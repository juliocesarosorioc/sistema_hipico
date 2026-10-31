-- Migración idempotente: control de carrera en grupo WhatsApp y solicitudes de abono
CREATE TABLE IF NOT EXISTS public.whatsapp_control_carrera_grupo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha date NOT NULL,
  hipodromo text NOT NULL,
  carrera integer NOT NULL,
  estado_carrera text NOT NULL DEFAULT 'ABIERTA',
  grupo_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_control_carrera_grupo_fecha_hip_carrera_uidx
  ON public.whatsapp_control_carrera_grupo (fecha, hipodromo, carrera);

CREATE TABLE IF NOT EXISTS public.whatsapp_solicitudes_abono (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo_corto text NOT NULL UNIQUE,
  cliente_id uuid,
  cliente_nombre text,
  monto numeric(12,2) NOT NULL,
  metodo_pago text,
  referencia text,
  comprobante_url text,
  estado text NOT NULL DEFAULT 'PENDIENTE',
  grupo_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS whatsapp_solicitudes_abono_estado_idx
  ON public.whatsapp_solicitudes_abono (estado);

-- RLS básica (ajustar según roles)
ALTER TABLE public.whatsapp_control_carrera_grupo ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_solicitudes_abono ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "whatsapp_control_read" ON public.whatsapp_control_carrera_grupo
    FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "whatsapp_solicitudes_read" ON public.whatsapp_solicitudes_abono
    FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;