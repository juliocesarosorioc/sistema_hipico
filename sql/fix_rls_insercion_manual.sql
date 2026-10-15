-- ============================================================
--  OBSOLETO — ESTE ARCHIVO YA NO ABRE NADA
-- ============================================================
--  Qué hacía antes, y por qué ya no debe volver a usarse:
--
--    create policy "resultados_carreras_for_all_club" on public.resultados_carreras
--        for all to anon, authenticated using (true) with check (true);
--    grant all privileges on table public.resultados_carreras to anon, ...;
--
--  Eso no era "RLS activo pero controlado": `with check (true)` con un rol
--  anon concede INSERT y UPDATE sin condición, y `grant all` además incluye
--  TRUNCATE, que ignora el RLS por completo. En la práctica era el mismo
--  `grant all ... to anon` del legacy, con dos líneas de más.
--
--  Se creó por un error real: `guardarPrograma()` se tragaba los fallos de
--  `club_guardar_programa_dia` y caía a un `.upsert()` directo, que el RLS
--  rechazaba. En vez de arreglar el fallback, se abrió la tabla. Ese
--  fallback ya está corregido en src/lib/gaceta/programa.ts: ahora solo cae
--  cuando la RPC no existe (42883 / PGRST202), no ante cualquier error.
--
--  Para cerrar `resultados_carreras` está sql/resultados_rpc.sql.
--  Para cerrar la lectura de `auditoria`, sql/auditoria_rls.sql.
--  Para el orden completo: sql/RUNBOOK_SQL.md.
--
--  ⚠️  SI ALGUNA VEZ CORRISTE LA VERSIÓN VIEJA DE ESTE ARCHIVO, la base
--     quedó con escritura abierta por anon en resultados_carreras.
--     Corre el bloque de remediación de abajo.
-- ============================================================

-- ============================================================
--  REMEDIACIÓN (idempotente)
--  Ejecutar SOLO si corriste la versión anterior de este archivo.
-- ============================================================

-- 1) Se van las políticas "permitir todo" de ambas tablas
drop policy if exists "resultados_carreras_for_all_club" on public.resultados_carreras;
drop policy if exists "programa_dia_for_all_club" on public.programa_dia;

-- 2) Se le saca a anon la escritura directa.
--    NOTA: `revoke all` también se lleva TRUNCATE, que es la parte que
--    ignoraba el RLS. No se revoca de authenticated ni de service_role.
revoke all on table public.resultados_carreras from anon;
revoke all on table public.programa_dia from anon;

-- 3) Se asegura que el RLS quede activo en las dos
alter table public.resultados_carreras enable row level security;
alter table public.programa_dia enable row level security;

-- 4) Resultados: la escritura pasa por RPC security definer con capacidad.
--    El detalle (funciones, políticas y capacidades) está en
--    sql/resultados_rpc.sql. Este bloque solo deja el RLS cerrado; sin las
--    políticas correctas el INSERT da 0 filas en vez de saltarse el control,
--    que es el fallo correcto para una tabla de dinero.
grant select on table public.resultados_carreras to anon, authenticated;

-- ------------------------------------------------------------
-- Verificación: la anon key NO debe poder escribir. Ambas consultas
-- deben fallar con "new row violates row-level security" o
-- "permission denied for table".
--
--   insert into public.resultados_carreras (...) values (...);
--   update public.resultados_carreras set dividendos = '{}' where false;
--
-- Y el SELECT normal de la app (con sesión y capacidad) debe seguir
-- funcionando.
-- ------------------------------------------------------------
