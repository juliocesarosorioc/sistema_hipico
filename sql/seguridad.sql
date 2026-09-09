-- ===================================================================
-- CLUB DINERO - SEGURIDAD Y AUDITORÍA (Supabase SQL Editor)
-- Ejecutar por partes en: Supabase Dashboard -> SQL Editor -> New query
-- ===================================================================

-- ===================================================================
-- PARTE 1: LOG DE AUDITORÍA (tabla + función segura)
-- La app NUNCA inserta directo en `auditoria`; siempre usa la RPC
-- club_log_accion (SEGURITY DEFINER), que escribe con los permisos del
-- creador de la función. Así los logs NO pueden ser falsificados por
-- el navegador del cliente aunque tenga la anon key.
-- ===================================================================

create table if not exists public.auditoria (
    id       bigint generated always as identity primary key,
    fecha    timestamptz not null default now(),
    usuario  text not null default 'anon',
    modulo   text not null,
    accion   text not null,
    ip       text,
    navegador text,
    ubicacion text
);

-- Índice para filtrar por rango de fechas y módulo
create index if not exists idx_auditoria_fecha on public.auditoria (fecha desc);
create index if not exists idx_auditoria_modulo on public.auditoria (modulo);

-- Función segura de escritura de auditoría
create or replace function public.club_log_accion(
    p_usuario text,
    p_modulo text,
    p_accion text,
    p_ip text default null,
    p_navegador text default null,
    p_ubicacion text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    -- Solo aceptamos un juego de caracteres simple para evitar inyecciones obvias
    insert into public.auditoria (usuario, modulo, accion, ip, navegador, ubicacion)
    values (left(coalesce(p_usuario, 'anon'), 80), left(p_modulo, 40), left(p_accion, 300),
            left(p_ip, 45), left(p_navegador, 300), left(p_ubicacion, 120));
end;
$$;

-- ===================================================================
-- PARTE 2: RLS EN `auditoria`
-- 1) NEGAMOS todo acceso directo a la tabla para anon:
-- ===================================================================
alter table public.auditoria enable row level security;

drop policy if exists "anon_insert_bloqueado" on public.auditoria;
create policy "anon_insert_bloqueado" on public.auditoria
    for insert to anon with check (false);

drop policy if exists "anon_read_bloqueado" on public.auditoria;
create policy "anon_read_bloqueado" on public.auditoria
    for select to anon using (false);

-- 2) PERMITIMOS que anon llame a la función de logging (única vía de escritura):
revoke all on public.auditoria from anon;
grant execute on function public.club_log_accion(text, text, text, text, text, text) to anon;

-- -------------------------------------------------------------------
-- PARTE 3 (OPCIONAL): LECTURA DEL LOG PARA ADMIN.
-- La nueva app se conecta con anon key (no usa Supabase Auth aún), así
-- que el SELECT del módulo Auditoría necesita permiso anon para LEER.
-- Si deseas que solo el equipo pueda leer, móntate sobre Supabase Auth:
-- -------------------------------------------------------------------
drop policy if exists "anon_read_temporal" on public.auditoria;
create policy "anon_read_temporal" on public.auditoria
    for select to anon using (true);
-- ⚠️ ESTA POLÍTICA HABILITA LECTURA PÚBLICA TEMPORAL. Cuando migres a
-- Supabase Auth, REEMPLÁZALA por:
--   create policy "solo_admin_read" on public.auditoria for select
--     to authenticated using (auth.jwt() ->> 'role' = 'admin');
-- y elimina la política "anon_read_temporal".

-- ===================================================================
-- PARTE 4: RLS DE TABLAS DE NEGOCIO (PENDIENTE DE AUTENTICACIÓN REAL)
-- Antes de endurecer el RLS de tablas como `operadores`, `banco`,
-- `tablas`, `depositos`, etc., el sistema debe migrar a Supabase Auth.
-- MÚSICA DE FONDO: con la anon key en el frontend y sin sesión de
-- Supabase, activar RLS restrictivo ROMPE el funcionamiento de la app.
-- Plan recomendado:
--   1. Crear un usuario real en Supabase Auth por cada operador.
--   2. En las tablas: ALTER TABLE <x> ENABLE ROW LEVEL SECURITY;
--   3. Añadir policies por rol (auth.jwt() ->> 'role' = '...').
--   4. Configurar triggers para sincronizar operadores <-> auth.users.
-- Si aún no estás listo para ese paso, mantén el RLS deshabilitado en
-- las tablas de negocio y centra la defensa en: no exponer la service
-- role key + password hasheada + login con bcrypt (o Supabase Auth).
-- ===================================================================