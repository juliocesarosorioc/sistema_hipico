-- ============================================================
--  AUDITORIA: LECTURA SOLO PARA QUIEN TIENE LA CAPACIDAD
-- ============================================================
--  PROBLEMA QUE RESUELVE
--
--  `seguridad.sql` y `paquete_pendientes.sql` dejaron esta politica:
--
--      create policy "anon_read_temporal" on public.auditoria
--          for select to anon using (true);
--
--  Con `using (true)`, CUALQUIERA que tenga la anon key puede leer el
--  registro completo de auditoria. Y esa tabla guarda `ip`, `navegador`,
--  `ubicacion` y `accion` de cada operacion: no son datos de negocio, son
--  datos personales de quien opera la casa.
--
--  El comentario original justificaba la politica asi:
--
--      "La nueva app se conecta con anon key (no usa Supabase Auth aun)"
--
--  Eso ya no es cierto. La app usa Supabase Auth de verdad (ver Guard y
--  `tiene_capacidad`), asi que el modulo de Auditoria ya corre con sesion.
--  La politica quedo como andamiaje de una transicion que se completo y
--  nunca se desarmo.
--
--  QUE HACE ESTE ARCHIVO
--
--  1) Borra la lectura publica y la deja solo para sesion autenticada.
--  2) La condicion no es "estar autenticado": es tener la capacidad
--     `seguridad:celda_auditoria`, la misma que usa el boton en la UI.
--     Un usuario logueado sin permiso recibe 0 filas, no un volcado.
--  3) NO toca la escritura. Esa sigue pasando por `club_log_accion`, que
--     es `security definer` y por lo tanto corre con los permisos del
--     dueno de la tabla, esquivando el RLS a proposito. Por eso anon puede
--     seguir invocando la RPC sin poder escribir directo.
--
--  ORDEN: correr DESPUES de seguridad.sql / paquete_pendientes.sql, porque
--  los dos crean `anon_read_temporal` y esta script la elimina.
--  Es idempotente: se puede re-ejecutar.
--
--  EFECTO ESPERADO AL CORRERLO (con la anon key): el SELECT sobre
--  auditoria pasa de N filas a 0. Si sigue devolviendo filas, la politica
--  no se elimino: revisa que no exista otra politica `to anon` sobre la
--  tabla y que RLS siga habilitado:
--
--      select relrowsecurity, relforcerowsecurity
--        from pg_class where relname = 'auditoria';
--      select policyname, cmd, roles, qual
--        from pg_policies where tablename = 'auditoria';
-- ============================================================

-- ------------------------------------------------------------
-- (1) Se retira la lectura publica
-- ------------------------------------------------------------
alter table public.auditoria enable row level security;

drop policy if exists "anon_read_temporal" on public.auditoria;
drop policy if exists "anon_read_bloqueado" on public.auditoria;

-- Refuerzo explicito: aunque alguien vuelva a crear una politica, sin
-- privilegio de SELECT en el rol anon no hay nada que proteger con RLS.
revoke all on public.auditoria from anon;

-- ------------------------------------------------------------
-- (2) Lectura por capacidad, para sesion autenticada
-- ------------------------------------------------------------
-- `public.tiene_capacidad(uid, 'seguridad:celda_auditoria')` ya se usa en
-- el resto de las RPC de seguridad del proyecto. Si la funcion todavia no
-- existiera, este bloque aborta y el SELECT sigue en cero (fail closed),
-- que es el lado correcto en el que fallar un log de acceso.
drop policy if exists "authenticated_lectura_por_capacidad" on public.auditoria;
create policy "authenticated_lectura_por_capacidad" on public.auditoria
    for select to authenticated
    using (public.tiene_capacidad(auth.uid(), 'seguridad:celda_auditoria'));

-- authenticated si necesita leerla; el RLS de arriba es lo que manda.
grant select on public.auditoria to authenticated;

-- ------------------------------------------------------------
-- (3) Verificacion
-- ------------------------------------------------------------
-- Con la anon key este debe dar 0 (ya no hay lectura publica):
--   select count(*) from public.auditoria;
-- Con la sesion de un operador que tiene 'seguridad:celda_auditoria',
-- este debe devolver filas; con un usuario logueado sin esa capacidad,
-- tambien 0.
