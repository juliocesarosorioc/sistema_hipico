-- ============================================================
--  CICLOS DE FACTURACIÓN SEMANAL POR GRUPO
-- ============================================================
--  Añade el ciclo de facturación personalizado a la tabla grupos_venta:
--    dia_inicio_semana · 1..7 (1 = Lunes … 7 = Domingo) — día de apertura
--    dia_fin_semana    · 1..7 — día de corte/cierre de la semana fiscal
--  Por defecto la semana corre de Lunes (1) a Domingo (7).
--
--  Los reportes de SALDOS CONSOLIDADOS deberán evaluar estos dos campos para
--  calcular la "Semana en curso" del grupo seleccionado (ver
--  src/lib/liquidacion/semana.ts → rangoSemanaDeGrupo()).
--
--  Idempotente: ejecutar en Supabase -> SQL Editor y listo.
-- ============================================================

ALTER TABLE public.grupos_venta
    ADD COLUMN IF NOT EXISTS dia_inicio_semana INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS dia_fin_semana    INTEGER NOT NULL DEFAULT 7;

-- Sanidad 1..7 (los CHECK no soportan IF NOT EXISTS → DO con guarda).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'grupos_venta_dia_inicio_semana_check'
    ) THEN
        ALTER TABLE public.grupos_venta
            ADD CONSTRAINT grupos_venta_dia_inicio_semana_check
            CHECK (dia_inicio_semana BETWEEN 1 AND 7);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'grupos_venta_dia_fin_semana_check'
    ) THEN
        ALTER TABLE public.grupos_venta
            ADD CONSTRAINT grupos_venta_dia_fin_semana_check
            CHECK (dia_fin_semana BETWEEN 1 AND 7);
    END IF;
END $$;

-- Verificación:
-- SELECT id, nombre, dia_inicio_semana, dia_fin_semana FROM grupos_venta LIMIT 5;