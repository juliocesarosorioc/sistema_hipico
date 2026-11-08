-- ============================================================================
-- SCRIPT OFICIAL: RECALCULAR Y ACTUALIZAR SALDOS EN SUPABASE
-- Regla de Negocio Canónica:
-- 1. Devoluciones e incentivos sobre el MONTO DECIDIDO neto de la carrera SIN comisión.
--    - Si solo perdió 50 -> base = 50. Devolución = 50 * (% dev).
--    - Si solo ganó 50 -> base = 50. Comisión = 50 * (% com). Neto = 50 - com. Devolución = 50 * (% dev).
--    - Si hubo cruce (ej. ganó 50 y perdió 20) -> base = |50 - 20| = 30.
--      Diferencia positiva = 30. Comisión = 30 * (% com). Neto = 30 - com. Devolución = 30 * (% dev).
--    - Si ganó y perdió lo mismo (ej. 50 y 50) -> base = 0.
-- 2. Comisión de la casa: SOLO sobre la diferencia neta positiva si termina a favor.
-- 3. La devolución SIEMPRE suma (+) a favor del cliente.
-- 4. Ejecución inmediata e idempotente: actualiza clientes.saldo_actual directamente.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.recalcular_todos_los_saldos_oficial()
RETURNS TABLE (
  cliente_id TEXT,
  cliente_nombre TEXT,
  grupo TEXT,
  saldo_anterior NUMERIC(14,2),
  saldo_nuevo NUMERIC(14,2),
  diferencia NUMERIC(14,2),
  pct_devolucion NUMERIC(6,2),
  total_devoluciones_acreditadas NUMERIC(14,2)
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  r RECORD;
  v_saldo_anterior NUMERIC(14,2);
  v_neto_jugadas NUMERIC(14,2);
  v_total_dev NUMERIC(14,2);
  v_depositos_netos NUMERIC(14,2);
  v_nuevo_saldo NUMERIC(14,2);
BEGIN
  -- Crear tabla temporal para recopilar resultados de auditoría
  CREATE TEMP TABLE IF NOT EXISTS tmp_resumen_saldos (
    cliente_id TEXT,
    cliente_nombre TEXT,
    grupo TEXT,
    saldo_anterior NUMERIC(14,2),
    saldo_nuevo NUMERIC(14,2),
    diferencia NUMERIC(14,2),
    pct_devolucion NUMERIC(6,2),
    total_devoluciones_acreditadas NUMERIC(14,2)
  ) ON COMMIT DROP;

  DELETE FROM tmp_resumen_saldos;

  -- Iterar por cada cliente registrado en la base de datos
  FOR r IN (
    SELECT 
      c.id AS cid,
      c.nombre AS cnom,
      c.seudonimo AS cseu,
      c.grupo_id AS cgid,
      g.nombre AS gnom,
      COALESCE(c.saldo_actual, 0.00) AS saldo_act,
      COALESCE(c.devolucion, c.incentivo_pct, c.devolucion_porcentaje, 0.00) AS dev_pct,
      COALESCE(g.comision_default, 5.00) AS com_pct
    FROM public.clientes c
    LEFT JOIN public.grupos_venta g ON g.id = c.grupo_id
    WHERE UPPER(TRIM(COALESCE(c.nombre, ''))) NOT IN ('MARCAS', 'TF', 'REMATES', 'DUPLETA', 'POLLAS')
  ) LOOP

    v_saldo_anterior := r.saldo_act;

    -- 1. Movimientos de Caja / Depósitos / Retiros (si existen en la tabla depositos)
    v_depositos_netos := 0.00;
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'depositos') THEN
      SELECT COALESCE(SUM(
        CASE 
          WHEN LOWER(COALESCE(d.tipo_operacion, '')) LIKE '%retiro%' OR LOWER(COALESCE(d.tipo_operacion, '')) LIKE '%disminuci%' THEN -ABS(d.monto)
          ELSE d.monto
        END
      ), 0.00)
      INTO v_depositos_netos
      FROM public.depositos d
      WHERE d.cliente_id::TEXT = r.cid::TEXT 
         OR UPPER(TRIM(d.cliente_nombre)) = UPPER(TRIM(r.cnom))
         OR (r.cseu IS NOT NULL AND UPPER(TRIM(d.cliente_nombre)) = UPPER(TRIM(r.cseu)));
    END IF;

    -- 2. Cálculo carrera a carrera con Cruces y Devolución sobre Monto Decidido
    WITH jugadas_carrera AS (
      SELECT
        COALESCE(t.fecha_carrera, t.fecha_registro::DATE, NOW()::DATE) AS fecha,
        UPPER(TRIM(t.hipodromo)) AS hipodromo,
        t.carrera,
        -- Ganado bruto desde perspectiva del cliente (premio menos lo apostado)
        SUM(
          CASE
            -- Cliente juega y gana
            WHEN (
                  t.cliente_juega_id::TEXT = r.cid::TEXT 
                  OR UPPER(TRIM(COALESCE(t.cliente_juega_nombre, ''))) IN (UPPER(TRIM(r.cnom)), UPPER(TRIM(COALESCE(r.cseu, ''))))
                  OR UPPER(TRIM(COALESCE(t.cliente_juega, ''))) IN (UPPER(TRIM(r.cnom)), UPPER(TRIM(COALESCE(r.cseu, ''))))
                 )
                 AND UPPER(TRIM(COALESCE(t.estado, ''))) IN ('GANADOR', 'GANO', 'SOLUCIONADO') THEN
              GREATEST(0.00, COALESCE(t.premio_pagar, 0.00) - COALESCE(t.monto_jugado, 0.00))
            -- Cliente da (consigue) y el apostador pierde -> cliente gana el monto apostado
            WHEN (
                  t.cliente_consigue_id::TEXT = r.cid::TEXT 
                  OR UPPER(TRIM(COALESCE(t.cliente_consigue_nombre, ''))) IN (UPPER(TRIM(r.cnom)), UPPER(TRIM(COALESCE(r.cseu, ''))))
                  OR UPPER(TRIM(COALESCE(t.cliente_consigue, ''))) IN (UPPER(TRIM(r.cnom)), UPPER(TRIM(COALESCE(r.cseu, ''))))
                  OR UPPER(TRIM(COALESCE(t.banquero_nombre, ''))) IN (UPPER(TRIM(r.cnom)), UPPER(TRIM(COALESCE(r.cseu, ''))))
                 )
                 AND UPPER(TRIM(COALESCE(t.estado, ''))) IN ('PERDEDOR', 'PERDIO') THEN
              COALESCE(t.monto_jugado, 0.00)
            ELSE 0.00
          END
        ) AS ganado_bruto,
        -- Perdido bruto desde perspectiva del cliente
        SUM(
          CASE
            -- Cliente juega y pierde
            WHEN (
                  t.cliente_juega_id::TEXT = r.cid::TEXT 
                  OR UPPER(TRIM(COALESCE(t.cliente_juega_nombre, ''))) IN (UPPER(TRIM(r.cnom)), UPPER(TRIM(COALESCE(r.cseu, ''))))
                  OR UPPER(TRIM(COALESCE(t.cliente_juega, ''))) IN (UPPER(TRIM(r.cnom)), UPPER(TRIM(COALESCE(r.cseu, ''))))
                 )
                 AND UPPER(TRIM(COALESCE(t.estado, ''))) IN ('PERDEDOR', 'PERDIO') THEN
              COALESCE(t.monto_jugado, 0.00)
            -- Cliente da (consigue) y el apostador gana -> cliente pierde la ganancia otorgada
            WHEN (
                  t.cliente_consigue_id::TEXT = r.cid::TEXT 
                  OR UPPER(TRIM(COALESCE(t.cliente_consigue_nombre, ''))) IN (UPPER(TRIM(r.cnom)), UPPER(TRIM(COALESCE(r.cseu, ''))))
                  OR UPPER(TRIM(COALESCE(t.cliente_consigue, ''))) IN (UPPER(TRIM(r.cnom)), UPPER(TRIM(COALESCE(r.cseu, ''))))
                  OR UPPER(TRIM(COALESCE(t.banquero_nombre, ''))) IN (UPPER(TRIM(r.cnom)), UPPER(TRIM(COALESCE(r.cseu, ''))))
                 )
                 AND UPPER(TRIM(COALESCE(t.estado, ''))) IN ('GANADOR', 'GANO', 'SOLUCIONADO') THEN
              GREATEST(0.00, COALESCE(t.premio_pagar, 0.00) - COALESCE(t.monto_jugado, 0.00))
            ELSE 0.00
          END
        ) AS perdido_bruto,
        -- Indicador de si contiene jugadas de puestos para derecho a devolución/incentivo
        BOOL_OR(
          UPPER(TRIM(COALESCE(t.nombre_jugada, ''))) NOT LIKE 'TABLA%'
          AND UPPER(TRIM(COALESCE(t.nombre_jugada, ''))) NOT LIKE 'TF%'
          AND UPPER(TRIM(COALESCE(t.nombre_jugada, ''))) NOT LIKE 'MARCA%'
          AND UPPER(TRIM(COALESCE(t.nombre_jugada, ''))) NOT LIKE 'DUPLETA%'
          AND UPPER(TRIM(COALESCE(t.nombre_jugada, ''))) NOT LIKE 'POLLA%'
          AND UPPER(TRIM(COALESCE(t.nombre_jugada, ''))) NOT LIKE 'REMATE%'
        ) AS es_puesto
      FROM public.tickets_apuestas t
      WHERE COALESCE(t.anulada, FALSE) = FALSE
        AND UPPER(TRIM(COALESCE(t.estado, ''))) IN ('GANADOR', 'GANO', 'PERDEDOR', 'PERDIO', 'SOLUCIONADO')
        AND (
          t.cliente_juega_id::TEXT = r.cid::TEXT 
          OR UPPER(TRIM(COALESCE(t.cliente_juega_nombre, ''))) IN (UPPER(TRIM(r.cnom)), UPPER(TRIM(COALESCE(r.cseu, ''))))
          OR UPPER(TRIM(COALESCE(t.cliente_juega, ''))) IN (UPPER(TRIM(r.cnom)), UPPER(TRIM(COALESCE(r.cseu, ''))))
          OR t.cliente_consigue_id::TEXT = r.cid::TEXT
          OR UPPER(TRIM(COALESCE(t.cliente_consigue_nombre, ''))) IN (UPPER(TRIM(r.cnom)), UPPER(TRIM(COALESCE(r.cseu, ''))))
          OR UPPER(TRIM(COALESCE(t.cliente_consigue, ''))) IN (UPPER(TRIM(r.cnom)), UPPER(TRIM(COALESCE(r.cseu, ''))))
          OR UPPER(TRIM(COALESCE(t.banquero_nombre, ''))) IN (UPPER(TRIM(r.cnom)), UPPER(TRIM(COALESCE(r.cseu, ''))))
        )
      GROUP BY 1, 2, 3
    ),
    carrera_liquidada AS (
      SELECT
        ganado_bruto,
        perdido_bruto,
        (ganado_bruto - perdido_bruto) AS dif_bruta,
        ABS(ganado_bruto - perdido_bruto) AS monto_decidido,
        -- Comisión de la casa: SOLO se cobra si la diferencia neta de la carrera es positiva
        CASE 
          WHEN (ganado_bruto - perdido_bruto) > 0 THEN 
            ROUND((ganado_bruto - perdido_bruto) * (r.com_pct / 100.0), 2)
          ELSE 0.00 
        END AS comision_casa,
        -- Resultado neto de jugadas de la carrera
        CASE 
          WHEN (ganado_bruto - perdido_bruto) > 0 THEN 
            (ganado_bruto - perdido_bruto) - ROUND((ganado_bruto - perdido_bruto) * (r.com_pct / 100.0), 2)
          ELSE (ganado_bruto - perdido_bruto)
        END AS neto_carrera,
        -- Devolución oficial: en base al monto decidido SIN comisión (gane o pierda)
        CASE 
          WHEN es_puesto AND r.dev_pct > 0 THEN
            ROUND(ABS(ganado_bruto - perdido_bruto) * (r.dev_pct / 100.0), 2)
          ELSE 0.00
        END AS dev_carrera
      FROM jugadas_carrera
    )
    SELECT
      COALESCE(SUM(neto_carrera), 0.00),
      COALESCE(SUM(dev_carrera), 0.00)
    INTO v_neto_jugadas, v_total_dev
    FROM carrera_liquidada;

    -- Solo actualizar si el cliente tiene jugadas o depósitos registrados
    IF v_neto_jugadas <> 0.00 OR v_total_dev <> 0.00 OR v_depositos_netos <> 0.00 THEN
      v_nuevo_saldo := ROUND(v_depositos_netos + v_neto_jugadas + v_total_dev, 2);
    ELSE
      v_nuevo_saldo := v_saldo_anterior;
    END IF;

    -- Aplicar la actualización al registro del cliente
    UPDATE public.clientes
    SET saldo_actual = v_nuevo_saldo
    WHERE id = r.cid;

    -- Registrar para el reporte final de retorno
    INSERT INTO tmp_resumen_saldos (
      cliente_id, cliente_nombre, grupo, saldo_anterior, saldo_nuevo, diferencia, pct_devolucion, total_devoluciones_acreditadas
    ) VALUES (
      r.cid::TEXT,
      r.cnom,
      COALESCE(r.gnom, 'Sin Grupo'),
      v_saldo_anterior,
      v_nuevo_saldo,
      ROUND(v_nuevo_saldo - v_saldo_anterior, 2),
      r.dev_pct,
      v_total_dev
    );

  END LOOP;

  RETURN QUERY 
  SELECT * FROM tmp_resumen_saldos ORDER BY cliente_nombre ASC;

END;
$$;

COMMIT;

-- ============================================================================
-- EJECUTAR LA ORDEN Y ACTUALIZAR LOS SALDOS AHORA MISMO
-- ============================================================================
SELECT * FROM public.recalcular_todos_los_saldos_oficial();
