-- ============================================================================
-- COMISIÓN DE SOCIOS POR CLIENTES Y DEVOLUCIONES DE JUGADAS
-- ============================================================================
-- MIGRACIÓN IDEMPOTENTE (se puede ejecutar completa las veces que haga falta).
--
-- Permite que un cliente tenga:
--   1. Devolución por sí mismo (clientes.devolucion, ej. 1.00%, 1.25%, 1.50%).
--   2. Socio asignado (clientes.socio_asignado) guardado como ID canónico.
--   3. Comisión que devenga el socio por las jugadas de este cliente
--      (clientes.comision_socio_pct).
--   4. Fecha de inicio de recálculo (clientes.fecha_inicio_comision_socio).
--
-- Se imputa en el saldo del socio de forma contable, no altera el cobro/pago
-- del ticket nominal.
--
-- IMPORTANTE: el bloque ALTER va PRIMERO. Si copias sólo los UPDATE y la
-- columna no existe, PostgreSQL falla con:
--   ERROR 42703: column "comision_socio_pct" of relation "clientes" does not exist
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Columnas imprescindibles (idempotente)
-- ----------------------------------------------------------------------------
ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS comision_socio_pct NUMERIC(5,2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS fecha_inicio_comision_socio DATE DEFAULT DATE '2026-10-29';

COMMENT ON COLUMN public.clientes.comision_socio_pct IS
  'Porcentaje de comisión que se le otorga al socio_asignado por las jugadas de este cliente.';

COMMENT ON COLUMN public.clientes.fecha_inicio_comision_socio IS
  'Fecha a partir de la cual se calculan o recalculan las comisiones para el socio.';

-- ----------------------------------------------------------------------------
-- 2. Socios oficiales
-- ----------------------------------------------------------------------------
UPDATE public.clientes
   SET es_socio = true
 WHERE UPPER(TRIM(COALESCE(nombre, seudonimo, ''))) IN ('EDDIE', 'MEMPHIS', 'PARTNER', 'THOR');

-- ----------------------------------------------------------------------------
-- 3. Devolución propia de cada destinatario
-- ----------------------------------------------------------------------------
UPDATE public.clientes SET devolucion = 1.00 WHERE UPPER(TRIM(COALESCE(nombre, seudonimo, ''))) = 'ARRAEZ';
UPDATE public.clientes SET devolucion = 1.25 WHERE UPPER(TRIM(COALESCE(nombre, seudonimo, ''))) = 'EDDIE';
UPDATE public.clientes SET devolucion = 1.00 WHERE UPPER(TRIM(COALESCE(nombre, seudonimo, ''))) = 'FORTUNA';
UPDATE public.clientes SET devolucion = 1.00 WHERE UPPER(TRIM(COALESCE(nombre, seudonimo, ''))) = 'INFANTINO';
UPDATE public.clientes SET devolucion = 1.00 WHERE UPPER(TRIM(COALESCE(nombre, seudonimo, ''))) = 'MEMPHIS';
UPDATE public.clientes SET devolucion = 1.50 WHERE UPPER(TRIM(COALESCE(nombre, seudonimo, ''))) = 'PARTNER';
UPDATE public.clientes SET devolucion = 1.00 WHERE UPPER(TRIM(COALESCE(nombre, seudonimo, ''))) = 'RUSSO';
UPDATE public.clientes SET devolucion = 1.50 WHERE UPPER(TRIM(COALESCE(nombre, seudonimo, ''))) = 'SAM';
UPDATE public.clientes SET devolucion = 1.00 WHERE UPPER(TRIM(COALESCE(nombre, seudonimo, ''))) = 'THOR';

-- ----------------------------------------------------------------------------
-- 4. Migrar valores legacy de socio_asignado (nombre/seudónimo) a ID canónico
-- ----------------------------------------------------------------------------
-- El frontend guarda el ID (valorSocioAsignado). Las bases antiguas guardaban
-- el nombre/seudónimo; esta sentencia normaliza ambos casos.
UPDATE public.clientes c
   SET socio_asignado = s.id::text
  FROM public.clientes s
 WHERE c.socio_asignado IS NOT NULL
   AND TRIM(c.socio_asignado) <> ''
   AND s.es_socio = true
   AND (
        UPPER(TRIM(c.socio_asignado)) = UPPER(TRIM(COALESCE(s.nombre, '')))
     OR UPPER(TRIM(c.socio_asignado)) = UPPER(TRIM(COALESCE(s.seudonimo, '')))
   )
   AND UPPER(TRIM(COALESCE(c.nombre, c.seudonimo, ''))) <> UPPER(TRIM(COALESCE(s.nombre, s.seudonimo, '')));

-- ----------------------------------------------------------------------------
-- 5. Asignación de socios y comisiones (socio_asignado = ID del socio)
--    COALESCE(id, nombre) mantiene compatibilidad si el socio aún no existe.
-- ----------------------------------------------------------------------------

-- EDDIE: 1,25% por GAETANO; 1,00% por RUCIO
UPDATE public.clientes c
   SET socio_asignado = COALESCE(
         (SELECT s.id::text FROM public.clientes s
           WHERE UPPER(TRIM(COALESCE(s.nombre, s.seudonimo, ''))) = 'EDDIE'
           ORDER BY s.id LIMIT 1),
         'EDDIE'),
       comision_socio_pct = 1.25,
       fecha_inicio_comision_socio = DATE '2026-10-29'
 WHERE UPPER(TRIM(COALESCE(c.nombre, c.seudonimo, ''))) = 'GAETANO';

UPDATE public.clientes c
   SET socio_asignado = COALESCE(
         (SELECT s.id::text FROM public.clientes s
           WHERE UPPER(TRIM(COALESCE(s.nombre, s.seudonimo, ''))) = 'EDDIE'
           ORDER BY s.id LIMIT 1),
         'EDDIE'),
       comision_socio_pct = 1.00,
       fecha_inicio_comision_socio = DATE '2026-10-29'
 WHERE UPPER(TRIM(COALESCE(c.nombre, c.seudonimo, ''))) = 'RUCIO';

-- MEMPHIS: 1,00% por NEWCASTLE
UPDATE public.clientes c
   SET socio_asignado = COALESCE(
         (SELECT s.id::text FROM public.clientes s
           WHERE UPPER(TRIM(COALESCE(s.nombre, s.seudonimo, ''))) = 'MEMPHIS'
           ORDER BY s.id LIMIT 1),
         'MEMPHIS'),
       comision_socio_pct = 1.00,
       fecha_inicio_comision_socio = DATE '2026-10-29'
 WHERE UPPER(TRIM(COALESCE(c.nombre, c.seudonimo, ''))) = 'NEWCASTLE';

-- PARTNER: 1,00% por ARELY; 1,00% por AYARI; 1,25% por BG; 1,00% por ROCA
UPDATE public.clientes c
   SET socio_asignado = COALESCE(
         (SELECT s.id::text FROM public.clientes s
           WHERE UPPER(TRIM(COALESCE(s.nombre, s.seudonimo, ''))) = 'PARTNER'
           ORDER BY s.id LIMIT 1),
         'PARTNER'),
       comision_socio_pct = 1.00,
       fecha_inicio_comision_socio = DATE '2026-10-29'
 WHERE UPPER(TRIM(COALESCE(c.nombre, c.seudonimo, ''))) = 'ARELY';

UPDATE public.clientes c
   SET socio_asignado = COALESCE(
         (SELECT s.id::text FROM public.clientes s
           WHERE UPPER(TRIM(COALESCE(s.nombre, s.seudonimo, ''))) = 'PARTNER'
           ORDER BY s.id LIMIT 1),
         'PARTNER'),
       comision_socio_pct = 1.00,
       fecha_inicio_comision_socio = DATE '2026-10-29'
 WHERE UPPER(TRIM(COALESCE(c.nombre, c.seudonimo, ''))) = 'AYARI';

UPDATE public.clientes c
   SET socio_asignado = COALESCE(
         (SELECT s.id::text FROM public.clientes s
           WHERE UPPER(TRIM(COALESCE(s.nombre, s.seudonimo, ''))) = 'PARTNER'
           ORDER BY s.id LIMIT 1),
         'PARTNER'),
       comision_socio_pct = 1.25,
       fecha_inicio_comision_socio = DATE '2026-10-29'
 WHERE UPPER(TRIM(COALESCE(c.nombre, c.seudonimo, ''))) = 'BG';

UPDATE public.clientes c
   SET socio_asignado = COALESCE(
         (SELECT s.id::text FROM public.clientes s
           WHERE UPPER(TRIM(COALESCE(s.nombre, s.seudonimo, ''))) = 'PARTNER'
           ORDER BY s.id LIMIT 1),
         'PARTNER'),
       comision_socio_pct = 1.00,
       fecha_inicio_comision_socio = DATE '2026-10-29'
 WHERE UPPER(TRIM(COALESCE(c.nombre, c.seudonimo, ''))) = 'ROCA';

-- THOR: 1,00% por SPEEDY
UPDATE public.clientes c
   SET socio_asignado = COALESCE(
         (SELECT s.id::text FROM public.clientes s
           WHERE UPPER(TRIM(COALESCE(s.nombre, s.seudonimo, ''))) = 'THOR'
           ORDER BY s.id LIMIT 1),
         'THOR'),
       comision_socio_pct = 1.00,
       fecha_inicio_comision_socio = DATE '2026-10-29'
 WHERE UPPER(TRIM(COALESCE(c.nombre, c.seudonimo, ''))) = 'SPEEDY';

COMMIT;
