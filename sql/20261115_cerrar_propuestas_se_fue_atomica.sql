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

    -- B. Citando una propuesta específica: silencio en grupo y silencio en privado (DM)
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
    END LOOP;

    -- A. Sin citar mensaje (retiro masivo): silencio en grupo, confirmación limpia al privado (DM)
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
    'canceladas', COALESCE(array_length(v_canceladas_ids, 1), 0),
    'canceladas_ids', v_canceladas_ids,
    'monto_liberado', v_liberado,
    'msg_publico_bot', v_msg_publico,
    'msg_privado_bot', v_msg_privado
  );
END;
$$;
