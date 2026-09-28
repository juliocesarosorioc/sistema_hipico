-- =============================================================================
-- RETIRO DEFINITIVO DEL MODULO "MARCAS" (retos 120/100)
-- =============================================================================
-- El modulo ya no existe en el codigo: se borraron la ruta /marcas, el
-- enlace del Sidebar, components/marcas/, lib/marcas.ts, lib/motores/marcas.ts
-- y su integracion en motores/oficiales.ts, liquidacion/pagarYCerrar.ts y
-- liquidacion/saldos.ts. Este script limpia lo que queda en la base.
--
-- NO borra dividends ni clientes: solo la tabla de jornada de Marcas y las
-- filas de configuracion que solo servian a ese modulo.
--
-- Ejecutar en el SQL Editor de Supabase. Es idempotente.
-- =============================================================================

BEGIN;

-- 1) Filas de tipos de jugada que eran exclusivamente de Marcas.
--    Se comparan por nombre porque no se conoce el id fijo.
DELETE FROM public.tipos_jugadas
 WHERE upper(nombre) LIKE 'MARCA%';

-- 2) Tabla de jornada de marcas (hipodromo + fecha unicos, con la columna
--    filas JSONB de marcados/contra). No la lee ya nadie.
DROP TABLE IF EXISTS public.marcas_dia CASCADE;

-- 3) La RPC club_guardar_marcas_para_carrera se creo para este modulo.
DROP FUNCTION IF EXISTS public.club_guardar_marcas_para_carrera CASCADE;
DROP FUNCTION IF EXISTS public.club_leer_marcas_para_carrera  CASCADE;

-- 4) La clave dividends.marcas vive DENTRO del jsonb de
--    resultados_carreras.dividendos. Se quita solo esa clave; se conservan
--    win, place, show, puestos, tabla, nini y remate.
UPDATE public.resultados_carreras
   SET dividendos = dividendos - 'marcas'
 WHERE dividendos ? 'marcas';

COMMIT;

-- -----------------------------------------------------------------------------
-- VERIFICACION (deberia devolver 0 filas en ambas consultas)
-- -----------------------------------------------------------------------------
-- SELECT * FROM public.marcas_dia;
-- SELECT * FROM public.tipos_jugadas WHERE upper(nombre) LIKE 'MARCA%';

-- -----------------------------------------------------------------------------
-- NOTA: si tras correr esto la app dice que falta una RPC, es que habia otra
-- con otro nombre. Buscarla con:
--   SELECT p.proname FROM pg_proc p
--     JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND lower(p.proname) LIKE '%marca%';
-- -----------------------------------------------------------------------------
