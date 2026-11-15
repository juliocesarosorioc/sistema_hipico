-- RPC atómica para cerrar una propuesta específica (con cita) o todas las abiertas (sin cita) al comando "Se fue"
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
  v_liberado numeric := 0;
  v_nuevo_retenido numeric := 0;
  v_canceladas_ids uuid[] := ARRAY[]::uuid[];
  v_nombre text;
  v_msg_publico text;
  v_msg_privado text;
BEGIN
  SELECT * INTO v_cliente
  FROM public.clientes
  WHERE id = p_jugador_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'JUGADOR_NO_ENCONTRADO');
  END IF;

  v_nombre := COALESCE(NULLIF(trim(v_cliente.seudonimo), ''), v_cliente.nombre, 'Jugador');

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

    v_msg_publico := format('🚫 *Se Fue* — %s retiró su propuesta (%s).', v_nombre, COALESCE(v_prop.jugada_estandarizada, v_prop.contenido, 'propuesta'));
    v_msg_privado := format('✅ Tu propuesta (%s) fue retirada ("Se fue"). Saldo liberado: $%s.', COALESCE(v_prop.jugada_estandarizada, v_prop.contenido, 'propuesta'), trim(to_char(v_liberado, '999999990.00')));
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
    END LOOP;

    v_msg_publico := format('🚫 *Se Fue* — Todas las propuestas abiertas de %s fueron retiradas.', v_nombre);
    v_msg_privado := format('✅ Todas tus propuestas abiertas fueron retiradas ("Se fue"). Saldo liberado: $%s.', trim(to_char(v_liberado, '999999990.00')));
  END IF;

  IF NOT COALESCE(v_cliente.libre, false) AND v_liberado > 0 THEN
    v_nuevo_retenido := GREATEST(0, ROUND(COALESCE(v_cliente.saldo_retenido, 0) - v_liberado, 2));
    UPDATE public.clientes
    SET saldo_retenido = v_nuevo_retenido,
        saldo_disponible = GREATEST(0, ROUND(COALESCE(saldo_actual, 0) + COALESCE(aval, 0) - v_nuevo_retenido, 2))
    WHERE id = p_jugador_id;
  END IF;

  INSERT INTO public.chat_mensajes (
    grupo_id, sala_id, remitente_nombre, es_operador, tipo_mensaje, estado_propuesta, contenido, origen_canal
  ) VALUES (
    p_grupo_id, p_sala_id, '🤖 ASISTENTE DE SALA', true, 'concrecion_fifo', 'no_aplica', v_msg_publico
  );

  RETURN jsonb_build_object(
    'ok', true,
    'canceladas', array_length(v_canceladas_ids, 1),
    'canceladas_ids', v_canceladas_ids,
    'monto_liberado', v_liberado,
    'msg_publico_bot', v_msg_publico,
    'msg_privado_bot', v_msg_privado
  );
END;
$$;
