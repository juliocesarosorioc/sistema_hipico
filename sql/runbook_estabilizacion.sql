-- ============================================================================
-- RUNBOOK DE ESTABILIZACIÓN — MÓDULOS DUPLETA, MARCAS Y TICKETS (RECLAMOS)
-- ----------------------------------------------------------------------------
-- PEGAR COMPLETO EN EL SQL EDITOR DE LA CONSOLA DE SUPABASE Y EJECUTAR.
--  · Crea (si no existen) las tablas dupletas, marcas_dia y tickets_jugadas.
--  · Idempotente: se puede ejecutar cuantas veces se quiera sin errores.
--  · Habilita RLS permisiva + GRANTs para anon/authenticated/service_role
--    (mismo patrón que el resto del módulo hípico).
--  · Añade las tablas a la publicación `supabase_realtime` para la
--    reactividad multi-sesión (tablas_fijas, resultados_carreras, dupletas,
--    marcas_dia, tickets_jugadas).
--  · Todo corre dentro de una transacción: o se aplica completo o nada.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1) TABLA dupletas — matriz de apuestas cruzadas (módulo Dupleta)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.dupletas (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    clave TEXT NOT NULL UNIQUE,
    hipodromo TEXT NOT NULL,
    fecha DATE NOT NULL,
    carrera1 INTEGER NOT NULL,
    carrera2 INTEGER NOT NULL,
    premio NUMERIC DEFAULT 0,
    precio NUMERIC DEFAULT 0,
    estado JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.dupletas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dupletas_publico ON public.dupletas;
CREATE POLICY dupletas_publico ON public.dupletas
    FOR ALL
    USING (true)
    WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.dupletas TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dupletas TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dupletas TO service_role;

-- ----------------------------------------------------------------------------
-- 2) TABLA marcas_dia — jornada de Marcas 120/100 (hipódromo + fecha únicos)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.marcas_dia (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    hipodromo TEXT NOT NULL,
    fecha DATE NOT NULL,
    filas JSONB NOT NULL DEFAULT '[]'::jsonb,
    condiciones TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT marcas_dia_unico UNIQUE (hipodromo, fecha)
);

ALTER TABLE public.marcas_dia ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS marcas_dia_publico ON public.marcas_dia;
CREATE POLICY marcas_dia_publico ON public.marcas_dia
    FOR ALL
    USING (true)
    WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.marcas_dia TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.marcas_dia TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.marcas_dia TO service_role;

-- ----------------------------------------------------------------------------
-- 3) TABLA tickets_jugadas — reclamos/disputas del cliente (Tickets por
--    solucionar). Estados CREADO → EN_REVISION → SOLUCIONADO, acción de la casa
--    (ABONO/REEMBOLSO/AJUSTE/RECHAZO) y encuesta de satisfacción 1-5.
--    cliente_id sin FK dura explícita: el esquema del cliente puede variar
--    (uuid o bigint), la SPA tolera ambos.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tickets_jugadas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    numero_ticket SERIAL UNIQUE,
    cliente_id UUID,
    cliente_nombre TEXT,
    jugada_origen TEXT,
    jugada_id TEXT,
    tipo_jugada TEXT,
    fecha_jugada DATE,
    hipodromo TEXT,
    carrera INTEGER,
    monto NUMERIC,
    premio_recalculado NUMERIC,
    motivo TEXT,
    imagen_soporte TEXT,
    estado TEXT NOT NULL DEFAULT 'CREADO'
        CHECK (estado IN ('CREADO', 'EN_REVISION', 'SOLUCIONADO')),
    respuesta_casa TEXT,
    accion_aplicada TEXT
        CHECK (accion_aplicada IN ('ABONO', 'REEMBOLSO', 'AJUSTE', 'RECHAZO')),
    monto_resuelto NUMERIC,
    respondido_por TEXT,
    respondido_at TIMESTAMPTZ,
    encuesta_satisfaccion INTEGER
        CHECK (encuesta_satisfaccion BETWEEN 1 AND 5),
    encuesta_comentario TEXT,
    encuesta_at TIMESTAMPTZ,
    creado_por TEXT,
    creado_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Índice de consulta por cliente (Portal: "Mis tickets").
CREATE INDEX IF NOT EXISTS idx_tickets_jugadas_cliente
    ON public.tickets_jugadas (cliente_id, creado_at DESC);

-- Índice de consulta por estado (Consola de la casa).
CREATE INDEX IF NOT EXISTS idx_tickets_jugadas_estado
    ON public.tickets_jugadas (estado, creado_at DESC);

ALTER TABLE public.tickets_jugadas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tickets_jugadas_publico ON public.tickets_jugadas;
CREATE POLICY tickets_jugadas_publico ON public.tickets_jugadas
    FOR ALL
    USING (true)
    WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tickets_jugadas TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tickets_jugadas TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tickets_jugadas TO service_role;

-- ----------------------------------------------------------------------------
-- 4) REALTIME — añade las tablas a la publicación supabase_realtime
--    (best-effort: si no existe la publicación o la tabla ya está, no falla)
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    table_name TEXT;
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        FOREACH table_name IN ARRAY ARRAY[
            'public.tablas_fijas',
            'public.resultados_carreras',
            'public.dupletas',
            'public.marcas_dia',
            'public.tickets_jugadas'
        ]
        LOOP
            BEGIN
                EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE %s', table_name);
            EXCEPTION
                WHEN duplicate_object THEN
                    NULL; -- ya estaba en la publicación
                WHEN undefined_table THEN
                    NULL; -- tabla no existe (aún), se realimenta en otra ejecución
            END;
        END LOOP;
    END IF;
END $$;

COMMIT;

-- ============================================================================
-- FIN DEL RUNBOOK — Verificar: SELECT * FROM public.dupletas LIMIT 1; etc.
-- ============================================================================