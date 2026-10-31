-- ============================================================================
-- TABLA: apuestas_eventos_especiales
-- Soporta apuestas libres y eventos especiales fuera del catálogo tradicional
-- (ej. "10/6 Milwaukee Brewers campeón serie mundial", Super Bowl, peleas, etc.)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.apuestas_eventos_especiales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha DATE NOT NULL DEFAULT CURRENT_DATE,
  evento TEXT NOT NULL,
  cliente_id TEXT,
  cliente_nombre TEXT NOT NULL,
  monto NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (monto >= 0),
  logro_cuota TEXT,
  pago_potencial NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (pago_potencial >= 0),
  estado TEXT NOT NULL DEFAULT 'PENDIENTE' CHECK (estado IN ('PENDIENTE', 'GANADOR', 'PERDEDOR', 'ANULADA')),
  ganador_seleccionado BOOLEAN NOT NULL DEFAULT FALSE,
  fecha_liquidacion TIMESTAMPTZ,
  nota TEXT,
  creado_por TEXT,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices de consulta rápida
CREATE INDEX IF NOT EXISTS idx_apuestas_eventos_fecha ON public.apuestas_eventos_especiales(fecha);
CREATE INDEX IF NOT EXISTS idx_apuestas_eventos_estado ON public.apuestas_eventos_especiales(estado);
CREATE INDEX IF NOT EXISTS idx_apuestas_eventos_cliente ON public.apuestas_eventos_especiales(cliente_nombre);

-- RLS
ALTER TABLE public.apuestas_eventos_especiales ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Lectura libre para usuarios autenticados o anon" 
  ON public.apuestas_eventos_especiales 
  FOR SELECT 
  USING (true);

CREATE POLICY "Escritura libre para usuarios autenticados o anon" 
  ON public.apuestas_eventos_especiales 
  FOR ALL 
  USING (true)
  WITH CHECK (true);
