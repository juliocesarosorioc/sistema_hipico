-- ============================================================================
-- MIGRACIÓN CONSOLIDADA DE SEGURIDAD, EDICIÓN DE CARRERAS, EVENTO LIBRE Y PURGA
-- Archivo: sql/migracion_seguridad_y_purga_produccion.sql
--
-- 100% IDEMPOTENTE Y RESILIENTE A ESQUEMAS PREEXISTENTES (Anti-Error 42703 / 42P13)
-- Incluye los 4 módulos de producción:
--   MÓDULO 1: Sesión Única, IP Única y Bloqueo por 3 Intentos Fallidos (30 min).
--   MÓDULO 2: Edición Transaccional en Cascada de Carreras Registradas.
--   MÓDULO 3: Esquema y Reversión Atómica de Evento Libre / Apuestas Especiales.
--   MÓDULO 4: Vaciado Seguro para Producción (Preservando Grupos, Operadores,
--             Catálogo de Hipódromos y Plan de Cuentas NIIF).
-- ============================================================================

BEGIN;

-- ============================================================================
-- MÓDULO 1: BLINDAJE DE SEGURIDAD, SESIÓN ÚNICA, IP ÚNICA Y ANTI-BRUTE FORCE
-- ============================================================================

-- 1.A Tabla usuario_sesion (con migración defensiva de columnas si ya existía)
CREATE TABLE IF NOT EXISTS public.usuario_sesion (
  id TEXT PRIMARY KEY,
  usuario_id TEXT,
  nombre TEXT,
  rol TEXT DEFAULT 'Operador',
  grupo_id TEXT,
  inicio_sesion TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ultimo_latido TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  ip TEXT,
  dispositivo TEXT,
  navegador TEXT,
  pagina_actual TEXT
);

ALTER TABLE public.usuario_sesion ADD COLUMN IF NOT EXISTS usuario_id TEXT;
ALTER TABLE public.usuario_sesion ADD COLUMN IF NOT EXISTS nombre TEXT;
ALTER TABLE public.usuario_sesion ADD COLUMN IF NOT EXISTS rol TEXT DEFAULT 'Operador';
ALTER TABLE public.usuario_sesion ADD COLUMN IF NOT EXISTS grupo_id TEXT;
ALTER TABLE public.usuario_sesion ADD COLUMN IF NOT EXISTS inicio_sesion TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.usuario_sesion ADD COLUMN IF NOT EXISTS ultimo_latido TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.usuario_sesion ADD COLUMN IF NOT EXISTS activo BOOLEAN DEFAULT TRUE;
ALTER TABLE public.usuario_sesion ADD COLUMN IF NOT EXISTS ip TEXT;
ALTER TABLE public.usuario_sesion ADD COLUMN IF NOT EXISTS dispositivo TEXT;
ALTER TABLE public.usuario_sesion ADD COLUMN IF NOT EXISTS navegador TEXT;
ALTER TABLE public.usuario_sesion ADD COLUMN IF NOT EXISTS pagina_actual TEXT;

CREATE INDEX IF NOT EXISTS idx_usuario_sesion_usuario ON public.usuario_sesion(usuario_id);
CREATE INDEX IF NOT EXISTS idx_usuario_sesion_latido ON public.usuario_sesion(ultimo_latido DESC);
CREATE INDEX IF NOT EXISTS idx_usuario_sesion_activo ON public.usuario_sesion(usuario_id, activo);

-- 1.B Tabla usuario_actividad (con migración defensiva de columnas si ya existía)
CREATE TABLE IF NOT EXISTS public.usuario_actividad (
  id BIGSERIAL PRIMARY KEY,
  sesion_id TEXT,
  usuario_id TEXT,
  nombre TEXT,
  rol TEXT,
  grupo_id TEXT,
  tipo TEXT DEFAULT 'ACCION',
  ruta TEXT,
  accion TEXT,
  detalle TEXT,
  ip TEXT,
  fecha TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.usuario_actividad ADD COLUMN IF NOT EXISTS sesion_id TEXT;
ALTER TABLE public.usuario_actividad ADD COLUMN IF NOT EXISTS usuario_id TEXT;
ALTER TABLE public.usuario_actividad ADD COLUMN IF NOT EXISTS nombre TEXT;
ALTER TABLE public.usuario_actividad ADD COLUMN IF NOT EXISTS rol TEXT;
ALTER TABLE public.usuario_actividad ADD COLUMN IF NOT EXISTS grupo_id TEXT;
ALTER TABLE public.usuario_actividad ADD COLUMN IF NOT EXISTS tipo TEXT DEFAULT 'ACCION';
ALTER TABLE public.usuario_actividad ADD COLUMN IF NOT EXISTS ruta TEXT;
ALTER TABLE public.usuario_actividad ADD COLUMN IF NOT EXISTS accion TEXT;
ALTER TABLE public.usuario_actividad ADD COLUMN IF NOT EXISTS detalle TEXT;
ALTER TABLE public.usuario_actividad ADD COLUMN IF NOT EXISTS ip TEXT;
ALTER TABLE public.usuario_actividad ADD COLUMN IF NOT EXISTS fecha TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_usuario_actividad_usuario_fecha ON public.usuario_actividad(usuario_id, fecha DESC);

-- 1.C Tabla usuario_intentos_login (recreada limpia para compatibilidad total usuario_id + identificador)
DROP TABLE IF EXISTS public.usuario_intentos_login CASCADE;
CREATE TABLE public.usuario_intentos_login (
  id BIGSERIAL PRIMARY KEY,
  usuario_id TEXT NOT NULL,
  identificador TEXT GENERATED ALWAYS AS (usuario_id) STORED,
  ip TEXT NOT NULL DEFAULT '0.0.0.0',
  intentos INTEGER NOT NULL DEFAULT 1,
  primer_intento TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ultimo_intento TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  bloqueado_hasta TIMESTAMPTZ,
  CONSTRAINT uq_intentos_usuario_ip UNIQUE (usuario_id, ip)
);

CREATE INDEX IF NOT EXISTS idx_intentos_login_usuario ON public.usuario_intentos_login(usuario_id);
CREATE INDEX IF NOT EXISTS idx_intentos_login_ip ON public.usuario_intentos_login(ip);

ALTER TABLE public.usuario_sesion ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usuario_actividad ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usuario_intentos_login ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "usuario_sesion_all" ON public.usuario_sesion;
CREATE POLICY "usuario_sesion_all" ON public.usuario_sesion FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "usuario_actividad_all" ON public.usuario_actividad;
CREATE POLICY "usuario_actividad_all" ON public.usuario_actividad FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "usuario_intentos_login_all" ON public.usuario_intentos_login;
CREATE POLICY "usuario_intentos_login_all" ON public.usuario_intentos_login FOR ALL USING (true) WITH CHECK (true);

-- Limpiar firmas previas de funciones RPC de sesión/login para evitar conflictos 42P13
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT oid::regprocedure AS proc_sig
    FROM pg_proc
    WHERE proname IN (
      'club_iniciar_sesion_segura',
      'club_registrar_latido_sesion',
      'club_registrar_intento_fallido',
      'club_limpiar_intentos_login',
      'club_actualizar_carrera_transaccional',
      'club_reversar_evento_especial'
    )
    AND pronamespace = 'public'::regnamespace
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.proc_sig || ' CASCADE';
  END LOOP;
END $$;

-- 1.1 RPC: Iniciar Sesión Segura (Invalida sesiones previas y fija IP de origen)
CREATE OR REPLACE FUNCTION public.club_iniciar_sesion_segura(
  p_sesion_id TEXT,
  p_usuario_id TEXT,
  p_nombre TEXT DEFAULT NULL,
  p_rol TEXT DEFAULT 'Operador',
  p_grupo_id TEXT DEFAULT NULL,
  p_ip TEXT DEFAULT '0.0.0.0',
  p_navegador TEXT DEFAULT NULL,
  p_dispositivo TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_bloqueo TIMESTAMPTZ;
  v_sesiones_cerradas INTEGER := 0;
BEGIN
  SELECT bloqueado_hasta INTO v_bloqueo
  FROM public.usuario_intentos_login
  WHERE (usuario_id = LOWER(TRIM(p_usuario_id)) OR (ip = p_ip AND p_ip <> '0.0.0.0' AND p_ip <> '127.0.0.1'))
    AND bloqueado_hasta > NOW()
  ORDER BY bloqueado_hasta DESC
  LIMIT 1;

  IF v_bloqueo IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'codigo', 'CUENTA_BLOQUEADA',
      'mensaje', 'Cuenta o IP bloqueada temporalmente por múltiples intentos fallidos.',
      'bloqueado_hasta', v_bloqueo,
      'segundos_restantes', EXTRACT(EPOCH FROM (v_bloqueo - NOW()))::INTEGER
    );
  END IF;

  -- Regla de Sesión Única: invalidar sesiones activas anteriores
  UPDATE public.usuario_sesion
  SET activo = FALSE
  WHERE usuario_id = p_usuario_id
    AND id <> p_sesion_id
    AND activo = TRUE;
  GET DIAGNOSTICS v_sesiones_cerradas = ROW_COUNT;

  INSERT INTO public.usuario_sesion (
    id, usuario_id, nombre, rol, grupo_id, inicio_sesion, ultimo_latido,
    activo, ip, navegador, dispositivo, pagina_actual
  ) VALUES (
    p_sesion_id, p_usuario_id, COALESCE(p_nombre, p_usuario_id), COALESCE(p_rol, 'Operador'), p_grupo_id,
    NOW(), NOW(), TRUE, p_ip, p_navegador, p_dispositivo, '/'
  )
  ON CONFLICT (id) DO UPDATE SET
    ultimo_latido = NOW(),
    activo = TRUE,
    ip = COALESCE(EXCLUDED.ip, public.usuario_sesion.ip);

  DELETE FROM public.usuario_intentos_login
  WHERE usuario_id = LOWER(TRIM(p_usuario_id));

  RETURN jsonb_build_object(
    'ok', true,
    'sesion_id', p_sesion_id,
    'ip_vinculada', p_ip,
    'sesiones_previas_cerradas', v_sesiones_cerradas
  );
END;
$$;

-- 1.2 RPC: Latido de Sesión con verificación de Sesión Única e IP Única
CREATE OR REPLACE FUNCTION public.club_registrar_latido_sesion(
  p_sesion_id TEXT,
  p_usuario_id TEXT,
  p_nombre TEXT DEFAULT NULL,
  p_rol TEXT DEFAULT 'Operador',
  p_grupo_id TEXT DEFAULT NULL,
  p_pagina TEXT DEFAULT NULL,
  p_ip TEXT DEFAULT NULL,
  p_navegador TEXT DEFAULT NULL,
  p_dispositivo TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_ip_registrada TEXT;
  v_activo BOOLEAN;
BEGIN
  SELECT ip, activo INTO v_ip_registrada, v_activo
  FROM public.usuario_sesion
  WHERE id = p_sesion_id;

  IF FOUND AND v_activo = FALSE THEN
    RETURN jsonb_build_object(
      'ok', false,
      'sesion_valida', false,
      'codigo', 'SESION_INVALIDADA',
      'mensaje', 'La sesión fue cerrada porque se inició sesión en otro dispositivo.'
    );
  END IF;

  IF FOUND
     AND v_ip_registrada IS NOT NULL
     AND v_ip_registrada <> ''
     AND v_ip_registrada <> '0.0.0.0'
     AND v_ip_registrada <> '127.0.0.1'
     AND p_ip IS NOT NULL
     AND p_ip <> ''
     AND p_ip <> '0.0.0.0'
     AND p_ip <> '127.0.0.1'
     AND v_ip_registrada <> p_ip
  THEN
    UPDATE public.usuario_sesion SET activo = FALSE WHERE id = p_sesion_id;

    INSERT INTO public.usuario_actividad (
      sesion_id, usuario_id, nombre, rol, grupo_id, tipo, accion, detalle, ip, fecha
    ) VALUES (
      p_sesion_id, p_usuario_id, COALESCE(p_nombre, p_usuario_id), COALESCE(p_rol, 'Operador'), p_grupo_id,
      'ACCION', 'ALERTA_SEGURIDAD: CAMBIO_IP_SESION',
      'Cambio de IP detectado: ' || v_ip_registrada || ' -> ' || p_ip || '. Sesión cerrada inmediatamente.',
      p_ip, NOW()
    );

    RETURN jsonb_build_object(
      'ok', false,
      'sesion_valida', false,
      'codigo', 'IP_CAMBIADA',
      'mensaje', 'Se detectó un cambio de dirección IP. Por seguridad la sesión fue cerrada.',
      'ip_original', v_ip_registrada,
      'ip_nueva', p_ip
    );
  END IF;

  UPDATE public.usuario_sesion
  SET activo = FALSE
  WHERE usuario_id = p_usuario_id
    AND id <> p_sesion_id
    AND activo = TRUE;

  INSERT INTO public.usuario_sesion (
    id, usuario_id, nombre, rol, grupo_id, inicio_sesion, ultimo_latido,
    activo, pagina_actual, ip, navegador, dispositivo
  ) VALUES (
    p_sesion_id, p_usuario_id, COALESCE(p_nombre, p_usuario_id), COALESCE(p_rol, 'Operador'), p_grupo_id,
    NOW(), NOW(), TRUE, p_pagina, p_ip, p_navegador, p_dispositivo
  )
  ON CONFLICT (id) DO UPDATE SET
    nombre = COALESCE(EXCLUDED.nombre, public.usuario_sesion.nombre),
    rol = COALESCE(EXCLUDED.rol, public.usuario_sesion.rol),
    grupo_id = COALESCE(EXCLUDED.grupo_id, public.usuario_sesion.grupo_id),
    ultimo_latido = NOW(),
    activo = TRUE,
    pagina_actual = COALESCE(EXCLUDED.pagina_actual, public.usuario_sesion.pagina_actual),
    ip = COALESCE(public.usuario_sesion.ip, EXCLUDED.ip),
    navegador = COALESCE(EXCLUDED.navegador, public.usuario_sesion.navegador),
    dispositivo = COALESCE(EXCLUDED.dispositivo, public.usuario_sesion.dispositivo);

  RETURN jsonb_build_object('ok', true, 'sesion_valida', true, 'sesion_id', p_sesion_id);
END;
$$;

-- 1.3 RPC: Registrar Intento Fallido de Contraseña (3 intentos = Bloqueo 30 min)
CREATE OR REPLACE FUNCTION public.club_registrar_intento_fallido(
  p_usuario_id TEXT,
  p_ip TEXT DEFAULT '0.0.0.0'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_intentos INTEGER;
  v_bloqueado_hasta TIMESTAMPTZ := NULL;
  v_ip TEXT := COALESCE(NULLIF(TRIM(p_ip), ''), '0.0.0.0');
  v_uid TEXT := LOWER(TRIM(COALESCE(p_usuario_id, 'desconocido')));
BEGIN
  INSERT INTO public.usuario_intentos_login (
    usuario_id, ip, intentos, primer_intento, ultimo_intento, bloqueado_hasta
  ) VALUES (
    v_uid, v_ip, 1, NOW(), NOW(), NULL
  )
  ON CONFLICT (usuario_id, ip) DO UPDATE SET
    intentos = CASE
      WHEN public.usuario_intentos_login.bloqueado_hasta IS NOT NULL
           AND public.usuario_intentos_login.bloqueado_hasta <= NOW()
      THEN 1
      ELSE public.usuario_intentos_login.intentos + 1
    END,
    primer_intento = CASE
      WHEN public.usuario_intentos_login.bloqueado_hasta IS NOT NULL
           AND public.usuario_intentos_login.bloqueado_hasta <= NOW()
      THEN NOW()
      ELSE public.usuario_intentos_login.primer_intento
    END,
    ultimo_intento = NOW(),
    bloqueado_hasta = CASE
      WHEN (
        CASE
          WHEN public.usuario_intentos_login.bloqueado_hasta IS NOT NULL
               AND public.usuario_intentos_login.bloqueado_hasta <= NOW()
          THEN 1
          ELSE public.usuario_intentos_login.intentos + 1
        END
      ) >= 3
      THEN NOW() + INTERVAL '30 minutes'
      ELSE NULL
    END
  RETURNING intentos, bloqueado_hasta INTO v_intentos, v_bloqueado_hasta;

  IF v_bloqueado_hasta IS NOT NULL THEN
    INSERT INTO public.usuario_actividad (
      sesion_id, usuario_id, nombre, rol, tipo, accion, detalle, ip, fecha
    ) VALUES (
      'seguridad_sistema', v_uid, v_uid, 'SEGURIDAD',
      'ACCION', 'ALERTA_SEGURIDAD: BLOQUEO_INTENTOS_FALLIDOS',
      'Cuenta e IP bloqueadas por 30 minutos tras 3 intentos fallidos consecutivos.',
      v_ip, NOW()
    );
  END IF;

  RETURN jsonb_build_object(
    'intentos', v_intentos,
    'bloqueado', v_bloqueado_hasta IS NOT NULL,
    'bloqueado_hasta', v_bloqueado_hasta,
    'intentos_restantes', GREATEST(0, 3 - v_intentos)
  );
END;
$$;

-- 1.4 RPC: Limpiar intentos fallidos tras login exitoso
CREATE OR REPLACE FUNCTION public.club_limpiar_intentos_login(
  p_identificador TEXT,
  p_ip TEXT DEFAULT '0.0.0.0'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM public.usuario_intentos_login
  WHERE usuario_id = LOWER(TRIM(COALESCE(p_identificador, '')))
     OR (ip = TRIM(COALESCE(p_ip, '')) AND p_ip <> '0.0.0.0' AND p_ip <> '127.0.0.1');
END;
$$;

-- ============================================================================
-- MÓDULO 2: EDICIÓN MANUAL DE CARRERAS REGISTRADAS (RPC TRANSACCIONAL CASCADA)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.club_actualizar_carrera_transaccional(
  p_id UUID DEFAULT NULL,
  p_fecha_antigua DATE DEFAULT NULL,
  p_hipodromo_antiguo TEXT DEFAULT NULL,
  p_carrera_antigua INTEGER DEFAULT NULL,
  p_fecha_nueva DATE DEFAULT NULL,
  p_hipodromo_nuevo TEXT DEFAULT NULL,
  p_carrera_nueva INTEGER DEFAULT NULL,
  p_distancia_nueva TEXT DEFAULT NULL,
  p_hora_nueva TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_carrera_id UUID;
  v_fecha_ant DATE;
  v_hipo_ant TEXT;
  v_num_ant INTEGER;
  v_hipodromo_id UUID := NULL;
BEGIN
  IF p_id IS NOT NULL THEN
    SELECT id, fecha, hipodromo, carrera
    INTO v_carrera_id, v_fecha_ant, v_hipo_ant, v_num_ant
    FROM public.carreras
    WHERE id = p_id
    FOR UPDATE;
  ELSE
    SELECT id, fecha, hipodromo, carrera
    INTO v_carrera_id, v_fecha_ant, v_hipo_ant, v_num_ant
    FROM public.carreras
    WHERE fecha = p_fecha_antigua
      AND UPPER(TRIM(hipodromo)) = UPPER(TRIM(p_hipodromo_antiguo))
      AND carrera = p_carrera_antigua
    FOR UPDATE;
  END IF;

  IF v_carrera_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'No se encontró la carrera especificada.');
  END IF;

  IF to_regclass('public.hipodromos') IS NOT NULL THEN
    SELECT id INTO v_hipodromo_id
    FROM public.hipodromos
    WHERE UPPER(TRIM(nombre)) = UPPER(TRIM(COALESCE(p_hipodromo_nuevo, v_hipo_ant)))
    LIMIT 1;
  END IF;

  UPDATE public.carreras
  SET fecha = COALESCE(p_fecha_nueva, fecha),
      hipodromo = UPPER(TRIM(COALESCE(p_hipodromo_nuevo, hipodromo))),
      carrera = COALESCE(p_carrera_nueva, carrera),
      distancia = COALESCE(p_distancia_nueva, distancia),
      hora = COALESCE(p_hora_nueva, hora)
  WHERE id = v_carrera_id;

  IF to_regclass('public.tablas_fijas') IS NOT NULL THEN
    UPDATE public.tablas_fijas
    SET fecha = COALESCE(p_fecha_nueva, fecha),
        hipodromo = UPPER(TRIM(COALESCE(p_hipodromo_nuevo, hipodromo))),
        carrera = COALESCE(p_carrera_nueva, carrera)
    WHERE fecha = v_fecha_ant
      AND UPPER(TRIM(hipodromo)) = UPPER(TRIM(v_hipo_ant))
      AND carrera = v_num_ant;
  END IF;

  IF to_regclass('public.resultados_carreras') IS NOT NULL THEN
    UPDATE public.resultados_carreras
    SET fecha = COALESCE(p_fecha_nueva, fecha),
        hipodromo = UPPER(TRIM(COALESCE(p_hipodromo_nuevo, hipodromo))),
        carrera = COALESCE(p_carrera_nueva, carrera)
    WHERE fecha = v_fecha_ant
      AND UPPER(TRIM(hipodromo)) = UPPER(TRIM(v_hipo_ant))
      AND carrera = v_num_ant;
  END IF;

  IF to_regclass('public.jugadas') IS NOT NULL THEN
    UPDATE public.jugadas
    SET fecha = COALESCE(p_fecha_nueva::text, fecha::text)::date,
        hipodromo = UPPER(TRIM(COALESCE(p_hipodromo_nuevo, hipodromo))),
        carrera = COALESCE(p_carrera_nueva, carrera)
    WHERE fecha = v_fecha_ant
      AND UPPER(TRIM(hipodromo)) = UPPER(TRIM(v_hipo_ant))
      AND carrera = v_num_ant;
  END IF;

  IF to_regclass('public.marcas_carrera') IS NOT NULL THEN
    UPDATE public.marcas_carrera
    SET fecha = COALESCE(p_fecha_nueva, fecha),
        hipodromo = UPPER(TRIM(COALESCE(p_hipodromo_nuevo, hipodromo))),
        carrera = COALESCE(p_carrera_nueva, carrera)
    WHERE fecha = v_fecha_ant
      AND UPPER(TRIM(hipodromo)) = UPPER(TRIM(v_hipo_ant))
      AND carrera = v_num_ant;
  END IF;

  IF to_regclass('public.remates') IS NOT NULL THEN
    UPDATE public.remates
    SET fecha = COALESCE(p_fecha_nueva, fecha),
        hipodromo = UPPER(TRIM(COALESCE(p_hipodromo_nuevo, hipodromo))),
        carrera = COALESCE(p_carrera_nueva, carrera)
    WHERE fecha = v_fecha_ant
      AND UPPER(TRIM(hipodromo)) = UPPER(TRIM(v_hipo_ant))
      AND carrera = v_num_ant;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'carrera_id', v_carrera_id,
    'hipodromo_id', v_hipodromo_id
  );
END;
$$;

-- ============================================================================
-- MÓDULO 3: PERFECCIONAMIENTO DE EVENTO LIBRE Y APUESTAS ESPECIALES
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.apuestas_eventos_especiales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha DATE NOT NULL DEFAULT CURRENT_DATE,
  evento TEXT NOT NULL,
  cliente_id TEXT,
  cliente_nombre TEXT NOT NULL,
  monto NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (monto >= 0),
  logro_cuota TEXT,
  pago_potencial NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (pago_potencial >= 0),
  estado TEXT NOT NULL DEFAULT 'PENDIENTE' CHECK (estado IN ('PENDIENTE', 'GANADOR', 'PERDEDOR', 'ANULADA')),
  ganador_seleccionado BOOLEAN NOT NULL DEFAULT FALSE,
  fecha_liquidacion TIMESTAMPTZ,
  nota TEXT,
  creado_por TEXT,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION public.club_reversar_evento_especial(
  p_apuesta_id UUID,
  p_motivo TEXT DEFAULT 'Reversión administrativa'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_apuesta RECORD;
  v_diferencia NUMERIC(12, 2) := 0;
BEGIN
  SELECT * INTO v_apuesta
  FROM public.apuestas_eventos_especiales
  WHERE id = p_apuesta_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Apuesta o evento especial no encontrado');
  END IF;

  IF v_apuesta.estado = 'ANULADA' THEN
    RETURN jsonb_build_object('ok', true, 'mensaje', 'El evento ya se encontraba anulado');
  END IF;

  IF v_apuesta.estado = 'GANADOR' AND v_apuesta.cliente_id IS NOT NULL THEN
    v_diferencia := GREATEST(0, COALESCE(v_apuesta.pago_potencial, 0) - COALESCE(v_apuesta.monto, 0));
    UPDATE public.clientes
    SET saldo_actual = COALESCE(saldo_actual, 0) - v_diferencia
    WHERE id::text = v_apuesta.cliente_id;
  ELSIF v_apuesta.estado = 'PERDEDOR' AND v_apuesta.cliente_id IS NOT NULL THEN
    v_diferencia := COALESCE(v_apuesta.monto, 0);
    UPDATE public.clientes
    SET saldo_actual = COALESCE(saldo_actual, 0) + v_diferencia
    WHERE id::text = v_apuesta.cliente_id;
  END IF;

  UPDATE public.apuestas_eventos_especiales
  SET estado = 'ANULADA',
      ganador_seleccionado = FALSE,
      actualizado_en = NOW(),
      nota = COALESCE(nota || ' | ', '') || 'ANULADA: ' || p_motivo
  WHERE id = p_apuesta_id;

  RETURN jsonb_build_object(
    'ok', true,
    'estado_anterior', v_apuesta.estado,
    'monto_restituido', v_diferencia
  );
END;
$$;

-- ============================================================================
-- MÓDULO 4: VACIADO DE CLIENTES, CONTABILIDAD Y CARRERAS (CONSERVANDO GRUPOS)
-- ============================================================================

DO $$
DECLARE
  t TEXT;
  tablas_a_vaciar TEXT[] := ARRAY[
    'remate_pujas',
    'remate_caballos',
    'polla_combinaciones',
    'polla_participantes',
    'polla_ventas',
    'dupleta_tickets',
    'tabla_fija_caballos',
    'tabla_grupos',
    'solicitudes_tablas',
    'carrera_ejemplares',
    'resultados_carreras',
    'cruces_carrera_config',
    'ih_inscripciones_carrera',
    'ih_carreras_programa',
    'ih_tendencia_jornada',
    'ih_cuadros_maestros_5y6',
    'historial_inteligencia_ejemplares',
    'gaceta_procesada',
    'apuestas_eventos_especiales',
    'eventos_libres',
    'marcas',
    'marcas_carrera',
    'tablas_fijas',
    'remates',
    'pollas',
    'dupletas',
    'wps_tickets',
    'tickets_apuestas',
    'tickets_jugadas',
    'tickets',
    'jugadas_adelantadas',
    'jugadas_monitor',
    'jugadas_auditoria',
    'portal_jugadas_reclamos',
    'portal_jugadas_externas',
    'jugadas',
    'programa_dia',
    'ejemplares',
    'carreras',
    'asientos_niif_lineas',
    'asientos_niif',
    'contabilidad_asientos_lineas',
    'contabilidad_asientos',
    'movimientos_contables',
    'asientos_contables',
    'libro_mayor_clientes',
    'pagos_comprobantes',
    'pagos_vzla',
    'movimientos_caja',
    'transacciones_financieras',
    'cierres_jornada',
    'saldos_semanales',
    'ciclos_facturacion_semanal',
    'formas_pago_clientes',
    'clientes_comision_personalizada',
    'comision_socio_por_cliente',
    'cuaderno_jugadas',
    'bitacora_externa',
    'whatsapp_envios',
    'clientes'
  ];
BEGIN
  FOREACH t IN ARRAY tablas_a_vaciar
  LOOP
    IF to_regclass('public.' || quote_ident(t)) IS NOT NULL THEN
      EXECUTE format('TRUNCATE TABLE public.%I RESTART IDENTITY CASCADE', t);
    END IF;
  END LOOP;

  -- Reiniciar saldos del Plan de Cuentas NIIF base a 0.00 conservando catálogo
  IF to_regclass('public.plan_cuentas_niif') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'plan_cuentas_niif' AND column_name = 'saldo_actual'
    ) THEN
      EXECUTE 'UPDATE public.plan_cuentas_niif SET saldo_actual = 0.00';
    END IF;
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'plan_cuentas_niif' AND column_name = 'saldo_deudor'
    ) THEN
      EXECUTE 'UPDATE public.plan_cuentas_niif SET saldo_deudor = 0.00';
    END IF;
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'plan_cuentas_niif' AND column_name = 'saldo_acreedor'
    ) THEN
      EXECUTE 'UPDATE public.plan_cuentas_niif SET saldo_acreedor = 0.00';
    END IF;
  END IF;
END $$;

COMMIT;
