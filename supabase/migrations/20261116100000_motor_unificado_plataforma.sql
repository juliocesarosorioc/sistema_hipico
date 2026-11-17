-- ============================================================================
-- MOTOR UNIFICADO PLATAFORMA HÍPICA (CEREBRO CENTRAL Y REGLAS DE NEGOCIO)
-- ============================================================================

-- 1. Tabla de Plantillas Personalizables de WhatsApp por Grupo (SaaS)
CREATE TABLE IF NOT EXISTS public.whatsapp_plantillas_grupo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grupo_id uuid NOT NULL,
  clave text NOT NULL,
  titulo text NOT NULL,
  contenido text NOT NULL,
  variables_disponibles text[] DEFAULT '{}',
  activo boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT uq_whatsapp_plantillas_grupo UNIQUE(grupo_id, clave)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_plantillas_grupo ON public.whatsapp_plantillas_grupo(grupo_id, clave);

-- 2. Actualización de publicar_propuesta_atomica: CERO RETENCIÓN AL PROPONER
-- Solo valida que saldo_disponible >= monto_solicitado, no retiene hasta concretar.
CREATE OR REPLACE FUNCTION public.publicar_propuesta_atomica(
  p_grupo_id uuid,
  p_sala_id uuid,
  p_carrera_id uuid,
  p_jugador_id uuid,
  p_accion text,
  p_es_match boolean,
  p_modalidad text,
  p_caballos_a text[],
  p_caballos_b text[],
  p_ejemplar_texto text,
  p_proporcion text,
  p_monto_solicitado numeric,
  p_texto_estandarizado text,
  p_whatsapp_msg_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_cliente record;
  v_sala record;
  v_apuesta_minima numeric := 10.00;
  v_propuesta_id uuid := gen_random_uuid();
  v_saldo_disp numeric := 0;
  v_monto_publicar numeric := p_monto_solicitado;
BEGIN
  -- Leer configuración de sala
  SELECT * INTO v_sala FROM public.salas_juego WHERE id = p_sala_id;
  v_apuesta_minima := COALESCE(v_sala.apuesta_minima, 10.00);

  -- Regla: Apuesta Mínima
  IF p_monto_solicitado < v_apuesta_minima THEN
    RETURN jsonb_build_object(
      'ok', false,
      'nada_aqui', true,
      'error', 'MONTO_MENOR_MINIMO',
      'msg_publico', '⛔ *Nada aquí* — El monto mínimo de apuesta es $' || TRIM(TO_CHAR(v_apuesta_minima, 'FM999999990.00')),
      'msg_publico_bot', '⛔ *Nada aquí* — El monto mínimo de apuesta es $' || TRIM(TO_CHAR(v_apuesta_minima, 'FM999999990.00'))
    );
  END IF;

  -- Validar existencia del jugador
  SELECT * INTO v_cliente
  FROM public.clientes
  WHERE id = p_jugador_id AND grupo_id = p_grupo_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'JUGADOR_NO_REGISTRADO',
      'msg_publico_bot', '🚫 *Nada Aquí* — Jugador no registrado en la nómina oficial del grupo.'
    );
  END IF;

  -- Calcular saldo disponible
  IF v_cliente.libre IS TRUE THEN
    v_saldo_disp := 999999999.00;
  ELSE
    v_saldo_disp := GREATEST(0, COALESCE(v_cliente.saldo_actual, 0) + COALESCE(v_cliente.aval, 0) - COALESCE(v_cliente.saldo_retenido, 0));
  END IF;

  IF v_saldo_disp <= 0 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'SALDO_INSUFICIENTE',
      'msg_publico_bot', '*Nada Aquí* — ' || v_cliente.nombre || ' no posee saldo disponible ($0,00)'
    );
  END IF;

  -- Topar al saldo disponible si excede
  IF v_monto_publicar > v_saldo_disp THEN
    v_monto_publicar := v_saldo_disp;
  END IF;

  -- CERO RETENCIÓN AL PROPONER: El saldo se retiene única y exclusivamente al concretar.

  -- Insertar en chat_mensajes
  INSERT INTO public.chat_mensajes (
    id,
    grupo_id,
    sala_id,
    carrera_id,
    remitente_id,
    remitente_nombre,
    es_bot,
    es_operador,
    tipo_mensaje,
    contenido,
    accion_proponente,
    es_match,
    modalidad_jugada,
    ejemplar_numero,
    caballos_bando_a,
    caballos_bando_b,
    proporcion_premio,
    monto_original,
    monto_disponible,
    estado_propuesta,
    jugada_estandarizada,
    whatsapp_msg_id,
    origen_canal
  ) VALUES (
    v_propuesta_id,
    p_grupo_id,
    p_sala_id,
    p_carrera_id,
    p_jugador_id,
    COALESCE(v_cliente.seudonimo, v_cliente.nombre),
    false,
    false,
    'propuesta_jugada',
    p_texto_estandarizado,
    COALESCE(p_accion, 'JUEGA'),
    COALESCE(p_es_match, false),
    COALESCE(p_modalidad, '1P'),
    p_ejemplar_texto,
    p_caballos_a,
    p_caballos_b,
    COALESCE(p_proporcion, '1x1'),
    v_monto_publicar,
    v_monto_publicar,
    'abierta',
    p_texto_estandarizado,
    p_whatsapp_msg_id,
    CASE WHEN p_whatsapp_msg_id IS NOT NULL THEN 'whatsapp' ELSE 'web' END
  );

  RETURN jsonb_build_object(
    'ok', true,
    'propuesta_id', v_propuesta_id,
    'monto_publicado', v_monto_publicar
  );
END;
$$;

-- 3. Actualización de concretar_jugada_fifo_atomica: RETENCIÓN EN AMBAS PARTES AL CONCRETAR
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
  v_proponente record;
  v_aceptante record;
  v_apuesta_minima numeric := 10.00;
  v_tiempo_vencimiento_min int := 5;
  v_remanente numeric := 0;
  v_saldo_disp_proponente numeric := 0;
  v_saldo_disp_aceptante numeric := 0;
  v_monto_efectivo numeric := 0;
  v_nuevo_remanente numeric := 0;
  v_ticket_id uuid := gen_random_uuid();
  v_codigo_ticket text;
  v_prop_raw text;
  v_prop_val numeric := 10.0;
  v_riesgo_proponente numeric := 0;
  v_riesgo_aceptante numeric := 0;
  v_nuevo_ret_aceptante numeric := 0;
  v_nuevo_ret_proponente numeric := 0;
BEGIN
  -- Leer configuración
  SELECT * INTO v_sala FROM public.salas_juego WHERE id = p_sala_id;
  v_apuesta_minima := COALESCE(v_sala.apuesta_minima, 10.00);
  v_tiempo_vencimiento_min := COALESCE(v_sala.tiempo_vencimiento_propuesta_min, v_sala.tiempo_vencimiento_min, 5);

  -- Bloquear propuesta
  SELECT * INTO v_prop
  FROM public.chat_mensajes
  WHERE id = p_propuesta_msg_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PROPUESTA_NO_EXISTE');
  END IF;

  v_remanente := COALESCE(v_prop.monto_disponible, 0);

  -- Regla: Vencimiento por Tiempo (X minutos)
  IF NOW() > (v_prop.created_at + (v_tiempo_vencimiento_min || ' minutes')::INTERVAL) THEN
    UPDATE public.chat_mensajes
    SET estado_propuesta = 'expirada',
        monto_disponible = 0
    WHERE id = p_propuesta_msg_id;

    RETURN jsonb_build_object(
      'ok', false,
      'nada_aqui', true,
      'error', 'FUERA_DE_TIEMPO',
      'msg_publico', '❌⏰ Nada aquí, fuera de tiempo',
      'msg_publico_bot', '❌⏰ Nada aquí, fuera de tiempo'
    );
  END IF;

  IF v_prop.estado_propuesta NOT IN ('abierta', 'parcial') OR v_remanente <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PROPUESTA_AGOTADA');
  END IF;

  -- Regla: Apuesta Mínima
  IF p_monto_pedido < v_apuesta_minima AND v_remanente >= v_apuesta_minima THEN
    RETURN jsonb_build_object(
      'ok', false,
      'nada_aqui', true,
      'error', 'MONTO_MENOR_MINIMO',
      'msg_publico', '⛔ *Nada aquí* — El monto mínimo de apuesta es $' || TRIM(TO_CHAR(v_apuesta_minima, 'FM999999990.00')),
      'msg_publico_bot', '⛔ *Nada aquí* — El monto mínimo de apuesta es $' || TRIM(TO_CHAR(v_apuesta_minima, 'FM999999990.00'))
    );
  END IF;

  -- Bloquear y validar proponente
  SELECT * INTO v_proponente
  FROM public.clientes
  WHERE id = v_prop.remitente_id AND grupo_id = p_grupo_id
  FOR UPDATE;

  -- Bloquear y validar aceptante
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

  IF v_proponente.libre IS TRUE THEN
    v_saldo_disp_proponente := 999999999.00;
  ELSE
    v_saldo_disp_proponente := GREATEST(0, COALESCE(v_proponente.saldo_actual, 0) + COALESCE(v_proponente.aval, 0) - COALESCE(v_proponente.saldo_retenido, 0));
  END IF;

  IF v_saldo_disp_aceptante <= 0 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'nada_aqui', true,
      'error', 'ACEPTANTE_SIN_SALDO',
      'msg_publico_bot', '*Nada Aquí* — ' || COALESCE(v_aceptante.seudonimo, v_aceptante.nombre) || ' no posee saldo disponible ($0,00)'
    );
  END IF;

  v_monto_efectivo := LEAST(p_monto_pedido, v_remanente, v_saldo_disp_aceptante, v_saldo_disp_proponente);

  IF v_monto_efectivo <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'MONTO_EFECTIVO_CERO');
  END IF;

  -- Calcular riesgo según proporción
  v_prop_raw := COALESCE(v_prop.proporcion_premio, '1x1');
  IF v_prop_raw ~ '^10[/a@\-]\d+' THEN
    v_prop_val := SUBSTRING(v_prop_raw FROM '\d+$')::numeric;
    IF v_prop.accion_proponente = 'CONSIGUE' THEN
      v_riesgo_proponente := v_monto_efectivo;
      v_riesgo_aceptante := ROUND(v_monto_efectivo * (v_prop_val / 10.0), 2);
    ELSE
      v_riesgo_proponente := ROUND(v_monto_efectivo * (v_prop_val / 10.0), 2);
      v_riesgo_aceptante := v_monto_efectivo;
    END IF;
  ELSE
    v_riesgo_proponente := v_monto_efectivo;
    v_riesgo_aceptante := v_monto_efectivo;
  END IF;

  v_nuevo_remanente := v_remanente - v_monto_efectivo;

  -- Actualizar estado de la propuesta
  UPDATE public.chat_mensajes
  SET monto_disponible = v_nuevo_remanente,
      estado_propuesta = CASE WHEN v_nuevo_remanente <= 0 THEN 'cerrada' ELSE 'parcial' END
  WHERE id = p_propuesta_msg_id;

  -- RETENER RIESGO ATÓMICO EN AMBAS PARTES
  IF v_proponente.libre IS NOT TRUE THEN
    v_nuevo_ret_proponente := COALESCE(v_proponente.saldo_retenido, 0) + v_riesgo_proponente;
    UPDATE public.clientes
    SET saldo_retenido = v_nuevo_ret_proponente,
        saldo_disponible = GREATEST(0, COALESCE(saldo_actual, 0) + COALESCE(aval, 0) - v_nuevo_ret_proponente)
    WHERE id = v_proponente.id;
  END IF;

  IF v_aceptante.libre IS NOT TRUE THEN
    v_nuevo_ret_aceptante := COALESCE(v_aceptante.saldo_retenido, 0) + v_riesgo_aceptante;
    UPDATE public.clientes
    SET saldo_retenido = v_nuevo_ret_aceptante,
        saldo_disponible = GREATEST(0, COALESCE(saldo_actual, 0) + COALESCE(aval, 0) - v_nuevo_ret_aceptante)
    WHERE id = v_aceptante.id;
  END IF;

  v_codigo_ticket := 'TK-' || SUBSTRING(v_ticket_id::text, 1, 8);

  -- Registrar ticket en chat_tickets_fifo
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
    riesgo_proponente,
    riesgo_aceptante,
    estado,
    whatsapp_concrecion_msg_id
  ) VALUES (
    v_ticket_id,
    v_codigo_ticket,
    p_grupo_id,
    p_sala_id,
    COALESCE(v_prop.carrera_id, v_sala.carrera_activa_id),
    p_propuesta_msg_id,
    v_prop.remitente_id,
    COALESCE(v_proponente.seudonimo, v_proponente.nombre),
    p_aceptante_id,
    COALESCE(v_aceptante.seudonimo, v_aceptante.nombre),
    v_prop.accion_proponente,
    v_prop.es_match,
    v_prop.modalidad_jugada,
    v_prop.ejemplar_numero,
    v_prop.caballos_bando_a,
    v_prop.caballos_bando_b,
    v_prop.proporcion_premio,
    v_prop.monto_original,
    v_monto_efectivo,
    v_riesgo_proponente,
    v_riesgo_aceptante,
    'ACTIVO',
    p_whatsapp_concrecion_msg_id
  );

  RETURN jsonb_build_object(
    'ok', true,
    'ticket_id', v_ticket_id,
    'codigo_ticket', v_codigo_ticket,
    'monto_concretado', v_monto_efectivo,
    'remanente', v_nuevo_remanente,
    'riesgo_proponente', v_riesgo_proponente,
    'riesgo_aceptante', v_riesgo_aceptante,
    'proponente_nombre', COALESCE(v_proponente.seudonimo, v_proponente.nombre),
    'aceptante_nombre', COALESCE(v_aceptante.seudonimo, v_aceptante.nombre)
  );
END;
$$;
