-- Tabla de Reglas y Respuestas Automáticas Entrenadas
CREATE TABLE IF NOT EXISTS public.reglas_respuestas_automaticas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grupo_id uuid NOT NULL,
  frase_disparadora text NOT NULL,
  tipo_coincidencia text NOT NULL DEFAULT 'contiene', -- 'exacta' | 'contiene' | 'regex'
  respuesta_publica text,
  respuesta_privada text,
  accion_sistema text NOT NULL DEFAULT 'respuesta_directa', -- 'respuesta_directa' | 'consultar_saldo'
  activo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reglas_resp_auto_grupo ON public.reglas_respuestas_automaticas(grupo_id, activo);

-- Función evaluadora RPC
CREATE OR REPLACE FUNCTION public.evaluar_respuesta_entrenada_sala(
  p_grupo_id uuid,
  p_jugador_id uuid,
  p_texto text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_regla RECORD;
  v_texto_limpio text := lower(trim(p_texto));
  v_cliente RECORD;
  v_msg_priv text;
  v_msg_pub text;
BEGIN
  -- 1. Buscar regla coincidente activa para el grupo
  FOR v_regla IN
    SELECT *
    FROM public.reglas_respuestas_automaticas
    WHERE grupo_id = p_grupo_id
      AND activo = true
    ORDER BY
      CASE WHEN tipo_coincidencia = 'exacta' THEN 1 ELSE 2 END,
      updated_at DESC
  LOOP
    IF (v_regla.tipo_coincidencia = 'exacta' AND v_texto_limpio = lower(trim(v_regla.frase_disparadora)))
       OR (v_regla.tipo_coincidencia IN ('contiene', 'parcial') AND v_texto_limpio LIKE '%' || lower(trim(v_regla.frase_disparadora)) || '%')
    THEN
      v_msg_pub := v_regla.respuesta_publica;
      v_msg_priv := v_regla.respuesta_privada;

      -- Si es consulta de saldo, enriquecer respuesta privada
      IF v_regla.accion_sistema = 'consultar_saldo' OR v_texto_limpio IN ('saldo', 'mi saldo', 'cuanto tengo', 'disponible') THEN
        SELECT nombre, seudonimo, saldo_actual, saldo_retenido, saldo_disponible, aval, libre
        INTO v_cliente
        FROM public.clientes
        WHERE id = p_jugador_id;

        IF FOUND THEN
          v_msg_priv := COALESCE(v_msg_priv, '') || E'\n' || '💰 *Tu Saldo Disponible:* $' || to_char(COALESCE(v_cliente.saldo_disponible, 0), 'FM999,999,990.00');
        END IF;
      END IF;

      RETURN jsonb_build_object(
        'coincidencia', true,
        'accion_sistema', v_regla.accion_sistema,
        'msg_publico', v_msg_pub,
        'msg_privado', v_msg_priv,
        'regla_id', v_regla.id
      );
    END IF;
  END LOOP;

  -- 2. Detección automática por defecto de consulta de saldo si el usuario escribió simplemente "saldo" o "mi saldo"
  IF v_texto_limpio IN ('saldo', 'mi saldo', 'cuanto tengo', 'disponible', 'mi saldo por favor') THEN
    SELECT nombre, seudonimo, saldo_actual, saldo_retenido, saldo_disponible, aval, libre
    INTO v_cliente
    FROM public.clientes
    WHERE id = p_jugador_id;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'coincidencia', true,
        'accion_sistema', 'consultar_saldo',
        'msg_publico', null,
        'msg_privado', '💰 *Hola ' || COALESCE(v_cliente.seudonimo, v_cliente.nombre) || '*, tu saldo disponible es: *$' || to_char(COALESCE(v_cliente.saldo_disponible, 0), 'FM999,999,990.00') || '*'
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'coincidencia', false,
    'accion_sistema', null,
    'msg_publico', null,
    'msg_privado', null
  );
END;
$$;
