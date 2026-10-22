-- sql/realtime_logos.sql  (ASCII-only, idempotente)
--
-- POR QUE
-- -------
-- Los logos de HIPODROMOS y GRUPOS se guardan como Data URL en la columna
-- `logo_url`. Hasta ahora, cuando un operador cambiaba un logo, el aviso
-- (`logos-updated`) viajaba SOLO dentro de su propia pestaña: las otras
-- pestañas del mismo equipo, las otras PCs y el celular del dueno seguian
-- mostrando el logo viejo hasta recargar la pagina.
--
-- COMO
-- ----
-- Este script pone las DOS tablas que guardan logos en la publicacion
-- `supabase_realtime`. El cliente ya escucha `public.hipodromos` y
-- `public.grupos_venta` (ver src/shared/store/useHipodromosStore.ts ->
-- useRealtimeLogos): ante cualquier alta/edicion/baja bumpea la version de
-- logos y todas las pantallas se repintan solas.
--
-- Ejecutar una sola vez en el SQL Editor de Supabase. Es idempotente: si la
-- tabla ya esta en la publicacion, no falla. Requiere que las tablas existan
-- (sql/grupos_usuarios.sql / sql/logos_hipodromos_grupos.sql). Referencia de
-- orden: sql/RUNBOOK_SQL.md.
--
-- VERIFICAR
-- ---------
--   select schemaname, tablename
--   from pg_publication_tables
--   where pubname = 'supabase_realtime'
--     and tablename in ('hipodromos', 'grupos_venta');
--   -- debe devolver 2 filas.

begin;

do $$
declare
    t text;
begin
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
        foreach t in array array['public.hipodromos', 'public.grupos_venta']
        loop
            begin
                execute format('alter publication supabase_realtime add table %s', t);
            exception
                when duplicate_object then
                    null; -- ya estaba en la publicacion
                when undefined_table then
                    null; -- tabla no existe todavia; se re-ejecuta tras crear las tablas
            end;
        end loop;
    end if;
end $$;

-- REPLICA IDENTITY FULL: el evento lleva los valores de las columnas, asi el
-- cliente puede filtrar/decidir con el nombre y el logo en UPDATE/DELETE.
alter table public.hipodromos replica identity full;
alter table public.grupos_venta replica identity full;

commit;
