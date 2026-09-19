-- ============================================================
--  MIGRACION: columnas de FECHA real de la carrera (gaceta)
--  en public.tablas_fijas
-- ============================================================
--  Qué falta: las páginas reporte_tablas_publicadas.html y
--  monitor_tablas_publicadas_imprimir.html ya seleccionan
--  `fecha` (+ `dia` y `fecha_creacion`) al leer la da de la
--  carrera desde la gaceta, pero la tabla todavía NO tiene esas
--  columnas -> la B  lanza 42703 (undefined column) y ambos
--  reportes quedan VACÍOS.
--
--  Este script es IDEMPOTENTE (se puede ejecutar muchas veces).
--  Ejecutar en:  Supabase -> SQL Editor
-- ============================================================

-- 1) Fecha real de la carrera (la que la gaceta escribe)
alter table public.tablas_fijas
    add column if not exists fecha  date;

-- 2) Día (respaldo/comodín usado en monitor imprimir)
alter table public.tablas_fijas
    add column if not exists dia    date;

-- (fecha_creacion ya existe como columna real: se mantiene como respaldo)

-- ============================================================
--  VERIFICACIÓN (opcional, descomentar):
--  select column_name from information_schema.columns
--  where table_schema='public' and table_name='tablas_fijas'
--  and column_name in ('fecha','dia','fecha_creacion')
--  order by column_name;
-- ============================================================
