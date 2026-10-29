-- ============================================================================
-- 003_pagos_comprobantes.sql
-- MIGRACIÓN: Sistema de Registro de Pagos con Comprobante y Conciliación
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.pagos_comprobantes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    grupo_id UUID NULL REFERENCES public.grupos(id) ON DELETE SET NULL,
    cliente_id UUID NULL REFERENCES public.clientes(id) ON DELETE SET NULL,
    cliente_nombre TEXT NOT NULL,
    direccion_flujo TEXT NOT NULL CHECK (direccion_flujo IN ('PAGO_DE_CLIENTE', 'PAGO_A_GANADOR')),
    metodo_pago TEXT NOT NULL, -- PAGO_MOVIL | TRANSFERENCIA | ZELLE | BINANCE | EFECTIVO | OTRO
    banco_origen TEXT NULL,
    banco_destino TEXT NULL,
    referencia_bancaria TEXT NOT NULL,
    monto_moneda_origen NUMERIC NOT NULL,
    moneda_origen TEXT NOT NULL DEFAULT 'VES',
    tasa_cambio NUMERIC NOT NULL DEFAULT 1,
    monto_equivalente_base NUMERIC NOT NULL,
    comprobante_url TEXT NOT NULL,
    comprobante_nombre TEXT NULL,
    comprobante_tipo TEXT NULL,
    comprobante_peso INT NULL,
    estado TEXT NOT NULL DEFAULT 'PENDIENTE' CHECK (estado IN ('PENDIENTE', 'APROBADO', 'RECHAZADO', 'ANULADO')),
    motivo_rechazo TEXT NULL,
    notas TEXT NULL,
    registrado_por TEXT NULL,
    atendido_por TEXT NULL,
    atendido_at TIMESTAMPTZ NULL,
    asiento_contable_id UUID NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índices de consulta rápida
CREATE INDEX IF NOT EXISTS idx_pagos_comprobantes_cliente ON public.pagos_comprobantes(cliente_id, direccion_flujo);
CREATE INDEX IF NOT EXISTS idx_pagos_comprobantes_estado ON public.pagos_comprobantes(estado, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pagos_comprobantes_grupo ON public.pagos_comprobantes(grupo_id);
CREATE INDEX IF NOT EXISTS idx_pagos_comprobantes_ref ON public.pagos_comprobantes(COALESCE(grupo_id, '00000000-0000-0000-0000-000000000000'::uuid), metodo_pago, referencia_bancaria);

-- RLS y permisos
ALTER TABLE public.pagos_comprobantes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pagos_comprobantes_select" ON public.pagos_comprobantes;
DROP POLICY IF EXISTS "pagos_comprobantes_insert" ON public.pagos_comprobantes;
DROP POLICY IF EXISTS "pagos_comprobantes_update" ON public.pagos_comprobantes;
DROP POLICY IF EXISTS "pagos_comprobantes_delete" ON public.pagos_comprobantes;

CREATE POLICY "pagos_comprobantes_select" ON public.pagos_comprobantes FOR SELECT USING (true);
CREATE POLICY "pagos_comprobantes_insert" ON public.pagos_comprobantes FOR INSERT WITH CHECK (true);
CREATE POLICY "pagos_comprobantes_update" ON public.pagos_comprobantes FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "pagos_comprobantes_delete" ON public.pagos_comprobantes FOR DELETE USING (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pagos_comprobantes TO anon, authenticated;

-- Registro del Bucket en Storage de Supabase para Comprobantes
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'comprobantes-pagos',
    'comprobantes-pagos',
    true,
    10485760, -- 10 MB límite
    ARRAY['image/png', 'image/jpeg', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE
SET public = true,
    file_size_limit = 10485760,
    allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];
