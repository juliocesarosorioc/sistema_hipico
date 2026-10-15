-- sql/crear_rpc_programa_dia.sql  (ASCII-only, idempotente)
-- 401 real de la consola: POST programa_dia?on_conflict=fecha desde
-- js/components/programa_dia.js:72 (.upsert directo bloqueado por RLS).
-- Se exponen RPC security definer (mismo patron que club_listar_grupos)
-- para que la app con la anon key pueda guardar/leer el programa dia.
-- Ejecutar una sola vez en el SQL Editor de Supabase.

begin;

-- Guarda (upsert por fecha) el programa del dia y devuelve la fila.
create or replace function public.club_guardar_programa_dia(
    p_fecha      date,
    p_hipodromos text[],
    p_carreras   jsonb,
    p_creado_por text
)
returns table (fecha date, hipodromos text[], carreras jsonb, resumen text, creado_por text)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_fecha date   := coalesce(p_fecha, current_date);
    v_hipos text[] := coalesce(p_hipodromos, '{}'::text[]);
    v_carr  jsonb  := coalesce(p_carreras, '[]'::jsonb);
    v_res   text;
begin
    v_res := jsonb_array_length(v_carr) || ' carrera(s) · ' || coalesce(array_to_string(v_hipos, ', '), '');
    insert into public.programa_dia (fecha, hipodromos, carreras, resumen, creado_por)
    values (v_fecha, v_hipos, v_carr, v_res, coalesce(p_creado_por, 'desconocido'))
    on conflict (fecha) do update set
        hipodromos = excluded.hipodromos,
        carreras   = excluded.carreras,
        resumen    = excluded.resumen,
        creado_por = excluded.creado_por
    returning fecha, hipodromos, carreras, resumen, creado_por
    into fecha, hipodromos, carreras, resumen, creado_por;
    return next;
end;
$$;

-- Lee la fila mas reciente del programa del dia.
create or replace function public.club_leer_programa_dia()
returns table (fecha date, hipodromos text[], carreras jsonb, resumen text)
language plpgsql
security definer
set search_path = public
as $$
begin
    return query
    select p.fecha, p.hipodromos, p.carreras, p.resumen
    from public.programa_dia p
    order by p.fecha desc
    limit 1;
end;
$$;

revoke all on function public.club_guardar_programa_dia(date, text[], jsonb, text) from public;
revoke all on function public.club_leer_programa_dia() from public;
grant execute on function public.club_guardar_programa_dia(date, text[], jsonb, text) to anon, authenticated, service_role;
grant execute on function public.club_leer_programa_dia() to anon, authenticated, service_role;

commit;
