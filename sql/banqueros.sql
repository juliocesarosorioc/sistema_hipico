-- =============================================================================
-- BANQUERO POR GRUPO DE VENTA x MODALIDAD
-- =============================================================================
-- El banquero es un CLIENTE que toma el lado contrario de las jugadas de un
-- grupo. Su saldo se mueve en ESPEJO TOTAL contra el resultado de cada ticket:
--
--   - Pierde el jugador  -> banquero +monto_jugado   (se queda la apuesta)
--   - Gana el jugador    -> banquero -premio_pagar   (paga capital + ganancia)
--   - Retirado/anulado   -> banquero 0
--
-- Ademas se le cobra una comision sobre el monto decidido (por convenio, tipico
-- 2.5%) que es la MISMA que antes ponia la casa a nombre del grupo: cuando hay
-- banquero, esa comision la paga el banquero y la recibe el grupo. Si el
-- convenio esta en 0% (ej. un grupo donde el banquero no paga nada), el grupo no
-- cobra comision por esas jugadas.
--
-- El convenio se configura por (grupo, modalidad) en `banquero_convenio`:
--   modalidad: TABLAS | MARCAS | DUPLETA | REMATES | WPS | POLLAS
--   comision_base: MONTO_DECIDIDO (default) | MONTO_JUGADO | GANANCIA
-- (En Dupleta el acuerdo puede ser sobre el monto jugado o el decidido.)
--
-- CONGELADO EN EL TICKET: al vender, un trigger BEFORE INSERT copia el banquero
-- y su comision al ticket. Editar el convenio despues NO altera las jugadas ya
-- vendidas: la liquidacion lee el ticket, nunca el convenio.
--
-- LIQUIDACION: un trigger BEFORE UPDATE aplica el espejo y la comision cuando el
-- ticket pasa de 'Pendiente' a decidido. Asi cubre Marcas, Tablas, Dupleta,
-- Remates, WPS y Pollas sin editar cada liquidador.
--
-- Ejecutar en el SQL Editor de Supabase. Es idempotente.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1) CONVENIO
-- -----------------------------------------------------------------------------
create table if not exists public.banquero_convenio (
    id                    uuid primary key default gen_random_uuid(),
    grupo_id              uuid not null references public.grupos_venta(id) on delete cascade,
    modalidad             text not null,
    banquero_cliente_id   uuid not null references public.clientes(id) on delete cascade,
    banquero_nombre       text,
    cobra_comision        boolean not null default false,
    comision_porcentaje   numeric not null default 2.5,
    comision_base         text    not null default 'MONTO_DECIDIDO',
    activo                boolean not null default true,
    created_at            timestamptz not null default now(),
    updated_at            timestamptz not null default now(),
    constraint banquero_convenio_unico unique (grupo_id, modalidad),
    constraint banquero_convenio_base_chk
        check (comision_base in ('MONTO_DECIDIDO', 'MONTO_JUGADO', 'GANANCIA'))
);

alter table public.banquero_convenio
    add column if not exists banquero_nombre       text,
    add column if not exists cobra_comision         boolean not null default false,
    add column if not exists comision_porcentaje    numeric not null default 2.5,
    add column if not exists comision_base          text    not null default 'MONTO_DECIDIDO',
    add column if not exists activo                 boolean not null default true,
    add column if not exists updated_at             timestamptz not null default now();

comment on table public.banquero_convenio is
    'Banquero (cliente) que toma el lado contrario de las jugadas de un grupo, por modalidad. Congela espejo total + comision sobre el monto decidido en cada ticket.';

alter table public.banquero_convenio disable row level security;
grant all privileges on table public.banquero_convenio to anon, authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 2) COLUMNAS EN EL TICKET (congeladas al vender)
-- -----------------------------------------------------------------------------
alter table public.tickets_apuestas
    add column if not exists banquero_cliente_id        uuid,
    add column if not exists banquero_nombre            text,
    add column if not exists banquero_cobra_comision    boolean,
    add column if not exists banquero_comision_porcentaje numeric,
    add column if not exists banquero_comision_base     text,
    add column if not exists banquero_resultado         numeric,
    add column if not exists banquero_comision          numeric;


-- -----------------------------------------------------------------------------
-- 3) MODALIDAD A PARTIR DEL ORIGEN DEL TICKET
-- -----------------------------------------------------------------------------
create or replace function public.club_modalidad_ticket(p_origen text)
returns text
language sql
immutable
as $$
    select case upper(btrim(coalesce(p_origen, '')))
        when 'MARCAS'        then 'MARCAS'
        when 'TABLAS'        then 'TABLAS'
        when 'TABLAS_FIJAS'  then 'TABLAS'
        when 'DUPLETA'       then 'DUPLETA'
        when 'REMATE'        then 'REMATES'
        when 'REMATES'       then 'REMATES'
        when 'WPS'           then 'WPS'
        when 'WPS_LEGACY'    then 'WPS'
        when 'POLLAS'        then 'POLLAS'
        else null
    end;
$$;


-- -----------------------------------------------------------------------------
-- 4) CONGELAR AL VENDER
-- -----------------------------------------------------------------------------
-- Si el ticket trae grupo_cobro_id y el grupo tiene banquero para esa modalidad,
-- se copian banquero y comision al ticket. No pisa un banquero ya seteado a mano.
create or replace function public.club_fijar_banquero_ticket()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_origen    text;
    v_modalidad text;
    v_conv      public.banquero_convenio%rowtype;
begin
    if new.banquero_cliente_id is not null then
        return new;
    end if;
    if new.grupo_cobro_id is null then
        return new;
    end if;

    begin
        v_origen := new.nota_auditoria::jsonb ->> 'origen';
    exception when others then
        v_origen := null;
    end;

    v_modalidad := public.club_modalidad_ticket(v_origen);
    if v_modalidad is null then
        return new;
    end if;

    select * into v_conv
      from public.banquero_convenio
     where grupo_id  = new.grupo_cobro_id
       and modalidad = v_modalidad
       and coalesce(activo, true)
     limit 1;

    if not found then
        return new;
    end if;

    new.banquero_cliente_id          := v_conv.banquero_cliente_id;
    new.banquero_nombre              := coalesce(
                                            v_conv.banquero_nombre,
                                            (select nombre from public.clientes where id = v_conv.banquero_cliente_id)
                                        );
    new.banquero_cobra_comision      := coalesce(v_conv.cobra_comision, false);
    new.banquero_comision_porcentaje := coalesce(v_conv.comision_porcentaje, 0);
    new.banquero_comision_base       := coalesce(v_conv.comision_base, 'MONTO_DECIDIDO');
    return new;
end;
$$;

drop trigger if exists trg_fijar_banquero_ticket on public.tickets_apuestas;
create trigger trg_fijar_banquero_ticket
    before insert on public.tickets_apuestas
    for each row execute function public.club_fijar_banquero_ticket();


-- -----------------------------------------------------------------------------
-- 5) LIQUIDAR CONTRA EL BANQUERO (espejo + comision)
-- -----------------------------------------------------------------------------
-- Se dispara SOLO en la transicion 'Pendiente' -> decidido y una sola vez por
-- ticket (guard por banquero_resultado). El espejo y la comision se aplican al
-- saldo del banquero en la misma transaccion que liquida al jugador.
create or replace function public.club_aplicar_banquero_ticket()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_base numeric := 0;
    v_com  numeric := 0;
    v_mov  numeric := 0;
    v_pct  numeric := 0;
begin
    if new.banquero_cliente_id is null then
        return new;
    end if;

    if coalesce(old.estado, '') <> 'Pendiente'
       or new.estado not in ('Ganador', 'Perdedor', 'Retirado')
       or new.banquero_resultado is not null then
        return new;
    end if;

    -- Espejo total.
    if new.estado = 'Ganador' then
        v_mov := -coalesce(new.premio_pagar, 0);
    elsif new.estado = 'Perdedor' then
        v_mov := coalesce(new.monto_jugado, 0);
    else
        v_mov := 0;
    end if;

    -- Comision sobre el monto decidido (o la base pactada), solo si decide.
    if new.estado <> 'Retirado' and coalesce(new.banquero_cobra_comision, false) then
        v_pct := coalesce(new.banquero_comision_porcentaje, 0);
        if new.banquero_comision_base = 'MONTO_JUGADO' then
            v_base := coalesce(new.monto_jugado, 0);
        elsif new.banquero_comision_base = 'GANANCIA' then
            v_base := greatest(0, coalesce(new.premio_pagar, 0) - coalesce(new.monto_jugado, 0));
        else
            -- MONTO_DECIDIDO. En Marcas/Tablas/Dupleta `monto_decidido` espeja
            -- `premio_pagar` al decidir; en Remates es el monto de la venta, asi
            -- que la base por defecto tambien cobra comision en la subasta.
            v_base := coalesce(new.monto_decidido, 0);
        end if;
        v_com := round(v_base * v_pct / 100, 2);
    end if;

    new.banquero_comision   := v_com;
    new.banquero_resultado  := round(v_mov - v_com, 2);
    -- Cuando hay banquero, la comision que recibe el grupo es la que paga el
    -- banquero: reemplaza la que la casa registraba antes.
    new.comision_pagada     := v_com;

    update public.clientes
       set saldo_actual = coalesce(saldo_actual, 0) + new.banquero_resultado
     where id = new.banquero_cliente_id;

    return new;
end;
$$;

drop trigger if exists trg_aplicar_banquero_ticket on public.tickets_apuestas;
create trigger trg_aplicar_banquero_ticket
    before update on public.tickets_apuestas
    for each row execute function public.club_aplicar_banquero_ticket();


-- -----------------------------------------------------------------------------
-- VERIFICACION
-- -----------------------------------------------------------------------------
--   select * from public.banquero_convenio order by grupo_id, modalidad;
--   select id, nombre_jugada, estado, banquero_nombre, banquero_resultado,
--          banquero_comision
--     from public.tickets_apuestas
--    where banquero_cliente_id is not null
--    order by fecha_registro desc
--    limit 20;
-- =============================================================================
