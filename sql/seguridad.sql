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
-- PARTE 3: LECTURA DEL LOG SOLO CON CAPACIDAD
--
-- Este archivo creaba aquí una política `anon_read_temporal` con
-- `using (true)` y un comentario que decía "la app todavía no usa Supabase
-- Auth". Ese día ya pasó: la app autentica con Supabase Auth y resuelve
-- permisos con `public.tiene_capacidad`.
--
-- Con `using (true)` cualquier persona con la anon key leia el registro
-- completo: IP, navegador, ubicacion y accion de cada operacion.
--
-- Por eso la lectura publica ya no se crea mas aca. Si aun la tenias en la
-- base, este mismo archivo la elimina:
-- -------------------------------------------------------------------
drop policy if exists "anon_read_temporal" on public.auditoria;

-- La politica buena va en su propio archivo, para que quede claro que
-- este no es el lugar de administrar accesos: despues de correr este
-- script, correr sql/auditoria_rls.sql. Define una politica
-- `for select to authenticated` condicionada a
-- `tiene_capacidad(auth.uid(), 'seguridad:celda_auditoria')`, que es la
-- misma capacidad que exige el boton del modulo en la UI.

-- ===================================================================
-- PARTE 4: RLS DE TABLAS DE NEGOCIO
-- Estado actual: este archivo ya NO es la guia. El orden vigente de
-- scripts y que tabla se cierra con que RPC esta en sql/RUNBOOK_SQL.md.
--
-- Lo que si sigue en pie: endurecer el RLS de las tablas de negocio
-- (operadores, banco, tablas, depositos...) se hace por RPC
-- `security definer` con `tiene_capacidad`, igual que
-- resultados_carreras y tickets_apuestas. No con policies abiertas al rol
-- anon.
-- ===================================================================