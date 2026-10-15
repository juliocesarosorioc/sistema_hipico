-- =============================================================================
-- MODULO DUPLETA - LIQUIDACION
-- =============================================================================
-- Regla de acierto: el cuadro `n1 x n2` GANA si `n1` gana la carrera1 Y `n2`
-- gana la carrera2 (daily double / dupleta clasica de dos carreras).
--
--   - Gana  -> acredita al jugador el `premio` congelado en el ticket
--              (nota_auditoria ->> 'premio') y marca el ticket 'Ganador'.
--   - Pierde-> solo registra: el stake ya se desconto al vender.
--   - Retiro-> si `n1` o `n2` se retiro, la jugada ANULA: se devuelve el stake
--              y el ticket queda 'Retirado' (premio y comision en 0).
--
-- El movimiento del BANQUERO de la modalidad no se hace aqui: el trigger
-- `trg_aplicar_banquero_ticket` (sql/banqueros.sql) lo aplica en la misma
-- transaccion al ver la transicion 'Pendiente' -> decidido.
--
-- Liquidacion todo-o-nada: si falta el orden de llegada de alguna de las dos
-- carreras, la funcion ABORTA y no mueve saldo de nadie.
--
-- Ejecutar en el SQL Editor de Supabase. Es idempotente.
-- =============================================================================

create or replace function public.club_liquidar_dupleta(
    p_hipodromo text,
    p_fecha     date,
    p_carrera1  int,
    p_carrera2  int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_hipo     text := upper(btrim(coalesce(p_hipodromo, '')));

    v_orden1   jsonb;
    v_retiros1 text;
    v_cab1     jsonb;
    v_orden2   jsonb;
    v_retiros2 text;
    v_cab2     jsonb;

    v_gan1     text;
    v_gan2     text;
    v_ret1     text[] := '{}';
    v_ret2     text[] := '{}';

    v_fila     record;
    v_tick     record;
    v_n1       text;
    v_n2       text;
    v_premio   numeric;

    v_liquidados int := 0;
    v_ganadores  int := 0;
    v_perdedores int := 0;
    v_anulados   int := 0;
    v_dinero     numeric := 0;
begin
    if v_hipo = '' then
        raise exception 'Debe indicar el hipodromo.';
    end if;

    -- ------------------------------------------------------------------
    -- Resultado de la carrera1. Sin orden de llegada no se decide nada.
    -- ------------------------------------------------------------------
    select orden_llegada, retirados, caballos into v_orden1, v_retiros1, v_cab1
      from public.resultados_carreras
     where upper(btrim(hipodromo)) = v_hipo and fecha = p_fecha and carrera = p_carrera1;
    if not found then
        raise exception 'La carrera % N%s no tiene resultado cargado. No se puede liquidar la dupleta.', v_hipo, p_carrera1;
    end if;
    if v_orden1 is null or jsonb_typeof(v_orden1) <> 'array' or jsonb_array_length(v_orden1) = 0 then
        raise exception 'La carrera % N%s no tiene ORDEN DE LLEGADA. Cargalo antes de liquidar la dupleta.', v_hipo, p_carrera1;
    end if;

    select orden_llegada, retirados, caballos into v_orden2, v_retiros2, v_cab2
      from public.resultados_carreras
     where upper(btrim(hipodromo)) = v_hipo and fecha = p_fecha and carrera = p_carrera2;
    if not found then
        raise exception 'La carrera % N%s no tiene resultado cargado. No se puede liquidar la dupleta.', v_hipo, p_carrera2;
    end if;
    if v_orden2 is null or jsonb_typeof(v_orden2) <> 'array' or jsonb_array_length(v_orden2) = 0 then
        raise exception 'La carrera % N%s no tiene ORDEN DE LLEGADA. Cargalo antes de liquidar la dupleta.', v_hipo, p_carrera2;
    end if;

    -- Ganador de cada carrera = puesto 1.
    select btrim(e ->> 'numero') into v_gan1
      from jsonb_array_elements(v_orden1) e
     order by (e ->> 'puesto')::int
     limit 1;

    select btrim(e ->> 'numero') into v_gan2
      from jsonb_array_elements(v_orden2) e
     order by (e ->> 'puesto')::int
     limit 1;

    -- Retirados de cada carrera: flag por caballo + texto libre.
    for v_fila in
        select btrim(c ->> 'numero') as num
          from jsonb_array_elements(coalesce(v_cab1, '[]'::jsonb)) c
         where coalesce((c ->> 'retirado')::boolean, false)
           and btrim(coalesce(c ->> 'numero', '')) <> ''
    loop
        v_ret1 := array_append(v_ret1, v_fila.num);
    end loop;
    for v_fila in
        select btrim(m[1]) as tok
          from regexp_matches(coalesce(v_retiros1, ''), '[0-9]+', 'g') as m
    loop
        v_ret1 := array_append(v_ret1, v_fila.tok);
    end loop;

    for v_fila in
        select btrim(c ->> 'numero') as num
          from jsonb_array_elements(coalesce(v_cab2, '[]'::jsonb)) c
         where coalesce((c ->> 'retirado')::boolean, false)
           and btrim(coalesce(c ->> 'numero', '')) <> ''
    loop
        v_ret2 := array_append(v_ret2, v_fila.num);
    end loop;
    for v_fila in
        select btrim(m[1]) as tok
          from regexp_matches(coalesce(v_retiros2, ''), '[0-9]+', 'g') as m
    loop
        v_ret2 := array_append(v_ret2, v_fila.tok);
    end loop;

    -- ------------------------------------------------------------------
    -- Tickets de esta dupleta (carrera1 x carrera2 del mismo dia).
    -- ------------------------------------------------------------------
    for v_tick in
        select t.*
          from public.tickets_apuestas t
         where t.estado = 'Pendiente'
           and upper(btrim(t.hipodromo)) = v_hipo
           and coalesce(t.nota_auditoria::jsonb ->> 'origen', '') = 'DUPLETA'
           and coalesce(t.nota_auditoria::jsonb ->> 'fecha_carrera', '') = p_fecha::text
           and nullif(t.nota_auditoria::jsonb ->> 'carrera1', '')::int = p_carrera1
           and nullif(t.nota_auditoria::jsonb ->> 'carrera2', '')::int = p_carrera2
         for update
    loop
        v_liquidados := v_liquidados + 1;
        v_n1     := btrim(coalesce(v_tick.nota_auditoria::jsonb ->> 'numero1', ''));
        v_n2     := btrim(coalesce(v_tick.nota_auditoria::jsonb ->> 'numero2', ''));
        v_premio := coalesce(nullif(v_tick.nota_auditoria::jsonb ->> 'premio', '')::numeric, 0);

        -- 1) Retiro de cualquiera de los dos -> anula y devuelve el stake.
        if v_n1 = any(v_ret1) or v_n2 = any(v_ret2) then
            update public.clientes
               set saldo_actual = coalesce(saldo_actual, 0) + coalesce(v_tick.monto_jugado, 0)
             where id = v_tick.cliente_juega_id;

            update public.tickets_apuestas
               set estado = 'Retirado', premio_pagar = 0, monto_decidido = 0, comision_pagada = 0
             where id = v_tick.id;

            v_dinero   := v_dinero + coalesce(v_tick.monto_jugado, 0);
            v_anulados := v_anulados + 1;
            continue;
        end if;

        -- 2) Gana si n1 gano la carrera1 y n2 gano la carrera2.
        if v_n1 = v_gan1 and v_n2 = v_gan2 then
            update public.clientes
               set saldo_actual = coalesce(saldo_actual, 0) + v_premio
             where id = v_tick.cliente_juega_id;

            update public.tickets_apuestas
               set estado = 'Ganador', premio_pagar = v_premio, monto_decidido = v_premio
             where id = v_tick.id;

            v_dinero    := v_dinero + v_premio;
            v_ganadores := v_ganadores + 1;
        else
            update public.tickets_apuestas
               set estado = 'Perdedor', premio_pagar = 0, monto_decidido = 0
             where id = v_tick.id;

            v_perdedores := v_perdedores + 1;
        end if;
    end loop;

    if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname = 'club_log_accion') then
        perform public.club_log_accion(
            'sistema', 'DUPLETA',
            format('LIQUIDACION %s N%s x N%s', v_hipo, p_carrera1, p_carrera2),
            null, null, format('ganador %s x %s', v_gan1, v_gan2)
        );
    end if;

    return jsonb_build_object(
        'ok',          true,
        'liquidados',  v_liquidados,
        'ganadores',   v_ganadores,
        'perdedores',  v_perdedores,
        'anulados',    v_anulados,
        'pagado',      v_dinero,
        'ganador1',    v_gan1,
        'ganador2',    v_gan2
    );
end;
$$;

grant execute on function public.club_liquidar_dupleta(text, date, int, int)
    to anon, authenticated, service_role;
