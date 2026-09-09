-- ============================================================
--  AGREGAR COLUMNAS FALTANTES EN CLIENTES
-- ============================================================
--  Ejecutar en Supabase -> SQL Editor.
--  La aplicación esperaba columnas que la tabla clientes NO tenía:
--    telefono, comision, socio_asignado, mostrar_saldo_socio
--  Sin estas columnas, registrar/editar clientes devuelve:
--    "Could not find the 'comision' column of 'clientes' in the schema cache"
-- ============================================================

ALTER TABLE public.clientes
    ADD COLUMN IF NOT EXISTS telefono            TEXT,
    ADD COLUMN IF NOT EXISTS comision            NUMERIC NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS socio_asignado      TEXT,
    ADD COLUMN IF NOT EXISTS mostrar_saldo_socio BOOLEAN NOT NULL DEFAULT false;

-- Verificación (debe listar las 4 columnas nuevas):
-- SELECT column_name FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'clientes'
-- ORDER BY ordinal_position;