-- ============================================================================
-- limpiar_data.sql  ·  Borrado de DATOS DE PRUEBA (no toca estructura)
--
--   1) TODAS las jugadas cargadas en la data (apuestas de TODAS las
--      modalidades: Tablas Fijas, Marcas, Dupletas, Remates, WPS, Pollas).
--      Todas viven en `tickets_apuestas`.
--   2) TODOS los usuarios (clientes) de TODOS los grupos.
--
-- Idempotente: se puede correr las veces que haga falta.
-- Ejecutar en el SQL Editor de Supabase (SQL puro, sin metacomandos).
--
-- NOTA DE DINERO: borrar las jugadas NO devuelve solo los saldos que cada
-- ticket descontó (`clientes.saldo_actual`). Si querés arrancar de cero con el
-- dinero, agregá el UPDATE marcado como OPCIONAL al final.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) Jugadas: TODAS
--    Nada referencia `tickets_apuestas.id` por FK (los demás tickets son la
--    propia fila), así que el borrado no puede trabarse por dependencias.
-- ---------------------------------------------------------------------------
delete from public.tickets_apuestas;

-- Auditoría de jugadas: queda huérfana sin tickets.
delete from public.jugadas_auditoria;

-- ---------------------------------------------------------------------------
-- 2) Usuarios de TODOS los grupos
--    Dos formas de pertenencia a la vez: la tabla intermedia `clientes_grupos`
--    y el `grupo_id` PRINCIPAL que guarda `clientes` (la app lee las dos).
-- ---------------------------------------------------------------------------
delete from public.clientes_grupos;

update public.clientes
   set grupo_id = null
 where grupo_id is not null;

commit;

-- ---------------------------------------------------------------------------
-- OPCIONAL — solo si querés que el dinero también quede en cero:
--   update public.clientes set saldo_actual = 0, aval = 0;
-- ---------------------------------------------------------------------------

-- Verificación (debe dar 0 en las tres):
--   select (select count(*) from public.tickets_apuestas)  as jugadas,
--          (select count(*) from public.clientes_grupos)   as usuarios_en_grupos,
--          (select count(*) from public.clientes where grupo_id is not null) as con_grupo;
