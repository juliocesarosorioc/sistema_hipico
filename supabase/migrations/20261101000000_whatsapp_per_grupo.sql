-- Migración: aislamiento por grupo en el control de carrera WhatsApp.
-- El índice original era (fecha, hipodromo, carrera) y chocaba entre grupos
-- distintos que abrían la misma carrera. Se reemplaza por
-- (fecha, grupo_id, hipodromo, carrera) para per-group isolation.
-- Además, grupo_id pasa a text para guardar el identificador del grupo de
-- WhatsApp (no un grupos.id uuid).

-- 1) Quitar la FK a grupos.id y convertir la columna a text.
ALTER TABLE public.whatsapp_control_carrera_grupo
  DROP CONSTRAINT IF EXISTS whatsapp_control_carrera_grupo_grupo_id_fkey;

ALTER TABLE public.whatsapp_control_carrera_grupo
  ALTER COLUMN grupo_id TYPE text USING grupo_id::text;

-- 2) Normalizar nulos/vacíos.
UPDATE public.whatsapp_control_carrera_grupo
  SET grupo_id = COALESCE(NULLIF(grupo_id, ''), 'GENERAL')
  WHERE grupo_id IS NULL OR grupo_id = '';

-- 3) Reemplazar el índice único.
DROP INDEX IF EXISTS public.whatsapp_control_carrera_grupo_fecha_hip_carrera_uidx;

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_control_carrera_grupo_fecha_grupo_hip_carrera_uidx
  ON public.whatsapp_control_carrera_grupo (fecha, grupo_id, hipodromo, carrera);
