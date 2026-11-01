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

-- Idempotencia: si la tabla ya existía con otro esquema, agregar columnas faltantes.
ALTER TABLE public.whatsapp_control_carrera_grupo
  ADD COLUMN IF NOT EXISTS fecha date,
  ADD COLUMN IF NOT EXISTS hipodromo text,
  ADD COLUMN IF NOT EXISTS carrera integer,
  ADD COLUMN IF NOT EXISTS estado_carrera text DEFAULT 'ABIERTA',
  ADD COLUMN IF NOT EXISTS grupo_id text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Rellenar nulos para no romper índices NOT NULL / UNIQUE.
UPDATE public.whatsapp_control_carrera_grupo
  SET fecha = COALESCE(fecha, CURRENT_DATE),
      hipodromo = COALESCE(hipodromo, 'GENERAL'),
      carrera = COALESCE(carrera, 1),
      estado_carrera = COALESCE(estado_carrera, 'ABIERTA'),
      created_at = COALESCE(created_at, now()),
      updated_at = COALESCE(updated_at, now())
  WHERE fecha IS NULL OR hipodromo IS NULL OR carrera IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_control_carrera_grupo_fecha_hip_carrera_uidx
  ON public.whatsapp_control_carrera_grupo (fecha, hipodromo, carrera);

CREATE TABLE IF NOT EXISTS public.whatsapp_solicitudes_abono (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo_corto text NOT NULL UNIQUE,
  cliente_id uuid,
  cliente_nombre text,
  monto numeric(12,2) NOT NULL DEFAULT 0,
  metodo_pago text,
  referencia text,
  comprobante_url text,
  estado text NOT NULL DEFAULT 'PENDIENTE',
  grupo_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.whatsapp_solicitudes_abono
  ADD COLUMN IF NOT EXISTS codigo_corto text,
  ADD COLUMN IF NOT EXISTS cliente_id uuid,
  ADD COLUMN IF NOT EXISTS cliente_nombre text,
  ADD COLUMN IF NOT EXISTS monto numeric(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS metodo_pago text,
  ADD COLUMN IF NOT EXISTS referencia text,
  ADD COLUMN IF NOT EXISTS comprobante_url text,
  ADD COLUMN IF NOT EXISTS estado text DEFAULT 'PENDIENTE',
  ADD COLUMN IF NOT EXISTS grupo_id text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

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