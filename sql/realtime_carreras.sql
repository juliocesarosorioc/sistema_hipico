-- sql/realtime_carreras.sql  (ASCII-only, idempotente)
--
-- POR QUE
-- -------
-- La MATRIZ `carreras` es la fuente unica de que carreras se juegan. Al extraer
-- las carreras con IA, `sincronizarCarrerasAlCentral` las escribe aca, pero los
-- modulos abiertos en OTRAS pestanas, los demas usuarios y los hooks que leen
-- directo no se enteraban hasta recargar: la carrera existia en la matriz y
-- "no cargaba" en todos los modulos.
--
-- El runbook de estabilizacion puso en `supabase_realtime` a tablas_fijas,
-- resultados_carreras, dupletas y tickets_jugadas, pero NO a `carreras`. Este
-- script la agrega. El cliente ya escucha `public.carreras` (ver
-- src/shared/store/useRegistroCentral.ts -> useRealtimeCarreras).
--
-- COMO
-- ----
-- Ejecutar una sola vez en el SQL Editor de Supabase, DESPUES de sql/carreras.sql
-- (la tabla tiene que existir). Es idempotente: si ya esta en la publicacion,
-- no falla. Referencia de orden: sql/RUNBOOK_SQL.md.
--
-- VERIFICAR
-- ---------
--   select schemaname, tablename
--   from pg_publication_tables
--   where pubname = 'supabase_realtime' and tablename = 'carreras';
--   -- debe devolver 1 fila.

begin;

do $$
declare
    t text;
begin
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
        foreach t in array array['public.carreras']
        loop
            begin
                execute format('alter publication supabase_realtime add table %s', t);
            exception
                when duplicate_object then
                    null; -- ya estaba en la publicacion
                when undefined_table then
                    null; -- tabla no existe todavia; se re-ejecuta tras carreras.sql
            end;
        end loop;
    end if;
end $$;

-- REPLICA IDENTITY FULL: el evento lleva los valores de las columnas, asi un
-- filtro por fecha/hipodromo en el cliente funciona tambien en UPDATE/DELETE.
alter table public.carreras replica identity full;

commit;
