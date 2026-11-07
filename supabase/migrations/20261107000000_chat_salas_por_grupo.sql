-- ============================================================================
-- TABLA: chat_salas (Salas de chat independientes por cada Grupo de Venta)
-- "Cada grupo tiene sus propias salas"
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.chat_salas (
  id text PRIMARY KEY,
  grupo_id text NOT NULL,
  nombre text NOT NULL,
  descripcion text,
  es_principal boolean DEFAULT false,
  activo boolean DEFAULT true,
  orden integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_salas_grupo_idx
  ON public.chat_salas (grupo_id, orden, created_at);

ALTER TABLE public.chat_salas ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "chat_salas_public_read" ON public.chat_salas FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "chat_salas_public_insert" ON public.chat_salas FOR INSERT WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "chat_salas_public_update" ON public.chat_salas FOR UPDATE USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "chat_salas_public_delete" ON public.chat_salas FOR DELETE USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
