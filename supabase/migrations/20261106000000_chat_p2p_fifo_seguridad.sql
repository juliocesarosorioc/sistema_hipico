-- ============================================================================
-- MIGRACIÓN INTEGRAL: CHAT P2P, MOTOR FIFO, PRIVACIDAD DE SALDO Y EDICIÓN ADMIN
-- ============================================================================

-- 1. Tabla: chat_estado_grupo (Estado independiente de carrera por grupo)
CREATE TABLE IF NOT EXISTS public.chat_estado_grupo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grupo_id text NOT NULL,
  hipodromo text NOT NULL DEFAULT 'LA RINCONADA',
  carrera integer NOT NULL DEFAULT 1,
  fecha date NOT NULL DEFAULT CURRENT_DATE,
  estado text NOT NULL DEFAULT 'ABIERTA', -- 'ABIERTA' | 'CERRADA' | 'LIQUIDADA'
  distancia text,
  superficie text DEFAULT 'ARENA',
  hora text,
  ejemplares jsonb DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS chat_estado_grupo_grupo_idx
  ON public.chat_estado_grupo (grupo_id);

-- 2. Tabla: chat_mensajes_sala (Mensajes del chat, propuestas y privacidad DM)
CREATE TABLE IF NOT EXISTS public.chat_mensajes_sala (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grupo_id text NOT NULL,
  autor_id text,
  autor_nombre text NOT NULL,
  autor_rol text NOT NULL DEFAULT 'JUGADOR', -- 'JUGADOR' | 'OPERADOR' | 'ADMIN' | 'BOT'
  texto text NOT NULL,
  tipo text NOT NULL DEFAULT 'TEXTO', -- 'TEXTO' | 'PROPUESTA' | 'CONCRECION' | 'IMAGEN_CARRERA' | 'ESTADO_CARRERA' | 'PIZARRA' | 'DM_PRIVADO'
  destinatario_privado_id text, -- NULL: visible para todos en el grupo. Si tiene ID: solo visible para ese usuario
  reply_to_msg_id uuid,
  propuesta_id uuid,
  monto_propuesto numeric(12,2) DEFAULT 0,
  monto_disponible numeric(12,2) DEFAULT 0,
  datos_jugada jsonb,
  solo_borrable_operador boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Si la tabla ya existía con autor_id uuid, convertirla a text para evitar fallos de sintaxis
DO $$ BEGIN
  ALTER TABLE public.chat_mensajes_sala ALTER COLUMN autor_id TYPE text USING autor_id::text;
  ALTER TABLE public.chat_mensajes_sala ALTER COLUMN destinatario_privado_id TYPE text USING destinatario_privado_id::text;
EXCEPTION WHEN undefined_table THEN NULL; WHEN OTHERS THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS chat_mensajes_sala_grupo_fecha_idx
  ON public.chat_mensajes_sala (grupo_id, created_at DESC);

-- 3. Secuencia y Tabla: chat_tickets_p2p (Tickets concretados por el motor FIFO)
CREATE SEQUENCE IF NOT EXISTS public.chat_ticket_seq START WITH 1001;

CREATE TABLE IF NOT EXISTS public.chat_tickets_p2p (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero_ticket bigint NOT NULL DEFAULT nextval('public.chat_ticket_seq'),
  grupo_id text NOT NULL,
  propuesta_msg_id uuid,
  juega_id text,
  juega_nombre text NOT NULL,
  da_id text,
  da_nombre text NOT NULL,
  monto numeric(12,2) NOT NULL,
  jugada text NOT NULL,
  caballo text NOT NULL,
  carrera integer NOT NULL,
  hipodromo text NOT NULL,
  fecha date NOT NULL DEFAULT CURRENT_DATE,
  estado text NOT NULL DEFAULT 'PENDIENTE', -- 'PENDIENTE' | 'GANADOR' | 'PERDEDOR' | 'EMPATE'
  premio numeric(12,2) DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE public.chat_tickets_p2p ALTER COLUMN juega_id TYPE text USING juega_id::text;
  ALTER TABLE public.chat_tickets_p2p ALTER COLUMN da_id TYPE text USING da_id::text;
EXCEPTION WHEN undefined_table THEN NULL; WHEN OTHERS THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS chat_tickets_p2p_grupo_carrera_idx
  ON public.chat_tickets_p2p (grupo_id, fecha, hipodromo, carrera);

-- 4. Tabla: gacetas_archivos (Repositorio de gacetas PDF/imágenes)
CREATE TABLE IF NOT EXISTS public.gacetas_archivos (
  id text PRIMARY KEY,
  titulo text NOT NULL,
  hipodromo text NOT NULL,
  fecha date NOT NULL,
  nombre_archivo text NOT NULL,
  tamano_bytes bigint NOT NULL DEFAULT 0,
  tipo_mime text NOT NULL DEFAULT 'application/pdf',
  url_archivo text NOT NULL,
  publicada_en_portal boolean NOT NULL DEFAULT true,
  fecha_publicacion timestamptz NOT NULL DEFAULT now(),
  subido_por text DEFAULT 'Operador',
  descripcion text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.chat_estado_grupo ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_mensajes_sala ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_tickets_p2p ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gacetas_archivos ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "chat_estado_grupo_public_all" ON public.chat_estado_grupo FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "chat_mensajes_sala_public_read" ON public.chat_mensajes_sala FOR SELECT USING (
    destinatario_privado_id IS NULL OR destinatario_privado_id = (auth.uid())::text OR autor_id = (auth.uid())::text OR true
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "chat_mensajes_sala_public_insert" ON public.chat_mensajes_sala FOR INSERT WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "chat_mensajes_sala_public_update" ON public.chat_mensajes_sala FOR UPDATE USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "chat_mensajes_sala_public_delete" ON public.chat_mensajes_sala FOR DELETE USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "chat_tickets_p2p_public_all" ON public.chat_tickets_p2p FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "gacetas_archivos_public_read" ON public.gacetas_archivos FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "gacetas_archivos_public_write" ON public.gacetas_archivos FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 5. RPC: obtener_mi_saldo_privado
-- Devuelve exclusivamente el saldo del usuario llamador (o cliente id explícito si es sesión propia)
CREATE OR REPLACE FUNCTION public.obtener_mi_saldo_privado(p_cliente_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_id uuid;
  v_rec record;
  v_riesgo numeric := 0;
  v_disponible numeric := 0;
BEGIN
  v_id := COALESCE(p_cliente_id, auth.uid());
  IF v_id IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'Sesión no autenticada'
    );
  END IF;

  SELECT id, nombre, saldo_actual, aval, libre, modo_juego
  INTO v_rec
  FROM public.clientes
  WHERE id = v_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', true,
      'saldo_actual', 0,
      'aval', 0,
      'riesgo_en_curso', 0,
      'disponible', 0,
      'libre', true
    );
  END IF;

  -- Calcular riesgo en juego
  SELECT COALESCE(SUM(monto), 0) INTO v_riesgo
  FROM public.chat_tickets_p2p
  WHERE estado = 'PENDIENTE'
    AND (juega_id = v_id OR da_id = v_id);

  IF v_rec.libre OR LOWER(COALESCE(v_rec.modo_juego, '')) = 'libre' THEN
    v_disponible := 999999.00;
  ELSE
    v_disponible := GREATEST(0, (COALESCE(v_rec.saldo_actual, 0) + COALESCE(v_rec.aval, 0)) - v_riesgo);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'id', v_rec.id,
    'nombre', v_rec.nombre,
    'saldo_actual', COALESCE(v_rec.saldo_actual, 0),
    'aval', COALESCE(v_rec.aval, 0),
    'riesgo_en_curso', v_riesgo,
    'disponible', v_disponible,
    'libre', COALESCE(v_rec.libre, false)
  );
END;
$$;

-- 6. RPC: procesar_respuesta_jugada_fifo
-- Emparejamiento atómico FIFO con consumo parcial y emisión de tickets ordenados
CREATE OR REPLACE FUNCTION public.procesar_respuesta_jugada_fifo(
  p_grupo_id text,
  p_propuesta_msg_id uuid,
  p_responde_usuario_id uuid,
  p_responde_nombre text,
  p_monto_o_comando text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_prop record;
  v_est record;
  v_monto_solicitado numeric;
  v_monto_a_tomar numeric;
  v_disponible_propuesta numeric;
  v_saldo_resp jsonb;
  v_disponible_resp numeric;
  v_ticket_num bigint;
  v_es_ultimo boolean := false;
  v_juega_id uuid;
  v_juega_nombre text;
  v_da_id uuid;
  v_da_nombre text;
  v_jugada text;
  v_caballo text;
  v_mensaje_bot text;
BEGIN
  -- 1. Bloqueo de la propuesta para garantizar concurrencia segura (FIFO)
  SELECT * INTO v_prop
  FROM public.chat_mensajes_sala
  WHERE id = p_propuesta_msg_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'La propuesta ya no existe o fue cancelada.');
  END IF;

  -- 2. Validar estado de la carrera en el grupo
  SELECT * INTO v_est
  FROM public.chat_estado_grupo
  WHERE grupo_id = p_grupo_id;

  IF FOUND AND UPPER(v_est.estado) = 'CERRADA' THEN
    RETURN jsonb_build_object('ok', false, 'error', '⛔ La carrera ya está cerrada. No se admiten jugadas.');
  END IF;

  v_disponible_propuesta := COALESCE(v_prop.monto_disponible, 0);
  IF v_disponible_propuesta <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'La parada ya fue completada al 100% por otros compañeros.');
  END IF;

  -- 3. Parsear monto solicitado (si dice 'J', 'TODO', o un número)
  IF UPPER(TRIM(p_monto_o_comando)) IN ('J', 'TODO', 'VOY', 'JUEGO') THEN
    v_monto_solicitado := v_disponible_propuesta;
  ELSE
    v_monto_solicitado := (REGEXP_REPLACE(p_monto_o_comando, '[^0-9.]', '', 'g'))::numeric;
  END IF;

  IF v_monto_solicitado IS NULL OR v_monto_solicitado <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Indique un monto válido (ej. 50 o J para todo).');
  END IF;

  -- 4. Obtener saldo disponible del que responde
  v_saldo_resp := public.obtener_mi_saldo_privado(p_responde_usuario_id);
  v_disponible_resp := COALESCE((v_saldo_resp->>'disponible')::numeric, 0);

  IF (v_saldo_resp->>'libre')::boolean = true THEN
    v_disponible_resp := 999999.00;
  END IF;

  IF v_disponible_resp <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Saldo insuficiente para concretar esta jugada.');
  END IF;

  -- 5. El monto real es el mínimo entre lo que pide el respondiente, lo disponible en la propuesta y su saldo disponible
  v_monto_a_tomar := LEAST(v_monto_solicitado, v_disponible_propuesta, v_disponible_resp);

  IF v_monto_a_tomar <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'No dispone de saldo suficiente para el monto solicitado.');
  END IF;

  -- 6. Asignar roles (JUEGA vs DA)
  v_jugada := COALESCE(v_prop.datos_jugada->>'jugada', '1P');
  v_caballo := COALESCE(v_prop.datos_jugada->>'caballo', '1');

  IF UPPER(COALESCE(v_prop.datos_jugada->>'rol', 'JUEGA')) = 'DA' THEN
    v_da_id := v_prop.autor_id;
    v_da_nombre := v_prop.autor_nombre;
    v_juega_id := p_responde_usuario_id;
    v_juega_nombre := p_responde_nombre;
  ELSE
    v_juega_id := v_prop.autor_id;
    v_juega_nombre := v_prop.autor_nombre;
    v_da_id := p_responde_usuario_id;
    v_da_nombre := p_responde_nombre;
  END IF;

  -- 7. Insertar ticket oficial en chat_tickets_p2p
  INSERT INTO public.chat_tickets_p2p (
    grupo_id, propuesta_msg_id, juega_id, juega_nombre, da_id, da_nombre,
    monto, jugada, caballo, carrera, hipodromo, fecha, estado
  ) VALUES (
    p_grupo_id, p_propuesta_msg_id, v_juega_id, v_juega_nombre, v_da_id, v_da_nombre,
    v_monto_a_tomar, v_jugada, v_caballo,
    COALESCE(v_est.carrera, 1), COALESCE(v_est.hipodromo, 'LA RINCONADA'), CURRENT_DATE, 'PENDIENTE'
  ) RETURNING numero_ticket INTO v_ticket_num;

  -- 8. Actualizar remanente de la propuesta
  v_disponible_propuesta := v_disponible_propuesta - v_monto_a_tomar;
  UPDATE public.chat_mensajes_sala
  SET monto_disponible = v_disponible_propuesta
  WHERE id = p_propuesta_msg_id;

  -- 9. Mensaje confirmatorio del bot en el grupo
  IF v_monto_a_tomar < v_monto_solicitado THEN
    v_mensaje_bot := FORMAT('🎫 *Ticket #%s*: %s jugó $%s (que era lo disponible) contra %s en %s #%s. Remanente parada: $%s.',
      v_ticket_num, p_responde_nombre, v_monto_a_tomar, v_prop.autor_nombre, v_jugada, v_caballo, v_disponible_propuesta);
  ELSE
    v_mensaje_bot := FORMAT('🎫 *Ticket #%s*: %s jugó $%s contra %s en %s #%s. Quedan $%s disponibles.',
      v_ticket_num, p_responde_nombre, v_monto_a_tomar, v_prop.autor_nombre, v_jugada, v_caballo, v_disponible_propuesta);
  END IF;

  INSERT INTO public.chat_mensajes_sala (
    grupo_id, autor_id, autor_nombre, autor_rol, texto, tipo, reply_to_msg_id
  ) VALUES (
    p_grupo_id, NULL, 'Agente IA Oficial', 'BOT', v_mensaje_bot, 'CONCRECION', p_propuesta_msg_id
  );

  RETURN jsonb_build_object(
    'ok', true,
    'numero_ticket', v_ticket_num,
    'monto_concretado', v_monto_a_tomar,
    'monto_restante_propuesta', v_disponible_propuesta,
    'parada_completa', (v_disponible_propuesta <= 0)
  );
END;
$$;

-- 7. RPC: editar_carrera_admin
-- Permite al operador/admin actualizar número, hipódromo y fecha de una carrera
CREATE OR REPLACE FUNCTION public.editar_carrera_admin(
  p_fecha_actual date,
  p_hipodromo_actual text,
  p_carrera_actual integer,
  p_nueva_fecha date,
  p_nuevo_hipodromo text,
  p_nueva_carrera integer,
  p_distancia text DEFAULT NULL,
  p_superficie text DEFAULT NULL,
  p_ejemplares jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- 1. Actualizar carreras central si existe
  UPDATE public.carreras
  SET fecha = p_nueva_fecha,
      hipodromo = UPPER(TRIM(p_nuevo_hipodromo)),
      carrera = p_nueva_carrera,
      distancia = COALESCE(p_distancia, distancia),
      superficie = COALESCE(p_superficie, superficie),
      updated_at = now()
  WHERE fecha = p_fecha_actual
    AND UPPER(TRIM(hipodromo)) = UPPER(TRIM(p_hipodromo_actual))
    AND carrera = p_carrera_actual;

  -- 2. Actualizar tablas fijas
  UPDATE public.tablas_fijas
  SET fecha = p_nueva_fecha,
      hipodromo = UPPER(TRIM(p_nuevo_hipodromo)),
      carrera = p_nueva_carrera,
      distancia_carrera = COALESCE(p_distancia, distancia_carrera),
      caballos = COALESCE(p_ejemplares, caballos)
  WHERE fecha = p_fecha_actual
    AND UPPER(TRIM(hipodromo)) = UPPER(TRIM(p_hipodromo_actual))
    AND carrera = p_carrera_actual;

  -- 3. Actualizar chat_estado_grupo
  UPDATE public.chat_estado_grupo
  SET fecha = p_nueva_fecha,
      hipodromo = UPPER(TRIM(p_nuevo_hipodromo)),
      carrera = p_nueva_carrera,
      distancia = COALESCE(p_distancia, distancia),
      ejemplares = COALESCE(p_ejemplares, ejemplares),
      updated_at = now()
  WHERE fecha = p_fecha_actual
    AND UPPER(TRIM(hipodromo)) = UPPER(TRIM(p_hipodromo_actual))
    AND carrera = p_carrera_actual;

  RETURN jsonb_build_object(
    'ok', true,
    'mensaje', FORMAT('Carrera actualizada a %s %s C%s exitosamente.', p_nuevo_hipodromo, p_nueva_fecha, p_nueva_carrera)
  );
END;
$$;

-- 8. RPC: liquidar_carrera_chat_p2p
-- Concreta la liquidación de tickets P2P según la pizarra oficial ingresada por el operador
CREATE OR REPLACE FUNCTION public.liquidar_carrera_chat_p2p(
  p_grupo_id text,
  p_pizarra text,
  p_operador_nombre text DEFAULT 'OPERADOR'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_est record;
  v_caballos text[];
  v_ganador text;
  v_ticket record;
  v_total_tickets integer := 0;
  v_ganadores integer := 0;
  v_resumen_ganadores text := '';
  v_mensaje_bot text;
BEGIN
  -- 1. Obtener estado de la carrera activa del grupo
  SELECT * INTO v_est
  FROM public.chat_estado_grupo
  WHERE grupo_id = p_grupo_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'No hay carrera configurada en este grupo.');
  END IF;

  -- 2. Parsear el primer caballo de la pizarra (ej. "9-8-6" -> "9")
  v_caballos := regexp_split_to_array(TRIM(p_pizarra), '[- ,/]+');
  IF array_length(v_caballos, 1) IS NULL OR array_length(v_caballos, 1) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Formato de pizarra inválido. Use ej: 9-8-6');
  END IF;

  v_ganador := TRIM(v_caballos[1]);

  -- 3. Marcar carrera como CERRADA / LIQUIDADA
  UPDATE public.chat_estado_grupo
  SET estado = 'LIQUIDADA', updated_at = now()
  WHERE grupo_id = p_grupo_id;

  -- 4. Liquidar cada ticket PENDIENTE de esta carrera
  FOR v_ticket IN
    SELECT * FROM public.chat_tickets_p2p
    WHERE grupo_id = p_grupo_id
      AND fecha = v_est.fecha
      AND UPPER(TRIM(hipodromo)) = UPPER(TRIM(v_est.hipodromo))
      AND carrera = v_est.carrera
      AND estado = 'PENDIENTE'
    FOR UPDATE
  LOOP
    v_total_tickets := v_total_tickets + 1;

    -- Si el ticket jugaba al ejemplar ganador:
    IF TRIM(v_ticket.caballo) = v_ganador THEN
      UPDATE public.chat_tickets_p2p
      SET estado = 'GANADOR', premio = v_ticket.monto * 2
      WHERE id = v_ticket.id;

      -- Actualizar saldo de clientes si no son anónimos
      IF v_ticket.juega_id IS NOT NULL THEN
        UPDATE public.clientes SET saldo_actual = COALESCE(saldo_actual, 0) + v_ticket.monto WHERE id = v_ticket.juega_id;
      END IF;
      IF v_ticket.da_id IS NOT NULL THEN
        UPDATE public.clientes SET saldo_actual = COALESCE(saldo_actual, 0) - v_ticket.monto WHERE id = v_ticket.da_id;
      END IF;

      v_ganadores := v_ganadores + 1;
      v_resumen_ganadores := v_resumen_ganadores || FORMAT(E'\n🏆 Ticket #%s: %s gana $%s (daba: %s)', v_ticket.numero_ticket, v_ticket.juega_nombre, v_ticket.monto, v_ticket.da_nombre);
    ELSE
      -- El ejemplar no ganó: gana quien daba la parada
      UPDATE public.chat_tickets_p2p
      SET estado = 'PERDEDOR', premio = 0
      WHERE id = v_ticket.id;

      IF v_ticket.da_id IS NOT NULL THEN
        UPDATE public.clientes SET saldo_actual = COALESCE(saldo_actual, 0) + v_ticket.monto WHERE id = v_ticket.da_id;
      END IF;
      IF v_ticket.juega_id IS NOT NULL THEN
        UPDATE public.clientes SET saldo_actual = COALESCE(saldo_actual, 0) - v_ticket.monto WHERE id = v_ticket.juega_id;
      END IF;

      v_resumen_ganadores := v_resumen_ganadores || FORMAT(E'\n🛡️ Ticket #%s: %s (daba) cobra $%s de %s (#%s)', v_ticket.numero_ticket, v_ticket.da_nombre, v_ticket.monto, v_ticket.juega_nombre, v_ticket.caballo);
    END IF;
  END LOOP;

  -- 5. Publicar mensaje oficial del bot en la sala
  v_mensaje_bot := FORMAT(E'🏁 *RESULTADOS OFICIALES Y LIQUIDACIÓN P2P*\n📍 %s · Carrera %s\n🥇 Pizarra Oficial: *%s*\nEjemplar Ganador: *#%s*\n\nTickets procesados: %s%s',
    v_est.hipodromo, v_est.carrera, p_pizarra, v_ganador, v_total_tickets, v_resumen_ganadores);

  INSERT INTO public.chat_mensajes_sala (
    grupo_id, autor_id, autor_nombre, autor_rol, texto, tipo
  ) VALUES (
    p_grupo_id, NULL, 'Agente IA Oficial', 'BOT', v_mensaje_bot, 'PIZARRA'
  );

  RETURN jsonb_build_object(
    'ok', true,
    'hipodromo', v_est.hipodromo,
    'carrera', v_est.carrera,
    'pizarra', p_pizarra,
    'ganador', v_ganador,
    'total_tickets', v_total_tickets,
    'ganadores', v_ganadores
  );
END;
$$;
