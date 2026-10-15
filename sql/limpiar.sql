-- ============================================================
--  LIMPIEZA TOTAL DE DATOS — CLUB DEL DINERO (Supabase)
-- ============================================================
--  IMPORTANTE:
--  1) Ejecuta esto en Supabase -> SQL Editor (NUNCA en producción sin backup).
--  2) Ten un BACKUP: Supabase -> Database -> Backups o exporta antes.
--  3) NO se borran los OPERADORES (tabla operadores): son los usuarios que
--     entran al sistema. Si los eliminas, NADIE podrá iniciar sesión.
--  4) NO se borran los catálogos base (monedas_sistema, monedas, tasas_cambio,
--     hipodromos, tipos_jugadas): el sistema los necesita para funcionar
--     (ej. taquilla consulta la moneda base con .limit(1).single()).
--     Si también quieres vaciarlos, usa el BLOQUE OPCIONAL al final.
--  5) CASCADE elimina en cadena los registros que dependen (FKs).
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- BORRADO DE TODA LA DATA OPERATIVA (+ clientes y bancos)
-- ------------------------------------------------------------
TRUNCATE TABLE
    public.clientes,
    public.bancos,
    public.depositos,
    public.transacciones_financieras,
    public.tickets_apuestas,
    public.wps_tickets,
    public.tablas_fijas,
    public.pollas,
    public.remates,
    public.remate_caballos,
    public.auditoria
RESTART IDENTITY CASCADE;

COMMIT;

-- ============================================================
--  OPCIONAL: si además quieres vaciar CATÁLOGOS/CONFIGURACIÓN
--  (monedas, monedas_sistema, tasas_cambio, hipodromos, tipos_jugadas)
--  descomenta el bloque y ajústalo a tu catálogo real.
-- ============================================================
-- BEGIN;
-- TRUNCATE TABLE
--     public.monedas_sistema,
--     public.monedas,
--     public.tasas_cambio,
--     public.hipodromos,
--     public.tipos_jugadas
-- RESTART IDENTITY CASCADE;
--
-- -- Re-inserta la moneda nacional base (ajusta código/nombre a tu país):
-- INSERT INTO public.monedas_sistema (codigo, nombre, simbolo)
-- VALUES ('PEN', 'Sol Peruano', 'S/');
--
-- INSERT INTO public.monedas (codigo, nombre, simbolo, es_base, tasa_cambio)
-- VALUES ('PEN', 'Sol Peruano', 'S/', true, 1.0);
--
-- INSERT INTO public.tasas_cambio (moneda_id, tasa)
-- SELECT id, 1.0 FROM public.monedas WHERE es_base = true;
-- COMMIT;

-- Si alguna tabla tiene RLS que bloquea el TRUNCATE, usa DELETE en su lugar:
--   DELETE FROM public.auditoria;   -- (con RLS activo se borra lo accesible)