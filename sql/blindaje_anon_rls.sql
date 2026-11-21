-- sql/blindaje_anon_rls.sql
-- Idempotente: retira políticas anon permisivas, activa RLS y revoca anon.

BEGIN;

DROP POLICY IF EXISTS tickets_apuestas_anon_read ON public.tickets_apuestas;
DROP POLICY IF EXISTS depositos_anon_all ON public.depositos;
DROP POLICY IF EXISTS tablas_fijas_anon_all ON public.tablas_fijas;
DROP POLICY IF EXISTS tabla_fija_caballos_anon_all ON public.tabla_fija_caballos;
DROP POLICY IF EXISTS tabla_grupos_anon_all ON public.tabla_grupos;

ALTER TABLE IF EXISTS public.tickets_apuestas ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.depositos ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.tablas_fijas ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.tabla_fija_caballos ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.tabla_grupos ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon;

COMMIT;
