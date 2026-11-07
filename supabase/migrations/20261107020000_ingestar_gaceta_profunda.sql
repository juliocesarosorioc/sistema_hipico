-- ============================================================================
-- MIGRACIÓN: INGESTAR GACETA PROFUNDA Y VISTAS SELECTIVAS DE JUEGO
-- ============================================================================
-- 1. Regla de Identidad y No-Duplicación por Ejemplar (nombre_limpio + pais_origen + nacimiento).
-- 2. Almacenamiento 100% interno de data analítica (actuaciones previas, parciales, traqueos).
-- 3. Vistas ligeras selectivas para modales:
--    - vw_modal_tablas_y_remates: numero_ejemplar, nombre, morning_line.
--    - vw_modal_dupleta_y_polla: numero_ejemplar, nombre.
-- 4. Función RPC public.ingestar_gaceta_profunda(payload JSONB).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. TABLA MAESTRA DE IDENTIDAD DE EJEMPLARES
CREATE TABLE IF NOT EXISTS public.ejemplares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre text NOT NULL,
  nombre_limpio text NOT NULL,
  pais_origen text NOT NULL DEFAULT 'VEN',
  fecha_nacimiento date,
  anio_nacimiento integer,
  sexo text,
  pelaje text,
  padre text,
  madre text,
  abuelo_materno text,
  stud text,
  haras_criador text,
  nacionalidad text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Si la tabla ya existía con columnas faltantes, agregarlas limpiamente:
ALTER TABLE public.ejemplares ADD COLUMN IF NOT EXISTS nombre_limpio text;
ALTER TABLE public.ejemplares ADD COLUMN IF NOT EXISTS pais_origen text DEFAULT 'VEN';
ALTER TABLE public.ejemplares ADD COLUMN IF NOT EXISTS fecha_nacimiento date;
ALTER TABLE public.ejemplares ADD COLUMN IF NOT EXISTS anio_nacimiento integer;
ALTER TABLE public.ejemplares ADD COLUMN IF NOT EXISTS sexo text;
ALTER TABLE public.ejemplares ADD COLUMN IF NOT EXISTS pelaje text;
ALTER TABLE public.ejemplares ADD COLUMN IF NOT EXISTS padre text;
ALTER TABLE public.ejemplares ADD COLUMN IF NOT EXISTS madre text;
ALTER TABLE public.ejemplares ADD COLUMN IF NOT EXISTS abuelo_materno text;
ALTER TABLE public.ejemplares ADD COLUMN IF NOT EXISTS stud text;
ALTER TABLE public.ejemplares ADD COLUMN IF NOT EXISTS haras_criador text;
ALTER TABLE public.ejemplares ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Completar nombre_limpio para registros existentes
UPDATE public.ejemplares
SET nombre_limpio = upper(trim(regexp_replace(nombre, '[^a-zA-Z0-9 ]', '', 'g')))
WHERE nombre_limpio IS NULL OR nombre_limpio = '';

-- Completar pais_origen desde nacionalidad si aplica
UPDATE public.ejemplares
SET pais_origen = COALESCE(NULLIF(nacionalidad, ''), 'VEN')
WHERE pais_origen IS NULL OR pais_origen = '';

-- Índice único de identidad para garantizar NO duplicación
CREATE UNIQUE INDEX IF NOT EXISTS idx_ejemplares_identidad_unica
ON public.ejemplares (
  nombre_limpio,
  pais_origen,
  COALESCE(fecha_nacimiento, '1900-01-01'::date),
  COALESCE(anio_nacimiento, 0)
);

-- 2. CARRERAS PROFUNDAS
CREATE TABLE IF NOT EXISTS public.carreras_profundas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hipodromo text NOT NULL,
  codigo_hipodromo text,
  fecha date NOT NULL,
  numero_carrera integer NOT NULL,
  hora text,
  distancia_m integer,
  superficie text,
  raza text,
  bolsa_usd numeric,
  condicion_lote text,
  condicion_lote_completa text,
  record_pista text,
  valida_5y6 integer,
  codigo_anual text,
  favoritos_gaceta jsonb,
  orden_rating_gaceta jsonb,
  raw_payload jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT uq_carreras_profundas_evento UNIQUE (hipodromo, fecha, numero_carrera)
);

-- 3. EJEMPLARES INSCRITOS EN CARRERAS PROFUNDAS
CREATE TABLE IF NOT EXISTS public.carreras_profundas_ejemplares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  carrera_id uuid NOT NULL REFERENCES public.carreras_profundas(id) ON DELETE CASCADE,
  ejemplar_id uuid REFERENCES public.ejemplares(id) ON DELETE SET NULL,
  numero_programa text NOT NULL,
  puesto_partida integer,
  nombre text NOT NULL,
  jinete text,
  entrenador text,
  peso_kg numeric,
  peso_base_kg numeric,
  descargo_kg numeric,
  dias_sin_correr integer,
  ganancias_usd numeric,
  implementos text,
  campana_resumen text,
  comentario text,
  morning_line text,
  es_elegible boolean DEFAULT false,
  retirado boolean DEFAULT false,
  raw_data jsonb,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT uq_carreras_profundas_ejemplares UNIQUE (carrera_id, numero_programa)
);

-- 4. ACTUACIONES PREVIAS DEL EJEMPLAR (HISTORIAL PROFUNDO)
CREATE TABLE IF NOT EXISTS public.ejemplares_actuaciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ejemplar_id uuid NOT NULL REFERENCES public.ejemplares(id) ON DELETE CASCADE,
  fecha date NOT NULL,
  hipodromo text NOT NULL,
  numero_carrera text NOT NULL,
  distancia_m integer,
  pp integer,
  pos_400m integer,
  pos_800m integer,
  pos_llegada integer,
  peso_jinete_kg numeric,
  jinete text,
  dividendo text,
  ganador text,
  cuerpos text,
  lote text,
  rating numeric,
  ttc numeric,
  tiempo_ganador text,
  tiempo_ejemplar text,
  total_ejemplares integer,
  superficie text,
  condicion_pista text,
  raw_data jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ejemplares_actuaciones_unica
ON public.ejemplares_actuaciones (ejemplar_id, fecha, hipodromo, numero_carrera);

-- 5. TRABAJOS / TRAQUEOS / WORKOUTS
CREATE TABLE IF NOT EXISTS public.ejemplares_trabajos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ejemplar_id uuid NOT NULL REFERENCES public.ejemplares(id) ON DELETE CASCADE,
  fecha date,
  hipodromo text,
  distancia_m integer,
  tiempo text,
  remate text,
  modalidad text,
  pista text,
  superficie_estado text,
  ranking text,
  comentario text,
  dias_atras integer,
  raw_data jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ejemplares_trabajos_unica
ON public.ejemplares_trabajos (
  ejemplar_id,
  COALESCE(fecha, '1900-01-01'::date),
  COALESCE(distancia_m, 0),
  COALESCE(tiempo, '')
);

-- ============================================================================
-- VISTAS SELECTIVAS PARA MODALES DE JUEGO (CAMPOS ESTRICTAMENTE LIGEROS)
-- ============================================================================

-- 1. MODAL TABLAS FIJAS Y REMATES: solo numero_ejemplar, nombre y morning_line
CREATE OR REPLACE VIEW public.vw_modal_tablas_y_remates AS
SELECT
  c.hipodromo,
  c.numero_carrera AS carrera,
  c.fecha,
  e.numero_programa AS numero_ejemplar,
  e.nombre,
  e.morning_line,
  e.retirado
FROM public.carreras_profundas c
JOIN public.carreras_profundas_ejemplares e ON e.carrera_id = c.id
ORDER BY
  c.fecha,
  c.hipodromo,
  c.numero_carrera,
  CASE WHEN e.numero_programa ~ '^[0-9]+$' THEN e.numero_programa::integer ELSE 999 END,
  e.numero_programa;

-- 2. MODAL DUPLETA / POLLA / 5y6: solo numero_ejemplar y nombre
CREATE OR REPLACE VIEW public.vw_modal_dupleta_y_polla AS
SELECT
  c.hipodromo,
  c.numero_carrera AS carrera,
  c.fecha,
  e.numero_programa AS numero_ejemplar,
  e.nombre,
  e.retirado
FROM public.carreras_profundas c
JOIN public.carreras_profundas_ejemplares e ON e.carrera_id = c.id
ORDER BY
  c.fecha,
  c.hipodromo,
  c.numero_carrera,
  CASE WHEN e.numero_programa ~ '^[0-9]+$' THEN e.numero_programa::integer ELSE 999 END,
  e.numero_programa;

-- ============================================================================
-- RPC: public.ingestar_gaceta_profunda(payload JSONB)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.ingestar_gaceta_profunda(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_carreras jsonb;
  v_carrera jsonb;
  v_ejemplares jsonb;
  v_ejemplar jsonb;
  v_actuaciones jsonb;
  v_actuacion jsonb;
  v_trabajos jsonb;
  v_trabajo jsonb;
  
  v_hipodromo text;
  v_codigo_hipodromo text;
  v_fecha date;
  v_numero_carrera integer;
  v_carrera_id uuid;
  v_ejemplar_id uuid;
  
  v_nombre text;
  v_nombre_limpio text;
  v_pais_origen text;
  v_fecha_nac date;
  v_anio_nac integer;
  
  v_tot_carreras integer := 0;
  v_tot_ejemplares integer := 0;
  v_tot_actuaciones integer := 0;
  v_tot_trabajos integer := 0;
  
  v_carreras_catalogo_caballos jsonb;
BEGIN
  IF payload IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Payload nulo');
  END IF;

  -- Puede venir como array directo o envuelto en {"carreras": [...]}
  IF jsonb_typeof(payload) = 'array' THEN
    v_carreras := payload;
  ELSE
    v_carreras := payload->'carreras';
  END IF;

  IF v_carreras IS NULL OR jsonb_array_length(v_carreras) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sin carreras en el payload');
  END IF;

  FOR v_carrera IN SELECT * FROM jsonb_array_elements(v_carreras)
  LOOP
    v_hipodromo := upper(trim(COALESCE(v_carrera->>'hipodromo', 'LA RINCONADA')));
    v_codigo_hipodromo := upper(trim(COALESCE(v_carrera->>'codigo_hipodromo', '')));
    
    BEGIN
      v_fecha := (v_carrera->>'fecha')::date;
    EXCEPTION WHEN OTHERS THEN
      v_fecha := CURRENT_DATE;
    END;

    v_numero_carrera := COALESCE((v_carrera->>'numero_carrera')::integer, (v_carrera->>'carrera')::integer, 1);

    -- 1. Insertar o actualizar cabecera en carreras_profundas
    INSERT INTO public.carreras_profundas (
      hipodromo,
      codigo_hipodromo,
      fecha,
      numero_carrera,
      hora,
      distancia_m,
      superficie,
      raza,
      bolsa_usd,
      condicion_lote,
      condicion_lote_completa,
      record_pista,
      valida_5y6,
      codigo_anual,
      favoritos_gaceta,
      orden_rating_gaceta,
      raw_payload,
      updated_at
    ) VALUES (
      v_hipodromo,
      NULLIF(v_codigo_hipodromo, ''),
      v_fecha,
      v_numero_carrera,
      v_carrera->>'hora',
      (v_carrera->>'distancia_m')::integer,
      v_carrera->>'superficie',
      v_carrera->>'raza',
      (v_carrera->>'bolsa_usd')::numeric,
      v_carrera->>'condicion_lote',
      v_carrera->>'condicion_lote_completa',
      v_carrera->>'record_pista',
      (v_carrera->>'valida_5y6')::integer,
      v_carrera->>'codigo_anual',
      v_carrera->'favoritos_gaceta',
      v_carrera->'orden_rating_gaceta',
      v_carrera,
      now()
    )
    ON CONFLICT (hipodromo, fecha, numero_carrera) DO UPDATE SET
      codigo_hipodromo = EXCLUDED.codigo_hipodromo,
      hora = COALESCE(EXCLUDED.hora, carreras_profundas.hora),
      distancia_m = COALESCE(EXCLUDED.distancia_m, carreras_profundas.distancia_m),
      superficie = COALESCE(EXCLUDED.superficie, carreras_profundas.superficie),
      raza = COALESCE(EXCLUDED.raza, carreras_profundas.raza),
      bolsa_usd = COALESCE(EXCLUDED.bolsa_usd, carreras_profundas.bolsa_usd),
      condicion_lote = COALESCE(EXCLUDED.condicion_lote, carreras_profundas.condicion_lote),
      condicion_lote_completa = COALESCE(EXCLUDED.condicion_lote_completa, carreras_profundas.condicion_lote_completa),
      record_pista = COALESCE(EXCLUDED.record_pista, carreras_profundas.record_pista),
      valida_5y6 = COALESCE(EXCLUDED.valida_5y6, carreras_profundas.valida_5y6),
      codigo_anual = COALESCE(EXCLUDED.codigo_anual, carreras_profundas.codigo_anual),
      favoritos_gaceta = COALESCE(EXCLUDED.favoritos_gaceta, carreras_profundas.favoritos_gaceta),
      orden_rating_gaceta = COALESCE(EXCLUDED.orden_rating_gaceta, carreras_profundas.orden_rating_gaceta),
      raw_payload = EXCLUDED.raw_payload,
      updated_at = now()
    RETURNING id INTO v_carrera_id;

    v_tot_carreras := v_tot_carreras + 1;
    v_ejemplares := v_carrera->'ejemplares';
    v_carreras_catalogo_caballos := '[]'::jsonb;

    IF v_ejemplares IS NOT NULL AND jsonb_typeof(v_ejemplares) = 'array' THEN
      FOR v_ejemplar IN SELECT * FROM jsonb_array_elements(v_ejemplares)
      LOOP
        v_nombre := upper(trim(COALESCE(v_ejemplar->>'nombre', '')));
        IF v_nombre = '' THEN
          CONTINUE;
        END IF;

        v_nombre_limpio := upper(trim(regexp_replace(v_nombre, '[^a-zA-Z0-9 ]', '', 'g')));
        v_pais_origen := upper(trim(COALESCE(v_ejemplar->>'pais_origen', v_ejemplar->>'nacionalidad', '')));
        IF v_pais_origen = '' THEN
          IF v_hipodromo LIKE '%RINCONADA%' OR v_hipodromo LIKE '%VALENCIA%' THEN
            v_pais_origen := 'VEN';
          ELSE
            v_pais_origen := 'USA';
          END IF;
        END IF;

        BEGIN
          v_fecha_nac := (v_ejemplar->>'fecha_nacimiento')::date;
        EXCEPTION WHEN OTHERS THEN
          v_fecha_nac := NULL;
        END;

        BEGIN
          v_anio_nac := (v_ejemplar->>'anio_nacimiento')::integer;
        EXCEPTION WHEN OTHERS THEN
          v_anio_nac := NULL;
        END;

        IF v_anio_nac IS NULL AND v_fecha_nac IS NOT NULL THEN
          v_anio_nac := EXTRACT(YEAR FROM v_fecha_nac)::integer;
        END IF;

        -- 2. Asegurar identidad única del ejemplar (buscar o insertar)
        SELECT id INTO v_ejemplar_id
        FROM public.ejemplares
        WHERE nombre_limpio = v_nombre_limpio
          AND pais_origen = v_pais_origen
          AND COALESCE(fecha_nacimiento, '1900-01-01'::date) = COALESCE(v_fecha_nac, '1900-01-01'::date)
          AND COALESCE(anio_nacimiento, 0) = COALESCE(v_anio_nac, 0)
        LIMIT 1;

        IF v_ejemplar_id IS NULL THEN
          -- Búsqueda secundaria flexible por nombre_limpio y pais_origen si fecha está vacía
          SELECT id INTO v_ejemplar_id
          FROM public.ejemplares
          WHERE nombre_limpio = v_nombre_limpio
            AND pais_origen = v_pais_origen
          LIMIT 1;
        END IF;

        IF v_ejemplar_id IS NULL THEN
          INSERT INTO public.ejemplares (
            nombre,
            nombre_limpio,
            pais_origen,
            fecha_nacimiento,
            anio_nacimiento,
            sexo,
            pelaje,
            padre,
            madre,
            abuelo_materno,
            stud,
            haras_criador,
            nacionalidad
          ) VALUES (
            v_nombre,
            v_nombre_limpio,
            v_pais_origen,
            v_fecha_nac,
            v_anio_nac,
            v_ejemplar->>'sexo',
            v_ejemplar->>'pelaje',
            v_ejemplar->>'padre',
            v_ejemplar->>'madre',
            v_ejemplar->>'abuelo_materno',
            v_ejemplar->>'stud',
            v_ejemplar->>'haras_criador',
            v_pais_origen
          )
          RETURNING id INTO v_ejemplar_id;
        ELSE
          -- Actualizar solo metadatos faltantes, conservando identidad histórica intacta
          UPDATE public.ejemplares SET
            fecha_nacimiento = COALESCE(ejemplares.fecha_nacimiento, v_fecha_nac),
            anio_nacimiento = COALESCE(ejemplares.anio_nacimiento, v_anio_nac),
            sexo = COALESCE(ejemplares.sexo, v_ejemplar->>'sexo'),
            pelaje = COALESCE(ejemplares.pelaje, v_ejemplar->>'pelaje'),
            padre = COALESCE(ejemplares.padre, v_ejemplar->>'padre'),
            madre = COALESCE(ejemplares.madre, v_ejemplar->>'madre'),
            abuelo_materno = COALESCE(ejemplares.abuelo_materno, v_ejemplar->>'abuelo_materno'),
            stud = COALESCE(ejemplares.stud, v_ejemplar->>'stud'),
            haras_criador = COALESCE(ejemplares.haras_criador, v_ejemplar->>'haras_criador'),
            updated_at = now()
          WHERE id = v_ejemplar_id;
        END IF;

        -- 3. Upsert en carreras_profundas_ejemplares
        INSERT INTO public.carreras_profundas_ejemplares (
          carrera_id,
          ejemplar_id,
          numero_programa,
          puesto_partida,
          nombre,
          jinete,
          entrenador,
          peso_kg,
          peso_base_kg,
          descargo_kg,
          dias_sin_correr,
          ganancias_usd,
          implementos,
          campana_resumen,
          comentario,
          morning_line,
          es_elegible,
          retirado,
          raw_data
        ) VALUES (
          v_carrera_id,
          v_ejemplar_id,
          COALESCE(v_ejemplar->>'numero_programa', v_ejemplar->>'numero', '1'),
          (v_ejemplar->>'puesto_partida')::integer,
          v_nombre,
          v_ejemplar->>'jinete',
          v_ejemplar->>'entrenador',
          (v_ejemplar->>'peso_kg')::numeric,
          (v_ejemplar->>'peso_base_kg')::numeric,
          (v_ejemplar->>'descargo_kg')::numeric,
          (v_ejemplar->>'dias_sin_correr')::integer,
          (v_ejemplar->>'ganancias_usd')::numeric,
          v_ejemplar->>'implementos',
          v_ejemplar->>'campana_resumen',
          v_ejemplar->>'comentario',
          v_ejemplar->>'morning_line',
          COALESCE((v_ejemplar->>'es_elegible')::boolean, false),
          COALESCE((v_ejemplar->>'retirado')::boolean, false),
          v_ejemplar
        )
        ON CONFLICT (carrera_id, numero_programa) DO UPDATE SET
          puesto_partida = COALESCE(EXCLUDED.puesto_partida, carreras_profundas_ejemplares.puesto_partida),
          nombre = EXCLUDED.nombre,
          jinete = COALESCE(EXCLUDED.jinete, carreras_profundas_ejemplares.jinete),
          entrenador = COALESCE(EXCLUDED.entrenador, carreras_profundas_ejemplares.entrenador),
          peso_kg = COALESCE(EXCLUDED.peso_kg, carreras_profundas_ejemplares.peso_kg),
          dias_sin_correr = COALESCE(EXCLUDED.dias_sin_correr, carreras_profundas_ejemplares.dias_sin_correr),
          ganancias_usd = COALESCE(EXCLUDED.ganancias_usd, carreras_profundas_ejemplares.ganancias_usd),
          implementos = COALESCE(EXCLUDED.implementos, carreras_profundas_ejemplares.implementos),
          morning_line = COALESCE(EXCLUDED.morning_line, carreras_profundas_ejemplares.morning_line),
          raw_data = EXCLUDED.raw_data;

        v_tot_ejemplares := v_tot_ejemplares + 1;

        -- Construir entrada para catálogo carreras (compatibilidad global)
        v_carreras_catalogo_caballos := v_carreras_catalogo_caballos || jsonb_build_array(
          jsonb_build_object(
            'numero', COALESCE(v_ejemplar->>'numero_programa', v_ejemplar->>'numero', '1'),
            'nombre', v_nombre,
            'nacionalidad', v_pais_origen,
            'jockey', v_ejemplar->>'jinete',
            'entrenador', v_ejemplar->>'entrenador',
            'peso', v_ejemplar->>'peso_kg',
            'implementos', v_ejemplar->>'implementos',
            'ml', v_ejemplar->>'morning_line',
            'retirado', COALESCE((v_ejemplar->>'retirado')::boolean, false)
          )
        );

        -- 4. Actuaciones previas (Historial sin duplicar)
        v_actuaciones := v_ejemplar->'carreras_previas';
        IF v_actuaciones IS NOT NULL AND jsonb_typeof(v_actuaciones) = 'array' THEN
          FOR v_actuacion IN SELECT * FROM jsonb_array_elements(v_actuaciones)
          LOOP
            BEGIN
              INSERT INTO public.ejemplares_actuaciones (
                ejemplar_id,
                fecha,
                hipodromo,
                numero_carrera,
                distancia_m,
                pp,
                pos_400m,
                pos_800m,
                pos_llegada,
                peso_jinete_kg,
                jinete,
                dividendo,
                ganador,
                cuerpos,
                lote,
                rating,
                ttc,
                tiempo_ganador,
                tiempo_ejemplar,
                total_ejemplares,
                superficie,
                condicion_pista,
                raw_data
              ) VALUES (
                v_ejemplar_id,
                (v_actuacion->>'fecha')::date,
                upper(trim(COALESCE(v_actuacion->>'hipodromo', v_hipodromo))),
                COALESCE(v_actuacion->>'numero_carrera', '1'),
                (v_actuacion->>'distancia_m')::integer,
                (v_actuacion->>'pp')::integer,
                (v_actuacion->>'pos_400m')::integer,
                (v_actuacion->>'pos_800m')::integer,
                (v_actuacion->>'pos_llegada')::integer,
                (v_actuacion->>'peso_jinete_kg')::numeric,
                v_actuacion->>'jinete',
                v_actuacion->>'dividendo',
                v_actuacion->>'ganador',
                v_actuacion->>'cuerpos',
                v_actuacion->>'lote',
                (v_actuacion->>'rating')::numeric,
                (v_actuacion->>'ttc')::numeric,
                v_actuacion->>'tiempo_ganador',
                v_actuacion->>'tiempo_ejemplar',
                (v_actuacion->>'total_ejemplares')::integer,
                v_actuacion->>'superficie',
                v_actuacion->>'condicion_pista',
                v_actuacion
              )
              ON CONFLICT (ejemplar_id, fecha, hipodromo, numero_carrera) DO NOTHING;
              v_tot_actuaciones := v_tot_actuaciones + 1;
            EXCEPTION WHEN OTHERS THEN
              -- Ignorar actuaciones con fecha inválida sin detener la importación
            END;
          END LOOP;
        END IF;

        -- 5. Trabajos / Traqueos / Workouts (Sin duplicar)
        v_trabajos := v_ejemplar->'trabajos';
        IF v_trabajos IS NOT NULL AND jsonb_typeof(v_trabajos) = 'array' THEN
          FOR v_trabajo IN SELECT * FROM jsonb_array_elements(v_trabajos)
          LOOP
            BEGIN
              INSERT INTO public.ejemplares_trabajos (
                ejemplar_id,
                fecha,
                hipodromo,
                distancia_m,
                tiempo,
                remate,
                modalidad,
                pista,
                superficie_estado,
                ranking,
                comentario,
                dias_atras,
                raw_data
              ) VALUES (
                v_ejemplar_id,
                CASE 
                  WHEN v_trabajo->>'fecha' IS NOT NULL THEN (v_trabajo->>'fecha')::date 
                  WHEN (v_trabajo->>'dias_atras') IS NOT NULL THEN v_fecha - ((v_trabajo->>'dias_atras')::integer)
                  ELSE v_fecha
                END,
                upper(trim(COALESCE(v_trabajo->>'hipodromo', v_hipodromo))),
                (v_trabajo->>'distancia_m')::integer,
                v_trabajo->>'tiempo',
                v_trabajo->>'remate',
                v_trabajo->>'modalidad',
                v_trabajo->>'pista',
                v_trabajo->>'superficie_estado',
                v_trabajo->>'ranking',
                v_trabajo->>'comentario',
                (v_trabajo->>'dias_atras')::integer,
                v_trabajo
              )
              ON CONFLICT (ejemplar_id, COALESCE(fecha, '1900-01-01'::date), COALESCE(distancia_m, 0), COALESCE(tiempo, '')) DO NOTHING;
              v_tot_trabajos := v_tot_trabajos + 1;
            EXCEPTION WHEN OTHERS THEN
              -- Ignorar trabajos defectuosos
            END;
          END LOOP;
        END IF;

      END LOOP;
    END IF;

    -- 6. SINCRONIZACIÓN AUTOMÁTICA CON public.carreras (Maestro existente de la plataforma)
    IF to_regclass('public.carreras') IS NOT NULL THEN
      BEGIN
        INSERT INTO public.carreras (
          fecha,
          hipodromo,
          carrera,
          distancia,
          hora,
          superficie,
          premio,
          caballos
        ) VALUES (
          v_fecha::text,
          v_hipodromo,
          v_numero_carrera,
          COALESCE((v_carrera->>'distancia_m')::text, '1200'),
          v_carrera->>'hora',
          COALESCE(v_carrera->>'superficie', 'ARENA'),
          COALESCE((v_carrera->>'bolsa_usd')::numeric, 0),
          v_carreras_catalogo_caballos
        )
        ON CONFLICT (fecha, hipodromo, carrera) DO UPDATE SET
          distancia = COALESCE(EXCLUDED.distancia, carreras.distancia),
          hora = COALESCE(EXCLUDED.hora, carreras.hora),
          superficie = COALESCE(EXCLUDED.superficie, carreras.superficie),
          premio = COALESCE(EXCLUDED.premio, carreras.premio),
          caballos = EXCLUDED.caballos;
      EXCEPTION WHEN OTHERS THEN
        -- Si carreras no tiene el unique exacto o falla, no detener
      END;
    END IF;

  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'carreras_procesadas', v_tot_carreras,
    'ejemplares_procesados', v_tot_ejemplares,
    'actuaciones_procesadas', v_tot_actuaciones,
    'trabajos_procesados', v_tot_trabajos
  );
END;
$$;

-- Permisos de ejecución
GRANT EXECUTE ON FUNCTION public.ingestar_gaceta_profunda(jsonb) TO authenticated, anon;
GRANT SELECT ON public.vw_modal_tablas_y_remates TO authenticated, anon;
GRANT SELECT ON public.vw_modal_dupleta_y_polla TO authenticated, anon;
