-- sql/realtime_reportes.sql  (ASCII-only, idempotente)
--
-- POR QUE
-- -------
-- Los reportes por modalidad (Tablas Fijas, Marcas, Dupletas, Remates y Polla)
-- tienen que reflejar en tiempo real los resultados oficiales de cada carrera
-- pagada/liquidada, y tambien las ventas y pagos que hace la casa.
--
-- El runbook de estabilizacion dejo en `supabase_realtime` a tablas_fijas,
-- resultados_carreras, dupletas y tickets_jugadas. `sql/realtime_carreras.sql`
-- agrego `carreras`. Este script:
--
--   * agrega `tickets_apuestas`  -> alta/estado/premio de cada jugada vendida
--                                  (tablas, marcas, dupletas y remates);
--   * agrega `remates` y `remate_pujas` -> cierre/reversion de remates;
--   * agrega `pollas`, `polla_ventas`, `polla_combinaciones` y
--     `polla_acumulado` -> ventas, puntajes y acumulado de la Polla.
--
-- El hook del cliente (`src/features/reportes/lib/useReporteEnVivo.ts`) ya
-- escucha esas tablas; si alguna no esta publicada, el reporte sigue andando
-- con el boton de refrescar. Es defensivo a proposito: no hace falta aplicar
-- este script para que la pantalla funcione, solo para que se actualice sola.
--
-- COMO
-- ----
-- Ejecutar una sola vez en el SQL Editor de Supabase. Es idempotente: si una
-- tabla ya esta en la publicacion o todavia no existe, no falla.
--
-- VERIFICAR
-- ---------
--   select tablename
--   from pg_publication_tables
--   where pubname = 'supabase_realtime'
--     and tablename in (
--       'tickets_apuestas', 'remates', 'remate_pujas',
--       'pollas', 'polla_ventas', 'polla_combinaciones', 'polla_acumulado'
--     )
--   order by tablename;

begin;

do $$
declare
    t text;
begin
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
        foreach t in array array[
            'public.tickets_apuestas',
            'public.remates',
            'public.remate_pujas',
            'public.pollas',
            'public.polla_ventas',
            'public.polla_combinaciones',
            'public.polla_acumulado'
        ]
        loop
            begin
                execute format('alter publication supabase_realtime add table %s', t);
            exception
                when duplicate_object then
                    null; -- ya estaba en la publicacion
                when undefined_table then
                    null; -- tabla no existe todavia (modulo sin migrar)
            end;
        end loop;
    end if;
end $$;

commit;
