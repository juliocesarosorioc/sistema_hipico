-- Archivo: sql/tablas_fijas_caballo_invalidado.sql
BEGIN;

-- 1. Agregar columna de ejemplares invalidados a nivel de tabla fija si se maneja por arreglo,
-- y función RPC para alternar el estado "invalidado" de un caballo dentro del JSONB de la tabla fija.
ALTER TABLE IF EXISTS public.tablas_fijas
ADD COLUMN IF NOT EXISTS caballos_invalidados INT[] DEFAULT ARRAY[]::INT[];

CREATE OR REPLACE FUNCTION public.rpc_toggle_caballo_invalidado_tabla_fija(
  p_tabla_id UUID,
  p_numero_caballo INT,
  p_invalidado BOOLEAN,
  p_motivo TEXT DEFAULT 'Invalidado en Tabla Fija'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caballos JSONB;
  v_nuevos_caballos JSONB := '[]'::jsonb;
  v_item JSONB;
  v_lista_inv INT[];
BEGIN
  SELECT caballos, COALESCE(caballos_invalidados, ARRAY[]::INT[])
  INTO v_caballos, v_lista_inv
  FROM public.tablas_fijas
  WHERE id = p_tabla_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontró la Tabla Fija indicada (%).', p_tabla_id;
  END IF;

  -- Actualizar el arreglo de números invalidados
  IF p_invalidado THEN
    IF NOT (p_numero_caballo = ANY(v_lista_inv)) THEN
      v_lista_inv := array_append(v_lista_inv, p_numero_caballo);
    END IF;
  ELSE
    v_lista_inv := array_remove(v_lista_inv, p_numero_caballo);
  END IF;

  -- Actualizar la propiedad "invalidado" dentro del JSONB "caballos"
  IF jsonb_typeof(v_caballos) = 'array' THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_caballos)
    LOOP
      IF (v_item->>'numero')::INT = p_numero_caballo THEN
        v_item := v_item || jsonb_build_object(
          'invalidado', p_invalidado,
          'motivo_invalidacion', CASE WHEN p_invalidado THEN p_motivo ELSE NULL END,
          'invalidado_en', CASE WHEN p_invalidado THEN now() ELSE NULL END
        );
      END IF;
      v_nuevos_caballos := v_nuevos_caballos || jsonb_build_array(v_item);
    END LOOP;
  END IF;

  UPDATE public.tablas_fijas
  SET
    caballos = v_nuevos_caballos,
    caballos_invalidados = v_lista_inv,
    actualizado_en = now()
  WHERE id = p_tabla_id;

  RETURN jsonb_build_object(
    'ok', true,
    'tabla_id', p_tabla_id,
    'numero_caballo', p_numero_caballo,
    'invalidado', p_invalidado,
    'caballos_invalidados', v_lista_inv
  );
END;
$$;

COMMIT;