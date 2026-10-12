-- ============================================================================
-- SEED DEL SUPER ADMINISTRADOR (NIVEL 0) — blindaje de "josorioc"
-- ============================================================================
-- Ejecutar en el SQL Editor de Supabase. Idempotente: se puede correr las veces
-- que haga falta.
--
-- ----------------------------------------------------------------------------
-- COMPATIBILIDAD CON EL ESQUEMA REAL (importante)
-- ----------------------------------------------------------------------------
-- Este script NO crea tablas nuevas tipo `grupos`, `perfiles_usuarios` ni
-- `roles`. La plataforma YA tiene su modelo multi-tenant + RBAC montado, y
-- duplicarlo dejaría dos verdades contradictorias. El mapeo es:
--
--   NIVEL 0  Super Admin        → usuario_sistema.es_principal = true  ("josorioc")
--   NIVEL 1  Grupo / Franquicia → public.grupos_venta
--   NIVEL 2  Admin de Grupo     → usuario_sistema.tipo_usuario = 'admin' + grupo_id
--   NIVEL 3  Operador de Grupo  → usuario_sistema.tipo_usuario = 'operador' + grupo_id
--
--   Las capacidades (los "roles"/permisos) viven en:
--     · public.capacidad               (el catálogo, generado del código)
--     · public.tipo_usuario            (los "roles": admin, operador, consulta…)
--     · public.tipo_usuario_capacidad  (la matriz rol → capacidad)
--     · public.usuario_capacidad       (excepciones por persona)
--
--   El aislamiento por grupo (Row Level Security) ya está implementado en:
--     · sql/grupos_usuarios.sql   → usuario_sistema.grupo_id + resolutores
--     · sql/rls_por_grupo.sql     → policies que exigen que la fila sea del
--                                   grupo del usuario
--   Este seed solo deja el piso (usuario_sistema.grupo_id) en su lugar y NO
--   reemplaza esas policies. Aplicá primero, en este orden:
--     1. src/db/seguridad_maestro.sql
--     2. src/db/maestro_seed.sql
--     3. sql/plataforma_tablas.sql        (crea grupos_venta)
--     4. sql/grupos_usuarios.sql
--     5. sql/negocio/rls-negocio.sql      + sql/rls_por_grupo.sql
--     6. ESTE archivo
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. GUARDA — no sigas si falta la base de seguridad
-- ----------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.usuario_sistema') is null then
    raise exception
      'Falta aplicar src/db/seguridad_maestro.sql (no existe public.usuario_sistema).';
  end if;
  if to_regclass('public.grupos_venta') is null then
    raise exception
      'Falta aplicar sql/plataforma_tablas.sql (no existe public.grupos_venta).';
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 1. TIPOS BASE — admin (NIVEL 2) y operador (NIVEL 3)
-- ----------------------------------------------------------------------------
-- El tipo "admin" es el rol del dueño/gerente de una banca; "operador" es el
-- taquillero. Se aseguran acá para que el seed funcione aunque el orden de
-- aplicación de maestro_seed.sql haya variado.
insert into public.tipo_usuario (id, nombre, descripcion)
values (1, 'admin', 'Administrador / dueño del grupo (NIVEL 2)')
on conflict (id) do update set nombre = excluded.nombre, descripcion = excluded.descripcion;

insert into public.tipo_usuario (id, nombre, descripcion)
values (2, 'operador', 'Operador de taquilla de un grupo (NIVEL 3)')
on conflict (id) do update set nombre = excluded.nombre, descripcion = excluded.descripcion;

-- ----------------------------------------------------------------------------
-- 2. GRUPO PRINCIPAL — la franquicia por defecto
-- ----------------------------------------------------------------------------
insert into public.grupos_venta (nombre, moneda, es_principal, cupo_tabla, activo)
select 'PRINCIPAL', 'USD', true, 100, true
where not exists (select 1 from public.grupos_venta where es_principal = true);

-- ----------------------------------------------------------------------------
-- 3. PERTENENCIA A GRUPO — la columna que lee la RLS
-- ----------------------------------------------------------------------------
-- Es la misma columna de sql/grupos_usuarios.sql. Se repite acá (con if not
-- exists) para que este seed sea autocontenido y no dependa del orden.
alter table public.usuario_sistema
  add column if not exists grupo_id uuid references public.grupos_venta(id) on delete set null;

create index if not exists usuario_sistema_grupo_idx
  on public.usuario_sistema (grupo_id);

-- ----------------------------------------------------------------------------
-- 4. LIMPIEZA — un solo principal
-- ----------------------------------------------------------------------------
-- Se corre ANTES de instalar el candado (más abajo), porque el candado impide
-- justamente desmarcar a un principal. Si por una migración vieja quedó más de
-- un principal, se deja solo a josorioc.
drop trigger if exists trg_proteger_usuario_principal on public.usuario_sistema;

update public.usuario_sistema
   set es_principal = false
 where es_principal = true
   and lower(id) <> 'josorioc';

-- ----------------------------------------------------------------------------
-- 5. EL SUPER ADMINISTRADOR: josorioc (NIVEL 0)
-- ----------------------------------------------------------------------------
-- `id` es la clave de login que normaliza la app (claveDeUsuario → parte local
-- en minúsculas). `es_principal = true` ⇒ acceso TOTAL por precedencia en
-- src/lib/seguridad/resolver.ts y en public.tiene_capacidad. No necesita fila
-- de grupo: ve todos los grupos.
insert into public.usuario_sistema (id, nombre, tipo_usuario_id, activo, es_principal, grupo_id)
values ('josorioc', 'Super Administrador', 1, true, true, null)
on conflict (id) do update
  set nombre          = excluded.nombre,
      tipo_usuario_id = excluded.tipo_usuario_id,
      es_principal    = true,
      activo          = true,
      grupo_id        = null;

-- ----------------------------------------------------------------------------
-- 6. CANDADO — "inmutable" de verdad (a nivel de base, no de UI)
-- ----------------------------------------------------------------------------
-- El RLS protege las tablas, pero un UPDATE con service_role o desde el SQL
-- Editor podría desactivar o desmarcar al dueño del sistema. Este trigger lo
-- impide: es la última línea. Reglas:
--   · Solo 'josorioc' puede tener es_principal = true.
--   · La fila del principal no se puede eliminar.
--   · No se puede desmarcar (es_principal = false) ni desactivar (activo = false).
--   · No se puede cambiar el identificador del principal.
create or replace function public.proteger_usuario_principal()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    if old.es_principal then
      raise exception 'El usuario principal (%) no se puede eliminar.', old.id;
    end if;
    return old;
  end if;

  if new.es_principal and lower(new.id) <> 'josorioc' then
    raise exception 'Solo "josorioc" puede ser el usuario principal del sistema.';
  end if;

  if tg_op = 'UPDATE' and old.es_principal then
    if not new.es_principal then
      raise exception 'El usuario principal (%) no se puede desmarcar.', old.id;
    end if;
    if new.activo is not true then
      raise exception 'El usuario principal (%) no se puede desactivar.', old.id;
    end if;
    if lower(new.id) <> lower(old.id) then
      raise exception 'El identificador del usuario principal no se puede cambiar.';
    end if;
  end if;

  return new;
end;
$$;

create trigger trg_proteger_usuario_principal
  before insert or update or delete on public.usuario_sistema
  for each row execute function public.proteger_usuario_principal();

-- ----------------------------------------------------------------------------
-- 7. VERIFICACIÓN (comentada: descomentá y corré para revisar)
-- ----------------------------------------------------------------------------
-- dueño del sistema:
-- select id, nombre, es_principal, activo, tipo_usuario_id, grupo_id
--   from public.usuario_sistema where lower(id) = 'josorioc';
--
-- jerarquía por grupo (NIVEL 1 → 3):
-- select g.nombre as grupo, u.id as usuario, t.nombre as rol, u.activo
--   from public.usuario_sistema u
--   left join public.grupos_venta g on g.id = u.grupo_id
--   left join public.tipo_usuario t on t.id = u.tipo_usuario_id
--  order by g.es_principal desc, g.nombre, t.nombre;
--
-- ¿quedó un solo principal?
-- select count(*) as principales from public.usuario_sistema where es_principal;
