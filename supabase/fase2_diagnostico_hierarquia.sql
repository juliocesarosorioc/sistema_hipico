-- ============================================================================
-- FASE 2 · DIAGNÓSTICO DE LA JERARQUÍA (NIVEL 0 → 3) — SOLO LECTURA
-- ============================================================================
-- Corré esto en el SQL Editor de Supabase para verificar que la estructura
-- multi-tenant/RBAC quedó aplicada. NO modifica nada: es un examen de la base.
--
--   NIVEL 0  Super Admin     → usuario_sistema.es_principal = true  (josorioc)
--   NIVEL 1  Grupo           → public.grupos_venta
--   NIVEL 2  Admin de grupo  → usuario_sistema tipo 'admin'  + grupo_id
--   NIVEL 3  Operador        → usuario_sistema tipo 'operador' + grupo_id
--
-- Orden de aplicación previo (si algo falta, el preflight lo dice):
--   1. src/db/seguridad_maestro.sql        (esquema de seguridad + resolutores)
--   2. src/db/maestro_seed.sql             (capacidades + tipos + josorioc)
--   3. sql/plataforma_tablas.sql           (grupos_venta)
--   4. sql/grupos_usuarios.sql             (usuario_sistema.grupo_id)
--   5. sql/negocio/rls-negocio.sql         (RLS encendido, policies abiertas)
--   6. sql/rls_por_grupo.sql               (CAMBIA a policies por grupo)
--   7. supabase/seed_superadmin.sql        (candado de inmutabilidad de josorioc)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- PREFLIGHT — no examinar un esquema a medio instalar.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.usuario_sistema') is null then
    raise exception 'Falta src/db/seguridad_maestro.sql (no existe public.usuario_sistema).';
  end if;
  if to_regclass('public.grupos_venta') is null then
    raise exception 'Falta sql/plataforma_tablas.sql (no existe public.grupos_venta).';
  end if;
  if to_regclass('public.clientes') is null then
    raise exception 'Falta el esquema de negocio (no existe public.clientes).';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 1. NIVEL 0 — los super administradores (debe haber UNO: josorioc)
-- ---------------------------------------------------------------------------
select 'NIVEL 0 · SUPER ADMIN' as seccion,
       id                                 as usuario,
       nombre,
       es_principal,
       activo
  from public.usuario_sistema
 where es_principal
 order by id;

-- ---------------------------------------------------------------------------
-- 2. NIVEL 1 — los grupos de venta
-- ---------------------------------------------------------------------------
select 'NIVEL 1 · GRUPOS' as seccion,
       g.nombre,
       g.moneda,
       g.es_principal,
       g.activo,
       (select count(*) from public.usuario_sistema u where u.grupo_id = g.id) as personal
  from public.grupos_venta g
 order by g.es_principal desc, g.nombre;

-- ---------------------------------------------------------------------------
-- 3. NIVEL 2/3 — el personal de cada grupo (admin / operador)
-- ---------------------------------------------------------------------------
select 'NIVEL 2/3 · PERSONAL' as seccion,
       coalesce(g.nombre, '(sin grupo)') as grupo,
       u.id                              as usuario,
       t.nombre                          as rol,
       u.activo
  from public.usuario_sistema u
  left join public.grupos_venta  g on g.id     = u.grupo_id
  left join public.tipo_usuario  t on t.id     = u.tipo_usuario_id
 order by g.es_principal desc nulls last, g.nombre, t.nombre, u.id;

-- ---------------------------------------------------------------------------
-- 4. PERTENENCIA — la columna que lee la RLS
-- ---------------------------------------------------------------------------
select 'PERTENENCIA · COLUMNA GRUPO_ID' as seccion,
       table_name, column_name, data_type
  from information_schema.columns
 where table_schema = 'public'
   and table_name   = 'usuario_sistema'
   and column_name  = 'grupo_id';

-- ---------------------------------------------------------------------------
-- 5. RESOLUTORES — las funciones que decide el grupo/rol
-- ---------------------------------------------------------------------------
select 'RESOLUTORES DE GRUPO' as seccion, proname as funcion
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and proname in ('usuario_en_grupo','usuario_en_cliente','ve_todos_los_grupos',
                   'grupo_del_usuario','soy_principal','tiene_capacidad',
                   'usuario_de','puede_contexto')
 order by proname;

-- ---------------------------------------------------------------------------
-- 6. RLS encendido — sin esto las policies por grupo son adornos
-- ---------------------------------------------------------------------------
select 'RLS ENCENDIDO' as seccion,
       c.relname                                as tabla,
       c.relrowsecurity                         as rls_on,
       c.relforcerowsecurity                    as forzado
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relname in ('usuario_sistema','tipo_usuario','capacidad',
                     'tipo_usuario_capacidad','usuario_capacidad',
                     'grupos_venta','clientes','tickets_apuestas',
                     'depositos','transacciones_financieras')
 order by c.relname;

-- ---------------------------------------------------------------------------
-- 7. POLICIES aplicadas — la frontera real por tabla
-- ---------------------------------------------------------------------------
select 'POLICIES POR TABLA' as seccion,
       tablename, policyname, cmd, roles
  from pg_policies
 where schemaname = 'public'
   and tablename in ('clientes','tickets_apuestas','tickets_jugadas',
                     'notificaciones','solicitudes_tablas','dupletas',
                     'transacciones_financieras','depositos','usuario_sistema')
 order by tablename, cmd, policyname;

-- ---------------------------------------------------------------------------
-- 8. ALERTAS — anti-patrones que romperían el aislamiento
-- ---------------------------------------------------------------------------
do $$
declare
  v_principales  int;
  v_admin_singr  int;
  v_oper_singr   int;
  v_msg          text := 'TODO OK: jerarquía NIVEL 0→3 y RLS coherentes.';
begin
  select count(*) into v_principales from public.usuario_sistema where es_principal;

  select count(*) into v_admin_singr
    from public.usuario_sistema u
    join public.tipo_usuario t on t.id = u.tipo_usuario_id
   where lower(t.nombre) = 'admin' and u.grupo_id is null and not u.es_principal;

  select count(*) into v_oper_singr
    from public.usuario_sistema u
    join public.tipo_usuario t on t.id = u.tipo_usuario_id
   where lower(t.nombre) = 'operador' and u.grupo_id is null;

  if v_principales <> 1 then
    v_msg := format('ATENCIÓN: %s usuarios con es_principal (debe ser 1: josorioc).', v_principales);
  elsif v_admin_singr > 0 then
    v_msg := format('ATENCIÓN: %s admin(s) sin grupo y sin ser principal (ve(n) TODO por retrocompatibilidad).', v_admin_singr);
  elsif v_oper_singr > 0 then
    v_msg := format('ATENCIÓN: %s operador(es) sin grupo (le queda(n) sin aislamiento).', v_oper_singr);
  end if;

  raise notice '[FASE 2] %', v_msg;
end
$$;

-- ============================================================================
-- CÓMO LEERLO
--   1. Debe aparecer exactamente UN super admin (josorioc).
--   2. Cada grupo del NIVEL 1 debe tener su admin (NIVEL 2) y operadores
--      (NIVEL 3) con grupo_id cargado.
--   3. Las tablas de negocio deben listar rls_on = true y sus policies por
--      grupo (usuario_en_grupo / usuario_en_cliente).
--   4. Si las tablas de negocio NO listan policies (fila vacía), corré
--      sql/rls_por_grupo.sql y volvé a examinar.
-- ============================================================================