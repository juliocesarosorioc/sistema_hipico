-- =============================================================================
-- MIGRACIÓN: una sola data de carreras, vinculada a sus resultados
-- Fecha: 2026-09-26
-- Objetivo: que `resultados_carreras` sea el REGISTRO ÚNICO de qué carreras
--           existen, y que cada una viva en la MISMA fila que sus resultados
--           (ganadores / orden_llegada / dividendos). `tablas_fijas` deja de
--           ser una segunda lista de carreras y queda como hija: la grilla de
--           venta que se armó para esa carrera.
--
-- POR QUÉ ESTA FORMA
-- La vinculación carrera↔resultado ya existe en el esquema: `resultados_carreras`
-- tiene fecha+hipodromo+carrera (unique) y, en esa misma fila, los resultados.
-- El problema nunca fue el diseño de la tabla, fue que estaba VACÍA: 4 de 134
-- carreras. Este script la puebla sin tocar `tablas_fijas`.
--
-- SEGURIDAD
--   - Idempotente: se puede correr N veces.
--   - Nunca pisa resultados: el backfill es ON CONFLICT DO NOTHING, así que
--     una carrera que ya tenga `ganadores` / `dividendos` queda intacta.
--   - Hay respaldo de ambas tablas antes de tocar nada.
--   - Verificado en preflight: 20 filas con año corrupto, 0 colisiones al
--     corregir, 130 filas de tablas_fijas = 130 carreras únicas (sin fan-out
--     por grupo de venta), 0 diferencias de ejemplares entre grupos.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 0) RESPALDO (idempotente)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS _bak_tablas_fijas_20260926 AS
  SELECT * FROM tablas_fijas;

CREATE TABLE IF NOT EXISTS _bak_resultados_carreras_20260926 AS
  SELECT * FROM resultados_carreras;

-- -----------------------------------------------------------------------------
-- 1) CORREGIR LOS 20 AÑOS CORRUPTOS en `tablas_fijas`
--
-- `fecha` guardaba el AÑO DE CREACIÓN de la fila en vez de la fecha del evento.
-- El evento es del 2026. `fecha_creacion` ya conserva la metadata real, así que
-- no se pierde información al corregir.
--
--   2025-09-25 (9 filas)  -> 2026-09-25   LONE STAR C5-C7, MEADOWLANDS C5-C6,
--                                      PRAIRIE MEADOWS C1, C11-C13
--   2025-09-26 (8 filas)  -> 2026-09-25   GULFSTREAM C4-C6, LONE STAR C8-C9,
--                                      MEADOWLANDS C1, SANTA ANITA C7-C8
--   2029-09-27 (3 filas)  -> 2026-09-27   LA RINCONADA C1-C3
--
-- Sin colisiones: se comprobó que ninguno de esos (hipodromo, carrera) existe
-- ya en 2026-09-25 ni en 2026-09-27.
-- -----------------------------------------------------------------------------
UPDATE tablas_fijas SET fecha = '2026-09-25' WHERE fecha = '2025-09-25';
UPDATE tablas_fijas SET fecha = '2026-09-25' WHERE fecha = '2025-09-26';
UPDATE tablas_fijas SET fecha = '2026-09-27' WHERE fecha = '2029-09-27';

-- -----------------------------------------------------------------------------
-- 2) BACKFILL: que cada carrera de `tablas_fijas` exista en el registro único
--
-- Se copian los datos que describen LA CARRERA (no los de la venta):
--   caballos, retirados, distancia, superficie y premio.
-- NO se copian grupo_venta / monto_tabla / comision / limite_ventas /
-- cantidad_vendida: esos son de la grilla vendida y se quedan en tablas_fijas.
--
-- `premio` conserva la compat con la app (que lee `premio`), y se rellenan
-- también `premio_oficial` / `premio_recalculado` para que quede el desglose.
--
-- `ganadores` solo se arma si algún ejemplar viene marcado `ganador = true`.
-- Hoy ninguno lo está, así que queda NULL = "resultados no cargados todavía",
-- que es la verdad. Cuando se carguen, van en la misma fila que la carrera.
-- -----------------------------------------------------------------------------
INSERT INTO resultados_carreras (
  fecha,
  hipodromo,
  carrera,
  caballos,
  retirados,
  distancia,
  superficie,
  premio,
  premio_oficial,
  premio_recalculado,
  ganadores
)
SELECT
  tf.fecha,
  upper(btrim(tf.hipodromo))                        AS hipodromo,
  tf.carrera,
  tf.caballos,
  COALESCE(tf.retirados_oficiales, 'NO HUBO RETIROS') AS retirados,
  tf.distancia_carrera::text                        AS distancia,
  tf.superficie,
  COALESCE(tf.premio_recalculado, tf.premio_original) AS premio,
  tf.premio_original                                AS premio_oficial,
  tf.premio_recalculado                             AS premio_recalculado,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(tf.caballos, '[]'::jsonb)) e
      WHERE COALESCE((e ->> 'ganador')::boolean, false)
    )
    THEN (
      SELECT jsonb_agg(e ->> 'numero' ORDER BY (e ->> 'orden')::int NULLS LAST, e ->> 'numero')
      FROM jsonb_array_elements(COALESCE(tf.caballos, '[]'::jsonb)) e
      WHERE COALESCE((e ->> 'ganador')::boolean, false)
    )
    ELSE NULL
  END                                               AS ganadores
FROM tablas_fijas tf
WHERE tf.fecha IS NOT NULL
  AND tf.carrera IS NOT NULL
  AND btrim(coalesce(tf.hipodromo, '')) <> ''
ON CONFLICT (fecha, hipodromo, carrera) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 3) VERIFICACIÓN (deja esto a mano para revisarlo antes de hacer COMMIT)
-- -----------------------------------------------------------------------------

-- 3.1) Toda carrera de tablas_fijas debe existir ya en el registro único.
--      Esperado: 0 filas.
SELECT tf.fecha, tf.hipodromo, tf.carrera
FROM tablas_fijas tf
LEFT JOIN resultados_carreras rc
  ON  rc.fecha    = tf.fecha
  AND rc.hipodromo = upper(btrim(tf.hipodromo))
  AND rc.carrera  = tf.carrera
WHERE rc.id IS NULL
ORDER BY 1,2,3;

-- 3.2) No deben quedar años fuera de 2026.  Esperado: 0 filas.
SELECT fecha, count(*) FROM tablas_fijas
WHERE fecha NOT LIKE '2026-%' GROUP BY 1;

-- 3.3) Conteo por fecha: el registro único debe cuadrar con las 130 carreras.
SELECT fecha, count(*) AS carreras
FROM resultados_carreras GROUP BY 1 ORDER BY 1;

-- 3.4) Cuántas tienen resultados cargados de verdad. Esperado 0 al migrar:
--     la data de carreras existe, pero la liquidación aún no se corrió.
SELECT count(*) AS con_resultados FROM resultados_carreras WHERE ganadores IS NOT NULL;

-- =============================================================================
-- COMMIT;   ← descomentar SOLO después de revisar las consultas 3.1 a 3.4
-- =============================================================================
