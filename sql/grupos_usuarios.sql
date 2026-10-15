-- ============================================================================
-- USUARIOS POR GRUPO DE VENTA — a qué grupo pertenece cada login
-- ============================================================================
--
-- Ejecutar DESPUÉS de src/db/seguridad_maestro.sql y de los scripts de grupos
-- (sql/banqueros.sql, que crea/usa `grupos_venta`). Idempotente: se puede correr
-- las veces que haga falta.
--
-- ----------------------------------------------------------------------------
-- EL PROBLEMA
-- ----------------------------------------------------------------------------
-- El sistema maneja varios GRUPOS DE VENTA (ARGENTINA, MVP, FORTUNA, ...), pero
-- un login del personal NO pertenece a ninguno: `usuario_sistema` sabe el TIPO
-- que tiene (admin, operador...) y no a qué grupo sirve. Así, quien entra como
-- cajero de un grupo ve los clientes, las jugadas y la contabilidad de TODOS.
--
-- Este archivo agrega esa pertenencia y los resolutores que la consultan.
-- El filtrado real de las tablas de negocio lo hace sql/rls_por_grupo.sql, que
-- se apoya en estas funciones.
--
-- ----------------------------------------------------------------------------
-- LA REGLA
-- ----------------------------------------------------------------------------
--   * Un usuario CON grupo  → ve y toca SOLO su grupo.
--   * Un usuario SIN grupo  → ve TODO (retrocompatible: mientras se migran los
--                             usuarios que ya existen, no se les rompe nada).
--   * El usuario principal  → ve TODO siempre (es el super administrador y
--                             además tiene el filtro "ver todos" en la app).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) PERTENENCIA — usuario_sistema.grupo_id
-- ---------------------------------------------------------------------------
-- Nullable a propósito: lo que no está asignado se comporta como "ve todo"
-- (ver `ve_todos_los_grupos`), así este archivo se puede aplicar sin migrar a
-- nadie primero. La asignación va al final, en la sección de migración.
alter table public.usuario_sistema
  add column if not exists grupo_id uuid references public.grupos_venta(id) on delete set null;

create index if not exists usuario_sistema_grupo_idx
  on public.usuario_sistema (grupo_id);

comment on column public.usuario_sistema.grupo_id is
  'Grupo de venta al que pertenece el login. NULL = todavía sin asignar (ve todos).';

-- ---------------------------------------------------------------------------
-- 2) RESOLUTORES (security definer: leen usuario_sistema sin pasar por su RLS)
-- ---------------------------------------------------------------------------
-- El grupo del usuario de una petición. `auth.uid()` es el uuid de Supabase y
-- `usuario_de()` es la puerta que ata esa petición a una fila (por `auth_id` o
-- por el correo exacto, ver seguridad_maestro.sql).
create or replace function public.grupo_del_usuario(u uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select us.grupo_id from public.usuario_de(u) us;
$$;

-- ¿Este usuario ve TODOS los grupos? El principal siempre, y también quien no
-- tiene grupo asignado todavía (retrocompatible).
create or replace function public.ve_todos_los_grupos(u uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select p.es_principal or p.grupo_id is null
    from public.usuario_de(u) p
  ), false);
$$;

-- ¿El usuario `u` puede ver/tocar una fila del grupo `g`?
-- El grupo llega como TEXTO a propósito: así la misma función sirve si la
-- columna del negocio es `uuid` (lo normal hoy) o `text`/`bigint` (alguna tabla
-- vieja). La comparación siempre es por texto.
--
--   * ve todos           → sí (cualquier grupo, incluso NULL)
--   * tiene un grupo     → sí, solo si la fila es de ESE grupo
--   * fila sin grupo (g NULL) y el usuario sí tiene grupo → NO
create or replace function public.usuario_en_grupo(u uuid, g text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.ve_todos_los_grupos(u)
      or (g is not null and public.grupo_del_usuario(u)::text = g);
$$;

-- El grupo de un cliente, sin pasar por el RLS de `clientes`. Se usa en las
-- policies que solo tienen el `cliente_id` (p. ej. un ticket sin `grupo_cobro_id`)
-- y no deben disparar la RLS de `clientes` desde adentro de otra policy.
create or replace function public.grupo_del_cliente(cid text)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.grupo_id from public.clientes c where c.id::text = cid limit 1;
$$;

-- Igual que `usuario_en_grupo`, pero para filas que no traen grupo propio: se
-- resuelve por el grupo del cliente (`cliente_juega_id`). Si el cliente no
-- existe o no tiene grupo, no se puede afirmar pertenencia → false.
create or replace function public.usuario_en_cliente(u uuid, cid text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.ve_todos_los_grupos(u)
      or exists (
           select 1
           from public.clientes c
           where c.id::text = cid
             and c.grupo_id is not null
             and c.grupo_id::text = public.grupo_del_usuario(u)::text
         );
$$;

revoke all on function public.grupo_del_usuario(uuid)   from public, anon;
revoke all on function public.ve_todos_los_grupos(uuid) from public, anon;
revoke all on function public.usuario_en_grupo(uuid, text) from public, anon;
revoke all on function public.usuario_en_cliente(uuid, text) from public, anon;
revoke all on function public.grupo_del_cliente(text)   from public, anon;
grant execute on function public.grupo_del_usuario(uuid)   to authenticated;
grant execute on function public.ve_todos_los_grupos(uuid) to authenticated;
grant execute on function public.usuario_en_grupo(uuid, text) to authenticated;
grant execute on function public.usuario_en_cliente(uuid, text) to authenticated;
grant execute on function public.grupo_del_cliente(text)   to authenticated;

-- ---------------------------------------------------------------------------
-- 3) RPC PARA EL NAVEGADOR — club_mi_grupo()
-- ---------------------------------------------------------------------------
-- Devuelve el grupo del usuario que consulta, para que la app sepa con qué
-- grupo entra (y si puede ver todos). Es `security definer` para no depender de
-- la RLS de `usuario_sistema`, que hoy solo deja leer la fila propia cuando el
-- `id` coincide con el correo del JWT (cosa que no siempre pasa).
create or replace function public.club_mi_grupo()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with f as (select * from public.usuario_de(auth.uid()))
  select jsonb_build_object(
    'grupo_id',
      (select us.grupo_id from f us),
    'grupo_nombre',
      (select g.nombre from public.grupos_venta g
        where g.id = (select us.grupo_id from f us)),
    've_todos',
      coalesce((select (us.es_principal or us.grupo_id is null) from f us), false),
    'es_principal',
      coalesce((select us.es_principal from f us), false)
  );
$$;

revoke all on function public.club_mi_grupo() from public, anon;
grant execute on function public.club_mi_grupo() to authenticated;

-- Verificación: al correr este archivo, el resultado debe ser 6. Si sale menos,
-- algo de arriba falló y hay que ver el error antes de seguir con rls_por_grupo.sql.
select count(distinct p.proname) as resolutores_creados
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'grupo_del_usuario', 've_todos_los_grupos', 'usuario_en_grupo',
    'usuario_en_cliente', 'grupo_del_cliente', 'club_mi_grupo'
  );

-- ============================================================================
-- MIGRACIÓN — asignar los usuarios que ya existen
-- ============================================================================
-- Sin `service_role` desde acá no se pueden leer los usuarios, así que las
-- asignaciones se hacen a mano con las consultas de abajo.
--
-- (A) LISTAR quién hay y a qué grupo está asignado:
--
--   select us.id, us.nombre, tu.nombre as tipo, us.activo,
--          coalesce(g.nombre, '— SIN GRUPO —') as grupo
--   from public.usuario_sistema us
--   left join public.tipo_usuario tu on tu.id = us.tipo_usuario_id
--   left join public.grupos_venta g on g.id = us.grupo_id
--   order by g.nombre nulls first, us.id;
--
-- (B) ASIGNAR por lista de usuarios. Reemplazá el nombre del grupo y los ids:
--
--   update public.usuario_sistema
--      set grupo_id = (select id from public.grupos_venta where nombre = 'ARGENTINA')
--    where id in ('usuario1', 'usuario2', 'usuario3');
--
--   update public.usuario_sistema
--      set grupo_id = (select id from public.grupos_venta where nombre = 'MVP')
--    where id in ('usuario4', 'usuario5');
--
-- (C) Un usuario sin grupo ve todo (retrocompatible). Para acotarlo, asignale
--     un grupo. El principal (josorioc) SIEMPRE ve todo.
--
-- (D) Para dejar constancia de qué grupos existen hoy:
--
--   select id, nombre, es_principal, activo from public.grupos_venta order by nombre;
-- ============================================================================
