-- ============================================================================
-- marcas_dia
-- ----------------------------------------------------------------------------
-- Guarda la jornada de "Marcas" (retos 120/100) de un hipódromo en una fecha:
-- una fila por carrera con los caballos marcados ("/") y los caballos en contra
-- (","), más las condiciones editables. La clave única es hipodromo + fecha →
-- UPSERT con onConflict desde la SPA (RLS permisiva, igual que el resto del
-- módulo hípico). Idempotente: puede ejecutarse tantas veces como quiera.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.marcas_dia (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    hipodromo TEXT NOT NULL,
    fecha DATE NOT NULL,
    filas JSONB NOT NULL DEFAULT '[]'::jsonb,
    condiciones TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT marcas_dia_unico UNIQUE (hipodromo, fecha)
);

-- Condición "VALEN O NO VALEN DEBUTANTES" (por defecto NO VALEN → false).
ALTER TABLE public.marcas_dia ADD COLUMN IF NOT EXISTS valen_debutantes BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.marcas_dia ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS marcas_dia_publico ON public.marcas_dia;
CREATE POLICY marcas_dia_publico ON public.marcas_dia
    FOR ALL
    USING (true)
    WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.marcas_dia TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.marcas_dia TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.marcas_dia TO service_role;