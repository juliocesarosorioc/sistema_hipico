-- ============================================================
--  JERARQUÍA DE PERMISOS DE CRUCES (Carrera → Cliente → Grupo)
-- ============================================================
--  La jerarquía permite_cruces decide si un cruce financiero (un cliente que
--  apuesta a favor y en contra del mismo ejemplar en la misma carrera)
--  recibe el descuento de comisión neta (comisión SOLO sobre la ganancia
--  neta). El switch general del GRUPO y el override del CLIENTE viven en las
--  columnas agregadas aquí (default TRUE = permitido). El nivel Carrera se
--  gobierna con el checkbox "Con Cruces" de Gestión de Jugadas.
--
--  Idempotente: ejecutar en Supabase -> SQL Editor.
-- ============================================================

ALTER TABLE public.grupos_venta
    ADD COLUMN IF NOT EXISTS permite_cruces BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE public.clientes
    ADD COLUMN IF NOT EXISTS permite_cruces BOOLEAN NOT NULL DEFAULT true;

-- Verificación:
-- SELECT table_name, column_name FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name IN ('clientes','grupos_venta')
--   AND column_name = 'permite_cruces';