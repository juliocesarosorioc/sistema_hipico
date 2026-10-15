-- =============================================================================
-- MODULO DUPLETA - EDICION DE LA VENTA
-- =============================================================================
-- Una combinacion de dupleta se vende UNA sola vez. Despues, lo unico que se
-- puede hacer es cambiar el JUGADOR (reasignar la venta) o ANULARLA. Ambas cosas
-- mueven dinero (saldo de dos clientes, o devolucion) y tocan el ticket, asi que
-- NO se hacen desde el navegador: van por estas dos RPC transaccionales.
--
--   1) club_reasignar_dupleta(ticket, nuevo_cliente)
--        - devuelve el monto al jugador anterior
--        - cobra el monto al nuevo (valida estado/activo/tope/aval)
--        - el nuevo debe pertenecer AL MISMO GRUPO de la venta (asi el convenio
--          y el banquero del ticket siguen siendo validos)
--        - actualiza el ticket: cliente_juega_id / cliente_juega_nombre
--
--   2) club_anular_dupleta(ticket, usuario, motivo)
--        - devuelve el monto al jugador
--        - marca el ticket como Retirado + anulada (con motivo, por y fecha)
--
-- Ejecutar en el SQL Editor de Supabase. Es idempotente.
-- =============================================================================

create or replace function public.club_reasignar_dupleta(
    p_ticket_id  bigint,
    p_cliente_id uuid,
    p_usuario    text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_tk      public.tickets_apuestas%rowtype;
    v_nuevo   public.clientes%rowtype;
    v_monto   numeric;
    v_saldo   numeric;
    v_aval    numeric;
    v_limite  numeric;
    v_modo    text;
    v_ant     text;
begin
    if p_ticket_id is null then
        raise exception 'Falta el ticket de la dupleta.';
    end if;
    if p_cliente_id is null then
        raise exception 'Debe seleccionar el cliente que juega.';
    end if;

    -- El ticket se bloquea: dos cajas reasignando a la vez se serializan.
    select * into v_tk from public.tickets_apuestas where id = p_ticket_id for update;
    if not found then
        raise exception 'El ticket % no existe.', p_ticket_id;
    end if;
    if coalesce((v_tk.nota_auditoria::jsonb ->> 'origen'), '') <> 'DUPLETA' then
        raise exception 'El ticket % no es una dupleta.', p_ticket_id;
    end if;
    if coalesce(v_tk.anulada, false) then
        raise exception 'La dupleta ya fue anulada: no se puede cambiar el jugador.';
    end if;
    if coalesce(v_tk.estado, '') <> 'Pendiente' then
        raise exception 'La dupleta ya fue liquidada (%). No se puede cambiar el jugador.', v_tk.estado;
    end if;

    v_monto := coalesce(v_tk.monto_jugado, 0);

    -- Mismo jugador: no hay nada que mover.
    if v_tk.cliente_juega_id = p_cliente_id then
        return jsonb_build_object(
            'ok', true,
            'sin_cambios', true,
            'ticket_id', v_tk.id,
            'saldo_restante', (select coalesce(saldo_actual, 0) from public.clientes where id = p_cliente_id)
        );
    end if;

    -- Nuevo jugador (for update: se serializa con otras ventas).
    select * into v_nuevo from public.clientes where id = p_cliente_id for update;
    if not found then
        raise exception 'El cliente no existe.';
    end if;
    if v_nuevo.estado is not null and v_nuevo.estado <> 'Activo' then
        raise exception 'El cliente % esta % y no puede jugar.', v_nuevo.nombre, v_nuevo.estado;
    end if;

    -- Pertenece al MISMO grupo de la venta (misma regla que la app).
    if coalesce(v_nuevo.grupo_id::text, '') <> coalesce(v_tk.grupo_cobro_id::text, '')
       and not exists (
            select 1 from public.clientes_grupos cg
             where cg.cliente_id = p_cliente_id and cg.grupo_id = v_tk.grupo_cobro_id
       ) then
        raise exception 'El cliente % no pertenece al grupo de la venta.', v_nuevo.nombre;
    end if;

    -- Tope de juego: saldo + aval (modo 'libre' no topa).
    v_saldo  := coalesce(v_nuevo.saldo_actual, 0);
    v_aval   := coalesce(v_nuevo.aval, 0);
    v_limite := v_saldo + v_aval;
    v_modo   := lower(btrim(coalesce(v_nuevo.modo_juego, 'aval')));
    if v_modo <> 'libre' and v_limite < v_monto then
        raise exception
            'Saldo insuficiente. % tiene % de saldo y % de aval (disponible %) y la jugada es de %.',
            v_nuevo.nombre,
            to_char(v_saldo, 'FM999999999990.00'),
            to_char(v_aval, 'FM999999999990.00'),
            to_char(v_limite, 'FM999999999990.00'),
            to_char(v_monto, 'FM999999999990.00');
    end if;

    v_ant := v_tk.cliente_juega_nombre;

    -- 1) Devolver al jugador anterior.
    if v_tk.cliente_juega_id is not null then
        update public.clientes
           set saldo_actual = coalesce(saldo_actual, 0) + v_monto
         where id = v_tk.cliente_juega_id;
    end if;

    -- 2) Cobrar al nuevo.
    update public.clientes
       set saldo_actual = v_saldo - v_monto
     where id = p_cliente_id;

    -- 3) Transferir el ticket. El grupo no cambia, asi que el banquero y el
    --    convenio congelados siguen siendo validos.
    update public.tickets_apuestas
       set cliente_juega_id     = v_nuevo.id,
           cliente_juega_nombre = v_nuevo.nombre
     where id = v_tk.id;

    if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname = 'club_log_accion') then
        perform public.club_log_accion(
            p_usuario, 'DUPLETA',
            format('CAMBIO JUGADOR ticket %s: %s -> %s', v_tk.id, v_ant, v_nuevo.nombre),
            null, null, format('%s ticket %s', v_tk.hipodromo, v_tk.id)
        );
    end if;

    return jsonb_build_object(
        'ok',             true,
        'ticket_id',      v_tk.id,
        'monto',          v_monto,
        'saldo_restante', v_saldo - v_monto
    );
end;
$$;

create or replace function public.club_anular_dupleta(
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
    v_monto numeric;
begin
    if p_ticket_id is null then
        raise exception 'Falta el ticket de la dupleta.';
    end if;

    select * into v_tk from public.tickets_apuestas where id = p_ticket_id for update;
    if not found then
        raise exception 'El ticket % no existe.', p_ticket_id;
    end if;
    if coalesce((v_tk.nota_auditoria::jsonb ->> 'origen'), '') <> 'DUPLETA' then
        raise exception 'El ticket % no es una dupleta.', p_ticket_id;
    end if;

    -- Idempotente: anular dos veces no devuelve el dinero dos veces.
    if coalesce(v_tk.anulada, false) then
        return jsonb_build_object('ok', true, 'ya_anulada', true, 'ticket_id', v_tk.id);
    end if;
    if coalesce(v_tk.estado, '') <> 'Pendiente' then
        raise exception 'La dupleta ya fue liquidada (%). No se puede anular.', v_tk.estado;
    end if;

    v_monto := coalesce(v_tk.monto_jugado, 0);

    if v_monto > 0 and v_tk.cliente_juega_id is not null then
        update public.clientes
           set saldo_actual = coalesce(saldo_actual, 0) + v_monto
         where id = v_tk.cliente_juega_id;
    end if;

    update public.tickets_apuestas
       set estado          = 'Retirado',
           premio_pagar    = 0,
           monto_decidido  = 0,
           comision_pagada = 0,
           anulada         = true,
           anulada_motivo  = nullif(btrim(coalesce(p_motivo, '')), ''),
           anulada_por     = p_usuario,
           anulada_at      = now()
     where id = v_tk.id;

    if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname = 'club_log_accion') then
        perform public.club_log_accion(
            p_usuario, 'DUPLETA',
            format('ANULAR ticket %s (%s)', v_tk.id, coalesce(p_motivo, 'sin motivo')),
            null, null, format('%s ticket %s', v_tk.hipodromo, v_tk.id)
        );
    end if;

    return jsonb_build_object('ok', true, 'ticket_id', v_tk.id, 'monto', v_monto);
end;
$$;

grant execute on function public.club_reasignar_dupleta(bigint, uuid, text) to anon, authenticated, service_role;
grant execute on function public.club_anular_dupleta(bigint, text, text) to anon, authenticated, service_role;
