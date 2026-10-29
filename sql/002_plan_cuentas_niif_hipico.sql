-- ============================================================================
-- MIGRACIÓN 002: PLAN ÚNICO DE CUENTAS (PUC-NIIF HÍPICO) Y MOTOR DE PARTIDA DOBLE
-- Idempotente, transaccional y con chequeo estricto de partida doble.
-- ============================================================================

BEGIN;

-- 1. EXTENSIÓN UUID
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. TABLA: plan_cuentas_contables
CREATE TABLE IF NOT EXISTS public.plan_cuentas_contables (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    grupo_id UUID NULL REFERENCES public.grupos(id) ON DELETE CASCADE,
    codigo TEXT NOT NULL,
    nombre TEXT NOT NULL,
    clase TEXT NOT NULL CHECK (clase IN ('ACTIVO', 'PASIVO', 'PATRIMONIO', 'INGRESO', 'COSTO_CONTRA_INGRESO', 'GASTO', 'ORDEN')),
    naturaleza TEXT NOT NULL CHECK (naturaleza IN ('DEUDORA', 'ACREEDORA')),
    nivel INT NOT NULL DEFAULT 4,
    codigo_padre TEXT NULL,
    acepta_movimientos BOOLEAN NOT NULL DEFAULT true,
    modulo_origen TEXT NULL,
    activa BOOLEAN NOT NULL DEFAULT true,
    creado_el TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_el TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índice único compuesto (globales con UUID cero para unicidad en Postgres)
CREATE UNIQUE INDEX IF NOT EXISTS uq_plan_cuentas_grupo_codigo 
ON public.plan_cuentas_contables (COALESCE(grupo_id, '00000000-0000-0000-0000-000000000000'::uuid), codigo);

CREATE INDEX IF NOT EXISTS idx_plan_cuentas_clase ON public.plan_cuentas_contables (clase);
CREATE INDEX IF NOT EXISTS idx_plan_cuentas_padre ON public.plan_cuentas_contables (codigo_padre);

-- 3. TABLA: asientos_contables (Cabecera del libro diario)
CREATE TABLE IF NOT EXISTS public.asientos_contables (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    grupo_id UUID NULL REFERENCES public.grupos(id) ON DELETE SET NULL,
    numero_asiento BIGSERIAL,
    fecha_contable DATE NOT NULL DEFAULT CURRENT_DATE,
    tipo_evento TEXT NOT NULL,
    referencia_id TEXT NULL,
    clave_idempotencia TEXT NULL,
    descripcion TEXT NOT NULL,
    estado TEXT NOT NULL DEFAULT 'PUBLICADO' CHECK (estado IN ('PUBLICADO', 'REVERSADO')),
    total_debe NUMERIC(18,2) NOT NULL DEFAULT 0,
    total_haber NUMERIC(18,2) NOT NULL DEFAULT 0,
    creado_el TIMESTAMPTZ NOT NULL DEFAULT now(),
    creado_por TEXT NULL,
    CONSTRAINT chk_partida_doble CHECK (ROUND(total_debe, 2) = ROUND(total_haber, 2))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_asientos_clave_idempotencia 
ON public.asientos_contables (clave_idempotencia) 
WHERE clave_idempotencia IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_asientos_fecha ON public.asientos_contables (fecha_contable);
CREATE INDEX IF NOT EXISTS idx_asientos_grupo ON public.asientos_contables (grupo_id);
CREATE INDEX IF NOT EXISTS idx_asientos_evento ON public.asientos_contables (tipo_evento);
CREATE INDEX IF NOT EXISTS idx_asientos_referencia ON public.asientos_contables (referencia_id);

-- 4. TABLA: asientos_contables_lineas (Detalle analítico imputable)
CREATE TABLE IF NOT EXISTS public.asientos_contables_lineas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asiento_id UUID NOT NULL REFERENCES public.asientos_contables(id) ON DELETE CASCADE,
    cuenta_codigo TEXT NOT NULL,
    cliente_id UUID NULL,
    cliente_nombre TEXT NULL,
    debe NUMERIC(18,2) NOT NULL DEFAULT 0,
    haber NUMERIC(18,2) NOT NULL DEFAULT 0,
    concepto TEXT NULL,
    creado_el TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_debe_haber_positivo CHECK (debe >= 0 AND haber >= 0),
    CONSTRAINT chk_linea_con_monto CHECK (debe > 0 OR haber > 0)
);

CREATE INDEX IF NOT EXISTS idx_lineas_asiento ON public.asientos_contables_lineas (asiento_id);
CREATE INDEX IF NOT EXISTS idx_lineas_cuenta ON public.asientos_contables_lineas (cuenta_codigo);
CREATE INDEX IF NOT EXISTS idx_lineas_cliente ON public.asientos_contables_lineas (cliente_id);

-- 5. SEMILLA OFICIAL DEL PLAN DE CUENTAS NIIF HÍPICO (INSERT ... ON CONFLICT DO UPDATE)
INSERT INTO public.plan_cuentas_contables 
(grupo_id, codigo, nombre, clase, naturaleza, nivel, codigo_padre, acepta_movimientos, modulo_origen, activa)
VALUES
-- ========================================================================
-- 1. ACTIVOS
-- ========================================================================
(NULL, '1', 'ACTIVO', 'ACTIVO', 'DEUDORA', 1, NULL, false, 'TESORERIA', true),
(NULL, '1.1', 'ACTIVO CORRIENTE - EFECTIVO Y EQUIVALENTES', 'ACTIVO', 'DEUDORA', 2, '1', false, 'TESORERIA', true),
(NULL, '1.1.01', 'Caja y Efectivo Disponible', 'ACTIVO', 'DEUDORA', 3, '1.1', false, 'TESORERIA', true),
(NULL, '1.1.01.001', 'Caja General y Efectivo Divisas', 'ACTIVO', 'DEUDORA', 4, '1.1.01', true, 'TESORERIA', true),
(NULL, '1.1.02', 'Bancos y Entidades Financieras', 'ACTIVO', 'DEUDORA', 3, '1.1', false, 'TESORERIA', true),
(NULL, '1.1.02.001', 'Banco Pozo Principal Operativo', 'ACTIVO', 'DEUDORA', 4, '1.1.02', true, 'TESORERIA', true),
(NULL, '1.1.02.002', 'Bancos Nacionales (Pago Móvil / Transferencias)', 'ACTIVO', 'DEUDORA', 4, '1.1.02', true, 'TESORERIA', true),
(NULL, '1.1.02.003', 'Pasarelas Internacionales y Cripto (Zelle / USDT)', 'ACTIVO', 'DEUDORA', 4, '1.1.02', true, 'TESORERIA', true),

(NULL, '1.2', 'CUENTAS POR COBRAR OPERACIONALES', 'ACTIVO', 'DEUDORA', 2, '1', false, 'CLIENTES', true),
(NULL, '1.2.01', 'Cartera de Clientes Deudores', 'ACTIVO', 'DEUDORA', 3, '1.2', false, 'CLIENTES', true),
(NULL, '1.2.01.001', 'Cuentas por Cobrar Clientes — Saldos Deudores', 'ACTIVO', 'DEUDORA', 4, '1.2.01', true, 'CLIENTES', true),
(NULL, '1.2.02', 'Cartera de Avales y Respaldo Financiero', 'ACTIVO', 'DEUDORA', 3, '1.2', false, 'AVALES', true),
(NULL, '1.2.02.001', 'Cartera de Avales Otorgados por Cobrar', 'ACTIVO', 'DEUDORA', 4, '1.2.02', true, 'AVALES', true),
(NULL, '1.2.03', 'Cuentas por Cobrar Convenios', 'ACTIVO', 'DEUDORA', 3, '1.2', false, 'CONVENIOS', true),
(NULL, '1.2.03.001', 'Cuentas por Cobrar Grupos en Convenio', 'ACTIVO', 'DEUDORA', 4, '1.2.03', true, 'CONVENIOS', true),

-- ========================================================================
-- 2. PASIVOS
-- ========================================================================
(NULL, '2', 'PASIVO', 'PASIVO', 'ACREEDORA', 1, NULL, false, 'CLIENTES', true),
(NULL, '2.1', 'PASIVO CORRIENTE - CUSTODIA Y OBLIGACIONES', 'PASIVO', 'ACREEDORA', 2, '2', false, 'CLIENTES', true),
(NULL, '2.1.01', 'Fondos en Custodia de Clientes', 'PASIVO', 'ACREEDORA', 3, '2.1', false, 'CLIENTES', true),
(NULL, '2.1.01.001', 'Depósitos y Saldos Acreedores de Clientes (Custodia Jugadores)', 'PASIVO', 'ACREEDORA', 4, '2.1.01', true, 'CLIENTES', true),
(NULL, '2.1.01.002', 'Retiros de Clientes Pendientes por Pagar', 'PASIVO', 'ACREEDORA', 4, '2.1.01', true, 'TESORERIA', true),
(NULL, '2.1.02', 'Bolsa de Apuestas en Tránsito', 'PASIVO', 'ACREEDORA', 3, '2.1', false, 'APUESTAS_TERCIOS', true),
(NULL, '2.1.02.001', 'Bolsa en Tránsito — Jugadas en Vivo', 'PASIVO', 'ACREEDORA', 4, '2.1.02', true, 'APUESTAS_TERCIOS', true),
(NULL, '2.1.02.002', 'Bolsa en Tránsito — Jugadas Adelantadas', 'PASIVO', 'ACREEDORA', 4, '2.1.02', true, 'APUESTAS_TERCIOS', true),
(NULL, '2.1.03', 'Premios y Pozos Pendientes de Liquidar', 'PASIVO', 'ACREEDORA', 3, '2.1', false, 'TABLAS_FIJAS', true),
(NULL, '2.1.03.001', 'Premios y Pozos por Pagar (Pollas, Remates, Tablas, Dupletas)', 'PASIVO', 'ACREEDORA', 4, '2.1.03', true, 'TABLAS_FIJAS', true),
(NULL, '2.1.04', 'Incentivos y Devoluciones por Acreditar', 'PASIVO', 'ACREEDORA', 3, '2.1', false, 'INCENTIVOS', true),
(NULL, '2.1.04.001', 'Devoluciones e Incentivos por Acreditar a Clientes', 'PASIVO', 'ACREEDORA', 4, '2.1.04', true, 'INCENTIVOS', true),
(NULL, '2.1.05', 'Obligaciones por Convenios Inter-Grupos', 'PASIVO', 'ACREEDORA', 3, '2.1', false, 'CONVENIOS', true),
(NULL, '2.1.05.001', 'Comisiones por Pagar a Grupos en Convenio', 'PASIVO', 'ACREEDORA', 4, '2.1.05', true, 'CONVENIOS', true),

-- ========================================================================
-- 3. PATRIMONIO
-- ========================================================================
(NULL, '3', 'PATRIMONIO', 'PATRIMONIO', 'ACREEDORA', 1, NULL, false, 'CIERRE_SEMANAL', true),
(NULL, '3.1', 'CAPITAL Y RESERVAS OPERATIVAS', 'PATRIMONIO', 'ACREEDORA', 2, '3', false, 'CIERRE_SEMANAL', true),
(NULL, '3.1.01', 'Capital de la Casa', 'PATRIMONIO', 'ACREEDORA', 3, '3.1', false, 'CIERRE_SEMANAL', true),
(NULL, '3.1.01.001', 'Capital Operativo de la Casa / Grupo', 'PATRIMONIO', 'ACREEDORA', 4, '3.1.01', true, 'CIERRE_SEMANAL', true),
(NULL, '3.1.02', 'Fondo de Avales y Garantías', 'PATRIMONIO', 'ACREEDORA', 3, '3.1', false, 'AVALES', true),
(NULL, '3.1.02.001', 'Fondo de Respaldo Banco Aval', 'PATRIMONIO', 'ACREEDORA', 4, '3.1.02', true, 'AVALES', true),
(NULL, '3.1.03', 'Resultados de Ejercicios Anteriores', 'PATRIMONIO', 'ACREEDORA', 3, '3.1', false, 'CIERRE_SEMANAL', true),
(NULL, '3.1.03.001', 'Resultados Acumulados de Semanas Anteriores', 'PATRIMONIO', 'ACREEDORA', 4, '3.1.03', true, 'CIERRE_SEMANAL', true),
(NULL, '3.1.04', 'Resultados del Ejercicio Activo', 'PATRIMONIO', 'ACREEDORA', 3, '3.1', false, 'CIERRE_SEMANAL', true),
(NULL, '3.1.04.001', 'Resultado Neto de la Semana Activa', 'PATRIMONIO', 'ACREEDORA', 4, '3.1.04', true, 'CIERRE_SEMANAL', true),
(NULL, '3.1.05', 'Cuentas Puente de Cierre', 'PATRIMONIO', 'ACREEDORA', 3, '3.1', false, 'CIERRE_SEMANAL', true),
(NULL, '3.1.05.001', 'Cuenta Puente de Cierre Semanal (Modo RESET / ARRASTRE)', 'PATRIMONIO', 'ACREEDORA', 4, '3.1.05', true, 'CIERRE_SEMANAL', true),

-- ========================================================================
-- 4. INGRESOS OPERACIONALES
-- ========================================================================
(NULL, '4', 'INGRESOS', 'INGRESO', 'ACREEDORA', 1, NULL, false, 'APUESTAS_TERCIOS', true),
(NULL, '4.1', 'INGRESOS POR COMISIÓN DE INTERMEDIACIÓN', 'INGRESO', 'ACREEDORA', 2, '4', false, 'APUESTAS_TERCIOS', true),
(NULL, '4.1.01', 'Comisión Apuestas entre Tercios', 'INGRESO', 'ACREEDORA', 3, '4.1', false, 'APUESTAS_TERCIOS', true),
(NULL, '4.1.01.001', 'Ingresos por Comisión — Apuestas entre Tercios', 'INGRESO', 'ACREEDORA', 4, '4.1.01', true, 'APUESTAS_TERCIOS', true),
(NULL, '4.1.02', 'Comisión Remates Hípicos', 'INGRESO', 'ACREEDORA', 3, '4.1', false, 'REMATES', true),
(NULL, '4.1.02.001', 'Ingresos por Comisión — Remates Hípicos', 'INGRESO', 'ACREEDORA', 4, '4.1.02', true, 'REMATES', true),
(NULL, '4.1.03', 'Comisión Pollas Hípicas', 'INGRESO', 'ACREEDORA', 3, '4.1', false, 'POLLAS', true),
(NULL, '4.1.03.001', 'Ingresos por Comisión — Pollas Hípicas', 'INGRESO', 'ACREEDORA', 4, '4.1.03', true, 'POLLAS', true),
(NULL, '4.1.04', 'Comisión Dupletas', 'INGRESO', 'ACREEDORA', 3, '4.1', false, 'DUPLETAS', true),
(NULL, '4.1.04.001', 'Ingresos por Comisión — Dupletas', 'INGRESO', 'ACREEDORA', 4, '4.1.04', true, 'DUPLETAS', true),

(NULL, '4.2', 'INGRESOS POR VENTA DIRECTA DE PRODUCTOS', 'INGRESO', 'ACREEDORA', 2, '4', false, 'TABLAS_FIJAS', true),
(NULL, '4.2.01', 'Ventas Tablas Fijas', 'INGRESO', 'ACREEDORA', 3, '4.2', false, 'TABLAS_FIJAS', true),
(NULL, '4.2.01.001', 'Ingresos por Ventas — Tablas Fijas', 'INGRESO', 'ACREEDORA', 4, '4.2.01', true, 'TABLAS_FIJAS', true),
(NULL, '4.2.02', 'Ventas Marcas', 'INGRESO', 'ACREEDORA', 3, '4.2', false, 'MARCAS', true),
(NULL, '4.2.02.001', 'Ingresos por Ventas — Marcas', 'INGRESO', 'ACREEDORA', 4, '4.2.02', true, 'MARCAS', true),
(NULL, '4.2.03', 'Ventas Taquilla WPS', 'INGRESO', 'ACREEDORA', 3, '4.2', false, 'TAQUILLA_WPS', true),
(NULL, '4.2.03.001', 'Ingresos por Ventas — Taquilla WPS', 'INGRESO', 'ACREEDORA', 4, '4.2.03', true, 'TAQUILLA_WPS', true),

(NULL, '4.3', 'INGRESOS POR CONVENIOS', 'INGRESO', 'ACREEDORA', 2, '4', false, 'CONVENIOS', true),
(NULL, '4.3.01', 'Comisión Convenios Inter-Grupos', 'INGRESO', 'ACREEDORA', 3, '4.3', false, 'CONVENIOS', true),
(NULL, '4.3.01.001', 'Ingresos por Convenios Inter-Grupos', 'INGRESO', 'ACREEDORA', 4, '4.3.01', true, 'CONVENIOS', true),

-- ========================================================================
-- 5. REBAJAS SOBRE INGRESOS, CRUCES, INCENTIVOS Y COSTOS DE PREMIOS
-- ========================================================================
(NULL, '5', 'COSTOS, CRUCES E INCENTIVOS', 'COSTO_CONTRA_INGRESO', 'DEUDORA', 1, NULL, false, 'CRUCES', true),
(NULL, '5.1', 'REBAJAS SOBRE COMISIONES, CRUCES E INCENTIVOS', 'COSTO_CONTRA_INGRESO', 'DEUDORA', 2, '5', false, 'CRUCES', true),
(NULL, '5.1.01', 'Cruces de Apuestas', 'COSTO_CONTRA_INGRESO', 'DEUDORA', 3, '5.1', false, 'CRUCES', true),
(NULL, '5.1.01.001', 'Reembolso de Comisión por Cruces (🔀 CRUCE Modalidad CON CRUCES)', 'COSTO_CONTRA_INGRESO', 'DEUDORA', 4, '5.1.01', true, 'CRUCES', true),
(NULL, '5.1.02', 'Incentivos a Clientes', 'COSTO_CONTRA_INGRESO', 'DEUDORA', 3, '5.1', false, 'INCENTIVOS', true),
(NULL, '5.1.02.001', 'Devolución de Incentivos a Clientes (A favor del cliente)', 'COSTO_CONTRA_INGRESO', 'DEUDORA', 4, '5.1.02', true, 'INCENTIVOS', true),
(NULL, '5.1.03', 'Incentivos a Avaladores', 'COSTO_CONTRA_INGRESO', 'DEUDORA', 3, '5.1', false, 'AVALES', true),
(NULL, '5.1.03.001', 'Devolución de Comisión a Avaladores / Corredores', 'COSTO_CONTRA_INGRESO', 'DEUDORA', 4, '5.1.03', true, 'AVALES', true),

(NULL, '5.2', 'COSTO DE PREMIOS PAGADOS POR LA CASA', 'COSTO_CONTRA_INGRESO', 'DEUDORA', 2, '5', false, 'TABLAS_FIJAS', true),
(NULL, '5.2.01', 'Premios Tablas Fijas', 'COSTO_CONTRA_INGRESO', 'DEUDORA', 3, '5.2', false, 'TABLAS_FIJAS', true),
(NULL, '5.2.01.001', 'Costo de Premios Pagados — Tablas Fijas', 'COSTO_CONTRA_INGRESO', 'DEUDORA', 4, '5.2.01', true, 'TABLAS_FIJAS', true),
(NULL, '5.2.02', 'Premios Marcas y Dupletas', 'COSTO_CONTRA_INGRESO', 'DEUDORA', 3, '5.2', false, 'MARCAS', true),
(NULL, '5.2.02.001', 'Costo de Premios Pagados — Marcas y Dupletas', 'COSTO_CONTRA_INGRESO', 'DEUDORA', 4, '5.2.02', true, 'MARCAS', true),
(NULL, '5.2.03', 'Premios Taquilla WPS', 'COSTO_CONTRA_INGRESO', 'DEUDORA', 3, '5.2', false, 'TAQUILLA_WPS', true),
(NULL, '5.2.03.001', 'Costo de Premios Pagados — Taquilla WPS', 'COSTO_CONTRA_INGRESO', 'DEUDORA', 4, '5.2.03', true, 'TAQUILLA_WPS', true),

-- ========================================================================
-- 6. GASTOS OPERATIVOS
-- ========================================================================
(NULL, '6', 'GASTOS OPERATIVOS', 'GASTO', 'DEUDORA', 1, NULL, false, 'TESORERIA', true),
(NULL, '6.1', 'GASTOS DE OPERACIÓN Y ADMINISTRACIÓN', 'GASTO', 'DEUDORA', 2, '6', false, 'TESORERIA', true),
(NULL, '6.1.01', 'Gastos Financieros', 'GASTO', 'DEUDORA', 3, '6.1', false, 'TESORERIA', true),
(NULL, '6.1.01.001', 'Gastos de Comisiones Bancarias', 'GASTO', 'DEUDORA', 4, '6.1.01', true, 'TESORERIA', true),
(NULL, '6.1.02', 'Diferencial Cambiario', 'GASTO', 'DEUDORA', 3, '6.1', false, 'TESORERIA', true),
(NULL, '6.1.02.001', 'Diferencial Cambiario', 'GASTO', 'DEUDORA', 4, '6.1.02', true, 'TESORERIA', true),
(NULL, '6.1.03', 'Administración y Operadores', 'GASTO', 'DEUDORA', 3, '6.1', false, 'TESORERIA', true),
(NULL, '6.1.03.001', 'Gastos de Operadores y Administración', 'GASTO', 'DEUDORA', 4, '6.1.03', true, 'TESORERIA', true),

-- ========================================================================
-- 7. CUENTAS DE ORDEN (RIESGO EN CURSO)
-- ========================================================================
(NULL, '7', 'CUENTAS DE ORDEN', 'ORDEN', 'DEUDORA', 1, NULL, false, 'APUESTAS_TERCIOS', true),
(NULL, '7.1', 'CUENTAS DE ORDEN POR CONTINGENCIAS Y RIESGOS', 'ORDEN', 'DEUDORA', 2, '7', false, 'APUESTAS_TERCIOS', true),
(NULL, '7.1.01', 'Control de Exposición Financiera', 'ORDEN', 'DEUDORA', 3, '7.1', false, 'APUESTAS_TERCIOS', true),
(NULL, '7.1.01.001', 'Riesgo Comprometido en Curso (Peor Caso Simulado)', 'ORDEN', 'DEUDORA', 4, '7.1.01', true, 'APUESTAS_TERCIOS', true),
(NULL, '7.1.01.002', 'Contra-cuenta de Riesgo Comprometido en Curso', 'ORDEN', 'ACREEDORA', 4, '7.1.01', true, 'APUESTAS_TERCIOS', true)

ON CONFLICT (COALESCE(grupo_id, '00000000-0000-0000-0000-000000000000'::uuid), codigo)
DO UPDATE SET
    nombre = EXCLUDED.nombre,
    clase = EXCLUDED.clase,
    naturaleza = EXCLUDED.naturaleza,
    nivel = EXCLUDED.nivel,
    codigo_padre = EXCLUDED.codigo_padre,
    acepta_movimientos = EXCLUDED.acepta_movimientos,
    modulo_origen = EXCLUDED.modulo_origen,
    activa = EXCLUDED.activa,
    actualizado_el = now();

-- 6. FUNCIÓN RPC TRANSACCIONAL PARA REGISTRO ATÓMICO DE ASIENTO
CREATE OR REPLACE FUNCTION public.rpc_registrar_asiento_contable_v2(
    p_grupo_id UUID,
    p_fecha DATE,
    p_tipo_evento TEXT,
    p_referencia_id TEXT,
    p_clave_idempotencia TEXT,
    p_descripcion TEXT,
    p_creado_por TEXT,
    p_lineas JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_asiento_id UUID;
    v_total_debe NUMERIC(18,2) := 0;
    v_total_haber NUMERIC(18,2) := 0;
    v_linea JSONB;
    v_debe NUMERIC(18,2);
    v_haber NUMERIC(18,2);
    v_cuenta_codigo TEXT;
    v_cliente_id UUID;
    v_cliente_nombre TEXT;
    v_concepto TEXT;
    v_asiento_existente RECORD;
BEGIN
    -- Idempotencia estricta
    IF p_clave_idempotencia IS NOT NULL AND p_clave_idempotencia <> '' THEN
        SELECT id, numero_asiento, total_debe, total_haber INTO v_asiento_existente
        FROM public.asientos_contables
        WHERE clave_idempotencia = p_clave_idempotencia;

        IF FOUND THEN
            RETURN jsonb_build_object(
                'ok', true,
                'ya_existia', true,
                'asiento_id', v_asiento_existente.id,
                'numero_asiento', v_asiento_existente.numero_asiento,
                'total_debe', v_asiento_existente.total_debe,
                'total_haber', v_asiento_existente.total_haber
            );
        END IF;
    END IF;

    -- Calcular y verificar balance de líneas
    FOR v_linea IN SELECT * FROM jsonb_array_elements(p_lineas)
    LOOP
        v_debe := ROUND(COALESCE((v_linea->>'debe')::numeric, 0), 2);
        v_haber := ROUND(COALESCE((v_linea->>'haber')::numeric, 0), 2);
        v_total_debe := v_total_debe + v_debe;
        v_total_haber := v_total_haber + v_haber;
    END LOOP;

    IF v_total_debe <> v_total_haber THEN
        RAISE EXCEPTION 'Partida doble descuadrada: Total Debe (%) <> Total Haber (%)', v_total_debe, v_total_haber;
    END IF;

    IF v_total_debe <= 0 THEN
        RAISE EXCEPTION 'El asiento debe tener montos positivos mayores a cero.';
    END IF;

    -- Insertar Cabecera
    INSERT INTO public.asientos_contables (
        grupo_id,
        fecha_contable,
        tipo_evento,
        referencia_id,
        clave_idempotencia,
        descripcion,
        estado,
        total_debe,
        total_haber,
        creado_por
    ) VALUES (
        p_grupo_id,
        COALESCE(p_fecha, CURRENT_DATE),
        p_tipo_evento,
        p_referencia_id,
        NULLIF(p_clave_idempotencia, ''),
        p_descripcion,
        'PUBLICADO',
        v_total_debe,
        v_total_haber,
        p_creado_por
    ) RETURNING id INTO v_asiento_id;

    -- Insertar Líneas
    FOR v_linea IN SELECT * FROM jsonb_array_elements(p_lineas)
    LOOP
        v_cuenta_codigo := TRIM(v_linea->>'cuenta_codigo');
        v_debe := ROUND(COALESCE((v_linea->>'debe')::numeric, 0), 2);
        v_haber := ROUND(COALESCE((v_linea->>'haber')::numeric, 0), 2);
        v_cliente_id := NULLIF(v_linea->>'cliente_id', '')::uuid;
        v_cliente_nombre := NULLIF(v_linea->>'cliente_nombre', '');
        v_concepto := NULLIF(v_linea->>'concepto', '');

        IF v_debe > 0 OR v_haber > 0 THEN
            INSERT INTO public.asientos_contables_lineas (
                asiento_id,
                cuenta_codigo,
                cliente_id,
                cliente_nombre,
                debe,
                haber,
                concepto
            ) VALUES (
                v_asiento_id,
                v_cuenta_codigo,
                v_cliente_id,
                v_cliente_nombre,
                v_debe,
                v_haber,
                v_concepto
            );
        END IF;
    END LOOP;

    RETURN jsonb_build_object(
        'ok', true,
        'ya_existia', false,
        'asiento_id', v_asiento_id,
        'total_debe', v_total_debe,
        'total_haber', v_total_haber
    );
END;
$$;

COMMIT;
