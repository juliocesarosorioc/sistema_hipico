-- Archivo: sql/fix_upsert_carreras_completas.sql
BEGIN;

-- 1. Asegurar índice único compuesto por (hipodromo_id, fecha, numero_carrera)
CREATE UNIQUE INDEX IF NOT EXISTS idx_carreras_hipodromo_fecha_num_unico
ON public.carreras (hipodromo_id, fecha, numero_carrera);

-- 2. RPC Transaccional que fusiona (Upsert) todas las carreras de una gaceta sin borrar las demás carreras del mismo hipódromo
CREATE OR REPLACE FUNCTION public.rpc_guardar_lote_carreras_gaceta(
  p_hipodromo_id UUID,
  p_hipodromo_nombre TEXT,
  p_fecha DATE,
  p_carreras JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_c JSONB;
  v_num INT;
  v_guardadas INT := 0;
  v_numeros_cargados INT[] := ARRAY[]::INT[];
BEGIN
  IF jsonb_typeof(p_carreras) <> 'array' THEN
    RAISE EXCEPTION 'El parámetro p_carreras debe ser un arreglo JSON.';
  END IF;

  FOR v_c IN SELECT * FROM jsonb_array_elements(p_carreras)
  LOOP
    v_num := (v_c->>'numero_carrera')::INT;
    IF v_num IS NOT NULL AND v_num > 0 THEN
      INSERT INTO public.carreras (
        hipodromo_id,
        hipodromo_nombre,
        fecha,
        numero_carrera,
        hora,
        distancia,
        ejemplares,
        estado
      ) VALUES (
        p_hipodromo_id,
        TRIM(p_hipodromo_nombre),
        p_fecha,
        v_num,
        COALESCE(v_c->>'hora', ''),
        COALESCE(v_c->>'distancia', ''),
        COALESCE(v_c->'ejemplares', '[]'::jsonb),
        COALESCE(v_c->>'estado', 'ABIERTA')
      )
      ON CONFLICT (hipodromo_id, fecha, numero_carrera)
      DO UPDATE SET
        hipodromo_nombre = EXCLUDED.hipodromo_nombre,
        hora = CASE WHEN EXCLUDED.hora <> '' THEN EXCLUDED.hora ELSE public.carreras.hora END,
        distancia = CASE WHEN EXCLUDED.distancia <> '' THEN EXCLUDED.distancia ELSE public.carreras.distancia END,
        ejemplares = CASE
          WHEN jsonb_array_length(EXCLUDED.ejemplares) > 0 THEN EXCLUDED.ejemplares
          ELSE public.carreras.ejemplares
        END;

      v_guardadas := v_guardadas + 1;
      v_numeros_cargados := array_append(v_numeros_cargados, v_num);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'carreras_procesadas', v_guardadas,
    'numeros_carrera', v_numeros_cargados
  );
END;
$$;

COMMIT;