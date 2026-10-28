-- ============================================================================
-- ESQUEMA AISLADO: INTELIGENCIA HÍPICA VENEZUELA (ih_*)
-- ============================================================================
-- Bounded Context exclusivo para el Sistema Experto de Análisis, Simulación
-- Prospectiva y Optimización del 5y6 Nacional (MACTOR + SMIC + Actuario v4).
--
-- REGLA DE ORO DE AISLAMIENTO:
-- Ninguna tabla operativa (apuestas, clientes, saldos, tickets, etc.) se cruza ni
-- se modifica desde este laboratorio analítico.
-- ============================================================================

-- 1. CATÁLOGO MAESTRO DE EJEMPLARES IH
CREATE TABLE IF NOT EXISTS public.ih_ejemplares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre_normalizado TEXT NOT NULL UNIQUE,
  nombre_display TEXT NOT NULL,
  pais_origen TEXT DEFAULT 'VEN',
  sexo TEXT, -- C (Caballo), Y (Yegua), P (Potro), CA (Castrado)
  pelaje TEXT, -- Z (Zaino), A (Alazán), C (Castaño), T (Tordillo)
  fecha_nacimiento DATE,
  edad_actual INTEGER,
  padre TEXT,
  madre TEXT,
  abuelo_materno TEXT,
  notas_pedigree TEXT,
  haras_origen TEXT,
  stud_actual TEXT,
  divisa_camisa TEXT,
  divisa_mangas TEXT,
  divisa_gorra TEXT,
  divisa_svg_config JSONB DEFAULT '{}'::jsonb,
  campana_general_corri INTEGER DEFAULT 0,
  campana_general_gano INTEGER DEFAULT 0,
  campana_general_seg INTEGER DEFAULT 0,
  campana_general_ter INTEGER DEFAULT 0,
  campana_general_no_figuro INTEGER DEFAULT 0,
  produccion_usd NUMERIC(14,2) DEFAULT 0,
  peso_fisico_historico JSONB DEFAULT '[]'::jsonb, -- Array de { fecha, pesoKg, carreraId, gano }
  peso_optimo_calculado NUMERIC(6,2),
  implementos_historicos TEXT[] DEFAULT ARRAY[]::TEXT[],
  ultimo_implemento_registrado TEXT,
  mejor_puesto_pista INTEGER,
  preferencia_linea_pista TEXT DEFAULT 'CENTRO', -- RIEL, CENTRO, AFUERA
  estilo_correr_inferido TEXT DEFAULT 'E2', -- E1 (Puntero), E2 (Stalker / Colocado), E3 (Rematador)
  creado_en TIMESTAMPTZ DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ih_ejemplares_nombre ON public.ih_ejemplares(nombre_normalizado);

-- 2. PROFESIONALES (Jinetes, Entrenadores, Studs, Haras)
CREATE TABLE IF NOT EXISTS public.ih_profesionales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo TEXT NOT NULL, -- 'JINETE', 'ENTRENADOR', 'STUD', 'HARAS'
  nombre_normalizado TEXT NOT NULL,
  nombre_display TEXT NOT NULL,
  ano_temporada INTEGER DEFAULT 2026,
  corridas INTEGER DEFAULT 0,
  primeros INTEGER DEFAULT 0,
  segundos INTEGER DEFAULT 0,
  terceros INTEGER DEFAULT 0,
  pct_victorias NUMERIC(6,2) DEFAULT 0,
  pct_efectividad NUMERIC(6,2) DEFAULT 0,
  estadisticas_detalladas JSONB DEFAULT '{}'::jsonb,
  actualizado_en TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_ih_profesional UNIQUE (tipo, nombre_normalizado, ano_temporada)
);

-- 3. YUNTAS Y SINERGIAS (Jinete / Entrenador)
CREATE TABLE IF NOT EXISTS public.ih_yuntas_sinergias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  jinete_normalizado TEXT NOT NULL,
  entrenador_normalizado TEXT NOT NULL,
  ano_temporada INTEGER DEFAULT 2026,
  corridas INTEGER DEFAULT 0,
  primeros INTEGER DEFAULT 0,
  segundos INTEGER DEFAULT 0,
  terceros INTEGER DEFAULT 0,
  pct_victorias NUMERIC(6,2) DEFAULT 0,
  actualizado_en TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_ih_yunta UNIQUE (jinete_normalizado, entrenador_normalizado, ano_temporada)
);

-- 4. CARRERAS DEL PROGRAMA OFICIAL ANALIZADAS
CREATE TABLE IF NOT EXISTS public.ih_carreras_programa (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha DATE NOT NULL,
  hipodromo TEXT NOT NULL, -- LA RINCONADA, VALENCIA
  reunion_numero INTEGER,
  carrera_numero INTEGER NOT NULL,
  distancia_metros INTEGER NOT NULL,
  superficie TEXT DEFAULT 'ARENA',
  hora_programada TIME,
  categoria_llamado TEXT,
  premio_bolivares NUMERIC(14,2) DEFAULT 0,
  premio_dolares NUMERIC(14,2) DEFAULT 0,
  es_valida_5y6 BOOLEAN DEFAULT FALSE,
  numero_valida_5y6 INTEGER, -- 1 a 6 si es_valida_5y6 es true
  estado_carrera TEXT DEFAULT 'PROGRAMADA', -- PROGRAMADA, CORRIENDO, FINALIZADA, CANCELADA
  pizarra_oficial INTEGER[] DEFAULT ARRAY[]::INTEGER[],
  variante_tiempo_oficial NUMERIC(6,2),
  creado_en TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_ih_carrera_prog UNIQUE (fecha, hipodromo, carrera_numero)
);

-- 5. TENDENCIA DE LA TARDE / SESGO DE JORNADA EN VIVO
CREATE TABLE IF NOT EXISTS public.ih_tendencia_jornada (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha DATE NOT NULL,
  hipodromo TEXT NOT NULL,
  carrera_corte INTEGER DEFAULT 1, -- hasta qué carrera se observó
  factor_pista_en_vivo TEXT DEFAULT 'NORMAL', -- LIGERA, NORMAL, PESADA, FANGOSA
  variante_segundos NUMERIC(4,2) DEFAULT 0.0,
  carril_dominante TEXT DEFAULT 'CENTRO', -- RIEL (1-3), CENTRO (4-6), AFUERA (7+)
  estilo_dominante TEXT DEFAULT 'E2', -- E1 (Velocistas), E2 (Colocados), E3 (Rematadores)
  observaciones TEXT,
  actualizado_por TEXT,
  actualizado_en TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_ih_tendencia UNIQUE (fecha, hipodromo)
);

-- 6. INSCRIPCIONES POR CARRERA (MATRIZ DE PARTICIPANTES)
CREATE TABLE IF NOT EXISTS public.ih_inscripciones_carrera (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  carrera_id UUID NOT NULL REFERENCES public.ih_carreras_programa(id) ON DELETE CASCADE,
  numero_gualdrapa INTEGER NOT NULL,
  puesto_pista INTEGER NOT NULL,
  ejemplar_id UUID REFERENCES public.ih_ejemplares(id),
  nombre_ejemplar TEXT NOT NULL,
  jinete TEXT,
  kilos_jinete NUMERIC(5,2),
  entrenador TEXT,
  stud TEXT,
  implementos TEXT,
  morning_line NUMERIC(6,2),
  dividendo_oficial NUMERIC(8,2),
  -- Variables tácticas en vivo (opcionales: pueden suministrarse en vivo o quedar null)
  peso_previo_carrera_kg NUMERIC(6,2),
  linea_corrida_pista TEXT, -- RIEL, CENTRO, AFUERA, COMPROMETIDO
  factor_pista_en_vivo TEXT,
  retirado_en_vivo BOOLEAN DEFAULT FALSE,
  motivo_retiro TEXT,
  -- Métricas calculadas por el motor actuarial v4
  speed_rating_ttc NUMERIC(6,2),
  probabilidad_smic_pct NUMERIC(6,2),
  score_godet_total NUMERIC(6,2),
  orden_proyeccion INTEGER,
  cuerpos_ventaja_proyectados NUMERIC(5,2),
  favorecido_tendencia_tarde BOOLEAN DEFAULT FALSE,
  es_linea_5y6 BOOLEAN DEFAULT FALSE,
  es_sorpresa_5y6 BOOLEAN DEFAULT FALSE,
  actualizado_en TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_ih_inscripcion UNIQUE (carrera_id, numero_gualdrapa)
);

-- 7. ACTUACIONES HISTÓRICAS (RETROSPECTO CON AUTO-ALIMENTACIÓN)
CREATE TABLE IF NOT EXISTS public.ih_actuaciones_historicas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ejemplar_id UUID REFERENCES public.ih_ejemplares(id) ON DELETE CASCADE,
  nombre_ejemplar TEXT NOT NULL,
  fecha DATE NOT NULL,
  hipodromo TEXT NOT NULL,
  carrera_numero INTEGER,
  distancia_metros INTEGER,
  puesto_pista INTEGER,
  peso_balanza_kg NUMERIC(6,2), -- Puede ser alimentado automáticamente desde gacetas posteriores
  jinete TEXT,
  kilos_jinete NUMERIC(5,2),
  entrenador TEXT,
  implementos TEXT,
  posicion_llegada INTEGER,
  cuerpos_diferencia NUMERIC(6,2),
  ganador_o_segundo TEXT,
  tiempo_ganador TEXT,
  tiempo_ejemplar TEXT,
  speed_rating_ttc NUMERIC(6,2),
  dividendo NUMERIC(8,2),
  parcial_primeros_metros TEXT, -- ej: 400m o 1000m
  parcial_recta_final TEXT, -- ej: 300m finales
  linea_corrida_resumen TEXT, -- ej: CAfTC, Riel, Afuera
  comentarios_carrera TEXT,
  creado_en TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_ih_actuacion UNIQUE (ejemplar_id, fecha, carrera_numero)
);

-- 8. MATRIZ DE TRABAJOS DE TOMATIEMPOS OFICIALES INH
CREATE TABLE IF NOT EXISTS public.ih_matriz_trabajos_tomatiempos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha_ejercicio DATE NOT NULL,
  hipodromo TEXT NOT NULL DEFAULT 'LA RINCONADA',
  ejemplar_id UUID REFERENCES public.ih_ejemplares(id) ON DELETE SET NULL,
  nombre_ejemplar TEXT NOT NULL,
  distancia_trabajo_metros INTEGER,
  tiempo_cronometrado TEXT NOT NULL, -- ej: "38.2", "49.1", "62.4"
  remate_final TEXT, -- ej: "12.3", "12.1"
  galope_desahogo TEXT, -- ej: "paró en 76.2 en 1000m"
  calificacion_traqueo TEXT, -- E (Excelente), MB (Muy Bien), B (Bien), R (Regular)
  observaciones_cancha TEXT, -- ej: "CÓMODO", "VOLANDO EN SILLA", "POR CENTRO DE CANCHA"
  jinete_traqueador TEXT,
  fuente_documento TEXT DEFAULT 'DIVISION DE TOMATIEMPOS OFICIALES INH',
  creado_en TIMESTAMPTZ DEFAULT NOW()
);

-- 9. OPTIMIZACIONES GUARDADAS DEL CUADRO MAESTRO 5Y6
CREATE TABLE IF NOT EXISTS public.ih_cuadros_maestros_5y6 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha DATE NOT NULL,
  hipodromo TEXT NOT NULL,
  factor_multiplicador NUMERIC(8,2) DEFAULT 35.0,
  estrategia TEXT NOT NULL, -- 'ECONOMICO', 'EQUILIBRADO', 'BLINDADO', 'PERSONALIZADO'
  presupuesto_maximo NUMERIC(12,2),
  combinaciones_totales INTEGER NOT NULL,
  costo_total NUMERIC(14,2) NOT NULL,
  probabilidad_cobertura_pct NUMERIC(6,2) NOT NULL,
  configuracion_validas JSONB NOT NULL, -- { v1: [num, ...], v2: [...], ... v6: [...] }
  resumen_estrategico TEXT,
  creado_en TIMESTAMPTZ DEFAULT NOW()
);

-- RLS POLICIES (Abiertas para lectura autenticada del laboratorio analítico)
ALTER TABLE public.ih_ejemplares ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ih_profesionales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ih_yuntas_sinergias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ih_carreras_programa ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ih_tendencia_jornada ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ih_inscripciones_carrera ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ih_actuaciones_historicas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ih_matriz_trabajos_tomatiempos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ih_cuadros_maestros_5y6 ENABLE ROW LEVEL SECURITY;

-- Políticas de lectura pública/autenticada para el laboratorio
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'ih_ejemplares_select') THEN
    CREATE POLICY ih_ejemplares_select ON public.ih_ejemplares FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'ih_carreras_select') THEN
    CREATE POLICY ih_carreras_select ON public.ih_carreras_programa FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'ih_tendencia_select') THEN
    CREATE POLICY ih_tendencia_select ON public.ih_tendencia_jornada FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'ih_inscripciones_select') THEN
    CREATE POLICY ih_inscripciones_select ON public.ih_inscripciones_carrera FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'ih_actuaciones_select') THEN
    CREATE POLICY ih_actuaciones_select ON public.ih_actuaciones_historicas FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'ih_trabajos_select') THEN
    CREATE POLICY ih_trabajos_select ON public.ih_matriz_trabajos_tomatiempos FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'ih_cuadros_select') THEN
    CREATE POLICY ih_cuadros_select ON public.ih_cuadros_maestros_5y6 FOR SELECT USING (true);
  END IF;
END $$;
