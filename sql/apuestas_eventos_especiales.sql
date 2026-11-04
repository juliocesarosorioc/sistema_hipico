-- ============================================================================
-- TABLA Y FUNCIONES RPC: apuestas_eventos_especiales (MÓDULO 3: EVENTO LIBRE)
-- Soporta apuestas libres, eventos deportivos P2P y eventos especiales fuera
-- del catálogo tradicional, con liquidación y reversión atómica de saldos.
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

DROP POLICY IF EXISTS "Lectura libre para usuarios autenticados o anon" ON public.apuestas_eventos_especiales;
CREATE POLICY "Lectura libre para usuarios autenticados o anon" 
  ON public.apuestas_eventos_especiales 
  FOR SELECT 
  USING (true);

DROP POLICY IF EXISTS "Escritura libre para usuarios autenticados o anon" ON public.apuestas_eventos_especiales;
CREATE POLICY "Escritura libre para usuarios autenticados o anon" 
  ON public.apuestas_eventos_especiales 
  FOR ALL 
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- RPC: club_reversar_evento_especial
-- Anula o revierte un evento libre/especial restaurando el saldo del cliente.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.club_reversar_evento_especial(
  p_apuesta_id UUID,
  p_motivo TEXT DEFAULT 'Reversión administrativa'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_apuesta RECORD;
  v_diferencia NUMERIC(12, 2) := 0;
BEGIN
  SELECT * INTO v_apuesta
  FROM public.apuestas_eventos_especiales
  WHERE id = p_apuesta_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Apuesta o evento especial no encontrado');
  END IF;

  IF v_apuesta.estado = 'ANULADA' THEN
    RETURN jsonb_build_object('ok', true, 'mensaje', 'El evento ya se encontraba anulado');
  END IF;

  -- Si estaba liquidado como GANADOR, descontar la ganancia neta acreditada
  IF v_apuesta.estado = 'GANADOR' AND v_apuesta.cliente_id IS NOT NULL THEN
    v_diferencia := GREATEST(0, COALESCE(v_apuesta.pago_potencial, 0) - COALESCE(v_apuesta.monto, 0));
    UPDATE public.clientes
    SET saldo_actual = COALESCE(saldo_actual, 0) - v_diferencia
    WHERE id::text = v_apuesta.cliente_id;
  -- Si estaba liquidado como PERDEDOR, restituir el monto descontado
  ELSIF v_apuesta.estado = 'PERDEDOR' AND v_apuesta.cliente_id IS NOT NULL THEN
    v_diferencia := COALESCE(v_apuesta.monto, 0);
    UPDATE public.clientes
    SET saldo_actual = COALESCE(saldo_actual, 0) + v_diferencia
    WHERE id::text = v_apuesta.cliente_id;
  END IF;

  UPDATE public.apuestas_eventos_especiales
  SET estado = 'ANULADA',
      ganador_seleccionado = FALSE,
      actualizado_en = NOW(),
      nota = COALESCE(nota || ' | ', '') || 'ANULADA: ' || p_motivo
  WHERE id = p_apuesta_id;

  RETURN jsonb_build_object(
    'ok', true,
    'estado_anterior', v_apuesta.estado,
    'monto_restituido', v_diferencia
  );
END;
$$;
