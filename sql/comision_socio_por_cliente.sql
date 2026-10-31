-- ============================================================================
-- COMISIÓN DE SOCIOS POR CLIENTES Y DEVOLUCIONES DE JUGADAS
-- ============================================================================
-- Permite que un cliente tenga:
--   1. Devolución por sí mismo (clientes.devolucion, ej. 1.00%, 1.25%, 1.50%).
--   2. Socio asignado (clientes.socio_asignado).
--   3. Comisión que devenga el socio por las jugadas de este cliente (clientes.comision_socio_pct).
--   4. Fecha de inicio de recálculo (clientes.fecha_inicio_comision_socio).
--
-- Se imputa en el saldo del socio de forma contable, no altera el cobro/pago del ticket.
-- ============================================================================

BEGIN;

-- 1. Agregar columnas a la tabla clientes si no existen
ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS comision_socio_pct NUMERIC(5,2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS fecha_inicio_comision_socio DATE DEFAULT '2026-10-29';

COMMENT ON COLUMN public.clientes.comision_socio_pct IS
  'Porcentaje de comisión que se le otorga al socio_asignado por las jugadas de este cliente.';

COMMENT ON COLUMN public.clientes.fecha_inicio_comision_socio IS
  'Fecha a partir de la cual se calculan o recalculan las comisiones para el socio.';

-- 2. Asegurar que los socios tengan es_socio = true
UPDATE public.clientes
   SET es_socio = true
 WHERE UPPER(TRIM(COALESCE(nombre, seudonimo, ''))) IN ('EDDIE', 'MEMPHIS', 'PARTNER', 'THOR');

-- 3. Asignación de Parámetros de Devolución por sí mismo
-- 🔀 ARRAEZ: 1.00%
UPDATE public.clientes SET devolucion = 1.00 WHERE UPPER(TRIM(COALESCE(nombre, seudonimo, ''))) = 'ARRAEZ';

-- 🔀 EDDIE: 1.25%
UPDATE public.clientes SET devolucion = 1.25 WHERE UPPER(TRIM(COALESCE(nombre, seudonimo, ''))) = 'EDDIE';

-- 🔀 FORTUNA: 1.00%
UPDATE public.clientes SET devolucion = 1.00 WHERE UPPER(TRIM(COALESCE(nombre, seudonimo, ''))) = 'FORTUNA';

-- 🔀 INFANTINO: 1.00%
UPDATE public.clientes SET devolucion = 1.00 WHERE UPPER(TRIM(COALESCE(nombre, seudonimo, ''))) = 'INFANTINO';

-- 🔀 MEMPHIS: 1.00%
UPDATE public.clientes SET devolucion = 1.00 WHERE UPPER(TRIM(COALESCE(nombre, seudonimo, ''))) = 'MEMPHIS';

-- 🔀 PARTNER: 1.50%
UPDATE public.clientes SET devolucion = 1.50 WHERE UPPER(TRIM(COALESCE(nombre, seudonimo, ''))) = 'PARTNER';

-- 🔀 RUSSO: 1.00%
UPDATE public.clientes SET devolucion = 1.00 WHERE UPPER(TRIM(COALESCE(nombre, seudonimo, ''))) = 'RUSSO';

-- 🔀 SAM: 1.50%
UPDATE public.clientes SET devolucion = 1.50 WHERE UPPER(TRIM(COALESCE(nombre, seudonimo, ''))) = 'SAM';

-- 🔀 THOR: 1.00%
UPDATE public.clientes SET devolucion = 1.00 WHERE UPPER(TRIM(COALESCE(nombre, seudonimo, ''))) = 'THOR';

-- 4. Asignación de Socios y Comisión por Cliente (con fecha_inicio_comision_socio = '2026-10-29')

-- EDDIE:
-- • (1,25%) por GAETANO
UPDATE public.clientes
   SET socio_asignado = 'EDDIE',
       comision_socio_pct = 1.25,
       fecha_inicio_comision_socio = '2026-10-29'
 WHERE UPPER(TRIM(COALESCE(nombre, seudonimo, ''))) = 'GAETANO';

-- • (1,00%) por RUCIO
UPDATE public.clientes
   SET socio_asignado = 'EDDIE',
       comision_socio_pct = 1.00,
       fecha_inicio_comision_socio = '2026-10-29'
 WHERE UPPER(TRIM(COALESCE(nombre, seudonimo, ''))) = 'RUCIO';

-- MEMPHIS:
-- • (1,00%) por NEWCASTLE
UPDATE public.clientes
   SET socio_asignado = 'MEMPHIS',
       comision_socio_pct = 1.00,
       fecha_inicio_comision_socio = '2026-10-29'
 WHERE UPPER(TRIM(COALESCE(nombre, seudonimo, ''))) = 'NEWCASTLE';

-- PARTNER:
-- • (1,00%) por ARELY
UPDATE public.clientes
   SET socio_asignado = 'PARTNER',
       comision_socio_pct = 1.00,
       fecha_inicio_comision_socio = '2026-10-29'
 WHERE UPPER(TRIM(COALESCE(nombre, seudonimo, ''))) = 'ARELY';

-- • (1,00%) por AYARI
UPDATE public.clientes
   SET socio_asignado = 'PARTNER',
       comision_socio_pct = 1.00,
       fecha_inicio_comision_socio = '2026-10-29'
 WHERE UPPER(TRIM(COALESCE(nombre, seudonimo, ''))) = 'AYARI';

-- • (1,25%) por BG
UPDATE public.clientes
   SET socio_asignado = 'PARTNER',
       comision_socio_pct = 1.25,
       fecha_inicio_comision_socio = '2026-10-29'
 WHERE UPPER(TRIM(COALESCE(nombre, seudonimo, ''))) = 'BG';

-- • (1,00%) por ROCA
UPDATE public.clientes
   SET socio_asignado = 'PARTNER',
       comision_socio_pct = 1.00,
       fecha_inicio_comision_socio = '2026-10-29'
 WHERE UPPER(TRIM(COALESCE(nombre, seudonimo, ''))) = 'ROCA';

-- THOR:
-- • (1,00%) por SPEEDY
UPDATE public.clientes
   SET socio_asignado = 'THOR',
       comision_socio_pct = 1.00,
       fecha_inicio_comision_socio = '2026-10-29'
 WHERE UPPER(TRIM(COALESCE(nombre, seudonimo, ''))) = 'SPEEDY';

COMMIT;
