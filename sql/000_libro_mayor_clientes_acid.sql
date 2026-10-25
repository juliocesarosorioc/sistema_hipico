-- ============================================================================
-- 000_libro_mayor_clientes_acid.sql
-- LIBRO MAYOR ÚNICO TRANSACCIONAL (SINGLE SOURCE OF TRUTH) Y AUTO-CURACIÓN
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.libro_mayor_clientes (
  id BIGSERIAL PRIMARY KEY,
  cliente_id TEXT NOT NULL,
  cliente_nombre TEXT,
  grupo_id TEXT,
  tipo_movimiento TEXT NOT NULL CHECK (tipo_movimiento IN (
    'DEPOSITO',
    'RETIRO',
    'JUGADA_GANADA_NETO',
    'JUGADA_PERDIDA',
    'REEMBOLSO_CRUCE',
    'ANULACION_RESTITUCION',
    'REVERSION_LIQUIDACION',
    'AJUSTE_AUDITORIA'
  )),
  monto_centavos BIGINT NOT NULL DEFAULT 0,
  monto NUMERIC(14,2) NOT NULL DEFAULT 0,
  referencia_ticket_id TEXT,
  hipodromo TEXT,
  carrera INTEGER,
  fecha_carrera DATE,
  observacion TEXT,
  creado_por TEXT DEFAULT 'SISTEMA',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_libro_mayor_cliente_id
  ON public.libro_mayor_clientes (cliente_id);

CREATE INDEX IF NOT EXISTS idx_libro_mayor_carrera
  ON public.libro_mayor_clientes (fecha_carrera, hipodromo, carrera);

-- Auto-curación de saldos corruptos (Caso Pedro -6000 en Grupo Argentina con jugadas anuladas)
CREATE OR REPLACE FUNCTION public.rpc_reconciliar_saldos_clientes(p_grupo_id TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_reparados INTEGER := 0;
BEGIN
  -- Cura inmediata de clientes cuyo saldo_actual quedó negativo por jugadas anuladas o sin pérdidas vigentes
  UPDATE public.clientes c
  SET saldo_actual = 0
  WHERE COALESCE(c.saldo_actual, 0) < 0
    AND (p_grupo_id IS NULL OR c.grupo_id::TEXT = p_grupo_id)
    AND NOT EXISTS (
      SELECT 1
      FROM public.tickets_apuestas t
      WHERE (t.cliente_juega_id::TEXT = c.id::TEXT OR UPPER(TRIM(COALESCE(t.cliente_juega_nombre, ''))) = UPPER(TRIM(COALESCE(c.nombre, ''))))
        AND COALESCE(t.anulada, FALSE) = FALSE
        AND UPPER(TRIM(COALESCE(t.estado, ''))) NOT IN ('ANULADA', 'ANULADO', 'CANCELADA', 'ELIMINADA', 'RETIRADO')
        AND UPPER(TRIM(COALESCE(t.estado, ''))) IN ('PERDEDOR', 'PERDIO', 'PENDIENTE')
    );

  GET DIAGNOSTICS v_reparados = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'reparados', v_reparados
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'ok', FALSE,
    'error', SQLERRM
  );
END;
$$;

COMMIT;
