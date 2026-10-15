-- ============================================================================
-- dupletas
-- ----------------------------------------------------------------------------
-- Guarda la matriz de la dupleta como JSON (estado completo: caballos de cada
-- carrera, premio, precio por cuadro, retirados y celdas vendidas).
-- La clave única es hipodromo|fecha|carrera1|carrera2 → UPSERT con onConflict
-- desde la SPA (RLS permisiva para que el cliente anon pueda leer/escribir,
-- igual que el resto del módulo hípico).
-- Idempotente: puede ejecutarse tantas veces como quiera.
-- ============================================================================

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