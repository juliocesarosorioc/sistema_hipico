-- ============================================================================
-- MIGRACIÓN: COMISIÓN PARTICULAR, INCENTIVOS Y COMISIÓN A SOCIOS
-- ============================================================================

ALTER TABLE IF EXISTS public.clientes
  ADD COLUMN IF NOT EXISTS comision_particular_pct numeric(5,2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS incentivo_pct numeric(5,2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS incentivo_base text DEFAULT 'MONTO_DECIDIDO',
  ADD COLUMN IF NOT EXISTS socio_id text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS socio_comision_pct numeric(5,2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS socio_base text DEFAULT 'MONTO_DECIDIDO',
  ADD COLUMN IF NOT EXISTS fecha_inicio_comision_socio date DEFAULT '2026-10-29';

-- Comentarios explicativos
COMMENT ON COLUMN public.clientes.comision_particular_pct IS 'Comisión cobrada al jugador cuando gana; si es null usa la del grupo';
COMMENT ON COLUMN public.clientes.incentivo_pct IS 'Porcentaje de devolución/incentivo al jugador carrera a carrera';
COMMENT ON COLUMN public.clientes.incentivo_base IS 'Base del incentivo: MONTO_DECIDIDO, PERDIDA o GANANCIA';
COMMENT ON COLUMN public.clientes.socio_id IS 'ID del socio/agencia responsable del jugador';
COMMENT ON COLUMN public.clientes.socio_comision_pct IS 'Porcentaje de comisión que devenga el socio por este jugador';
COMMENT ON COLUMN public.clientes.socio_base IS 'Base de la comisión del socio: MONTO_DECIDIDO, PERDIDA, GANANCIA o COMISION_COBRADA';
