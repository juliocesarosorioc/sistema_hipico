-- ============================================================================
-- MIGRACIÓN: CONTABILIDAD AUTOMATIZADA, AISLAMIENTO POR GRUPOS,
-- TRATAMIENTO DE AVALADOS, INTER-GRUPOS ARGENTINA Y HONORARIOS DE EQUIPO
-- ============================================================================

BEGIN;

-- 1. TABLA: equipo_trabajo_honorarios
-- Permite registrar a los miembros del equipo de trabajo con sus datos
-- de contacto, rol y método de pago para imputación de honorarios.
CREATE TABLE IF NOT EXISTS public.equipo_trabajo_honorarios (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    grupo_id UUID NULL,
    usuario_id UUID NULL,
    nombre_completo TEXT NOT NULL,
    cedula_rif TEXT NULL,
    cargo_rol TEXT NOT NULL,
    telefono TEXT NULL,
    metodo_pago TEXT NULL,
    datos_pago TEXT NULL,
    monto_pactado NUMERIC(18,2) NOT NULL DEFAULT 0,
    frecuencia_pago TEXT NOT NULL DEFAULT 'SEMANAL' CHECK (frecuencia_pago IN ('DIARIO', 'SEMANAL', 'QUINCENAL', 'MENSUAL', 'POR_CARRERA')),
    activo BOOLEAN NOT NULL DEFAULT true,
    notas TEXT NULL,
    creado_el TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_el TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_equipo_honorarios_grupo ON public.equipo_trabajo_honorarios (grupo_id);
CREATE INDEX IF NOT EXISTS idx_equipo_honorarios_activo ON public.equipo_trabajo_honorarios (activo);

-- 2. TABLA: registros_honorarios_pagos
-- Registro histórico de causación y liquidación de honorarios al equipo
CREATE TABLE IF NOT EXISTS public.registros_honorarios_pagos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    grupo_id UUID NULL,
    miembro_id UUID NOT NULL REFERENCES public.equipo_trabajo_honorarios(id) ON DELETE RESTRICT,
    miembro_nombre TEXT NOT NULL,
    fecha_registro DATE NOT NULL DEFAULT CURRENT_DATE,
    periodo_desde DATE NULL,
    periodo_hasta DATE NULL,
    concepto TEXT NOT NULL,
    monto NUMERIC(18,2) NOT NULL,
    estado TEXT NOT NULL DEFAULT 'PAGADO' CHECK (estado IN ('POR_PAGAR', 'PAGADO', 'ANULADO')),
    medio_pago TEXT NULL,
    banco_referencia TEXT NULL,
    asiento_id UUID NULL REFERENCES public.asientos_contables(id) ON DELETE SET NULL,
    registrado_por TEXT NULL,
    creado_el TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reg_honorarios_grupo ON public.registros_honorarios_pagos (grupo_id);
CREATE INDEX IF NOT EXISTS idx_reg_honorarios_miembro ON public.registros_honorarios_pagos (miembro_id);
CREATE INDEX IF NOT EXISTS idx_reg_honorarios_estado ON public.registros_honorarios_pagos (estado);

-- 3. CUENTAS ESPECIALIZADAS EN EL PLAN CONTABLE
-- Aseguramos la existencia de las subcuentas analíticas requeridas:
INSERT INTO public.plan_cuentas_contables (codigo, nombre, clase, naturaleza, nivel, codigo_padre, acepta_movimientos, modulo_origen, activa)
VALUES
    -- Cuentas por Pagar Premios Clientes Avalados
    ('2.1.01.003', 'Cuentas por Pagar — Premios Clientes Avalados', 'PASIVO', 'ACREEDORA', 4, '2.1.01', true, 'CLIENTES', true),
    -- Obligaciones por Honorarios de Equipo
    ('2.1.06', 'Obligaciones Laborales y Honorarios por Pagar', 'PASIVO', 'ACREEDORA', 3, '2.1', false, 'TESORERIA', true),
    ('2.1.06.001', 'Cuentas por Pagar Honorarios Equipo de Trabajo', 'PASIVO', 'ACREEDORA', 4, '2.1.06', true, 'TESORERIA', true),
    -- Desglose de ingresos por comisión por modalidad
    ('4.1.01.002', 'Ingresos por Comisión — Tablas Fijas', 'INGRESO', 'ACREEDORA', 4, '4.1.01', true, 'TABLAS_FIJAS', true),
    ('4.1.01.003', 'Ingresos por Comisión — Marcas', 'INGRESO', 'ACREEDORA', 4, '4.1.01', true, 'MARCAS', true),
    ('4.1.01.004', 'Ingresos por Comisión — Dupletas', 'INGRESO', 'ACREEDORA', 4, '4.1.01', true, 'DUPLETAS', true),
    ('4.1.01.005', 'Ingresos por Comisión — Pollas y Remates', 'INGRESO', 'ACREEDORA', 4, '4.1.01', true, 'POLLAS', true),
    ('4.1.01.006', 'Ingresos por Comisión — Taquilla WPS', 'INGRESO', 'ACREEDORA', 4, '4.1.01', true, 'TAQUILLA_WPS', true),
    ('4.1.01.007', 'Ingresos por Comisión — Eventos Especiales y Libres', 'INGRESO', 'ACREEDORA', 4, '4.1.01', true, 'APUESTAS_TERCIOS', true),
    -- Ingresos por Venta Neta Inter-Grupos (Argentina)
    ('4.1.02', 'Ingresos por Venta y Respaldo Inter-Grupos', 'INGRESO', 'ACREEDORA', 3, '4.1', false, 'CONVENIOS', true),
    ('4.1.02.001', 'Ingresos Venta Neta Inter-Grupos (Argentina)', 'INGRESO', 'ACREEDORA', 4, '4.1.02', true, 'CONVENIOS', true),
    -- Gastos de Honorarios Equipo
    ('6.1.03.001', 'Gastos de Honorarios y Operadores de Equipo', 'GASTO', 'DEUDORA', 4, '6.1.03', true, 'TESORERIA', true)
ON CONFLICT DO NOTHING;

-- 4. POLÍTICAS RLS BÁSICAS
ALTER TABLE public.equipo_trabajo_honorarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registros_honorarios_pagos ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN
    DROP POLICY IF EXISTS p_equipo_honorarios_all ON public.equipo_trabajo_honorarios;
    CREATE POLICY p_equipo_honorarios_all ON public.equipo_trabajo_honorarios FOR ALL USING (true) WITH CHECK (true);

    DROP POLICY IF EXISTS p_reg_honorarios_all ON public.registros_honorarios_pagos;
    CREATE POLICY p_reg_honorarios_all ON public.registros_honorarios_pagos FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

COMMIT;
