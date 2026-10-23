-- Archivo: sql/contabilidad_niif_partida_doble.sql
BEGIN;

-- 1. Plan Único de Cuentas (PUC) adaptado a Operaciones Hípicas bajo estructura NIIF
CREATE TABLE IF NOT EXISTS public.contabilidad_plan_cuentas (
  codigo TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  tipo_elemento TEXT NOT NULL CHECK (tipo_elemento IN ('ACTIVO', 'PASIVO', 'PATRIMONIO', 'INGRESO', 'GASTO')),
  naturaleza TEXT NOT NULL CHECK (naturaleza IN ('DEUDORA', 'ACREEDORA')),
  acepta_movimientos BOOLEAN DEFAULT true,
  activa BOOLEAN DEFAULT true
);

INSERT INTO public.contabilidad_plan_cuentas (codigo, nombre, tipo_elemento, naturaleza) VALUES
  ('1101', 'Caja General Unificada', 'ACTIVO', 'DEUDORA'),
  ('1102', 'Bancos Nacionales e Internacionales', 'ACTIVO', 'DEUDORA'),
  ('1201', 'Cuentas por Cobrar - Clientes y Apostadores (Avales)', 'ACTIVO', 'DEUDORA'),
  ('1202', 'Cuentas por Cobrar - Grupos y Convenios Aliados', 'ACTIVO', 'DEUDORA'),
  ('2101', 'Depósitos y Saldos a Favor de Clientes (Pasivo)', 'PASIVO', 'ACREEDORA'),
  ('2102', 'Premios y Dividendos por Pagar', 'PASIVO', 'ACREEDORA'),
  ('2103', 'Comisiones por Pagar a Grupos / Banqueros', 'PASIVO', 'ACREEDORA'),
  ('3101', 'Capital y Fondo Operativo de la Banca', 'PATRIMONIO', 'ACREEDORA'),
  ('4101', 'Ingresos Brutos por Venta de Taquilla / WPS', 'INGRESO', 'ACREEDORA'),
  ('4102', 'Ingresos Brutos por Venta de Tablas Fijas', 'INGRESO', 'ACREEDORA'),
  ('4103', 'Ingresos por Comisiones de Remates, Pollas y Dupletas', 'INGRESO', 'ACREEDORA'),
  ('4201', 'Ganancia por Diferencial Cambiario (NIC 21)', 'INGRESO', 'ACREEDORA'),
  ('5101', 'Costo de Liquidación de Premios de Taquilla y Tablas', 'GASTO', 'DEUDORA'),
  ('5102', 'Gasto de Comisiones Cedidas a Convenios y Operadores', 'GASTO', 'DEUDORA'),
  ('5201', 'Pérdida por Diferencial Cambiario (NIC 21)', 'GASTO', 'DEUDORA')
ON CONFLICT (codigo) DO NOTHING;

-- 2. Cabecera del Libro Diario (Asientos Contables Inmutables)
CREATE TABLE IF NOT EXISTS public.contabilidad_asientos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero_asiento BIGSERIAL UNIQUE,
  fecha_contable DATE NOT NULL DEFAULT CURRENT_DATE,
  fecha_hora_registro TIMESTAMPTZ NOT NULL DEFAULT now(),
  grupo_id UUID,
  modulo_origen TEXT NOT NULL, -- 'TAQUILLA', 'TABLAS_FIJAS', 'REMATES', 'POLLAS', 'CAJA', 'BANCOS', 'REVERSO'
  referencia_externa_id TEXT,  -- ID de carrera, ticket o depósito
  descripcion TEXT NOT NULL,
  moneda_origen TEXT NOT NULL DEFAULT 'USD',
  tasa_cambio_nic21 NUMERIC(18,6) NOT NULL DEFAULT 1.000000 CHECK (tasa_cambio_nic21 > 0),
  estado TEXT NOT NULL DEFAULT 'PUBLICADO' CHECK (estado IN ('PUBLICADO', 'REVERSADO')),
  asiento_reversado_id UUID REFERENCES public.contabilidad_asientos(id),
  creado_por UUID
);

-- 3. Líneas del Asiento Contable (Partida Doble: Debe y Haber en Moneda Origen y Funcional USD)
CREATE TABLE IF NOT EXISTS public.contabilidad_asientos_lineas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asiento_id UUID NOT NULL REFERENCES public.contabilidad_asientos(id) ON DELETE RESTRICT,
  cuenta_codigo TEXT NOT NULL REFERENCES public.contabilidad_plan_cuentas(codigo),
  tercero_id UUID, -- cliente_id o banquero_id para Estado de Cuenta Auxiliar
  debe_origen NUMERIC(18,2) NOT NULL DEFAULT 0.00 CHECK (debe_origen >= 0),
  haber_origen NUMERIC(18,2) NOT NULL DEFAULT 0.00 CHECK (haber_origen >= 0),
  debe_usd NUMERIC(18,2) NOT NULL DEFAULT 0.00 CHECK (debe_usd >= 0),
  haber_usd NUMERIC(18,2) NOT NULL DEFAULT 0.00 CHECK (haber_usd >= 0),
  glosa_linea TEXT,
  CHECK (NOT (debe_usd > 0 AND haber_usd > 0)),
  CHECK (debe_usd > 0 OR haber_usd > 0)
);

CREATE INDEX IF NOT EXISTS idx_asientos_fecha ON public.contabilidad_asientos(fecha_contable, grupo_id);
CREATE INDEX IF NOT EXISTS idx_lineas_cuenta ON public.contabilidad_asientos_lineas(cuenta_codigo);
CREATE INDEX IF NOT EXISTS idx_lineas_tercero ON public.contabilidad_asientos_lineas(tercero_id);

-- 4. RPC Atómica para Registrar un Asiento Contable Verificando Equilibrio Estricto (Debe == Haber)
CREATE OR REPLACE FUNCTION public.rpc_registrar_asiento_niif(
  p_fecha_contable DATE,
  p_grupo_id UUID,
  p_modulo_origen TEXT,
  p_referencia_id TEXT,
  p_descripcion TEXT,
  p_moneda_origen TEXT,
  p_tasa_cambio NUMERIC,
  p_lineas JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_asiento_id UUID;
  v_linea JSONB;
  v_total_debe_usd NUMERIC(18,2) := 0;
  v_total_haber_usd NUMERIC(18,2) := 0;
  v_debe_orig NUMERIC(18,2);
  v_haber_orig NUMERIC(18,2);
  v_debe_usd NUMERIC(18,2);
  v_haber_usd NUMERIC(18,2);
  v_tasa NUMERIC(18,6) := COALESCE(NULLIF(p_tasa_cambio, 0), 1.000000);
BEGIN
  IF jsonb_typeof(p_lineas) <> 'array' OR jsonb_array_length(p_lineas) < 2 THEN
    RAISE EXCEPTION 'NIIF Error: Todo asiento de partida doble requiere al menos 2 líneas.';
  END IF;

  INSERT INTO public.contabilidad_asientos (
    fecha_contable, grupo_id, modulo_origen, referencia_externa_id,
    descripcion, moneda_origen, tasa_cambio_nic21, creado_por
  ) VALUES (
    COALESCE(p_fecha_contable, CURRENT_DATE),
    p_grupo_id,
    p_modulo_origen,
    p_referencia_id,
    p_descripcion,
    COALESCE(p_moneda_origen, 'USD'),
    v_tasa,
    auth.uid()
  ) RETURNING id INTO v_asiento_id;

  FOR v_linea IN SELECT * FROM jsonb_array_elements(p_lineas)
  LOOP
    v_debe_orig := ROUND(COALESCE((v_linea->>'debe')::NUMERIC, 0), 2);
    v_haber_orig := ROUND(COALESCE((v_linea->>'haber')::NUMERIC, 0), 2);

    IF COALESCE(p_moneda_origen, 'USD') = 'USD' THEN
      v_debe_usd := v_debe_orig;
      v_haber_usd := v_haber_orig;
    ELSE
      v_debe_usd := ROUND(v_debe_orig / v_tasa, 2);
      v_haber_usd := ROUND(v_haber_orig / v_tasa, 2);
    END IF;

    INSERT INTO public.contabilidad_asientos_lineas (
      asiento_id, cuenta_codigo, tercero_id,
      debe_origen, haber_origen, debe_usd, haber_usd, glosa_linea
    ) VALUES (
      v_asiento_id,
      v_linea->>'cuenta_codigo',
      NULLIF(v_linea->>'tercero_id', '')::UUID,
      v_debe_orig,
      v_haber_orig,
      v_debe_usd,
      v_haber_usd,
      v_linea->>'glosa'
    );

    v_total_debe_usd := v_total_debe_usd + v_debe_usd;
    v_total_haber_usd := v_total_haber_usd + v_haber_usd;
  END LOOP;

  -- Validación Matemática Inquebrantable de Partida Doble
  IF v_total_debe_usd <> v_total_haber_usd THEN
    RAISE EXCEPTION 'DESCUADRE CONTABLE NIIF: Total Debe USD (%) es distinto de Total Haber USD (%). Operación abortada.',
      v_total_debe_usd, v_total_haber_usd;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'asiento_id', v_asiento_id,
    'total_debe_usd', v_total_debe_usd,
    'total_haber_usd', v_total_haber_usd
  );
END;
$$;

-- 5. Vista de Balance de Comprobación y Estado de Resultados en Tiempo Real (NIC 1)
CREATE OR REPLACE VIEW public.vw_balance_comprobacion_niif AS
SELECT
  a.fecha_contable,
  a.grupo_id,
  pc.codigo AS cuenta_codigo,
  pc.nombre AS cuenta_nombre,
  pc.tipo_elemento,
  pc.naturaleza,
  SUM(l.debe_usd) AS total_debe_usd,
  SUM(l.haber_usd) AS total_haber_usd,
  CASE
    WHEN pc.naturaleza = 'DEUDORA' THEN SUM(l.debe_usd - l.haber_usd)
    ELSE SUM(l.haber_usd - l.debe_usd)
  END AS saldo_neto_usd
FROM public.contabilidad_asientos a
JOIN public.contabilidad_asientos_lineas l ON l.asiento_id = a.id
JOIN public.contabilidad_plan_cuentas pc ON pc.codigo = l.cuenta_codigo
GROUP BY a.fecha_contable, a.grupo_id, pc.codigo, pc.nombre, pc.tipo_elemento, pc.naturaleza;

COMMIT;