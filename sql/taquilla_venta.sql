-- =============================================================================
--  VENTA INDIVIDUAL DE TAQUILLA ("BetSlip" / Gestión de Jugadas)
--  club_vender_jugada  +  club_anular_jugada
-- =============================================================================
--  Por que una RPC y no un insert desde el navegador:
--  la venta toca tres cosas que no pueden quedar a medias. Si se crea el ticket
--  y falla el descuento, el jugador tiene apuesta sin pagar. Si se descuenta y
--  falla el ticket, se perdio plata. Por eso va en UNA sola transaccion
--  (mismo criterio que sql/marcas_venta.sql, sql/tablas_venta.sql y
--  sql/dupleta_venta.sql).
--
--  Hasta ahora la Taquilla vivia SOLO en memoria (localStorage): el operador
--  cargaba jugadas, pagaba la carrera y `aplicarLiquidacionSaldos` liquidaba
--  los tickets que OTRO flujo hubiera escrito — nunca los que acababa de
--  vender. Con esta RPC la venta individual SI produce filas reales en
--  `tickets_apuestas` (con nombre_jugada, caballo, monto_jugado, cliente y
--  grupo de cobro), cobra el saldo al momento de vender y deja el ticket
--  'Pendiente' para que lo decida la liquidacion universal.
--
--  CONGELAMIENTO del grupo: el ticket guarda grupo_cobro_id + nombre (y la
--  comision del grupo) para que corregir el grupo despues no reescriba la
--  venta. La ANULACION devuelve el saldo exacto que se desconto.
--
--  Ejecutar en el SQL Editor de Supabase. Es idempotente (create or replace +
--  add column / create index if not exists).
-- =============================================================================

-- ---------------------------------------------------------------------------
--  Columnas de auditoria de anulacion (las usa sql/jugadas_monitor.sql; se
--  agregan aqui para que la anulacion no dependa de haber corrido ese script).
-- ---------------------------------------------------------------------------
alter table public.tickets_apuestas
    add column if not exists anulada        boolean not null default false,
    add column if not exists anulada_motivo text,
    add column if not exists anulada_por    text,
    add column if not exists anulada_at     timestamptz,
    add column if not exists cliente_consigue_nombre text;

-- ===========================================================================
--  VENTA
-- ===========================================================================
create or replace function public.club_vender_jugada(
    p_hipodromo     text,
    p_fecha         date,
    p_carrera       int,
    p_jugada        text,
    p_caballo       text,
    p_monto         numeric,
    p_cliente_id    uuid,
    p_grupo_id      uuid    default null,
    p_cliente_dador text    default null,
    p_moneda        text    default null,
    p_comision      numeric default null,
    p_modalidad     text    default null,
    p_usuario       text    default null,
    p_idem          text    default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_cliente  public.clientes%rowtype;
    v_grupo    public.grupos_venta%rowtype;
    v_hipo     text;
    v_jugada   text;
    v_caballo  text;
    v_num      int;
    v_idem     text;
    v_grupo_id uuid;
    v_saldo    numeric;
    v_aval     numeric;
    v_limite   numeric;
    v_modo     text;
    v_moneda   text;
    v_comision numeric;
    v_ins      public.tickets_apuestas%rowtype;
begin
    -- ------------------------------------------------------------------
    -- IDEMPOTENCIA: si ya hay un ticket con esta clave, se devuelve ese
    -- ticket sin debitar nada (reintento seguro ante timeout de la red).
    -- ------------------------------------------------------------------
    v_idem := nullif(btrim(coalesce(p_idem, '')), '');
    if v_idem is not null then
        select * into v_ins
          from public.tickets_apuestas
         where nota_auditoria::jsonb ->> 'idempotencia' = v_idem
           and coalesce(nota_auditoria::jsonb ->> 'origen', '') = 'TAQUILLA';

        if found then
            return jsonb_build_object(
                'ok',             true,
                'ya_existia',     true,
                'ticket_id',      v_ins.id,
                'estado',         v_ins.estado,
                'saldo_restante', (select coalesce(saldo_actual, 0) from public.clientes where id = v_ins.cliente_juega_id)
            );
        end if;
    end if;

    -- ------------------------------------------------------------------
    -- Entrada
    -- ------------------------------------------------------------------
    if p_monto is null or p_monto <= 0 then
        raise exception 'El monto debe ser un numero mayor a cero.';
    end if;
    if p_cliente_id is null then
        raise exception 'Debe seleccionar el cliente que juega.';
    end if;

    v_hipo := upper(btrim(coalesce(p_hipodromo, '')));
    if v_hipo = '' then
        raise exception 'Debe indicar el hipodromo.';
    end if;
    if p_carrera is null or p_carrera <= 0 then
        raise exception 'Debe indicar la carrera.';
    end if;

    v_jugada := upper(btrim(coalesce(p_jugada, '')));
    if v_jugada = '' then
        raise exception 'La jugada (nomenclatura) no puede estar vacia.';
    end if;

    v_caballo := btrim(coalesce(p_caballo, ''));
    -- `ejemplar_numero` es int en tickets_apuestas: solo pasa un numero suelto
    -- (un pareo "1-2" o "12 13 x 14 15" se guarda en `caballo` como texto).
    v_num := case when v_caballo ~ '^[0-9]+$' then v_caballo::int else null end;

    -- ------------------------------------------------------------------
    -- Cliente que JUEGA (for update: dos cajas descontandole a la vez se
    -- serializan).
    -- ------------------------------------------------------------------
    select * into v_cliente from public.clientes where id = p_cliente_id for update;
    if not found then
        raise exception 'El cliente no existe.';
    end if;
    if v_cliente.estado is not null and v_cliente.estado <> 'Activo' then
        raise exception 'El cliente % esta % y no puede jugar.', v_cliente.nombre, v_cliente.estado;
    end if;

    -- ------------------------------------------------------------------
    -- Grupo de cobro: si no viene, se usa el grupo principal del cliente.
    -- Si existe, se valida pertenencia con la MISMA regla que la app
    -- (clientes.grupo_id o clientes_grupos).
    -- ------------------------------------------------------------------
    v_grupo_id := p_grupo_id;
    if v_grupo_id is null then
        v_grupo_id := v_cliente.grupo_id;
    end if;

    if v_grupo_id is not null then
        select * into v_grupo from public.grupos_venta where id = v_grupo_id;
        if not found then
            raise exception 'El grupo de venta no existe.';
        end if;
        if v_grupo.activo is not null and v_grupo.activo = false then
            raise exception 'El grupo % esta inactivo.', coalesce(v_grupo.nombre, '?');
        end if;
        if coalesce(v_cliente.grupo_id::text, '') <> v_grupo_id::text
           and not exists (
                select 1 from public.clientes_grupos cg
                 where cg.cliente_id = p_cliente_id and cg.grupo_id = v_grupo_id
           ) then
            raise exception 'El cliente % no pertenece al grupo %.', v_cliente.nombre, coalesce(v_grupo.nombre, '?');
        end if;
    end if;

    -- ------------------------------------------------------------------
    -- TOPE DE JUEGO: saldo + aval (modo 'libre' no topa). El aval NO se
    -- descuenta; se topa contra saldo + aval y es el saldo el que baja.
    -- ------------------------------------------------------------------
    v_saldo := coalesce(v_cliente.saldo_actual, 0);
    v_aval  := coalesce(v_cliente.aval, 0);
    v_limite := v_saldo + v_aval;
    v_modo := lower(btrim(coalesce(v_cliente.modo_juego, 'aval')));

    if v_modo <> 'libre' and v_limite < p_monto then
        raise exception
            'Saldo insuficiente. % tiene % de saldo y % de aval (disponible %) y la jugada es de %.',
            v_cliente.nombre,
            to_char(v_saldo, 'FM999999999990.00'),
            to_char(v_aval, 'FM999999999990.00'),
            to_char(v_limite, 'FM999999999990.00'),
            to_char(p_monto, 'FM999999999990.00');
    end if;

    v_moneda := coalesce(
        nullif(upper(btrim(coalesce(p_moneda, ''))), ''),
        case when v_grupo_id is not null then upper(v_grupo.moneda) end,
        'USD'
    );
    v_comision := coalesce(p_comision, v_grupo.comision_default, 0);

    -- Riesgo descontado ANTES de crear el ticket, en la misma transaccion.
    update public.clientes
       set saldo_actual = v_saldo - p_monto
     where id = p_cliente_id;

    insert into public.tickets_apuestas (
        fecha_registro, hipodromo, carrera, nombre_jugada, caballo, ejemplar_numero,
        cantidad_tablas, monto_jugado, monto_decidido, premio_pagar,
        cliente_juega_id, cliente_juega_nombre, cliente_consigue_nombre,
        grupo, grupo_cobro_id, grupo_cobro_nombre, grupo_comision_id, grupo_comision_nombre,
        comision_porcentaje, comision_pagada,
        estado, moneda, tasa_cambio, nota_auditoria
    )
    values (
        now(), v_hipo, p_carrera, v_jugada, v_caballo, v_num,
        1, p_monto, 0, 0,
        v_cliente.id, v_cliente.nombre, nullif(btrim(coalesce(p_cliente_dador, '')), ''),
        case when v_grupo_id is not null then v_grupo.nombre end,
        v_grupo_id,
        case when v_grupo_id is not null then v_grupo.nombre end,
        v_grupo_id,
        case when v_grupo_id is not null then v_grupo.nombre end,
        v_comision, 0,
        'Pendiente', v_moneda, 1,
        jsonb_build_object(
            'origen',        'TAQUILLA',
            'fecha_carrera', p_fecha,
            'jugada',        v_jugada,
            'caballo',       v_caballo,
            'modalidad',     nullif(upper(btrim(coalesce(p_modalidad, ''))), ''),
            'dador',         nullif(btrim(coalesce(p_cliente_dador, '')), ''),
            'usuario',       p_usuario,
            'idempotencia',  v_idem
        )
    )
    returning * into v_ins;

    -- Auditoria best-effort: si la funcion de log no esta, la venta igual vale.
    if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname = 'club_log_accion') then
        perform public.club_log_accion(
            p_usuario, 'TAQUILLA', format('VENTA %s C%s N%s', v_jugada, p_carrera, v_caballo),
            null, null, format('%s %s C%s', v_hipo, p_fecha, p_carrera)
        );
    end if;

    return jsonb_build_object(
        'ok',             true,
        'ticket_id',      v_ins.id,
        'saldo_restante', v_saldo - p_monto
    );

    exception
        when unique_violation then
            raise exception 'Esa jugada ya fue registrada (reintento con la misma clave). No se desconto nada.';
end;
$$;

-- Garantia real de idempotencia: si dos cajas mandan la misma clave a la vez,
-- la segunda choca contra el indice y la transaccion entera se revierte.
create unique index if not exists tickets_taquilla_idem_unico
    on public.tickets_apuestas ((nota_auditoria::jsonb ->> 'idempotencia'))
 where nota_auditoria::jsonb ->> 'idempotencia' is not null
   and coalesce(nota_auditoria::jsonb ->> 'origen', '') = 'TAQUILLA';

grant execute on function public.club_vender_jugada(text, date, int, text, text, numeric, uuid, uuid, text, text, numeric, text, text, text)
    to anon, authenticated, service_role;

-- ===========================================================================
--  ANULACION (devolver la jugada cargada por error)
-- ===========================================================================
--  Solo se puede anular un ticket 'Pendiente'. Un ticket ya decidido
--  (Ganador/Perdedor/Retirado) NO se anula por aqui: se corrige por el flujo
--  de resultados/retiros, que recalcula los premios.
create or replace function public.club_anular_jugada(
    p_ticket_id bigint,
    p_usuario   text default null,
    p_motivo    text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_tk    public.tickets_apuestas%rowtype;
    v_saldo numeric;
begin
    select * into v_tk from public.tickets_apuestas where id = p_ticket_id for update;
    if not found then
        raise exception 'El ticket % no existe.', p_ticket_id;
    end if;

    -- Idempotente: anular dos veces no devuelve el saldo dos veces.
    if coalesce(v_tk.anulada, false) then
        return jsonb_build_object('ok', true, 'ya_anulada', true, 'ticket_id', v_tk.id, 'devuelto', 0);
    end if;

    if v_tk.estado <> 'Pendiente' then
        raise exception 'No se puede anular el ticket %: su estado es %.', p_ticket_id, v_tk.estado;
    end if;

    -- Devolucion exacta del saldo que se desconto en la venta.
    if v_tk.cliente_juega_id is not null and coalesce(v_tk.monto_jugado, 0) > 0 then
        select saldo_actual into v_saldo from public.clientes where id = v_tk.cliente_juega_id for update;
        update public.clientes
           set saldo_actual = coalesce(v_saldo, 0) + v_tk.monto_jugado
         where id = v_tk.cliente_juega_id;
    end if;

    update public.tickets_apuestas
       set estado          = 'Anulado',
           anulada         = true,
           anulada_motivo  = nullif(btrim(coalesce(p_motivo, '')), ''),
           anulada_por     = p_usuario,
           anulada_at      = now(),
           premio_pagar    = 0,
           monto_decidido  = 0
     where id = p_ticket_id;

    if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname = 'club_log_accion') then
        perform public.club_log_accion(
            p_usuario, 'TAQUILLA', format('ANULA ticket %s', p_ticket_id),
            null, null, coalesce(nullif(btrim(coalesce(p_motivo, '')), ''), 'sin motivo')
        );
    end if;

    return jsonb_build_object(
        'ok',        true,
        'ticket_id', p_ticket_id,
        'devuelto',  coalesce(v_tk.monto_jugado, 0)
    );
end;
$$;

grant execute on function public.club_anular_jugada(bigint, text, text)
    to anon, authenticated, service_role;

-- Indice de apoyo para el monitor por carrera (mismo espiritu que
-- sql/jugadas_monitor.sql).
create index if not exists idx_tickets_taquilla_carrera
    on public.tickets_apuestas (hipodromo, carrera, estado)
 where nota_auditoria::jsonb ->> 'origen' = 'TAQUILLA';
