-- ============================================================================
-- MIGRACIÓN: TABLA whatsapp_plantillas_grupo PARA PERSONALIZACIÓN POR INQUILINO
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.whatsapp_plantillas_grupo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grupo_id uuid NOT NULL REFERENCES public.grupos_venta(id) ON DELETE CASCADE,
  clave text NOT NULL,
  titulo text NOT NULL,
  contenido text NOT NULL,
  variables_disponibles text[] DEFAULT ARRAY[]::text[],
  activo boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT whatsapp_plantillas_grupo_uniq UNIQUE (grupo_id, clave)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_plantillas_grupo_gid ON public.whatsapp_plantillas_grupo(grupo_id);

ALTER TABLE public.whatsapp_plantillas_grupo ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'whatsapp_plantillas_grupo' AND policyname = 'acceso_total_service_role'
  ) THEN
    CREATE POLICY acceso_total_service_role ON public.whatsapp_plantillas_grupo
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;
