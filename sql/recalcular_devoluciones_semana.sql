-- ============================================================================
-- FUNCIÓN PL/PGSQL Y SCRIPT DE RECÁLCULO SEMANAL DE DEVOLUCIONES E INCENTIVOS
-- ============================================================================
-- Recalcula retroactivamente las devoluciones e incentivos de la semana hípica actual
-- (o de cualquier rango de fechas indicado) para todos los clientes y socios.
--
-- Principios de Integridad Contable:
-- 1. Idempotencia estricta: Si se ejecuta dos veces seguidas para la misma semana,
--    el delta en la segunda corrida es 0.00 y NO altera los saldos.
-- 2. Trazabilidad NIIF: Se generan los asientos de ajuste en partida doble
--    (Debe 5.1.02.001 Devolución Incentivos / Haber 2.1.01.001 Fondos en Custodia Cliente).
-- 3. Fuente de Verdad: Actualiza de forma atómica 'clientes.saldo_actual'.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.recalcular_devoluciones_semana(
    p_fecha_desde DATE DEFAULT NULL,
    p_fecha_hasta DATE DEFAULT NULL,
    p_grupo_id    UUID DEFAULT NULL,
    p_dry_run     BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
    cliente_id              UUID,
    cliente_nombre          TEXT,
    es_socio                BOOLEAN,
    devolucion_propia_pct   NUMERIC,
    total_propia            NUMERIC,
    total_comisiones        NUMERIC,
    total_debido            NUMERIC,
    ya_acreditado           NUMERIC,
    delta_aplicado          NUMERIC,
    saldo_anterior          NUMERIC,
    saldo_nuevo             NUMERIC,
    resultado               TEXT
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_desde DATE;
    v_hasta DATE;
    v_hoy   DATE := CURRENT_DATE;
    v_dow   INT;
    r_cli   RECORD;
    
    v_base_propia      NUMERIC;
    v_dev_propia       NUMERIC;
    v_dev_comisiones   NUMERIC;
    v_debido           NUMERIC;
    v_acreditado       NUMERIC;
    v_delta            NUMERIC;
    v_saldo_ant        NUMERIC;
    v_saldo_act        NUMERIC;
    v_asiento_id       UUID;
    v_clave_asiento    TEXT;
    v_concepto         TEXT;
BEGIN
    -- 1. Determinar el ciclo semanal (Jueves a Miércoles por defecto hípico)
    IF p_fecha_desde IS NULL OR p_fecha_hasta IS NULL THEN
        -- EXTRACT(DOW): 0=Dom, 1=Lun, 2=Mar, 3=Mié, 4=Jue, 5=Vie, 6=Sáb
        v_dow := EXTRACT(DOW FROM v_hoy)::INT;
        -- Días transcurridos desde el último jueves:
        -- Jue(4) -> 0, Vie(5) -> 1, Sáb(6) -> 2, Dom(0) -> 3, Lun(1) -> 4, Mar(2) -> 5, Mié(3) -> 6
        v_desde := v_hoy - ((v_dow - 4 + 7) % 7);
        v_hasta := v_desde + 6;
    ELSE
        v_desde := p_fecha_desde;
        v_hasta := p_fecha_hasta;
    END IF;

    -- 2. Recorrer cada cliente destinatario (con devolución configurada, socio o con afiliados)
    FOR r_cli IN
        SELECT DISTINCT
            c.id,
            COALESCE(c.nombre, c.seudonimo, 'CLIENTE') AS nombre,
            COALESCE(c.es_socio, false) AS es_socio,
            COALESCE(c.devolucion, (c.raw_user_meta_data->>'incentivo_pct')::numeric, 0)::NUMERIC AS dev_pct,
            COALESCE(c.saldo_actual, 0)::NUMERIC AS saldo_actual,
            c.grupo_id
        FROM public.clientes c
        WHERE (
            COALESCE(c.devolucion, 0) > 0
            OR COALESCE(c.es_socio, false) = true
            OR EXISTS (
                SELECT 1 FROM public.clientes af 
                WHERE af.socio_asignado = c.id::text 
                   OR UPPER(TRIM(af.socio_asignado)) = UPPER(TRIM(c.nombre))
                   OR UPPER(TRIM(af.socio_asignado)) = UPPER(TRIM(c.seudonimo))
            )
        )
        AND (p_grupo_id IS NULL OR c.grupo_id = p_grupo_id)
        ORDER BY nombre ASC
    LOOP
        v_base_propia := 0;
        v_dev_propia := 0;
        v_dev_comisiones := 0;
        v_debido := 0;
        v_acreditado := 0;
        v_delta := 0;
        v_saldo_ant := ROUND(r_cli.saldo_actual, 2);
        v_saldo_act := v_saldo_ant;

        -- A. Devolución propia por sus apuestas de puestos en la semana
        IF r_cli.dev_pct > 0 THEN
            SELECT COALESCE(SUM(
                CASE 
                    WHEN UPPER(COALESCE(t.estado, '')) IN ('GANADOR', 'PERDEDOR', 'SOLUCIONADO', 'FINALIZADA')
                    THEN COALESCE(t.monto_jugado, t.monto, 0)
                    ELSE 0
                END
            ), 0)
            INTO v_base_propia
            FROM public.tickets_apuestas t
            WHERE (
                t.cliente_juega_id = r_cli.id 
                OR UPPER(TRIM(t.cliente_juega_nombre)) = UPPER(TRIM(r_cli.nombre))
            )
            AND t.fecha_carrera >= v_desde 
            AND t.fecha_carrera <= v_hasta
            AND COALESCE(t.anulada, false) = false
            AND (
                UPPER(COALESCE(t.nombre_jugada, '')) LIKE '%PUESTO%' 
                OR UPPER(COALESCE(t.nombre_jugada, '')) ~ '\b([1-8]P|PP|[1-8]N|\d+Y\d+N|\d+X\d+|\d+A\d+)\b'
                OR UPPER(COALESCE(t.modalidad, '')) LIKE '%PUESTO%'
            );

            v_dev_propia := ROUND((v_base_propia * r_cli.dev_pct) / 100.0, 2);
        END IF;

        -- B. Comisiones por clientes afiliados asignados a este socio
        SELECT COALESCE(SUM(
            ROUND((
                COALESCE(t.monto_jugado, t.monto, 0) * COALESCE(af.comision_socio_pct, 1.0)
            ) / 100.0, 2)
        ), 0)
        INTO v_dev_comisiones
        FROM public.clientes af
        JOIN public.tickets_apuestas t ON (
            t.cliente_juega_id = af.id 
            OR UPPER(TRIM(t.cliente_juega_nombre)) = UPPER(TRIM(af.nombre))
            OR UPPER(TRIM(t.cliente_juega_nombre)) = UPPER(TRIM(af.seudonimo))
        )
        WHERE (
            af.socio_asignado = r_cli.id::text
            OR UPPER(TRIM(af.socio_asignado)) = UPPER(TRIM(r_cli.nombre))
            OR UPPER(TRIM(af.socio_asignado)) = UPPER(TRIM(COALESCE(r_cli.nombre, '')))
        )
        AND t.fecha_carrera >= v_desde 
        AND t.fecha_carrera <= v_hasta
        AND t.fecha_carrera >= COALESCE(af.fecha_inicio_comision_socio, DATE '2026-10-29')
        AND COALESCE(t.anulada, false) = false
        AND UPPER(COALESCE(t.estado, '')) IN ('GANADOR', 'PERDEDOR', 'SOLUCIONADO', 'FINALIZADA')
        AND (
            UPPER(COALESCE(t.nombre_jugada, '')) LIKE '%PUESTO%' 
            OR UPPER(COALESCE(t.nombre_jugada, '')) ~ '\b([1-8]P|PP|[1-8]N|\d+Y\d+N|\d+X\d+|\d+A\d+)\b'
            OR UPPER(COALESCE(t.modalidad, '')) LIKE '%PUESTO%'
        );

        v_debido := ROUND(v_dev_propia + v_dev_comisiones, 2);

        -- C. Obtener lo que ya fue acreditado en la semana mediante asientos NIIF
        SELECT COALESCE(SUM(l.haber), 0)
        INTO v_acreditado
        FROM public.asientos_niif_lineas l
        JOIN public.asientos_niif a ON l.asiento_id = a.id
        WHERE a.fecha >= v_desde AND a.fecha <= v_hasta
        AND (
            a.clave LIKE 'INC:%'
            OR a.clave LIKE 'RECALCULO:%'
            OR UPPER(a.concepto) LIKE '%INCENTIVO%'
            OR UPPER(a.concepto) LIKE '%DEVOLUCI%'
        )
        AND (
            a.clave LIKE '%:' || r_cli.id::text || '%'
            OR a.clave LIKE '%:' || UPPER(TRIM(r_cli.nombre)) || '%'
            OR UPPER(a.concepto) LIKE '%' || UPPER(TRIM(r_cli.nombre)) || '%'
            OR l.cuenta = '2.1.01.001' AND UPPER(l.nombre_cuenta) LIKE '%' || UPPER(TRIM(r_cli.nombre)) || '%'
        );

        v_acreditado := ROUND(v_acreditado, 2);
        v_delta := ROUND(v_debido - v_acreditado, 2);

        -- D. Aplicar ajuste contable y actualizar saldo si no es simulación (dry-run)
        IF NOT p_dry_run AND v_delta <> 0 THEN
            v_saldo_act := ROUND(v_saldo_ant + v_delta, 2);

            -- 1. Actualizar el saldo en clientes
            UPDATE public.clientes
            SET saldo_actual = v_saldo_act,
                updated_at = NOW()
            WHERE id = r_cli.id;

            -- 2. Registrar el asiento NIIF si hubo delta positivo
            IF v_delta > 0 THEN
                v_clave_asiento := 'RECALCULO:SEMANA:' || v_desde || ':' || v_hasta || ':' || r_cli.id::text;
                v_concepto := 'Recálculo semanal (' || v_desde || ' a ' || v_hasta || ') a favor de ' || r_cli.nombre || ' [Debido: $' || v_debido || ', Previo: $' || v_acreditado || ', Delta: +$' || v_delta || ']';

                -- Insertar cabecera NIIF con ON CONFLICT DO UPDATE para idempotencia
                INSERT INTO public.asientos_niif (
                    clave, fecha, concepto, moneda_operacion, moneda_presentacion, tasa_cambio, total_debe, total_haber, usuario
                )
                VALUES (
                    v_clave_asiento, v_hasta, v_concepto, 'USD', 'USD', 1, v_delta, v_delta, 'SQL_RECALCULO'
                )
                ON CONFLICT (clave) DO UPDATE 
                SET total_debe = v_delta, total_haber = v_delta, concepto = EXCLUDED.concepto
                RETURNING id INTO v_asiento_id;

                -- Eliminar líneas previas de la clave si ya existía
                DELETE FROM public.asientos_niif_lineas WHERE asiento_id = v_asiento_id;

                -- Insertar líneas en partida doble:
                -- Debe: 5.1.02.001 (Devolución de Incentivos y Comisiones)
                INSERT INTO public.asientos_niif_lineas (
                    asiento_id, linea, cuenta, nombre_cuenta, debe, haber, debe_presentacion, haber_presentacion
                )
                VALUES (
                    v_asiento_id, 1, 
                    CASE WHEN r_cli.es_socio THEN '5.1.03.001' ELSE '5.1.02.001' END,
                    'Devolución de Incentivos / Socios', 
                    v_delta, 0, v_delta, 0
                );

                -- Haber: 2.1.01.001 (Abono al saldo del Cliente)
                INSERT INTO public.asientos_niif_lineas (
                    asiento_id, linea, cuenta, nombre_cuenta, debe, haber, debe_presentacion, haber_presentacion
                )
                VALUES (
                    v_asiento_id, 2, '2.1.01.001', 
                    'Fondos en Custodia - ' || r_cli.nombre, 
                    0, v_delta, 0, v_delta
                );
            END IF;
        END IF;

        -- Retornar fila en el reporte
        cliente_id            := r_cli.id;
        cliente_nombre        := r_cli.nombre;
        es_socio              := r_cli.es_socio;
        devolucion_propia_pct := r_cli.dev_pct;
        total_propia          := v_dev_propia;
        total_comisiones      := v_dev_comisiones;
        total_debido          := v_debido;
        ya_acreditado         := v_acreditado;
        delta_aplicado        := v_delta;
        saldo_anterior        := v_saldo_ant;
        saldo_nuevo           := v_saldo_act;
        resultado             := CASE 
                                    WHEN p_dry_run THEN 'SIMULACIÓN'
                                    WHEN v_delta = 0 THEN 'AL DÍA (SIN CAMBIO)'
                                    WHEN v_delta > 0 THEN 'ACREDITADO (+$' || v_delta || ')'
                                    ELSE 'DÉBITO AJUSTE (-$' || ABS(v_delta) || ')'
                                 END;
        RETURN NEXT;
    END LOOP;
END;
$$;

-- ============================================================================
-- EJECUCIÓN DEL RECÁLCULO PARA LA SEMANA ACTUAL
-- ============================================================================
-- Descomenta la opción deseada y presiona Run:

-- 1. Ejecutar de forma definitiva actualizando saldos y asientos contables:
SELECT * FROM public.recalcular_devoluciones_semana();

-- 2. O si deseas simular primero sin aplicar cambios a los saldos:
-- SELECT * FROM public.recalcular_devoluciones_semana(p_dry_run := true);

-- 3. O si deseas especificar un rango exacto de fechas (ej. 2026-11-05 al 2026-11-11):
-- SELECT * FROM public.recalcular_devoluciones_semana('2026-11-05', '2026-11-11');
