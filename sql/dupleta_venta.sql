-- =============================================================================
-- MODULO DUPLETA - VENTA (saldo + ticket en una transaccion)
-- =============================================================================
-- La dupleta se vende por celda (un cruce de dos ejemplares de dos carreras).
-- Igual que Marcas y Tablas Fijas, la venta NO se hace desde el navegador: esta
-- RPC descuenta el saldo del jugador y crea el ticket dentro de UNA
-- TRANSACCION, para que un fallo no deje saldo debitado sin ticket.
--
-- Estado del ticket:
--   estado        = 'Pendiente'  (a la espera del resultado de las dos carreras)
--   nombre_jugada = 'DUPLETA <n1> x <n2>'
--   caballo       = '<n1>x<n2>'
--   origen        = 'DUPLETA'    (para el trigger de banquero)
--   grupo_cobro_id = grupo       (el trigger de banquero congela banquero y comision)
--
-- El `premio` (paga estimada) se guarda en `nota_auditoria`; la liquidacion de
-- Dupleta dependera de los resultados de las dos carreras y aun no se
-- implementa aqui.
--
-- Ejecutar en el SQL Editor de Supabase. Es idempotente.
-- =============================================================================

create or replace function public.club_vender_dupleta(
    p_hipodromo  text,
    p_fecha      date,
    p_carrera1   int,
    p_carrera2   int,
    p_numero1    text,
    p_numero2    text,
    p_monto      numeric,
    p_cliente_id uuid,
    p_grupo_id   uuid,
    p_premio     numeric default 0,
    p_usuario    text default null,
    p_idem       text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_cliente public.clientes%rowtype;
    v_grupo   public.grupos_venta%rowtype;
    v_hipo    text;
    v_n1      text;
    v_n2      text;
    v_idem    text;
    v_saldo   numeric;
    v_aval    numeric;
    v_limite  numeric;
    v_modo    text;
    v_ins     public.tickets_apuestas%rowtype;
begin
    -- ------------------------------------------------------------------
    -- IDEMPOTENCIA: si ya hay un ticket con esta clave, se devuelve ese
    -- ticket sin debitar nada (reintento seguro ante timeout de la red).
    -- ------------------------------------------------------------------
    v_idem := nullif(btrim(coalesce(p_idem, '')), '');
    if v_idem is not null then
        select * into v_ins
          from public.tickets_apuestas
         where nota_auditoria::jsonb ->> 'idempotencia' = v_idem;

        if found then
            return jsonb_build_object(
                'ok', true,
                'ya_existia', true,
                'ticket_id', v_ins.id,
                'estado', v_ins.estado,
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
    if p_grupo_id is null then
        raise exception 'Debe seleccionar el grupo de venta.';
    end if;

    v_hipo := upper(btrim(coalesce(p_hipodromo, '')));
    if v_hipo = '' then
        raise exception 'Debe indicar el hipodromo.';
    end if;

    v_n1 := btrim(coalesce(p_numero1, ''));
    v_n2 := btrim(coalesce(p_numero2, ''));
    if v_n1 = '' or v_n2 = '' then
        raise exception 'Debe indicar los dos ejemplares de la dupleta.';
    end if;
    if p_carrera1 is null or p_carrera2 is null then
        raise exception 'Debe indicar las dos carreras de la dupleta.';
    end if;

    -- ------------------------------------------------------------------
    -- Grupo
    -- ------------------------------------------------------------------
    select * into v_grupo from public.grupos_venta where id = p_grupo_id;
    if not found then
        raise exception 'El grupo de venta no existe.';
    end if;
    if v_grupo.activo is not null and v_grupo.activo = false then
        raise exception 'El grupo % esta inactivo.', coalesce(v_grupo.nombre, '?');
    end if;

    -- ------------------------------------------------------------------
    -- Cliente (for update: dos cajas descontandole a la vez se serializan)
    -- ------------------------------------------------------------------
    select * into v_cliente from public.clientes where id = p_cliente_id for update;
    if not found then
        raise exception 'El cliente no existe.';
    end if;
    if v_cliente.estado is not null and v_cliente.estado <> 'Activo' then
        raise exception 'El cliente % esta % y no puede jugar.', v_cliente.nombre, v_cliente.estado;
    end if;

    -- Pertenencia al grupo con la MISMA regla que la app: clientes.grupo_id o
    -- clientes_grupos.
    if coalesce(v_cliente.grupo_id::text, '') <> p_grupo_id::text
       and not exists (
            select 1 from public.clientes_grupos cg
             where cg.cliente_id = p_cliente_id and cg.grupo_id = p_grupo_id
       ) then
        raise exception 'El cliente % no pertenece al grupo %.', v_cliente.nombre, coalesce(v_grupo.nombre, '?');
    end if;

    -- ------------------------------------------------------------------
    -- TOPE DE JUEGO: saldo + aval (modo 'libre' no topa).
    -- ------------------------------------------------------------------
    v_saldo  := coalesce(v_cliente.saldo_actual, 0);
    v_aval   := coalesce(v_cliente.aval, 0);
    v_limite := v_saldo + v_aval;
    v_modo   := lower(btrim(coalesce(v_cliente.modo_juego, 'aval')));

    if v_modo <> 'libre' and v_limite < p_monto then
        raise exception
            'Saldo insuficiente. % tiene % de saldo y % de aval (disponible %) y la jugada es de %.',
            v_cliente.nombre,
            to_char(v_saldo, 'FM999999999990.00'),
            to_char(v_aval, 'FM999999999990.00'),
            to_char(v_limite, 'FM999999999990.00'),
            to_char(p_monto, 'FM999999999990.00');
    end if;

    -- El riesgo se descuenta ANTES de crear el ticket, en la misma transaccion.
    update public.clientes
       set saldo_actual = v_saldo - p_monto
     where id = p_cliente_id;

    insert into public.tickets_apuestas (
        fecha_registro, hipodromo, carrera, nombre_jugada, caballo, ejemplar_numero,
        cantidad_tablas, monto_jugado, monto_decidido, premio_pagar,
        cliente_juega_id, cliente_juega_nombre,
        grupo, grupo_cobro_id, grupo_cobro_nombre, grupo_comision_id, grupo_comision_nombre,
        comision_porcentaje, comision_pagada,
        estado, moneda, tasa_cambio, nota_auditoria
    )
    values (
        now(), v_hipo, p_carrera1,
        format('DUPLETA %s x %s', v_n1, v_n2), v_n1 || 'x' || v_n2, nullif(v_n1, '')::int,
        1, p_monto, 0, 0,
        v_cliente.id, v_cliente.nombre,
        v_grupo.nombre, v_grupo.id, v_grupo.nombre, v_grupo.id, v_grupo.nombre,
        0, 0,
        'Pendiente', coalesce(upper(v_grupo.moneda), 'USD'), 1,
        jsonb_build_object(
            'origen',        'DUPLETA',
            'fecha_carrera', p_fecha,
            'carrera1',      p_carrera1,
            'carrera2',      p_carrera2,
            'numero1',       v_n1,
            'numero2',       v_n2,
            'premio',        coalesce(p_premio, 0),
            'usuario',       p_usuario,
            'idempotencia',  v_idem
        )
    )
    returning * into v_ins;

    -- Auditoria best-effort: si la funcion de log no esta, la venta igual vale.
    if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname = 'club_log_accion') then
        perform public.club_log_accion(
            p_usuario, 'DUPLETA', format('VENTA %s x %s', v_n1, v_n2),
            null, null, format('%s %s N%s x N%s', v_hipo, p_fecha, p_carrera1, p_carrera2)
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
create unique index if not exists tickets_dupleta_idem_unico
    on public.tickets_apuestas ((nota_auditoria::jsonb ->> 'idempotencia'))
 where nota_auditoria::jsonb ->> 'idempotencia' is not null
   and coalesce(nota_auditoria::jsonb ->> 'origen', '') = 'DUPLETA';

grant execute on function public.club_vender_dupleta(text, date, int, int, text, text, numeric, uuid, uuid, numeric, text, text)
    to anon, authenticated, service_role;
