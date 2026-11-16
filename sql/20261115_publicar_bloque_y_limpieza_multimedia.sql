-- ============================================================================
-- RPC: publicar_bloque_propuestas_atomica & limpiar_multimedia_whatsapp_por_fechas
-- ============================================================================

-- 1. RPC para publicar múltiples propuestas en bloque de forma atómica
CREATE OR REPLACE FUNCTION public.publicar_bloque_propuestas_atomica(
  p_grupo_id uuid,
  p_sala_id uuid,
  p_carrera_id uuid,
  p_jugador_id uuid,
  p_propuestas jsonb,
  p_whatsapp_msg_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_cliente record;
  v_item jsonb;
  v_total_riesgo numeric := 0;
  v_riesgo_item numeric := 0;
  v_monto_item numeric := 0;
  v_prop_id uuid;
  v_propuestas_ids uuid[] := ARRAY[]::uuid[];
  v_nuevo_retenido numeric := 0;
  v_prop_texto text;
  v_accion text;
  v_modalidad text;
  v_proporcion text;
  v_es_match boolean;
BEGIN
  -- Bloquear y validar cliente
  SELECT * INTO v_cliente
  FROM public.clientes
  WHERE id = p_jugador_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CLIENTE_NO_ENCONTRADO');
  END IF;

  -- Calcular riesgo total del bloque
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_propuestas)
  LOOP
    v_monto_item := COALESCE((v_item->>'monto_solicitado')::numeric, 0);
    v_proporcion := COALESCE(v_item->>'proporcion', '1x1');
    v_accion := UPPER(COALESCE(v_item->>'accion', 'JUEGA'));

    IF v_monto_item > 0 THEN
      IF v_proporcion ~ '^10\/[0-9]+(\.[0-9]+)?$' AND v_accion = 'JUEGA' THEN
        v_riesgo_item := ROUND(v_monto_item * (SPLIT_PART(v_proporcion, '/', 2)::numeric / 10.0), 2);
      ELSE
        v_riesgo_item := v_monto_item;
      END IF;
      v_total_riesgo := v_total_riesgo + v_riesgo_item;
    END IF;
  END LOOP;

  -- Validar saldo disponible salvo si es libre
  IF NOT COALESCE(v_cliente.libre, false) THEN
    IF COALESCE(v_cliente.saldo_disponible, 0) < v_total_riesgo THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error', 'SALDO_INSUFICIENTE',
        'saldo_disponible', COALESCE(v_cliente.saldo_disponible, 0),
        'total_riesgo', v_total_riesgo
      );
    END IF;
  END IF;

  -- Insertar cada propuesta del bloque
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_propuestas)
  LOOP
    v_monto_item := COALESCE((v_item->>'monto_solicitado')::numeric, 0);
    IF v_monto_item > 0 THEN
      v_accion := UPPER(COALESCE(v_item->>'accion', 'JUEGA'));
      v_modalidad := COALESCE(v_item->>'modalidad', '1P');
      v_proporcion := COALESCE(v_item->>'proporcion', '1x1');
      v_es_match := COALESCE((v_item->>'es_match')::boolean, false);
      v_prop_texto := COALESCE(v_item->>'texto_estandarizado', v_item->>'ejemplar_texto', 'Propuesta');

      INSERT INTO public.chat_mensajes (
        grupo_id,
        sala_id,
        carrera_id,
        remitente_id,
        remitente_nombre,
        es_operador,
        tipo_mensaje,
        estado_propuesta,
        accion_proponente,
        modalidad_propuesta,
        es_match,
        proporcion,
        monto_original,
        monto_disponible,
        contenido,
        jugada_estandarizada,
        whatsapp_msg_id,
        origen_canal,
        created_at
      ) VALUES (
        p_grupo_id,
        p_sala_id,
        p_carrera_id,
        p_jugador_id,
        COALESCE(v_cliente.seudonimo, v_cliente.nombre, 'Jugador'),
        false,
        'propuesta_jugada',
        'abierta',
        v_accion,
        v_modalidad,
        v_es_match,
        v_proporcion,
        v_monto_item,
        v_monto_item,
        v_prop_texto,
        v_prop_texto,
        p_whatsapp_msg_id,
        'WHATSAPP',
        now()
      ) RETURNING id INTO v_prop_id;

      v_propuestas_ids := array_append(v_propuestas_ids, v_prop_id);
    END IF;
  END LOOP;

  -- Actualizar saldo retenido y disponible del cliente
  IF NOT COALESCE(v_cliente.libre, false) AND v_total_riesgo > 0 THEN
    v_nuevo_retenido := ROUND(COALESCE(v_cliente.saldo_retenido, 0) + v_total_riesgo, 2);
    UPDATE public.clientes
    SET saldo_retenido = v_nuevo_retenido,
        saldo_disponible = GREATEST(0, ROUND(COALESCE(saldo_actual, 0) + COALESCE(aval, 0) - v_nuevo_retenido, 2)),
        updated_at = now()
    WHERE id = p_jugador_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'propuestas_ids', v_propuestas_ids,
    'total_riesgo', v_total_riesgo,
    'cantidad', array_length(v_propuestas_ids, 1)
  );
END;
$$;

-- 2. RPC para limpiar multimedia de WhatsApp por rango de fechas
CREATE OR REPLACE FUNCTION public.limpiar_multimedia_whatsapp_por_fechas(
  p_fecha_inicio text,
  p_fecha_fin text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_eliminados int := 0;
  v_t_inicio timestamptz;
  v_t_fin timestamptz;
BEGIN
  v_t_inicio := (p_fecha_inicio || ' 00:00:00.000+00')::timestamptz;
  v_t_fin := (p_fecha_fin || ' 23:59:59.999+00')::timestamptz;

  WITH borrados AS (
    DELETE FROM public.chat_mensajes
    WHERE tipo_mensaje IN ('IMAGEN', 'AUDIO', 'NOTA_VOZ', 'imagen', 'audio', 'nota_voz')
      AND created_at >= v_t_inicio
      AND created_at <= v_t_fin
    RETURNING id
  )
  SELECT count(*) INTO v_eliminados FROM borrados;

  RETURN jsonb_build_object(
    'ok', true,
    'eliminados', v_eliminados,
    'fecha_inicio', p_fecha_inicio,
    'fecha_fin', p_fecha_fin
  );
END;
$$;
