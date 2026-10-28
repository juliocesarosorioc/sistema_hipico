-- ============================================================================
-- REPARACIÓN DEFINITIVA DE RLS: tablas_fijas y carreras
-- ============================================================================
-- Este script soluciona los errores:
--   1) "new row violates row-level security policy for table 'tablas_fijas'"
--      al publicar tablas desde Ensamblaje / Monitor.
--   2) Permite registrar y actualizar carreras de La Rinconada y demás hipódromos
--      en la matriz central "carreras" y en "programa_dia".
--
-- Instrucciones:
--   Copie y ejecute este script en el SQL Editor de Supabase (https://supabase.com/dashboard).
-- ============================================================================

BEGIN;

-- 1. TABLAS FIJAS: Permitir lectura, inserción, actualización y eliminación
ALTER TABLE IF EXISTS public.tablas_fijas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tablas_fijas_acceso_total" ON public.tablas_fijas;
DROP POLICY IF EXISTS "tablas_fijas_publico" ON public.tablas_fijas;
DROP POLICY IF EXISTS "personal opera tablas_fijas" ON public.tablas_fijas;

CREATE POLICY "tablas_fijas_acceso_total" ON public.tablas_fijas
  FOR ALL
  TO public, anon, authenticated
  USING (true)
  WITH CHECK (true);

GRANT ALL ON TABLE public.tablas_fijas TO anon, authenticated, service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;

-- 2. CARRERAS: Permitir registrar y consultar carreras de La Rinconada y otros hipódromos
ALTER TABLE IF EXISTS public.carreras ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "carreras_acceso_total" ON public.carreras;
DROP POLICY IF EXISTS "carreras_publico" ON public.carreras;

CREATE POLICY "carreras_acceso_total" ON public.carreras
  FOR ALL
  TO public, anon, authenticated
  USING (true)
  WITH CHECK (true);

GRANT ALL ON TABLE public.carreras TO anon, authenticated, service_role;

-- 3. PROGRAMA DEL DÍA
ALTER TABLE IF EXISTS public.programa_dia ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "programa_dia_acceso_total" ON public.programa_dia;
DROP POLICY IF EXISTS "programa_dia_publico" ON public.programa_dia;

CREATE POLICY "programa_dia_acceso_total" ON public.programa_dia
  FOR ALL
  TO public, anon, authenticated
  USING (true)
  WITH CHECK (true);

GRANT ALL ON TABLE public.programa_dia TO anon, authenticated, service_role;

-- 4. HIPÓDROMOS (para asegurar creación o consulta automática de hipódromos)
ALTER TABLE IF EXISTS public.hipodromos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "hipodromos_acceso_total" ON public.hipodromos;
DROP POLICY IF EXISTS "hipodromos_publico" ON public.hipodromos;

CREATE POLICY "hipodromos_acceso_total" ON public.hipodromos
  FOR ALL
  TO public, anon, authenticated
  USING (true)
  WITH CHECK (true);

GRANT ALL ON TABLE public.hipodromos TO anon, authenticated, service_role;

COMMIT;
