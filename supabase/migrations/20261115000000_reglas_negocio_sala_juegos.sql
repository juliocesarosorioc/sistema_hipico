-- ============================================================================
-- MIGRACIÓN: REGLAS DE NEGOCIO SALA DE JUEGOS Y CORTE DE PIZARRA DE MARCAS
-- ============================================================================

-- 1. Agregar columnas de configuración editables en salas_juego y grupos_venta
ALTER TABLE IF EXISTS public.salas_juego
  ADD COLUMN IF NOT EXISTS apuesta_minima NUMERIC(14,2) DEFAULT 10.00,
  ADD COLUMN IF NOT EXISTS tiempo_vencimiento_propuesta_min INT DEFAULT 5,
  ADD COLUMN IF NOT EXISTS tiempo_vencimiento_min INT DEFAULT 5,
  ADD COLUMN IF NOT EXISTS tope_caballos_marcas_nacional INT DEFAULT 5,
  ADD COLUMN IF NOT EXISTS tope_marcas_nacional INT DEFAULT 5,
  ADD COLUMN IF NOT EXISTS tope_caballos_marcas_internacional INT DEFAULT 4,
  ADD COLUMN IF NOT EXISTS tope_marcas_americano INT DEFAULT 4;

ALTER TABLE IF EXISTS public.grupos_venta
  ADD COLUMN IF NOT EXISTS apuesta_minima NUMERIC(14,2) DEFAULT 10.00,
  ADD COLUMN IF NOT EXISTS tiempo_vencimiento_propuesta_min INT DEFAULT 5,
  ADD COLUMN IF NOT EXISTS tope_caballos_marcas_nacional INT DEFAULT 5,
  ADD COLUMN IF NOT EXISTS tope_caballos_marcas_internacional INT DEFAULT 4;

-- Asegurar valores por defecto en filas existentes
UPDATE public.salas_juego
SET
  apuesta_minima = COALESCE(apuesta_minima, 10.00),
  tiempo_vencimiento_propuesta_min = COALESCE(tiempo_vencimiento_propuesta_min, tiempo_vencimiento_min, 5),
  tiempo_vencimiento_min = COALESCE(tiempo_vencimiento_min, tiempo_vencimiento_propuesta_min, 5),
  tope_caballos_marcas_nacional = COALESCE(tope_caballos_marcas_nacional, tope_marcas_nacional, 5),
  tope_marcas_nacional = COALESCE(tope_marcas_nacional, tope_caballos_marcas_nacional, 5),
  tope_caballos_marcas_internacional = COALESCE(tope_caballos_marcas_internacional, tope_marcas_americano, 4),
  tope_marcas_americano = COALESCE(tope_marcas_americano, tope_caballos_marcas_internacional, 4)
WHERE apuesta_minima IS NULL
   OR tiempo_vencimiento_propuesta_min IS NULL
   OR tope_caballos_marcas_nacional IS NULL
   OR tope_caballos_marcas_internacional IS NULL;

-- 2. RPC: cancelar_propuesta_proponente_atomica
CREATE OR REPLACE FUNCTION public.cancelar_propuesta_proponente_atomica(
  p_propuesta_msg_id uuid,
  p_jugador_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_prop record;
  v_cliente record;
  v_liberado numeric := 0;
  v_nuevo_retenido numeric := 0;
BEGIN
  SELECT * INTO v_prop
  FROM public.chat_mensajes
  WHERE id = p_propuesta_msg_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PROPUESTA_NO_EXISTE');
  END IF;

  IF v_prop.remitente_id <> p_jugador_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_AUTORIZADO');
  END IF;

  v_liberado := COALESCE(v_prop.monto_disponible, 0);

  UPDATE public.chat_mensajes
  SET estado_propuesta = 'cancelada',
      monto_disponible = 0
  WHERE id = p_propuesta_msg_id;

  SELECT * INTO v_cliente
  FROM public.clientes
  WHERE id = p_jugador_id
  FOR UPDATE;

  IF FOUND AND v_cliente.libre IS NOT TRUE AND v_liberado > 0 THEN
    v_nuevo_retenido := GREATEST(0, COALESCE(v_cliente.saldo_retenido, 0) - v_liberado);
    UPDATE public.clientes
    SET saldo_retenido = v_nuevo_retenido,
        saldo_disponible = GREATEST(0, COALESCE(saldo_actual, 0) + COALESCE(aval, 0) - v_nuevo_retenido)
    WHERE id = p_jugador_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'monto_liberado', v_liberado,
    'propuesta_id', p_propuesta_msg_id
  );
END;
$$;

-- 3. RPC: cancelar_todas_propuestas_proponente_atomica
CREATE OR REPLACE FUNCTION public.cancelar_todas_propuestas_proponente_atomica(
  p_sala_id uuid,
  p_jugador_id uuid,
  p_carrera_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_cliente record;
  v_total_liberado numeric := 0;
  v_nuevo_retenido numeric := 0;
BEGIN
  -- Sumar y cerrar todas las propuestas abiertas
  WITH cerradas AS (
    UPDATE public.chat_mensajes
    SET estado_propuesta = 'cancelada',
        monto_disponible = 0
    WHERE sala_id = p_sala_id
      AND remitente_id = p_jugador_id
      AND estado_propuesta IN ('abierta', 'parcial')
      AND monto_disponible > 0
      AND (p_carrera_id IS NULL OR carrera_id = p_carrera_id)
    RETURNING monto_disponible
  )
  SELECT COALESCE(SUM(monto_disponible), 0) INTO v_total_liberado FROM cerradas;

  SELECT * INTO v_cliente
  FROM public.clientes
  WHERE id = p_jugador_id
  FOR UPDATE;

  IF FOUND AND v_cliente.libre IS NOT TRUE AND v_total_liberado > 0 THEN
    v_nuevo_retenido := GREATEST(0, COALESCE(v_cliente.saldo_retenido, 0) - v_total_liberado);
    UPDATE public.clientes
    SET saldo_retenido = v_nuevo_retenido,
        saldo_disponible = GREATEST(0, COALESCE(saldo_actual, 0) + COALESCE(aval, 0) - v_nuevo_retenido)
    WHERE id = p_jugador_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'total_liberado', v_total_liberado
  );
END;
$$;

-- 4. RPC: publicar_propuesta_atomica (con validación de apuesta mínima)
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
  v_grupo record;
  v_apuesta_minima numeric := 10.00;
  v_propuesta_id uuid := gen_random_uuid();
  v_saldo_disp numeric := 0;
  v_monto_publicar numeric := p_monto_solicitado;
  v_nuevo_ret numeric := 0;
BEGIN
  -- Leer configuración de sala / grupo
  SELECT * INTO v_sala FROM public.salas_juego WHERE id = p_sala_id;
  SELECT * INTO v_grupo FROM public.grupos_venta WHERE id = p_grupo_id;

  v_apuesta_minima := COALESCE(v_sala.apuesta_minima, v_grupo.apuesta_minima, 10.00);

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

  -- Retener riesgo al proponente
  IF v_cliente.libre IS NOT TRUE THEN
    v_nuevo_ret := COALESCE(v_cliente.saldo_retenido, 0) + v_monto_publicar;
    UPDATE public.clientes
    SET saldo_retenido = v_nuevo_ret,
        saldo_disponible = GREATEST(0, COALESCE(saldo_actual, 0) + COALESCE(aval, 0) - v_nuevo_ret)
    WHERE id = p_jugador_id;
  END IF;

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
    v_cliente.nombre,
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

-- 5. RPC: concretar_jugada_fifo_atomica (con validación de vencimiento y apuesta mínima)
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
  v_monto_efectivo numeric := 0;
  v_nuevo_remanente numeric := 0;
  v_ticket_id uuid := gen_random_uuid();
  v_codigo_ticket text;
  v_nuevo_ret_aceptante numeric := 0;
  v_nuevo_ret_proponente numeric := 0;
BEGIN
  -- Leer configuración
  SELECT * INTO v_sala FROM public.salas_juego WHERE id = p_sala_id;
  SELECT * INTO v_grupo FROM public.grupos_venta WHERE id = p_grupo_id;

  v_apuesta_minima := COALESCE(v_sala.apuesta_minima, v_grupo.apuesta_minima, 10.00);
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

    -- Devolver saldo retenido no casado al proponente
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

  IF v_prop.estado_propuesta NOT IN ('abierta', 'parcial') OR v_remanente <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PROPUESTA_AGOTADA');
  END IF;

  -- Regla: Apuesta Mínima (salvo que el saldo restante de la propuesta sea menor)
  IF p_monto_pedido < v_apuesta_minima AND v_remanente >= v_apuesta_minima THEN
    RETURN jsonb_build_object(
      'ok', false,
      'nada_aqui', true,
      'error', 'MONTO_MENOR_MINIMO',
      'msg_publico', '⛔ *Nada aquí* — El monto mínimo de apuesta es $' || TRIM(TO_CHAR(v_apuesta_minima, 'FM999999990.00')),
      'msg_publico_bot', '⛔ *Nada aquí* — El monto mínimo de apuesta es $' || TRIM(TO_CHAR(v_apuesta_minima, 'FM999999990.00'))
    );
  END IF;

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

  IF v_saldo_disp_aceptante <= 0 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'nada_aqui', true,
      'error', 'ACEPTANTE_SIN_SALDO',
      'msg_publico_bot', '*Nada Aquí* — ' || v_aceptante.nombre || ' no posee saldo disponible ($0,00)'
    );
  END IF;

  v_monto_efectivo := LEAST(p_monto_pedido, v_remanente, v_saldo_disp_aceptante);

  IF v_monto_efectivo <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'MONTO_EFECTIVO_CERO');
  END IF;

  v_nuevo_remanente := v_remanente - v_monto_efectivo;

  -- Actualizar estado de la propuesta
  UPDATE public.chat_mensajes
  SET monto_disponible = v_nuevo_remanente,
      estado_propuesta = CASE WHEN v_nuevo_remanente <= 0 THEN 'cerrada' ELSE 'parcial' END
  WHERE id = p_propuesta_msg_id;

  -- Retener riesgo del aceptante
  IF v_aceptante.libre IS NOT TRUE THEN
    v_nuevo_ret_aceptante := COALESCE(v_aceptante.saldo_retenido, 0) + v_monto_efectivo;
    UPDATE public.clientes
    SET saldo_retenido = v_nuevo_ret_aceptante,
        saldo_disponible = GREATEST(0, COALESCE(saldo_actual, 0) + COALESCE(aval, 0) - v_nuevo_ret_aceptante)
    WHERE id = p_aceptante_id;
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
    p_monto_pedido,
    v_monto_efectivo,
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
    'remanente_propuesta', v_nuevo_remanente,
    'fue_recortado_por_remanente', (v_monto_efectivo < p_monto_pedido),
    'excedio_saldo_aceptante', (p_monto_pedido > v_saldo_disp_aceptante)
  );
END;
$$;

-- 5. Columna origen y políticas RLS en chat_mensajes para sincronización en vivo Web <-> WhatsApp
ALTER TABLE IF EXISTS public.chat_mensajes
  ADD COLUMN IF NOT EXISTS origen TEXT DEFAULT 'WEB';

ALTER TABLE IF EXISTS public.chat_mensajes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Permitir lectura publica chat_mensajes" ON public.chat_mensajes;
CREATE POLICY "Permitir lectura publica chat_mensajes"
  ON public.chat_mensajes
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Permitir insercion chat_mensajes" ON public.chat_mensajes;
CREATE POLICY "Permitir insercion chat_mensajes"
  ON public.chat_mensajes
  FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS "Permitir actualizacion chat_mensajes" ON public.chat_mensajes;
CREATE POLICY "Permitir actualizacion chat_mensajes"
  ON public.chat_mensajes
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

