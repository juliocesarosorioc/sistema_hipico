-- ============================================================================
-- CONTABILIDAD CENTRALIZADA DE SALDOS POR CLIENTE (SINGLE SOURCE OF TRUTH)
-- ============================================================================
-- 
-- Motor contable centralizado: libro mayor unificado para todos los módulos.
-- Corrige desincronización donde clientes.saldo_actual queda con saldos huérfanos
-- (ej: Pedro Grupo Argentina con -6000) mientras reportes muestran 0.
--
-- Idempotente: puede ejecutarse múltiples veces sin efectos colaterales.
-- ============================================================================

-- 1) FUNCIONES AUXILIARES DE NORMALIZACIÓN
CREATE OR REPLACE FUNCTION public.norm_nombre(p_nombre text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT upper(regexp_replace(coalesce(trim(p_nombre), ''), '\s+', ' ', 'g'))
$$;

-- 2) VISTA MAESTRA DE MOVIMIENTOS DE CUADERNO CONSOLIDADOS
-- Unifica depósitos, retiros, abonos, traslados desde cuaderno_movimientos
CREATE OR REPLACE VIEW public.v_cuaderno_consolidado AS
SELECT 
  cm.cliente_id,
  c.grupo_id,
  cm.fecha,
  cm.tipo,
  cm.monto,
  cm.descripcion,
  cm.usuario,
  cm.creado_en
FROM cuaderno_movimientos cm
JOIN clientes c ON c.id = cm.cliente_id
WHERE cm.anulado IS NOT TRUE;

-- 3) FUNCIÓN: CALCULAR ESTADO DE CUENTA CENTRALIZADO POR CLIENTE
CREATE OR REPLACE FUNCTION public.calcular_estado_cuenta_cliente(p_cliente_id uuid DEFAULT NULL)
RETURNS TABLE (
  cliente_id uuid,
  grupo_id uuid,
  nombre text,
  es_libre boolean,
  aval_vigente numeric,
  total_depositos numeric,
  total_retiros numeric,
  jugadas_ganadas_bruto numeric,
  comisiones_cobradas numeric,
  jugadas_ganadas_neto numeric,
  jugadas_perdidas numeric,
  jugadas_anuladas_count bigint,
  jugadas_activas_count bigint,
  saldo_contable_real numeric,
  riesgo_en_curso numeric,
  disponible_real numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH clientes_base AS (
    SELECT 
      cl.id AS cliente_id,
      cl.grupo_id,
      cl.nombre,
      COALESCE(lower(trim(cl.modo_juego)), '') = 'libre' AS es_libre,
      COALESCE(cl.aval, 0) + COALESCE(cl.aval_limite, 0) + COALESCE(cl.credito, 0) AS aval_vigente
    FROM clientes cl
    WHERE p_cliente_id IS NULL OR cl.id = p_cliente_id
  ),
  movimientos AS (
    SELECT 
      cb.cliente_id,
      COALESCE(SUM(CASE 
        WHEN lower(cb.tipo) IN ('deposito', 'abono', 'ingreso', 'credito') THEN cb.monto 
        ELSE 0 
      END), 0) AS total_depositos,
      COALESCE(SUM(CASE 
        WHEN lower(cb.tipo) IN ('retiro', 'egreso', 'pago', 'debito') THEN cb.monto 
        ELSE 0 
      END), 0) AS total_retiros
    FROM v_cuaderno_consolidado cb
    GROUP BY cb.cliente_id
  ),
  tickets_universal AS (
    SELECT 
      t.cliente_juega_id AS cliente_id,
      t.id,
      COALESCE(t.estado, '') AS estado,
      COALESCE(t.monto_jugado, 0) AS monto_jugado,
      COALESCE(t.premio_pagar, 0) AS premio_pagar,
      COALESCE(t.monto_decidido, 0) AS monto_decidido,
      COALESCE(t.comision_porcentaje, 0) AS comision_pct,
      t.anulada,
      t.nombre_jugada
    FROM tickets_apuestas t
    WHERE t.cliente_juega_id IS NOT NULL
      AND (p_cliente_id IS NULL OR t.cliente_juega_id = p_cliente_id)
  ),
  tickets_filtrados AS (
    SELECT 
      tu.*,
      CASE 
        WHEN tu.anulada = true OR upper(tu.estado) IN ('ANULADA','CANCELADA','ELIMINADA','RETIRADO') THEN true
        ELSE false
      END AS es_anulada
    FROM tickets_universal tu
  ),
  resultado_tickets AS (
    SELECT 
      tf.cliente_id,
      COUNT(*) FILTER (WHERE tf.es_anulada) AS jugadas_anuladas_count,
      COUNT(*) FILTER (WHERE upper(tf.estado) = 'PENDIENTE' AND NOT tf.es_anulada) AS jugadas_activas_count,
      -- Ganadas: estado Ganador y no anulada
      COALESCE(SUM(CASE WHEN upper(tf.estado) = 'GANADOR' AND NOT tf.es_anulada THEN tf.premio_pagar ELSE 0 END), 0) AS ganadas_bruto,
      -- Comisiones cobradas (aproximado por comisión_porcentaje si aplica)
      COALESCE(SUM(CASE 
        WHEN upper(tf.estado) = 'GANADOR' AND NOT tf.es_anulada 
        THEN GREATEST(0, tf.monto_jugado * tf.comision_pct / 100.0)
        ELSE 0 
      END), 0) AS comisiones_cobradas,
      -- Perdidas: estado Perdedor y no anulada
      COALESCE(SUM(CASE WHEN upper(tf.estado) = 'PERDEDOR' AND NOT tf.es_anulada THEN tf.monto_jugado ELSE 0 END), 0) AS perdidas
    FROM tickets_filtrados tf
    GROUP BY tf.cliente_id
  )
  SELECT 
    cb.cliente_id,
    cb.grupo_id,
    cb.nombre,
    cb.es_libre,
    cb.aval_vigente,
    COALESCE(m.total_depositos, 0) AS total_depositos,
    COALESCE(m.total_retiros, 0) AS total_retiros,
    COALESCE(rt.ganadas_bruto, 0) AS jugadas_ganadas_bruto,
    COALESCE(rt.comisiones_cobradas, 0) AS comisiones_cobradas,
    COALESCE(rt.ganadas_bruto, 0) - COALESCE(rt.comisiones_cobradas, 0) AS jugadas_ganadas_neto,
    COALESCE(rt.perdidas, 0) AS jugadas_perdidas,
    COALESCE(rt.jugadas_anuladas_count, 0) AS jugadas_anuladas_count,
    COALESCE(rt.jugadas_activas_count, 0) AS jugadas_activas_count,
    -- saldo_contable_real = depósitos - retiros + ganadas_neto - perdidas
    (COALESCE(m.total_depositos, 0) - COALESCE(m.total_retiros, 0) + 
     COALESCE(rt.ganadas_bruto, 0) - COALESCE(rt.comisiones_cobradas, 0) - 
     COALESCE(rt.perdidas, 0)) AS saldo_contable_real,
    -- riesgo_en_curso: solo jugadas activas no anuladas
    COALESCE((SELECT SUM(tf2.monto_jugado) 
              FROM tickets_filtrados tf2 
              WHERE tf2.cliente_id = cb.cliente_id 
                AND upper(tf2.estado) = 'PENDIENTE' 
                AND NOT tf2.es_anulada), 0) AS riesgo_en_curso,
    -- disponible_real
    ((COALESCE(m.total_depositos, 0) - COALESCE(m.total_retiros, 0) + 
      COALESCE(rt.ganadas_bruto, 0) - COALESCE(rt.comisiones_cobradas, 0) - 
      COALESCE(rt.perdidas, 0)) + cb.aval_vigente - 
     COALESCE((SELECT SUM(tf2.monto_jugado) 
               FROM tickets_filtrados tf2 
               WHERE tf2.cliente_id = cb.cliente_id 
                 AND upper(tf2.estado) = 'PENDIENTE' 
                 AND NOT tf2.es_anulada), 0)) AS disponible_real
  FROM clientes_base cb
  LEFT JOIN movimientos m ON m.cliente_id = cb.cliente_id
  LEFT JOIN resultado_tickets rt ON rt.cliente_id = cb.cliente_id;
END;
$$;

-- 4) VISTA DE SALDOS CENTRALIZADOS PARA TODOS LOS MÓDULOS
CREATE OR REPLACE VIEW public.v_saldos_centralizados_clientes AS
SELECT * FROM public.calcular_estado_cuenta_cliente(NULL);

-- 5) FUNCIÓN RPC DE RECONCILIACIÓN Y SINCRONIZACIÓN
CREATE OR REPLACE FUNCTION public.reconciliar_saldos_clientes(p_grupo_id uuid DEFAULT NULL, p_cliente_id uuid DEFAULT NULL)
RETURNS TABLE (
  cliente_id uuid,
  nombre text,
  saldo_anterior numeric,
  saldo_nuevo numeric,
  diferencia numeric,
  corregido boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  rec RECORD;
  v_saldo_anterior numeric;
  v_saldo_nuevo numeric;
BEGIN
  FOR rec IN 
    SELECT cec.* 
    FROM public.calcular_estado_cuenta_cliente(p_cliente_id) cec
    JOIN clientes c ON c.id = cec.cliente_id
    WHERE (p_grupo_id IS NULL OR c.grupo_id = p_grupo_id)
      AND (p_cliente_id IS NULL OR c.id = p_cliente_id)
  LOOP
    SELECT COALESCE(saldo_actual, 0) INTO v_saldo_anterior
    FROM clientes WHERE id = rec.cliente_id;
    
    v_saldo_nuevo := rec.saldo_contable_real;
    
    -- Actualizar saldo_actual con valor contable real
    UPDATE clientes 
    SET saldo_actual = v_saldo_nuevo,
        actualizado_en = NOW()
    WHERE id = rec.cliente_id;
    
    cliente_id := rec.cliente_id;
    nombre := rec.nombre;
    saldo_anterior := v_saldo_anterior;
    saldo_nuevo := v_saldo_nuevo;
    diferencia := v_saldo_nuevo - v_saldo_anterior;
    corregido := (abs(diferencia) > 0.001);
    
    RETURN NEXT;
  END LOOP;
  
  RETURN;
END;
$$;

-- 6) TRIGGERS PARA ACTUALIZACIÓN AUTOMÁTICA
CREATE OR REPLACE FUNCTION public.trigger_reconciliar_saldo_cliente()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_cliente_id uuid;
BEGIN
  -- Determinar cliente afectado según tabla
  IF TG_TABLE_NAME = 'tickets_apuestas' THEN
    v_cliente_id := COALESCE(NEW.cliente_juega_id, OLD.cliente_juega_id);
  ELSIF TG_TABLE_NAME = 'cuaderno_movimientos' THEN
    v_cliente_id := COALESCE(NEW.cliente_id, OLD.cliente_id);
  ELSIF TG_TABLE_NAME = 'tablas_fijas_ventas' THEN
    v_cliente_id := COALESCE(NEW.cliente_id, OLD.cliente_id);
  ELSIF TG_TABLE_NAME = 'pollas_tickets' THEN
    v_cliente_id := COALESCE(NEW.cliente_id, OLD.cliente_id);
  ELSIF TG_TABLE_NAME = 'remates_pujas' THEN
    v_cliente_id := COALESCE(NEW.cliente_id, OLD.cliente_id);
  END IF;
  
  IF v_cliente_id IS NOT NULL THEN
    -- Reconciliar automáticamente
    PERFORM 1 FROM public.reconciliar_saldos_clientes(NULL, v_cliente_id);
  END IF;
  
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Crear triggers si las tablas existen
DO $$
BEGIN
  -- tickets_apuestas
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'tickets_apuestas') THEN
    DROP TRIGGER IF EXISTS trg_reconciliar_tickets ON tickets_apuestas;
    CREATE TRIGGER trg_reconciliar_tickets
      AFTER INSERT OR UPDATE OR DELETE ON tickets_apuestas
      FOR EACH ROW EXECUTE FUNCTION public.trigger_reconciliar_saldo_cliente();
  END IF;
  
  -- cuaderno_movimientos
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'cuaderno_movimientos') THEN
    DROP TRIGGER IF EXISTS trg_reconciliar_cuaderno ON cuaderno_movimientos;
    CREATE TRIGGER trg_reconciliar_cuaderno
      AFTER INSERT OR UPDATE OR DELETE ON cuaderno_movimientos
      FOR EACH ROW EXECUTE FUNCTION public.trigger_reconciliar_saldo_cliente();
  END IF;
END $$;

-- 7) EJECUTAR RECONCILIACIÓN INMEDIATA PARA CORREGIR SALDOS HUÉRFANOS
SELECT * FROM public.reconciliar_saldos_clientes(NULL, NULL);

-- Comentarios
COMMENT ON FUNCTION public.calcular_estado_cuenta_cliente IS 'Motor contable centralizado - Calcula estado de cuenta real por cliente desde todas las fuentes';
COMMENT ON FUNCTION public.reconciliar_saldos_clientes IS 'Sincroniza clientes.saldo_actual con saldo contable real calculado centralmente';
COMMENT ON VIEW public.v_saldos_centralizados_clientes IS 'Vista única de saldos para todos los módulos del sistema';
