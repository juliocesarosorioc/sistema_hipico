-- ============================================================================
-- PLANTILLAS GLOBALES DE WHATSAPP (grupo_id IS NULL)
-- ============================================================================
-- Las filas globales aplican a todos los inquilinos. Las plantillas de un grupo
-- concreto siguen teniendo precedencia (UNIQUE (grupo_id, clave)).

-- 1) grupo_id pasa a nullable para poder representar la plantilla global.
ALTER TABLE IF EXISTS public.whatsapp_plantillas_grupo
  ALTER COLUMN grupo_id DROP NOT NULL;

-- 2) La FK impide insertar NULL: se dropea la restricción conocida si existe.
ALTER TABLE IF EXISTS public.whatsapp_plantillas_grupo
  DROP CONSTRAINT IF EXISTS whatsapp_plantillas_grupo_grupo_id_fkey;

-- 3) Se conserva el UNIQUE compuesto por grupo (NULL no colisiona en Postgres).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'whatsapp_plantillas_grupo_uniq'
      AND conrelid = 'public.whatsapp_plantillas_grupo'::regclass
  ) THEN
    ALTER TABLE public.whatsapp_plantillas_grupo
      ADD CONSTRAINT whatsapp_plantillas_grupo_uniq UNIQUE (grupo_id, clave);
  END IF;
END $$;

-- 4) UNIQUE parcial: una sola plantilla global por clave.
CREATE UNIQUE INDEX IF NOT EXISTS uq_whatsapp_plantillas_global
  ON public.whatsapp_plantillas_grupo (clave)
  WHERE grupo_id IS NULL;

-- 5) RLS: seamiento explícito para service_role.
ALTER TABLE IF EXISTS public.whatsapp_plantillas_grupo ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF to_regclass('public.whatsapp_plantillas_grupo') IS NOT NULL THEN
    DROP POLICY IF EXISTS acceso_total_service_role ON public.whatsapp_plantillas_grupo;
    CREATE POLICY acceso_total_service_role ON public.whatsapp_plantillas_grupo
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;
