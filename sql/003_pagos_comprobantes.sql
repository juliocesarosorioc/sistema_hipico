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
    aplicado_en_saldo BOOLEAN NOT NULL DEFAULT false,
    motivo_rechazo TEXT NULL,
    nota_admin TEXT NULL,
    notas TEXT NULL,
    registrado_por TEXT NULL,
    atendido_por TEXT NULL,
    atendido_at TIMESTAMPTZ NULL,
    aprobado_por TEXT NULL,
    aprobado_at TIMESTAMPTZ NULL,
    asiento_contable_id UUID NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Compatibilidad idempotente para tablas creadas previamente
ALTER TABLE public.pagos_comprobantes ADD COLUMN IF NOT EXISTS aplicado_en_saldo BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.pagos_comprobantes ADD COLUMN IF NOT EXISTS nota_admin TEXT NULL;
ALTER TABLE public.pagos_comprobantes ADD COLUMN IF NOT EXISTS aprobado_por TEXT NULL;
ALTER TABLE public.pagos_comprobantes ADD COLUMN IF NOT EXISTS aprobado_at TIMESTAMPTZ NULL;

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

-- ============================================================================
-- PROCEDIMIENTO ALMACENADO (RPC): procesar_pago_comprobante
-- Conciliación atómica de pagos y actualización en tiempo real de saldos
-- ============================================================================

CREATE OR REPLACE FUNCTION public.procesar_pago_comprobante(
    p_pago_id UUID,
    p_accion TEXT, -- 'APROBAR', 'RECHAZAR', 'ANULAR'
    p_operador TEXT DEFAULT 'Administrador',
    p_nota_admin TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_pago public.pagos_comprobantes%ROWTYPE;
    v_delta NUMERIC(18,2);
    v_nuevo_saldo NUMERIC(18,2);
BEGIN
    SELECT * INTO v_pago
    FROM public.pagos_comprobantes
    WHERE id = p_pago_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No se encontró el registro de pago especificado.';
    END IF;

    -- 1. RECHAZAR PAGO
    IF p_accion = 'RECHAZAR' THEN
        IF v_pago.aplicado_en_saldo THEN
            RAISE EXCEPTION 'El pago ya fue aplicado al saldo; utilice ANULAR para revertirlo.';
        END IF;

        UPDATE public.pagos_comprobantes
        SET estado = 'RECHAZADO',
            nota_admin = COALESCE(p_nota_admin, nota_admin),
            motivo_rechazo = COALESCE(p_nota_admin, motivo_rechazo),
            aprobado_por = p_operador,
            atendido_por = p_operador,
            atendido_at = now(),
            updated_at = now()
        WHERE id = p_pago_id;

        RETURN jsonb_build_object('ok', true, 'estado', 'RECHAZADO');
    END IF;

    -- 2. APROBAR PAGO
    IF p_accion = 'APROBAR' THEN
        IF v_pago.aplicado_en_saldo THEN
            -- Idempotencia: ya estaba aplicado
            SELECT COALESCE(saldo_actual, saldo, 0) INTO v_nuevo_saldo
            FROM public.clientes
            WHERE id = v_pago.cliente_id;

            RETURN jsonb_build_object(
                'ok', true,
                'estado', 'APROBADO',
                'saldo_actual', COALESCE(v_nuevo_saldo, 0),
                'idempotente', true
            );
        END IF;

        -- Si el cliente paga a la casa -> suma a su saldo (+).
        -- Si la casa le paga sus ganancias al cliente ganador -> rebaja su saldo acreedor a favor (-).
        IF v_pago.direccion_flujo = 'PAGO_DE_CLIENTE' THEN
            v_delta := ROUND(v_pago.monto_equivalente_base, 2);
        ELSE
            v_delta := -ROUND(v_pago.monto_equivalente_base, 2);
        END IF;

        UPDATE public.clientes
        SET saldo = ROUND(COALESCE(saldo, 0) + v_delta, 2),
            saldo_actual = ROUND(COALESCE(saldo_actual, saldo, 0) + v_delta, 2)
        WHERE id = v_pago.cliente_id
        RETURNING COALESCE(saldo_actual, saldo) INTO v_nuevo_saldo;

        UPDATE public.pagos_comprobantes
        SET estado = 'APROBADO',
            aplicado_en_saldo = true,
            aprobado_at = now(),
            atendido_at = now(),
            aprobado_por = p_operador,
            atendido_por = p_operador,
            nota_admin = COALESCE(p_nota_admin, nota_admin),
            updated_at = now()
        WHERE id = p_pago_id;

        RETURN jsonb_build_object(
            'ok', true,
            'estado', 'APROBADO',
            'delta_aplicado', v_delta,
            'saldo_actual', COALESCE(v_nuevo_saldo, 0)
        );
    END IF;

    -- 3. ANULAR PAGO PREVIAMENTE APROBADO
    IF p_accion = 'ANULAR' THEN
        IF v_pago.aplicado_en_saldo THEN
            IF v_pago.direccion_flujo = 'PAGO_DE_CLIENTE' THEN
                v_delta := -ROUND(v_pago.monto_equivalente_base, 2);
            ELSE
                v_delta := ROUND(v_pago.monto_equivalente_base, 2);
            END IF;

            UPDATE public.clientes
            SET saldo = ROUND(COALESCE(saldo, 0) + v_delta, 2),
                saldo_actual = ROUND(COALESCE(saldo_actual, saldo, 0) + v_delta, 2)
            WHERE id = v_pago.cliente_id
            RETURNING COALESCE(saldo_actual, saldo) INTO v_nuevo_saldo;
        ELSE
            SELECT COALESCE(saldo_actual, saldo, 0) INTO v_nuevo_saldo
            FROM public.clientes
            WHERE id = v_pago.cliente_id;
        END IF;

        UPDATE public.pagos_comprobantes
        SET estado = 'ANULADO',
            aplicado_en_saldo = false,
            nota_admin = COALESCE(p_nota_admin, nota_admin),
            motivo_rechazo = COALESCE(p_nota_admin, motivo_rechazo),
            updated_at = now()
        WHERE id = p_pago_id;

        RETURN jsonb_build_object(
            'ok', true,
            'estado', 'ANULADO',
            'saldo_actual', COALESCE(v_nuevo_saldo, 0)
        );
    END IF;

    RAISE EXCEPTION 'Acción inválida: %', p_accion;
END;
$$;

GRANT EXECUTE ON FUNCTION public.procesar_pago_comprobante(UUID, TEXT, TEXT, TEXT) TO anon, authenticated;
