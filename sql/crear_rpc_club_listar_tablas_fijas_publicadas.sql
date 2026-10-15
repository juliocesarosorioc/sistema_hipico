-- ============================================================================
-- club_listar_tablas_fijas_publicadas
-- ----------------------------------------------------------------------------
-- CAUSA DE "el filtro de días no trae días" y "no se ven los valores de los
-- ejemplares" en la IMPRESIÓN DE TABLAS FIJAS:
--   El reporte leía tablas_fijas con un SELECT directo (RLS LOQUEADO -> data
--   vacía sin error). Esta RPC es SECURITY DEFINER: la ejecuta el propietario
--   (dueño del club) y devuelve SOLO las tablas en estado 'Abierta' pasando
--   por alto RLS, igual que club_listar_grupos / club_listar_ejemplares.
-- Idempotente: puede ejecutarse tantas veces como quiera.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.club_listar_tablas_fijas_publicadas()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COALESCE(jsonb_agg(t), '[]'::jsonb)
    FROM tablas_fijas t
    WHERE t.estado ILIKE 'Abierta';
$$;

REVOKE ALL ON FUNCTION public.club_listar_tablas_fijas_publicadas() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_listar_tablas_fijas_publicadas() TO authenticated;
GRANT EXECUTE ON FUNCTION public.club_listar_tablas_fijas_publicadas() TO service_role;
GRANT EXECUTE ON FUNCTION public.club_listar_tablas_fijas_publicadas() TO anon;
