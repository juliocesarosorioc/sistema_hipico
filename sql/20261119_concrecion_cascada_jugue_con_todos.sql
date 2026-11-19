-- ============================================================================
-- MIGRACIÓN: CONCRECIÓN EN CASCADA FIFO ("Es lo que queda") Y "JUGUE CON TODOS" / "TODOS"
-- ============================================================================

ALTER TABLE IF EXISTS public.chat_tickets_fifo
  ADD COLUMN IF NOT EXISTS monto_solicitado NUMERIC(14,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS monto_concretado NUMERIC(14,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fue_ajuste_parcial BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS monto_pendiente_ampliacion NUMERIC(14,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS whatsapp_concrecion_msg_id TEXT;

-- 1. RPC: concretar_jugada_fifo_atomica (Soporta recorte "Jugo X, Es lo que queda" y cola FIFO "EN_COLA")
CREATE OR REPLACE FUNCTION public.concretar_jugada_fifo_atomica(
  p_grupo_id uuid,
  p_sala_id uuid,
  p_propuesta_msg_id uuid,
  p_aceptante_id uuid,
  p_monto_pedido numeric,
  p_whatsapp_concrecion_msg_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_prop record;
  v_sala record;
  v_grupo record;
  v_proponente record;
  v_aceptante record;
  v_apuesta_minima numeric := 10.00;
  v_tiempo_vencimiento_min int := 5;
  v_remanente numeric := 0;
  v_saldo_disp_aceptante numeric := 0;
  v_tope_aceptante numeric := 0;
  v_monto_efectivo numeric := 0;
  v_monto_pendiente numeric := 0;
  v_fue_recortado_remanente boolean := false;
  v_nuevo_remanente numeric := 0;
  v_ticket_id uuid := gen_random_uuid();
  v_codigo_ticket text;
  v_nuevo_ret_aceptante numeric := 0;
  v_nuevo_ret_proponente numeric := 0;
  v_msg_publico text := NULL;
BEGIN
  SELECT * INTO v_sala FROM public.salas_juego WHERE id = p_sala_id;
  SELECT * INTO v_grupo FROM public.grupos_venta WHERE id = p_grupo_id;

  v_apuesta_minima := COALESCE(v_sala.apuesta_minima, v_grupo.apuesta_minima, 10.00);
  v_tiempo_vencimiento_min := COALESCE(v_sala.tiempo_vencimiento_propuesta_min, v_sala.tiempo_vencimiento_min, 5);

  SELECT * INTO v_prop
  FROM public.chat_mensajes
  WHERE id = p_propuesta_msg_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PROPUESTA_NO_EXISTE');
  END IF;

  v_remanente := COALESCE(v_prop.monto_disponible, 0);

  IF v_prop.estado_propuesta IN ('cancelada', 'se_fue') THEN
    RETURN jsonb_build_object(
      'ok', false,
      'nada_aqui', true,
      'error', 'PROPUESTA_SE_FUE',
      'msg_publico', '🚫Nada aquí, Se fue.',
      'msg_publico_bot', '🚫Nada aquí, Se fue.'
    );
  END IF;

  IF NOW() > (v_prop.created_at + (v_tiempo_vencimiento_min || ' minutes')::INTERVAL) THEN
    UPDATE public.chat_mensajes
    SET estado_propuesta = 'expirada',
        monto_disponible = 0
    WHERE id = p_propuesta_msg_id;

    SELECT * INTO v_proponente FROM public.clientes WHERE id = v_prop.remitente_id FOR UPDATE;
    IF FOUND AND v_proponente.libre IS NOT TRUE AND v_remanente > 0 THEN
      v_nuevo_ret_proponente := GREATEST(0, COALESCE(v_proponente.saldo_retenido, 0) - v_remanente);
      UPDATE public.clientes
      SET saldo_retenido = v_nuevo_ret_proponente,
          saldo_disponible = GREATEST(0, COALESCE(saldo_actual, 0) + COALESCE(aval, 0) - v_nuevo_ret_proponente)
      WHERE id = v_prop.remitente_id;
    END IF;

    RETURN jsonb_build_object(
      'ok', false,
      'nada_aqui', true,
      'error', 'FUERA_DE_TIEMPO',
      'msg_publico', '❌⏰ Nada aquí, fuera de tiempo',
      'msg_publico_bot', '❌⏰ Nada aquí, fuera de tiempo'
    );
  END IF;

  -- Validar aceptante y su saldo disponible
  SELECT * INTO v_aceptante
  FROM public.clientes
  WHERE id = p_aceptante_id AND grupo_id = p_grupo_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ACEPTANTE_NO_REGISTRADO');
  END IF;

  IF v_aceptante.libre IS TRUE THEN
    v_saldo_disp_aceptante := 999999999.00;
  ELSE
    v_saldo_disp_aceptante := GREATEST(0, COALESCE(v_aceptante.saldo_actual, 0) + COALESCE(v_aceptante.aval, 0) - COALESCE(v_aceptante.saldo_retenido, 0));
  END IF;

  IF v_saldo_disp_aceptante <= 0 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'nada_aqui', true,
      'error', 'ACEPTANTE_SIN_SALDO',
      'msg_publico_bot', '*Nada Aquí* — ' || v_aceptante.nombre || ' no posee saldo disponible ($0,00)'
    );
  END IF;

  v_tope_aceptante := LEAST(p_monto_pedido, v_saldo_disp_aceptante);
  v_codigo_ticket := 'TK-' || SUBSTRING(v_ticket_id::text, 1, 8);

  -- Caso 4to jugador (remanente agotado pero propuesta vigente): encolar en espera de "Jugue con Todos" / "Todos"
  IF v_remanente <= 0 AND v_prop.estado_propuesta IN ('cerrada', 'concretada', 'parcial', 'abierta') THEN
    INSERT INTO public.chat_tickets_fifo (
      id,
      codigo_ticket,
      grupo_id,
      sala_id,
      carrera_id,
      propuesta_msg_id,
      proponente_id,
      proponente_nombre,
      aceptante_id,
      aceptante_nombre,
      accion_proponente,
      es_match,
      modalidad,
      ejemplar_numero,
      caballos_bando_a,
      caballos_bando_b,
      proporcion_premio,
      monto_solicitado,
      monto_concretado,
      fue_ajuste_parcial,
      monto_pendiente_ampliacion,
      riesgo_proponente,
      riesgo_aceptante,
      estado,
      whatsapp_concrecion_msg_id
    ) VALUES (
      v_ticket_id,
      v_codigo_ticket,
      p_grupo_id,
      p_sala_id,
      v_prop.carrera_id,
      p_propuesta_msg_id,
      v_prop.remitente_id,
      v_prop.remitente_nombre,
      p_aceptante_id,
      v_aceptante.nombre,
      v_prop.accion_proponente,
      v_prop.es_match,
      v_prop.modalidad_jugada,
      v_prop.ejemplar_numero,
      v_prop.caballos_bando_a,
      v_prop.caballos_bando_b,
      COALESCE(v_prop.proporcion_premio, '1x1'),
      v_tope_aceptante,
      0,
      true,
      v_tope_aceptante,
      0,
      0,
      'EN_COLA',
      p_whatsapp_concrecion_msg_id
    );

    RETURN jsonb_build_object(
      'ok', true,
      'en_cola', true,
      'ticket_id', v_ticket_id,
      'codigo_ticket', v_codigo_ticket,
      'monto_concretado', 0,
      'monto_pendiente_ampliacion', v_tope_aceptante,
      'remanente_propuesta', 0
    );
  END IF;

  IF v_prop.estado_propuesta NOT IN ('abierta', 'parcial') OR v_remanente <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PROPUESTA_AGOTADA');
  END IF;

  IF p_monto_pedido < v_apuesta_minima AND v_remanente >= v_apuesta_minima THEN
    RETURN jsonb_build_object(
      'ok', false,
      'nada_aqui', true,
      'error', 'MONTO_MENOR_MINIMO',
      'msg_publico', '⛔ *Nada aquí* — El monto mínimo de apuesta es $' || TRIM(TO_CHAR(v_apuesta_minima, 'FM999999990.00')),
      'msg_publico_bot', '⛔ *Nada aquí* — El monto mínimo de apuesta es $' || TRIM(TO_CHAR(v_apuesta_minima, 'FM999999990.00'))
    );
  END IF;

  v_monto_efectivo := LEAST(v_tope_aceptante, v_remanente);

  IF v_monto_efectivo <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'MONTO_EFECTIVO_CERO');
  END IF;

  IF v_tope_aceptante > v_remanente AND v_monto_efectivo = v_remanente THEN
    v_fue_recortado_remanente := true;
    v_monto_pendiente := GREATEST(0, ROUND(v_tope_aceptante - v_monto_efectivo, 2));
    v_msg_publico := 'Jugo ' || TRIM(TO_CHAR(v_monto_efectivo, 'FM999999990')) || ', Es lo que queda';
  END IF;

  v_nuevo_remanente := v_remanente - v_monto_efectivo;

  UPDATE public.chat_mensajes
  SET monto_disponible = v_nuevo_remanente,
      estado_propuesta = CASE WHEN v_nuevo_remanente <= 0 THEN 'concretada' ELSE 'parcial' END
  WHERE id = p_propuesta_msg_id;

  IF v_aceptante.libre IS NOT TRUE THEN
    v_nuevo_ret_aceptante := COALESCE(v_aceptante.saldo_retenido, 0) + v_monto_efectivo;
    UPDATE public.clientes
    SET saldo_retenido = v_nuevo_ret_aceptante,
        saldo_disponible = GREATEST(0, COALESCE(saldo_actual, 0) + COALESCE(aval, 0) - v_nuevo_ret_aceptante)
    WHERE id = p_aceptante_id;
  END IF;

  INSERT INTO public.chat_tickets_fifo (
    id,
    codigo_ticket,
    grupo_id,
    sala_id,
    carrera_id,
    propuesta_msg_id,
    proponente_id,
    proponente_nombre,
    aceptante_id,
    aceptante_nombre,
    accion_proponente,
    es_match,
    modalidad,
    ejemplar_numero,
    caballos_bando_a,
    caballos_bando_b,
    proporcion_premio,
    monto_solicitado,
    monto_concretado,
    fue_ajuste_parcial,
    monto_pendiente_ampliacion,
    riesgo_proponente,
    riesgo_aceptante,
    estado,
    whatsapp_concrecion_msg_id
  ) VALUES (
    v_ticket_id,
    v_codigo_ticket,
    p_grupo_id,
    p_sala_id,
    v_prop.carrera_id,
    p_propuesta_msg_id,
    v_prop.remitente_id,
    v_prop.remitente_nombre,
    p_aceptante_id,
    v_aceptante.nombre,
    v_prop.accion_proponente,
    v_prop.es_match,
    v_prop.modalidad_jugada,
    v_prop.ejemplar_numero,
    v_prop.caballos_bando_a,
    v_prop.caballos_bando_b,
    COALESCE(v_prop.proporcion_premio, '1x1'),
    v_tope_aceptante,
    v_monto_efectivo,
    (v_fue_recortado_remanente OR v_monto_efectivo < p_monto_pedido),
    v_monto_pendiente,
    v_monto_efectivo,
    v_monto_efectivo,
    'ACTIVO',
    p_whatsapp_concrecion_msg_id
  );

  RETURN jsonb_build_object(
    'ok', true,
    'ticket_id', v_ticket_id,
    'codigo_ticket', v_codigo_ticket,
    'monto_concretado', v_monto_efectivo,
    'monto_pendiente_ampliacion', v_monto_pendiente,
    'remanente_propuesta', v_nuevo_remanente,
    'fue_recortado_por_remanente', v_fue_recortado_remanente,
    'excedio_saldo_aceptante', (p_monto_pedido > v_saldo_disp_aceptante),
    'msg_publico_bot', v_msg_publico
  );
END;
$$;

-- 2. RPC: cerrar_propuestas_se_fue_atomica (Soporta retiro del proponente Y cierre de excedente/cola del aceptante)
CREATE OR REPLACE FUNCTION public.cerrar_propuestas_se_fue_atomica(
  p_grupo_id uuid,
  p_sala_id uuid,
  p_jugador_id uuid,
  p_propuesta_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_cliente record;
  v_prop record;
  v_tk record;
  v_liberado numeric := 0;
  v_nuevo_retenido numeric := 0;
  v_canceladas_ids uuid[] := ARRAY[]::uuid[];
  v_tickets_cola_cerrados int := 0;
  v_msg_publico text := NULL;
  v_msg_privado text := NULL;
BEGIN
  SELECT * INTO v_cliente
  FROM public.clientes
  WHERE id = p_jugador_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'JUGADOR_NO_ENCONTRADO');
  END IF;

  -- A. Cerrar cualquier excedente pendiente o entrada EN_COLA del jugador como aceptante
  FOR v_tk IN
    SELECT id, estado, monto_pendiente_ampliacion
    FROM public.chat_tickets_fifo
    WHERE sala_id = p_sala_id
      AND aceptante_id = p_jugador_id
      AND (p_propuesta_id IS NULL OR propuesta_msg_id = p_propuesta_id)
      AND (estado = 'EN_COLA' OR (estado = 'ACTIVO' AND COALESCE(monto_pendiente_ampliacion, 0) > 0))
    FOR UPDATE
  LOOP
    IF v_tk.estado = 'EN_COLA' THEN
      UPDATE public.chat_tickets_fifo
      SET estado = 'ANULADO',
          monto_pendiente_ampliacion = 0
      WHERE id = v_tk.id;
    ELSE
      UPDATE public.chat_tickets_fifo
      SET monto_pendiente_ampliacion = 0
      WHERE id = v_tk.id;
    END IF;
    v_tickets_cola_cerrados := v_tickets_cola_cerrados + 1;
  END LOOP;

  -- B. Si citó una propuesta específica
  IF p_propuesta_id IS NOT NULL THEN
    SELECT * INTO v_prop
    FROM public.chat_mensajes
    WHERE id = p_propuesta_id
      AND sala_id = p_sala_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'PROPUESTA_NO_ENCONTRADA');
    END IF;

    IF v_prop.remitente_id <> p_jugador_id THEN
      IF v_tickets_cola_cerrados > 0 THEN
        RETURN jsonb_build_object(
          'ok', true,
          'canceladas', v_tickets_cola_cerrados,
          'canceladas_ids', ARRAY[p_propuesta_id],
          'monto_liberado', 0,
          'msg_publico_bot', NULL,
          'msg_privado_bot', NULL
        );
      END IF;
      RETURN jsonb_build_object('ok', false, 'error', 'NO_ES_PROPONENTE');
    END IF;

    IF v_prop.estado_propuesta IN ('abierta', 'parcial') AND COALESCE(v_prop.monto_disponible, 0) > 0 THEN
      v_liberado := COALESCE(v_prop.monto_disponible, 0);
      v_canceladas_ids := array_append(v_canceladas_ids, v_prop.id);
      UPDATE public.chat_mensajes
      SET estado_propuesta = 'cancelada',
          monto_disponible = 0
      WHERE id = v_prop.id;
    END IF;

    -- Anular tickets pendientes de ampliación de esa propuesta cerrada
    UPDATE public.chat_tickets_fifo
    SET estado = CASE WHEN estado = 'EN_COLA' THEN 'ANULADO' ELSE estado END,
        monto_pendiente_ampliacion = 0
    WHERE propuesta_msg_id = v_prop.id
      AND (estado = 'EN_COLA' OR COALESCE(monto_pendiente_ampliacion, 0) > 0);

    v_msg_publico := NULL;
    v_msg_privado := NULL;
  ELSE
    FOR v_prop IN
      SELECT id, monto_disponible
      FROM public.chat_mensajes
      WHERE sala_id = p_sala_id
        AND remitente_id = p_jugador_id
        AND estado_propuesta IN ('abierta', 'parcial')
        AND COALESCE(monto_disponible, 0) > 0
      FOR UPDATE
    LOOP
      v_liberado := v_liberado + COALESCE(v_prop.monto_disponible, 0);
      v_canceladas_ids := array_append(v_canceladas_ids, v_prop.id);
      UPDATE public.chat_mensajes
      SET estado_propuesta = 'cancelada',
          monto_disponible = 0
      WHERE id = v_prop.id;

      UPDATE public.chat_tickets_fifo
      SET estado = CASE WHEN estado = 'EN_COLA' THEN 'ANULADO' ELSE estado END,
          monto_pendiente_ampliacion = 0
      WHERE propuesta_msg_id = v_prop.id
        AND (estado = 'EN_COLA' OR COALESCE(monto_pendiente_ampliacion, 0) > 0);
    END LOOP;

    v_msg_publico := NULL;
    v_msg_privado := '✅ Todas tus propuestas abiertas fueron retiradas.';
  END IF;

  IF NOT COALESCE(v_cliente.libre, false) AND v_liberado > 0 THEN
    v_nuevo_retenido := GREATEST(0, ROUND(COALESCE(v_cliente.saldo_retenido, 0) - v_liberado, 2));
    UPDATE public.clientes
    SET saldo_retenido = v_nuevo_retenido,
        saldo_disponible = GREATEST(0, ROUND(COALESCE(saldo_actual, 0) + COALESCE(aval, 0) - v_nuevo_retenido, 2))
    WHERE id = p_jugador_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'canceladas', COALESCE(array_length(v_canceladas_ids, 1), 0) + v_tickets_cola_cerrados,
    'canceladas_ids', v_canceladas_ids,
    'monto_liberado', v_liberado,
    'msg_publico_bot', v_msg_publico,
    'msg_privado_bot', v_msg_privado
  );
END;
$$;

-- 3. RPC: ampliar_cupo_propuesta_fifo_atomica ("Jugue con Todos" / "Todos")
CREATE OR REPLACE FUNCTION public.ampliar_cupo_propuesta_fifo_atomica(
  p_grupo_id uuid,
  p_sala_id uuid,
  p_proponente_id uuid,
  p_propuesta_msg_id uuid DEFAULT NULL,
  p_nuevo_tope_total numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_prop record;
  v_proponente record;
  v_aceptante record;
  v_tk record;
  v_prop_id uuid;
  v_saldo_disp_prop numeric := 0;
  v_saldo_disp_acep numeric := 0;
  v_adicional numeric := 0;
  v_nuevo_monto_tk numeric := 0;
  v_tenia_previo boolean := false;
  v_total_ampliado numeric := 0;
  v_texto_item text;
  v_lineas text[] := ARRAY[]::text[];
  v_respuestas_grupo jsonb := '[]'::jsonb;
  v_notificaciones jsonb := '[]'::jsonb;
BEGIN
  -- 1. Resolver la propuesta del proponente (la citada o la última con tickets pendientes de ampliación)
  IF p_propuesta_msg_id IS NOT NULL THEN
    v_prop_id := p_propuesta_msg_id;
  ELSE
    SELECT tk.propuesta_msg_id INTO v_prop_id
    FROM public.chat_tickets_fifo tk
    JOIN public.chat_mensajes m ON m.id = tk.propuesta_msg_id
    WHERE tk.sala_id = p_sala_id
      AND tk.proponente_id = p_proponente_id
      AND m.estado_propuesta NOT IN ('cancelada', 'se_fue', 'expirada')
      AND (tk.estado = 'EN_COLA' OR (tk.estado = 'ACTIVO' AND COALESCE(tk.monto_pendiente_ampliacion, 0) > 0))
    ORDER BY m.created_at DESC, tk.created_at ASC
    LIMIT 1;
  END IF;

  IF v_prop_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SIN_PENDIENTES_AMPLIACION');
  END IF;

  SELECT * INTO v_prop
  FROM public.chat_mensajes
  WHERE id = v_prop_id
  FOR UPDATE;

  IF NOT FOUND OR v_prop.remitente_id <> p_proponente_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_ES_PROPONENTE');
  END IF;

  SELECT * INTO v_proponente
  FROM public.clientes
  WHERE id = p_proponente_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PROPONENTE_NO_ENCONTRADO');
  END IF;

  IF v_proponente.libre IS TRUE THEN
    v_saldo_disp_prop := 999999999.00;
  ELSE
    v_saldo_disp_prop := GREATEST(0, COALESCE(v_proponente.saldo_actual, 0) + COALESCE(v_proponente.aval, 0) - COALESCE(v_proponente.saldo_retenido, 0));
  END IF;

  -- 2. Recorrer tickets en orden FIFO estricto
  FOR v_tk IN
    SELECT *
    FROM public.chat_tickets_fifo
    WHERE propuesta_msg_id = v_prop_id
      AND (estado = 'EN_COLA' OR (estado = 'ACTIVO' AND COALESCE(monto_pendiente_ampliacion, 0) > 0))
    ORDER BY created_at ASC, id ASC
    FOR UPDATE
  LOOP
    EXIT WHEN v_saldo_disp_prop <= 0;

    SELECT * INTO v_aceptante
    FROM public.clientes
    WHERE id = v_tk.aceptante_id
    FOR UPDATE;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    IF v_aceptante.libre IS TRUE THEN
      v_saldo_disp_acep := 999999999.00;
    ELSE
      v_saldo_disp_acep := GREATEST(0, COALESCE(v_aceptante.saldo_actual, 0) + COALESCE(v_aceptante.aval, 0) - COALESCE(v_aceptante.saldo_retenido, 0));
    END IF;

    v_adicional := LEAST(COALESCE(v_tk.monto_pendiente_ampliacion, 0), v_saldo_disp_prop, v_saldo_disp_acep);
    IF v_adicional <= 0 THEN
      CONTINUE;
    END IF;

    v_tenia_previo := (COALESCE(v_tk.monto_concretado, 0) > 0);
    v_nuevo_monto_tk := ROUND(COALESCE(v_tk.monto_concretado, 0) + v_adicional, 2);

    -- Descontar / retener saldo del proponente y del aceptante
    IF v_proponente.libre IS NOT TRUE THEN
      UPDATE public.clientes
      SET saldo_retenido = COALESCE(saldo_retenido, 0) + v_adicional,
          saldo_disponible = GREATEST(0, COALESCE(saldo_actual, 0) + COALESCE(aval, 0) - (COALESCE(saldo_retenido, 0) + v_adicional))
      WHERE id = p_proponente_id;
      v_saldo_disp_prop := GREATEST(0, v_saldo_disp_prop - v_adicional);
    END IF;

    IF v_aceptante.libre IS NOT TRUE THEN
      UPDATE public.clientes
      SET saldo_retenido = COALESCE(saldo_retenido, 0) + v_adicional,
          saldo_disponible = GREATEST(0, COALESCE(saldo_actual, 0) + COALESCE(aval, 0) - (COALESCE(saldo_retenido, 0) + v_adicional))
      WHERE id = v_aceptante.id;
    END IF;

    -- Actualizar ticket FIFO
    UPDATE public.chat_tickets_fifo
    SET estado = 'ACTIVO',
        monto_concretado = v_nuevo_monto_tk,
        riesgo_proponente = v_nuevo_monto_tk,
        riesgo_aceptante = v_nuevo_monto_tk,
        monto_pendiente_ampliacion = GREATEST(0, ROUND(COALESCE(v_tk.monto_pendiente_ampliacion, 0) - v_adicional, 2)),
        fue_ajuste_parcial = (v_nuevo_monto_tk < COALESCE(v_tk.monto_solicitado, v_nuevo_monto_tk))
    WHERE id = v_tk.id;

    v_total_ampliado := v_total_ampliado + v_adicional;

    IF v_tenia_previo AND v_nuevo_monto_tk >= COALESCE(v_tk.monto_solicitado, v_nuevo_monto_tk) THEN
      v_texto_item := 'Jugó Completo ' || TRIM(TO_CHAR(v_nuevo_monto_tk, 'FM999999990'));
    ELSE
      v_texto_item := 'Jugo ' || TRIM(TO_CHAR(v_nuevo_monto_tk, 'FM999999990'));
    END IF;

    v_lineas := array_append(v_lineas, v_texto_item);
    v_respuestas_grupo := v_respuestas_grupo || jsonb_build_array(
      jsonb_build_object(
        'texto', v_texto_item,
        'quotedMsgId', v_tk.whatsapp_concrecion_msg_id,
        'aceptanteId', v_tk.aceptante_id,
        'aceptanteNombre', v_tk.aceptante_nombre,
        'montoTotal', v_nuevo_monto_tk,
        'montoAdicional', v_adicional,
        'jugoCompleto', v_tenia_previo
      )
    );
  END LOOP;

  IF v_total_ampliado <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SIN_SALDO_PARA_AMPLIAR');
  END IF;

  UPDATE public.chat_mensajes
  SET monto_original = COALESCE(monto_original, 0) + v_total_ampliado,
      monto_disponible = 0,
      estado_propuesta = 'concretada'
  WHERE id = v_prop_id;

  RETURN jsonb_build_object(
    'ok', true,
    'propuesta_id', v_prop_id,
    'monto_ampliado', v_total_ampliado,
    'msg_publico', array_to_string(v_lineas, E'\n'),
    'msg_publico_bot', array_to_string(v_lineas, E'\n'),
    'respuestaPublica', array_to_string(v_lineas, E'\n'),
    'respuestas_grupo', v_respuestas_grupo,
    'notificaciones_privadas', v_notificaciones
  );
END;
$$;
