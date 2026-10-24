-- ============================================================
-- HISTORIAL EVOLUTIVO DEL EJEMPLAR - LLAVE MAESTRA (nombre_normalizado, pais)
-- Integra: participaciones, trackeos, pesos físicos, tablas fijas, jugadas, notas
-- ============================================================

-- Función para normalizar nombres
CREATE OR REPLACE FUNCTION normalizar_nombre_ejemplar(p_nombre text)
RETURNS text AS $$
BEGIN
  IF p_nombre IS NULL THEN RETURN ''; END IF;
  RETURN UPPER(TRIM(regexp_replace(regexp_replace(p_nombre, '[^A-Z0-9ÁÉÍÓÚÑ ]', ' ', 'g'), '\s+', ' ', 'g')));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Tabla maestra de ejemplares
CREATE TABLE IF NOT EXISTS padron_ejemplares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre_normalizado text NOT NULL,
  nombre_completo text,
  pais text NOT NULL DEFAULT 'VE',
  edad integer,
  sexo text,
  padre text,
  madre text,
  abuelo_materno text,
  haras text,
  stud text,
  implementos text,
  aptitud_dirt numeric,
  aptitud_turf numeric,
  aptitud_wet numeric,
  aptitud_synth numeric,
  peso_optimo_kg numeric,
  peso_fisico_hoy_kg numeric,
  speed_rating_promedio numeric,
  speed_rating_maximo numeric,
  beyer_promedio numeric,
  beyer_maximo numeric,
  indice_consistencia_godet numeric,
  indice_godet numeric,
  jinete_habitual text,
  entrenador_actual text,
  trackeos_count integer DEFAULT 0,
  actuaciones_count integer DEFAULT 0,
  notas_analista text,
  datos_extra jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(nombre_normalizado, pais)
);

CREATE INDEX IF NOT EXISTS idx_padron_ejemplares_nombre_pais ON padron_ejemplares(nombre_normalizado, pais);
CREATE INDEX IF NOT EXISTS idx_padron_ejemplares_nombre ON padron_ejemplares(nombre_normalizado);

-- Historial de participaciones
CREATE TABLE IF NOT EXISTS historial_participaciones_ejemplar (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ejemplar_id uuid REFERENCES padron_ejemplares(id) ON DELETE CASCADE,
  nombre_normalizado text NOT NULL,
  pais text NOT NULL DEFAULT 'VE',
  fecha date,
  hipodromo text,
  numero_carrera integer,
  codigo_carrera text,
  distancia text,
  superficie text,
  condicion_pista text,
  peso_fisico numeric,
  peso_jinete numeric,
  descargo numeric,
  jinete text,
  entrenador text,
  pp integer,
  posicion_llegada integer,
  cuerpos text,
  parciales_pos text,
  tiempo_ganador text,
  tiempo_ejemplar text,
  km_h numeric,
  beyer numeric,
  speed_rating numeric,
  dividendo text,
  ganador_o_segundo text,
  serie text,
  comentarios text,
  datos_extra jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hist_part_ejemplar_id ON historial_participaciones_ejemplar(ejemplar_id);
CREATE INDEX IF NOT EXISTS idx_hist_part_nombre_pais ON historial_participaciones_ejemplar(nombre_normalizado, pais);
CREATE INDEX IF NOT EXISTS idx_hist_part_fecha ON historial_participaciones_ejemplar(fecha);

-- Historial de trackeos/workouts
CREATE TABLE IF NOT EXISTS trackeos_ejemplar (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ejemplar_id uuid REFERENCES padron_ejemplares(id) ON DELETE CASCADE,
  nombre_normalizado text NOT NULL,
  pais text NOT NULL DEFAULT 'VE',
  fecha date,
  hipodromo text,
  jinete text,
  distancia_ejercicio text,
  fraccionales_texto text,
  tiempo text,
  condicion text,
  modalidad_ep_es text,
  remate_200m text,
  estilo text,
  ranking text,
  comentario text,
  fuente text DEFAULT 'gaceta',
  datos_extra jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trackeos_ejemplar_id ON trackeos_ejemplar(ejemplar_id);
CREATE INDEX IF NOT EXISTS idx_trackeos_nombre_pais ON trackeos_ejemplar(nombre_normalizado, pais);
CREATE INDEX IF NOT EXISTS idx_trackeos_fecha ON trackeos_ejemplar(fecha);

-- Evolución de peso físico
CREATE TABLE IF NOT EXISTS pesos_fisicos_ejemplar (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ejemplar_id uuid REFERENCES padron_ejemplares(id) ON DELETE CASCADE,
  nombre_normalizado text NOT NULL,
  pais text NOT NULL DEFAULT 'VE',
  fecha date DEFAULT current_date,
  peso_optimo_kg numeric,
  peso_fisico_hoy_kg numeric,
  peso_vivo numeric,
  fuente text,
  datos_extra jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pesos_ejemplar_id ON pesos_fisicos_ejemplar(ejemplar_id);
CREATE INDEX IF NOT EXISTS idx_pesos_nombre_pais ON pesos_fisicos_ejemplar(nombre_normalizado, pais);

-- Historial de apuestas/jugadas por ejemplar
CREATE TABLE IF NOT EXISTS apuestas_historial_ejemplar (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ejemplar_id uuid REFERENCES padron_ejemplares(id) ON DELETE CASCADE,
  nombre_normalizado text NOT NULL,
  pais text NOT NULL DEFAULT 'VE',
  fecha date DEFAULT current_date,
  hipodromo text,
  numero_carrera integer,
  tipo_apuesta text,
  monto numeric DEFAULT 0,
  unidades numeric DEFAULT 0,
  tablas_fijas boolean DEFAULT false,
  ticket_id uuid,
  tabla_id uuid,
  datos_extra jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_apuestas_ejemplar_id ON apuestas_historial_ejemplar(ejemplar_id);
CREATE INDEX IF NOT EXISTS idx_apuestas_nombre_pais ON apuestas_historial_ejemplar(nombre_normalizado, pais);
CREATE INDEX IF NOT EXISTS idx_apuestas_fecha ON apuestas_historial_ejemplar(fecha);

-- Notas del analista por ejemplar
CREATE TABLE IF NOT EXISTS notas_analista_ejemplar (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ejemplar_id uuid REFERENCES padron_ejemplares(id) ON DELETE CASCADE,
  nombre_normalizado text NOT NULL,
  pais text NOT NULL DEFAULT 'VE',
  analista_id uuid,
  nota text,
  etiquetas text[],
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notas_ejemplar_id ON notas_analista_ejemplar(ejemplar_id);
CREATE INDEX IF NOT EXISTS idx_notas_nombre_pais ON notas_analista_ejemplar(nombre_normalizado, pais);

-- Función RPC para obtener memoria histórica consolidada
CREATE OR REPLACE FUNCTION rpc_obtener_memoria_historica_caballos(p_nombres text[])
RETURNS TABLE (
  nombre_normalizado text,
  pais text,
  ejemplar_id uuid,
  speed_rating_promedio numeric,
  speed_rating_maximo numeric,
  beyer_promedio numeric,
  beyer_maximo numeric,
  indice_consistencia_godet numeric,
  indice_godet numeric,
  peso_optimo_kg numeric,
  peso_fisico_hoy_kg numeric,
  actuaciones_count integer,
  trackeos_count integer,
  jinete_habitual text,
  entrenador_actual text,
  aptitud_dirt numeric,
  aptitud_turf numeric,
  aptitud_wet numeric,
  ultimas_actuaciones jsonb,
  ultimos_trackeos jsonb,
  historial_pesos jsonb,
  apuestas_resumen jsonb,
  notas_recientes jsonb
) AS $$
BEGIN
  RETURN QUERY
  WITH nombres_norm AS (
    SELECT DISTINCT normalizar_nombre_ejemplar(unnest(p_nombres)) AS nn
  ),
  ejemplares_match AS (
    SELECT pe.* FROM padron_ejemplares pe
    JOIN nombres_norm nn ON pe.nombre_normalizado = nn.nn
  ),
  acts AS (
    SELECT hpe.nombre_normalizado, hpe.pais,
           jsonb_agg(jsonb_build_object(
             'fecha', hpe.fecha,
             'hipodromo', hpe.hipodromo,
             'carrera', hpe.numero_carrera,
             'distancia', hpe.distancia,
             'posicion', hpe.posicion_llegada,
             'beyer', hpe.beyer,
             'speed_rating', hpe.speed_rating,
             'tiempo', hpe.tiempo_ejemplar,
             'jinete', hpe.jinete,
             'comentario', hpe.comentarios,
             'peso_fisico', hpe.peso_fisico,
             'condicion_pista', hpe.condicion_pista
           ) ORDER BY hpe.fecha DESC NULLS LAST) FILTER (WHERE hpe.fecha IS NOT NULL) AS actuaciones
    FROM historial_participaciones_ejemplar hpe
    JOIN ejemplares_match em ON em.nombre_normalizado = hpe.nombre_normalizado AND em.pais = hpe.pais
    GROUP BY hpe.nombre_normalizado, hpe.pais
  ),
  trks AS (
    SELECT te.nombre_normalizado, te.pais,
           jsonb_agg(jsonb_build_object(
             'fecha', te.fecha,
             'hipodromo', te.hipodromo,
             'distancia_ejercicio', te.distancia_ejercicio,
             'fraccionales_texto', te.fraccionales_texto,
             'tiempo', te.tiempo,
             'comentario', te.comentario,
             'remate_200m', te.remate_200m,
             'estilo', te.estilo
           ) ORDER BY te.fecha DESC NULLS LAST) FILTER (WHERE te.fecha IS NOT NULL) AS trackeos
    FROM trackeos_ejemplar te
    JOIN ejemplares_match em ON em.nombre_normalizado = te.nombre_normalizado AND em.pais = te.pais
    GROUP BY te.nombre_normalizado, te.pais
  ),
  pesos AS (
    SELECT pfe.nombre_normalizado, pfe.pais,
           jsonb_agg(jsonb_build_object(
             'fecha', pfe.fecha,
             'peso_optimo_kg', pfe.peso_optimo_kg,
             'peso_fisico_hoy_kg', pfe.peso_fisico_hoy_kg,
             'peso_vivo', pfe.peso_vivo
           ) ORDER BY pfe.fecha DESC NULLS LAST) AS pesos
    FROM pesos_fisicos_ejemplar pfe
    JOIN ejemplares_match em ON em.nombre_normalizado = pfe.nombre_normalizado AND em.pais = pfe.pais
    GROUP BY pfe.nombre_normalizado, pfe.pais
  ),
  ap AS (
    SELECT ahe.nombre_normalizado, ahe.pais,
           jsonb_build_object(
             'total_monto', COALESCE(SUM(ahe.monto),0),
             'total_unidades', COALESCE(SUM(ahe.unidades),0),
             'count', COUNT(*),
             'tablas_fijas_count', COUNT(*) FILTER (WHERE ahe.tablas_fijas = true)
           ) AS resumen
    FROM apuestas_historial_ejemplar ahe
    JOIN ejemplares_match em ON em.nombre_normalizado = ahe.nombre_normalizado AND em.pais = ahe.pais
    GROUP BY ahe.nombre_normalizado, ahe.pais
  ),
  nts AS (
    SELECT nae.nombre_normalizado, nae.pais,
           jsonb_agg(jsonb_build_object(
             'nota', nae.nota,
             'etiquetas', nae.etiquetas,
             'updated_at', nae.updated_at
           ) ORDER BY nae.updated_at DESC NULLS LAST) FILTER (WHERE nae.nota IS NOT NULL) AS notas
    FROM notas_analista_ejemplar nae
    JOIN ejemplares_match em ON em.nombre_normalizado = nae.nombre_normalizado AND em.pais = nae.pais
    GROUP BY nae.nombre_normalizado, nae.pais
  )
  SELECT 
    em.nombre_normalizado,
    em.pais,
    em.id,
    em.speed_rating_promedio,
    em.speed_rating_maximo,
    em.beyer_promedio,
    em.beyer_maximo,
    em.indice_consistencia_godet,
    em.indice_godet,
    em.peso_optimo_kg,
    em.peso_fisico_hoy_kg,
    em.actuaciones_count,
    em.trackeos_count,
    em.jinete_habitual,
    em.entrenador_actual,
    em.aptitud_dirt,
    em.aptitud_turf,
    em.aptitud_wet,
    COALESCE(acts.actuaciones, '[]'::jsonb),
    COALESCE(trks.trackeos, '[]'::jsonb),
    COALESCE(pesos.pesos, '[]'::jsonb),
    COALESCE(ap.resumen, '{}'::jsonb),
    COALESCE(nts.notas, '[]'::jsonb)
  FROM ejemplares_match em
  LEFT JOIN acts ON acts.nombre_normalizado = em.nombre_normalizado AND acts.pais = em.pais
  LEFT JOIN trks ON trks.nombre_normalizado = em.nombre_normalizado AND trks.pais = em.pais
  LEFT JOIN pesos ON pesos.nombre_normalizado = em.nombre_normalizado AND pesos.pais = em.pais
  LEFT JOIN ap ON ap.nombre_normalizado = em.nombre_normalizado AND ap.pais = em.pais
  LEFT JOIN nts ON nts.nombre_normalizado = em.nombre_normalizado AND nts.pais = em.pais;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger para actualizar updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_padron_ejemplares_updated_at ON padron_ejemplares;
CREATE TRIGGER update_padron_ejemplares_updated_at
  BEFORE UPDATE ON padron_ejemplares
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_notas_analista_updated_at ON notas_analista_ejemplar;
CREATE TRIGGER update_notas_analista_updated_at
  BEFORE UPDATE ON notas_analista_ejemplar
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
