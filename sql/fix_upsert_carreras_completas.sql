-- Archivo: sql/fix_upsert_carreras_completas.sql
-- ============================================================================
-- BULK UPSERT TRANSACCIONAL E IDEMPOTENTE DE CARRERAS Y EJEMPLARES
-- ============================================================================
BEGIN;

-- 1. Asegurar índices únicos para upsert idempotente en public.carreras
CREATE UNIQUE INDEX IF NOT EXISTS carreras_fecha_hipodromo_carrera_uidx
ON public.carreras (fecha, hipodromo, carrera);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'carreras' AND column_name = 'hipodromo_id'
  ) THEN
    EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS idx_carreras_hipodromo_fecha_num_unico
             ON public.carreras (hipodromo_id, fecha, carrera)
             WHERE hipodromo_id IS NOT NULL';
  END IF;
END $$;

-- 2. RPC Bulk Upsert en 1 Sola Transacción: public.upsert_lote_carreras_completo
-- Recibe un arreglo JSONB de carreras (incluso de múltiples hipódromos y fechas)
-- y realiza el UPSERT masivo en una única transacción sin duplicar carreras
-- ni borrar jugadas activas ni retiros previos.
CREATE OR REPLACE FUNCTION public.upsert_lote_carreras_completo(
  p_carreras JSONB,
  p_origen TEXT DEFAULT 'ia',
  p_usuario TEXT DEFAULT 'sistema'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_c JSONB;
  v_fecha DATE;
  v_hipodromo TEXT;
  v_carrera INT;
  v_distancia TEXT;
  v_superficie TEXT;
  v_hora TEXT;
  v_premio NUMERIC;
  v_estado TEXT;
  v_caballos JSONB;
  v_retirados TEXT;
  v_guardadas INT := 0;
  v_hipodromos TEXT[] := ARRAY[]::TEXT[];
BEGIN
  IF p_carreras IS NULL OR jsonb_typeof(p_carreras) <> 'array' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'p_carreras debe ser un arreglo JSONB.');
  END IF;

  FOR v_c IN SELECT * FROM jsonb_array_elements(p_carreras)
  LOOP
    BEGIN
      v_fecha := COALESCE(NULLIF(BTRIM(v_c->>'fecha'), '')::DATE, CURRENT_DATE);
    EXCEPTION WHEN OTHERS THEN
      v_fecha := CURRENT_DATE;
    END;

    v_hipodromo := UPPER(BTRIM(COALESCE(v_c->>'hipodromo', v_c->>'hipodromo_nombre', '')));
    BEGIN
      v_carrera := COALESCE(NULLIF(BTRIM(COALESCE(v_c->>'carrera', v_c->>'numero_carrera', '')), '')::INT, 0);
    EXCEPTION WHEN OTHERS THEN
      v_carrera := 0;
    END;

    IF v_hipodromo = '' OR v_carrera <= 0 THEN
      CONTINUE;
    END IF;

    v_distancia := NULLIF(BTRIM(COALESCE(v_c->>'distancia', '')), '');
    v_superficie := COALESCE(NULLIF(UPPER(BTRIM(COALESCE(v_c->>'superficie', ''))), ''), 'ARENA');
    v_hora := NULLIF(BTRIM(COALESCE(v_c->>'hora', '')), '');
    BEGIN
      v_premio := COALESCE(NULLIF(REGEXP_REPLACE(COALESCE(v_c->>'premio', ''), '[^0-9.]', '', 'g'), '')::NUMERIC, 0);
    EXCEPTION WHEN OTHERS THEN
      v_premio := 0;
    END;
    v_estado := COALESCE(NULLIF(BTRIM(COALESCE(v_c->>'estado', '')), ''), 'Programada');
    v_caballos := COALESCE(v_c->'caballos', v_c->'ejemplares', '[]'::JSONB);
    v_retirados := NULLIF(BTRIM(COALESCE(v_c->>'retirados', '')), '');

    INSERT INTO public.carreras (
      fecha,
      hipodromo,
      carrera,
      estado,
      caballos,
      retirados,
      distancia,
      superficie,
      premio,
      hora,
      origen,
      actualizado_por,
      updated_at
    ) VALUES (
      v_fecha,
      v_hipodromo,
      v_carrera,
      v_estado,
      v_caballos,
      v_retirados,
      v_distancia,
      v_superficie,
      v_premio,
      v_hora,
      COALESCE(p_origen, 'ia'),
      COALESCE(p_usuario, 'sistema'),
      NOW()
    )
    ON CONFLICT (fecha, hipodromo, carrera)
    DO UPDATE SET
      caballos = CASE
        WHEN jsonb_typeof(EXCLUDED.caballos) = 'array' AND jsonb_array_length(EXCLUDED.caballos) > 0
        THEN EXCLUDED.caballos
        ELSE public.carreras.caballos
      END,
      distancia = COALESCE(EXCLUDED.distancia, public.carreras.distancia),
      superficie = COALESCE(EXCLUDED.superficie, public.carreras.superficie),
      premio = CASE WHEN COALESCE(EXCLUDED.premio, 0) > 0 THEN EXCLUDED.premio ELSE public.carreras.premio END,
      hora = COALESCE(EXCLUDED.hora, public.carreras.hora),
      retirados = COALESCE(EXCLUDED.retirados, public.carreras.retirados),
      origen = COALESCE(EXCLUDED.origen, public.carreras.origen),
      actualizado_por = COALESCE(EXCLUDED.actualizado_por, public.carreras.actualizado_por),
      updated_at = NOW();

    v_guardadas := v_guardadas + 1;
    IF NOT (v_hipodromo = ANY(v_hipodromos)) THEN
      v_hipodromos := array_append(v_hipodromos, v_hipodromo);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'carreras_procesadas', v_guardadas,
    'hipodromos', v_hipodromos
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_lote_carreras_completo(JSONB, TEXT, TEXT) TO authenticated, anon, service_role;

-- 3. RPC Transaccional para edición en cascada (hipódromo, fecha, número, hora, distancia)
CREATE OR REPLACE FUNCTION public.club_actualizar_carrera_transaccional(
  p_carrera_id TEXT DEFAULT NULL,
  p_fecha_antigua DATE DEFAULT NULL,
  p_hipodromo_antiguo TEXT DEFAULT NULL,
  p_carrera_antigua INT DEFAULT NULL,
  p_fecha_nueva DATE DEFAULT NULL,
  p_hipodromo_nuevo TEXT DEFAULT NULL,
  p_carrera_nueva INT DEFAULT NULL,
  p_distancia_nueva TEXT DEFAULT NULL,
  p_hora_nueva TEXT DEFAULT NULL,
  p_usuario TEXT DEFAULT 'admin'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hipo_ant TEXT := UPPER(BTRIM(COALESCE(p_hipodromo_antiguo, '')));
  v_hipo_nue TEXT := UPPER(BTRIM(COALESCE(p_hipodromo_nuevo, '')));
BEGIN
  UPDATE public.carreras
  SET
    fecha = COALESCE(p_fecha_nueva, fecha),
    hipodromo = COALESCE(NULLIF(v_hipo_nue, ''), hipodromo),
    carrera = COALESCE(p_carrera_nueva, carrera),
    distancia = COALESCE(p_distancia_nueva, distancia),
    hora = COALESCE(p_hora_nueva, hora),
    actualizado_por = COALESCE(p_usuario, actualizado_por),
    updated_at = NOW()
  WHERE fecha = p_fecha_antigua
    AND UPPER(BTRIM(hipodromo)) = v_hipo_ant
    AND carrera = p_carrera_antigua;

  IF to_regclass('public.tablas_fijas') IS NOT NULL THEN
    UPDATE public.tablas_fijas
    SET
      fecha = COALESCE(p_fecha_nueva, fecha),
      hipodromo = COALESCE(NULLIF(v_hipo_nue, ''), hipodromo),
      carrera = COALESCE(p_carrera_nueva, carrera)
    WHERE fecha = p_fecha_antigua
      AND UPPER(BTRIM(hipodromo)) = v_hipo_ant
      AND carrera = p_carrera_antigua;
  END IF;

  IF to_regclass('public.resultados_carreras') IS NOT NULL THEN
    UPDATE public.resultados_carreras
    SET
      fecha = COALESCE(p_fecha_nueva, fecha),
      hipodromo = COALESCE(NULLIF(v_hipo_nue, ''), hipodromo),
      carrera = COALESCE(p_carrera_nueva, carrera)
    WHERE fecha = p_fecha_antigua
      AND UPPER(BTRIM(hipodromo)) = v_hipo_ant
      AND carrera = p_carrera_antigua;
  END IF;

  IF to_regclass('public.jugadas') IS NOT NULL THEN
    UPDATE public.jugadas
    SET
      fecha = COALESCE(p_fecha_nueva, fecha),
      hipodromo = COALESCE(NULLIF(v_hipo_nue, ''), hipodromo),
      carrera = COALESCE(p_carrera_nueva, carrera)
    WHERE fecha = p_fecha_antigua
      AND UPPER(BTRIM(hipodromo)) = v_hipo_ant
      AND carrera = p_carrera_antigua;
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.club_actualizar_carrera_transaccional(TEXT, DATE, TEXT, INT, DATE, TEXT, INT, TEXT, TEXT, TEXT) TO authenticated, anon, service_role;

COMMIT;
