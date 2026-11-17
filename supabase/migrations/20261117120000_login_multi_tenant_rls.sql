-- ============================================================================
-- LOGIN MULTI-TENANT Y RLS POR GRUPO DE VENTA
-- ============================================================================
-- El login pide CÓDIGO DE SALA + USUARIO + CONTRASEÑA. El código se resuelve en
-- la base (no en el navegador) y la sesión queda atada a ese grupo.
--
-- Sigue el modelo de `src/core/db/rls-negocio.sql`: RLS encendido, `anon` sin
-- acceso a datos de negocio salvo las dos excepciones necesarias para entrar
-- (leer `grupos_venta` antes del login y escuchar `chat_mensajes` en realtime),
-- y escrituras de `authenticated` sujetas al tenant y a las capacidades.
-- Idempotente.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) CÓDIGO DE SALA DE CADA GRUPO
-- ---------------------------------------------------------------------------
alter table public.grupos_venta
  add column if not exists codigo_sala text;

comment on column public.grupos_venta.codigo_sala is
  'Código público elegido por el grupo para el login. Se compara sin distinción de mayúsculas.';

-- Backfill legible: el principal queda como `principal`; el resto usa un slug
-- del nombre más un sufijo corto del uuid para que nunca choquen dos grupos con
-- el mismo nombre.
update public.grupos_venta g
set codigo_sala = case
  when g.es_principal then 'principal'
  else
    trim(trailing '-' from regexp_replace(
      translate(lower(btrim(coalesce(g.nombre, 'grupo'))), 'áéíóúñÁÉÍÓÚÑ', 'aeiounaeioun'),
      '[^a-z0-9]+', '-', 'g'
    )) || '-' || substr(replace(g.id::text, '-', ''), 1, 8)
end
where g.codigo_sala is null
   or btrim(g.codigo_sala) = '';

-- Si dos filas tenían el mismo código escrito a mano, se desempata con el id.
with duplicados as (
  select id,
         row_number() over (
           partition by lower(btrim(codigo_sala))
           order by id
         ) as n
  from public.grupos_venta
  where codigo_sala is not null
    and btrim(codigo_sala) <> ''
)
update public.grupos_venta g
set codigo_sala = lower(btrim(g.codigo_sala)) || '-' || substr(replace(g.id::text, '-', ''), 1, 6)
from duplicados d
where d.id = g.id
  and d.n > 1;

create unique index if not exists grupos_venta_codigo_sala_uidx
  on public.grupos_venta (lower(btrim(codigo_sala)))
  where codigo_sala is not null
    and btrim(codigo_sala) <> '';

-- ---------------------------------------------------------------------------
-- 2) RESOLUCIÓN AUTORIZADA DEL CÓDIGO (security definer)
-- ---------------------------------------------------------------------------
-- El formulario NO decide a qué tenant pertenece: le pregunta a la base. Se
-- concede a `anon` porque este paso ocurre antes de `signInWithPassword`.
create or replace function public.club_resolver_codigo_sala(p_codigo text)
returns table (id uuid, nombre text, codigo_sala text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_codigo text := lower(btrim(coalesce(p_codigo, '')));
begin
  if v_codigo = '' then
    return;
  end if;

  return query
  select g.id, g.nombre, g.codigo_sala
  from public.grupos_venta g
  where lower(btrim(g.codigo_sala)) = v_codigo
    and g.activo is distinct from false
  limit 1;
end;
$$;

revoke all on function public.club_resolver_codigo_sala(text) from public;
grant execute on function public.club_resolver_codigo_sala(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3) HELPER DE TENANT
-- ---------------------------------------------------------------------------
-- `auth.jwt() ->> 'grupo_id'` es el claim firme cuando la instalación usa un
-- access-token hook. Donde todavía no existe, se cae a los resolutores que ya
-- hay en `sql/grupos_usuarios.sql` (usuario_en_grupo → ve_todos_los_grupos →
-- grupo_del_usuario), que son `security definer` y no sufren recursión de RLS.
create or replace function public.login_grupo_autorizado(p_grupo_id text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    p_grupo_id is not null
    and btrim(p_grupo_id) <> ''
    and (
      coalesce(nullif(btrim(auth.jwt() ->> 'grupo_id'), ''), '') = btrim(p_grupo_id)
      or public.usuario_en_grupo(auth.uid(), btrim(p_grupo_id))
    );
$$;

revoke all on function public.login_grupo_autorizado(text) from public, anon;
grant execute on function public.login_grupo_autorizado(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4) GRUPOS_VENTA
-- ---------------------------------------------------------------------------
-- `anon` conserva SELECT: es lo que permite resolver el código antes del login
-- si la RPC todavía no está desplegada. Las escrituras de semana_vigente y sus
-- GRANT de columna NO se tocan.
alter table public.grupos_venta enable row level security;

drop policy if exists grupos_venta_select on public.grupos_venta;
drop policy if exists grupos_venta_select_anon on public.grupos_venta;
drop policy if exists login_multi_tenant_grupos_select on public.grupos_venta;

create policy grupos_venta_select_anon on public.grupos_venta
  for select to anon
  using (true);

create policy login_multi_tenant_grupos_select on public.grupos_venta
  for select to authenticated
  using (public.login_grupo_autorizado(id::text));

grant select on public.grupos_venta to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5) CLIENTES (PII + credenciales del portal)
-- ---------------------------------------------------------------------------
-- Reemplaza la policy abierta "personal opera clientes". El portal real entra
-- por la Edge Function `portal-auth` con service_role, así que `anon` no necesita
-- leer esta tabla: denegar por omisión es la frontera correcta.
alter table public.clientes enable row level security;

drop policy if exists "personal opera clientes" on public.clientes;
drop policy if exists login_multi_tenant_clientes_select on public.clientes;
drop policy if exists login_multi_tenant_clientes_insert on public.clientes;
drop policy if exists login_multi_tenant_clientes_update on public.clientes;
drop policy if exists login_multi_tenant_clientes_delete on public.clientes;

create policy login_multi_tenant_clientes_select on public.clientes
  for select to authenticated
  using (public.login_grupo_autorizado(grupo_id::text));

create policy login_multi_tenant_clientes_insert on public.clientes
  for insert to authenticated
  with check (
    public.login_grupo_autorizado(grupo_id::text)
    and public.tiene_capacidad(auth.uid(), 'clientes:fn_guardar_cliente')
  );

create policy login_multi_tenant_clientes_update on public.clientes
  for update to authenticated
  using (public.login_grupo_autorizado(grupo_id::text))
  with check (
    public.login_grupo_autorizado(grupo_id::text)
    and public.tiene_capacidad(auth.uid(), 'clientes:fn_guardar_cliente')
  );

create policy login_multi_tenant_clientes_delete on public.clientes
  for delete to authenticated
  using (
    public.login_grupo_autorizado(grupo_id::text)
    and public.tiene_capacidad(auth.uid(), 'clientes:fn_guardar_cliente')
  );

revoke all on public.clientes from anon;
grant select, insert, update, delete on public.clientes to authenticated;

-- ---------------------------------------------------------------------------
-- 6) SALAS_JUEGO
-- ---------------------------------------------------------------------------
-- Cada sala pertenece a un grupo (`grupo_id`). Se cierra `anon` y se dejan las
-- cuatro operaciones al personal autenticado del tenant.
alter table public.salas_juego enable row level security;

drop policy if exists login_multi_tenant_salas_select on public.salas_juego;
drop policy if exists login_multi_tenant_salas_insert on public.salas_juego;
drop policy if exists login_multi_tenant_salas_update on public.salas_juego;
drop policy if exists login_multi_tenant_salas_delete on public.salas_juego;

create policy login_multi_tenant_salas_select on public.salas_juego
  for select to authenticated
  using (public.login_grupo_autorizado(grupo_id::text));

create policy login_multi_tenant_salas_insert on public.salas_juego
  for insert to authenticated
  with check (public.login_grupo_autorizado(grupo_id::text));

create policy login_multi_tenant_salas_update on public.salas_juego
  for update to authenticated
  using (public.login_grupo_autorizado(grupo_id::text))
  with check (public.login_grupo_autorizado(grupo_id::text));

create policy login_multi_tenant_salas_delete on public.salas_juego
  for delete to authenticated
  using (public.login_grupo_autorizado(grupo_id::text));

revoke all on public.salas_juego from anon;
grant select, insert, update, delete on public.salas_juego to authenticated;

-- ---------------------------------------------------------------------------
-- 7) CHAT_MENSAJES
-- ---------------------------------------------------------------------------
-- Las escrituras van por service_role (API / bot), nunca con la llave pública.
-- El SELECT de `anon` se conserva porque `ChatSalaPanel` se suscribe al canal
-- realtime con la llave del navegador; sin esa policy la sala en vivo muere.
alter table public.chat_mensajes enable row level security;

drop policy if exists "Permitir lectura publica chat_mensajes" on public.chat_mensajes;
drop policy if exists "Permitir insercion chat_mensajes" on public.chat_mensajes;
drop policy if exists "Permitir actualizacion chat_mensajes" on public.chat_mensajes;
drop policy if exists login_multi_tenant_chat_select_anon on public.chat_mensajes;
drop policy if exists login_multi_tenant_chat_select on public.chat_mensajes;
drop policy if exists login_multi_tenant_chat_insert on public.chat_mensajes;
drop policy if exists login_multi_tenant_chat_update on public.chat_mensajes;
drop policy if exists login_multi_tenant_chat_delete on public.chat_mensajes;

create policy login_multi_tenant_chat_select_anon on public.chat_mensajes
  for select to anon
  using (true);

create policy login_multi_tenant_chat_select on public.chat_mensajes
  for select to authenticated
  using (public.login_grupo_autorizado(grupo_id::text));

create policy login_multi_tenant_chat_insert on public.chat_mensajes
  for insert to authenticated
  with check (public.login_grupo_autorizado(grupo_id::text));

create policy login_multi_tenant_chat_update on public.chat_mensajes
  for update to authenticated
  using (public.login_grupo_autorizado(grupo_id::text))
  with check (public.login_grupo_autorizado(grupo_id::text));

create policy login_multi_tenant_chat_delete on public.chat_mensajes
  for delete to authenticated
  using (public.login_grupo_autorizado(grupo_id::text));

revoke insert, update, delete on public.chat_mensajes from anon;
grant select on public.chat_mensajes to anon;
grant select, insert, update, delete on public.chat_mensajes to authenticated;

-- ============================================================================
-- VERIFICACIÓN RÁPIDA
-- ============================================================================
-- select codigo_sala, nombre, es_principal from public.grupos_venta order by codigo_sala;
-- select tablename, policyname, cmd from pg_policies
-- where schemaname = 'public'
--   and tablename in ('grupos_venta','clientes','salas_juego','chat_mensajes')
-- order by tablename, cmd;
-- ============================================================================
