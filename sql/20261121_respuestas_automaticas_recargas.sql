-- 2026-11-21 — Respuestas automáticas / recargas por WhatsApp
--
-- Anti-replay de recargas: la validación previa en código NO basta si dos
-- solicitudes concurrentes llegan al mismo tiempo. Estos índices únicos
-- convierten la referencia y la huella del comprobante en una barrera atómica.
-- Se crean sólo si la tabla existe (algunas instalaciones aún no la tienen).

DO $$
BEGIN
  IF to_regclass('public.solicitudes_recarga_saldo') IS NOT NULL THEN
    CREATE UNIQUE INDEX IF NOT EXISTS uq_recargas_grupo_metodo_ref
      ON public.solicitudes_recarga_saldo (grupo_id, metodo_pago, referencia_original);

    CREATE UNIQUE INDEX IF NOT EXISTS uq_recargas_hash_imagen
      ON public.solicitudes_recarga_saldo (hash_imagen_sha256)
      WHERE hash_imagen_sha256 IS NOT NULL;
    -- Montos repetidos se bloquean con la consulta previa en código (el mismo
    -- banco + monto dentro del grupo); no se indexe aquí para no rechazar
    -- recargas legítimas del mismo valor con referencias distintas.
  END IF;
END $$;
