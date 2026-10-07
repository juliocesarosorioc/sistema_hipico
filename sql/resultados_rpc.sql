-- ============================================================
--  RESULTADOS DE CARRERA: ESCRITURA CONTROLADA POR RPC
-- ============================================================
--  PROBLEMA (verificado en producción con la anon key):
--    `resultados_carreras` tiene una policy "for all to anon" con
--    USING/WITH CHECK (true) (ver sql/fix_rls_insercion_manual.sql), y la
--    anon key va incrustada en el bundle público. Eso dejó la tabla
--   abierta: cualquiera que abriera el sitio podía
--      UPDATE  resultados_carreras SET dividendos = ...   → cambiar el pago
--      DELETE FROM resultados_carreras                    → borrar el resultado
--    o sea, alterar los DIVIDENDOS que hoy mueven la liquidación de dinero.
--
--  SOLUCIÓN (mismo patrón que grupos_asignacion_rpc.sql):
--    1) `club_guardar_resultado_carrera` (security definer) valida la
--       capacidad EN EL SERVIDOR y recién ahí escribe.
--    2) La policy de `anon` queda SOLO para lectura: los reportes, el portal
--       y el semáforo siguen pudiendo leer sin sesión de Supabase.
--
--  ⚠️ ORDEN DE EJECUCIÓN IMPORTANTE:
--     (1) correr este archivo entero; (2) recién ahí desplegar la app.
--     La app llama a la RPC y SOLO cae al upsert directo si la RPC no
--     existe, así que mientras no se corra este SQL sigue funcionando igual.
--
--  EJECUTAR EN EL SQL EDITOR DE SUPABASE (una sola vez, es idempotente).
--
--  NOTA sobre `club_guardar_pizarra_carrera`, que YA existe en la base: no la
--  toques. No está en ningún .sql del repo, la app ya no la llama (el comentario
--  de src/app/(dashboard)/tablas-fijas/page.tsx:60 lo explica) y antes devolvía
--  `false` tragándose el error, así que la pizarra nunca se guardó por ahí. Esta
--  RPC la reemplaza como única vía de escritura de `resultados_carreras`.
-- ============================================================

-- ------------------------------------------------------------
-- (A) RPC DE ESCRITURA
--     Acepta cualquier subconjunto de columnas en p_fila; las que no
--     venir NO se tocan (así registrar una carrera programada no borra el
--     resultado ya cargado, que era el bug que motivó el merge-duplicates).
-- ------------------------------------------------------------
create or replace function public.club_guardar_resultado_carrera(
    p_fecha     date,
    p_hipodromo text,
    p_carrera   integer,
    p_fila      jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_hip       text;
    v_ganadores text[];
    v_creada    boolean := false;
begin
    v_hip := upper(btrim(coalesce(p_hipodromo, '')));
    if v_hip = '' then
        raise exception 'Hipodromo requerido';
    end if;
    if p_carrera is null or p_carrera <= 0 then
        raise exception 'Carrera requerida';
    end if;

    -- Permiso del lado del servidor. Sin sesión de Supabase `auth.uid()` es
    -- null y `tiene_capacidad` devuelve false: cierra en falso.
    -- Cualquiera de estos permisos habilita el guardado, porque cada caller
    -- legitimo pasa por un botón distinto.
    if not (
           public.tiene_capacidad(auth.uid(), 'carreras:fn_registrar_carrera')
        or public.tiene_capacidad(auth.uid(), 'gestion_jugadas:btn_cargar_resultados')
        or public.tiene_capacidad(auth.uid(), 'gestion_jugadas:fn_liquidar_carrera')
        or public.tiene_capacidad(auth.uid(), 'taquilla:btn_cargar_resultados')
    ) then
        raise exception 'Sin permiso para guardar resultados de carrera'
            using errcode = '42501';
    end if;

    if p_fila ? 'ganadores' and jsonb_typeof(p_fila -> 'ganadores') = 'array' then
        v_ganadores := array(select jsonb_array_elements_text(p_fila -> 'ganadores'));
    end if;

    insert into public.resultados_carreras as rc (
        fecha, hipodromo, carrera, ganadores, retirados,
        premio_oficial, premio_recalculado, detalle,
        aplicado_a_tablas, cargado_por, orden_llegada, dividendos
    )
    values (
        coalesce(p_fecha, current_date), v_hip, p_carrera,
        v_ganadores,
        nullif(btrim(coalesce(p_fila ->> 'retirados', '')), ''),
        nullif(p_fila ->> 'premio_oficial', '')::numeric,
        nullif(p_fila ->> 'premio_recalculado', '')::numeric,
        coalesce(p_fila -> 'detalle', '[]'::jsonb),
        coalesce((p_fila ->> 'aplicado_a_tablas')::boolean, false),
        nullif(btrim(coalesce(p_fila ->> 'cargado_por', '')), ''),
        case when p_fila ? 'orden_llegada' then p_fila -> 'orden_llegada' else null end,
        case when p_fila ? 'dividendos'   then p_fila -> 'dividendos'   else null end
    )
    on conflict (fecha, hipodromo, carrera) do update
        -- Solo se pisan las columnas que VINIERON en p_fila. Así registrar de
        -- nuevo una carrera ya liquidada no le borra el ganador ni los
        -- dividendos (el bug por el que antes se usaba merge-duplicates).
        set ganadores        = case when p_fila ? 'ganadores'         then v_ganadores
                                      else rc.ganadores end,
            retirados        = case when p_fila ? 'retirados'
                                      then nullif(btrim(coalesce(p_fila ->> 'retirados', '')), '')
                                      else rc.retirados end,
            premio_oficial   = case when p_fila ? 'premio_oficial'
                                      then nullif(p_fila ->> 'premio_oficial', '')::numeric
                                      else rc.premio_oficial end,
            premio_recalculado = case when p_fila ? 'premio_recalculado'
                                      then nullif(p_fila ->> 'premio_recalculado', '')::numeric
                                      else rc.premio_recalculado end,
            detalle          = case when p_fila ? 'detalle'           then p_fila -> 'detalle'
                                      else rc.detalle end,
            aplicado_a_tablas = case when p_fila ? 'aplicado_a_tablas'
                                      then coalesce((p_fila ->> 'aplicado_a_tablas')::boolean, false)
                                      else rc.aplicado_a_tablas end,
            cargado_por      = case when p_fila ? 'cargado_por'
                                      then nullif(btrim(coalesce(p_fila ->> 'cargado_por', '')), '')
                                      else rc.cargado_por end,
            orden_llegada    = case when p_fila ? 'orden_llegada'     then p_fila -> 'orden_llegada'
                                      else rc.orden_llegada end,
            dividendos       = case when p_fila ? 'dividendos'        then p_fila -> 'dividendos'
                                      else rc.dividendos end,
            updated_at       = now()
    returning (xmax = 0) into v_creada;
    return jsonb_build_object('ok', true, 'creada', v_creada);
end;
$$;

revoke all on function public.club_guardar_resultado_carrera(date, text, integer, jsonb) from public;
grant execute on function public.club_guardar_resultado_carrera(date, text, integer, jsonb) to anon, authenticated;

-- ------------------------------------------------------------
-- (B) CERRAR LA POLICY ABIERTA
--     Se elimina la policy "for all to anon USING(true) WITH CHECK(true)"
--     que dejaba editar/borrar dividendos con la anon key.
-- ------------------------------------------------------------
alter table public.resultados_carreras enable row level security;

drop policy if exists "resultados_carreras_for_all_club" on public.resultados_carreras;
drop policy if exists "resultados_carreras_lectura"         on public.resultados_carreras;
drop policy if exists "resultados_carreras_escritura_permitida" on public.resultados_carreras;

-- (B.1) LECTURA PÚBLICA.
--   La necesitan los reportes, el semáforo de Carreras del Día y el
--   constructor de la relación de jugadas, que corren en el navegador.
create policy "resultados_carreras_lectura"
    on public.resultados_carreras
    for select
    to anon, authenticated
    using (true);

-- (B.2) ESCRITURA SOLO CON CAPACIDAD (para el personal con sesión).
create policy "resultados_carreras_escritura_permitida"
    on public.resultados_carreras
    for all
    to authenticated
    using (
           public.tiene_capacidad(auth.uid(), 'carreras:fn_registrar_carrera')
        or public.tiene_capacidad(auth.uid(), 'gestion_jugadas:btn_cargar_resultados')
        or public.tiene_capacidad(auth.uid(), 'gestion_jugadas:fn_liquidar_carrera')
        or public.tiene_capacidad(auth.uid(), 'taquilla:btn_cargar_resultados')
    )
    with check (
           public.tiene_capacidad(auth.uid(), 'carreras:fn_registrar_carrera')
        or public.tiene_capacidad(auth.uid(), 'gestion_jugadas:btn_cargar_resultados')
        or public.tiene_capacidad(auth.uid(), 'gestion_jugadas:fn_liquidar_carrera')
        or public.tiene_capacidad(auth.uid(), 'taquilla:btn_cargar_resultados')
    );

-- (B.3) QUITAR LOS PRIVILEGIOS DE ESCRITURA A `anon`.
--   `grant all` incluía TRUNCATE, que ignora el RLS por completo.
revoke all privileges on public.resultados_carreras from anon;
grant select on public.resultados_carreras to anon, authenticated;

-- VERIFICACION ------------------------------------------------------
-- 1) La RPC existe y es idempotente:
--    select proname, prosecdef from pg_proc
--     where proname = 'club_guardar_resultado_carrera';
--
-- 2) Quedan 2 policies (lectura + escritura con capacidad), y NINGUNA
--    "for all to anon":
--    select policyname, cmd, roles from pg_policies
--     where tablename = 'resultados_carreras';
--
-- 3) Con la anon key, un UPDATE debe fallar con 42501:
--    curl -X PATCH "<ref>/rest/v1/resultados_carreras?carrera=eq.99999" \
--      -H "apikey: <anon>" -H "Authorization: Bearer <anon>" \
--      -H "Content-Type: application/json" -d '{"dividendos":{"win":999}}'
--
-- 4) La RPC sin sesión de staff debe fallar con "Sin permiso":
--    curl -X POST "<ref>/rest/v1/rpc/club_guardar_resultado_carrera" \
--      -H "apikey: <anon>" -H "Authorization: Bearer <anon>" \
--      -H "Content-Type: application/json" \
--      -d '{"p_fecha":"2026-01-01","p_hipodromo":"PRUEBA","p_carrera":99999,"p_fila":{}}'
