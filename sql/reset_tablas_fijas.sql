-- ============================================================
--  LIMPIEZA: TABLAS FIJAS ENSAMBLADAS (inventario)
-- ============================================================
--  Borra TODA la data de las tablas fijas ensambladas (lo que se
--  carga desde la Gaceta o se arma manualmente en "Ensamblaje").
--  Ejecutar en Supabase -> SQL Editor cuando se pida "vaciarlo todo".
--
--  Qué se borra:
--   1) solicitudes_tablas  -> compras del portal asociadas a carreras
--   2) tabla_grupos        -> cupos de cada carrera por grupo
--   3) tablas_fijas        -> las carreras ensambladas/publicadas
--
--  No se toca: clientes, grupos_venta, ejemplares, gaceta_procesada,
--  tickets_apuestas (ventas históricas) ni los catálogos.
-- ============================================================

BEGIN;

DELETE FROM public.solicitudes_tablas;

DELETE FROM public.tabla_grupos;

DELETE FROM public.tablas_fijas;

COMMIT;

-- VERIFICACION ----------------------------------------------------------
-- select (select count(*) from public.tablas_fijas) as tablas_fijas,
--        (select count(*) from public.tabla_grupos) as tabla_grupos,
--        (select count(*) from public.solicitudes_tablas) as solicitudes;