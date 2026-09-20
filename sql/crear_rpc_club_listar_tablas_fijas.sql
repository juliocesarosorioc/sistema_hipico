-- ============================================================================
-- club_listar_tablas_fijas
-- ----------------------------------------------------------------------------
-- CAUSAS raíz de estos dos síntomas en la PANTALLA DE TABLAS FIJAS:
--
--   (a) El filtro de días de la CONFIGURACIÓN DE IMPRESIÓN salía vacío.
--   (b) La impresión "no mostraba los valores de los ejemplares".
--
-- Ambos los provocaba el mismo defecto: el front consultaba la tabla
-- "tablas_fijas" con un SELECT directo (window.supabase.from('tablas_fijas')
-- .select('*, tabla_grupos(*)')). Como la tabla tiene RLS activo y su policy
-- solo permite ver los registros que el rol actual creó (policy por usuario),
-- el SELECT devuelve data = [] SIN error → el filtro de días quedaba vacío y
-- la impresión no encontraba valores.
--
-- SOLUCIÓN (mismo blindaje ya aplicado a ejemplares, grupos, boletos y
-- programa_dia en esta misma base): este RPC SECURITY DEFINER + SECURITY
-- INVOKER no existe… se declara con SECURITY DEFINER que ejecuta bajo el
-- rol propietario (club_owner) y por lo tanto IGNORA el RLS. Pasa por alto
-- la policy y devuelve los registros reales, que son los que necesita el
-- monitor (todas las carreras) y la impresión (solo Abierta, con valores).
--
-- USO:
--   * Monitor (todas, sin importar estado):  no pasa p_estado
--   * Impresión (solo Abierta con valores):  p_estado := 'Abierta'
--
-- IDEMPOTENTE: puede ejecutarse cuantas veces quiera (CREATE OR REPLACE).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.club_listar_tablas_fijas(p_estado text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _json jsonb;
BEGIN
    IF p_estado IS NULL OR NULLIF(TRIM(p_estado), '') IS NULL THEN
        SELECT COALESCE(jsonb_agg(to_jsonb(t) || jsonb_build_object('tabla_grupos', COALESCE((
            SELECT jsonb_agg(to_jsonb(tg) ORDER BY tg.id)
              FROM tabla_grupos tg
             WHERE tg.tabla_id = t.id
        ), '[]'::jsonb))), '[]'::jsonb)
          INTO _json
          FROM tablas_fijas t;
    ELSE
        SELECT COALESCE(jsonb_agg(to_jsonb(t) || jsonb_build_object('tabla_grupos', COALESCE((
            SELECT jsonb_agg(to_jsonb(tg) ORDER BY tg.id)
              FROM tabla_grupos tg
             WHERE tg.tabla_id = t.id
        ), '[]'::jsonb))), '[]'::jsonb)
          INTO _json
          FROM tablas_fijas t
         WHERE t.estado ILIKE '%' || p_estado || '%';
    END IF;
    RETURN _json;
END;
$$;

REVOKE ALL ON FUNCTION public.club_listar_tablas_fijas(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.club_listar_tablas_fijas(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.club_listar_tablas_fijas(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.club_listar_tablas_fijas(text) TO anon;
