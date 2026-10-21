-- ============================================================================
-- FASE 1 · ROL "DUEÑO DE GRUPO" / BANQUERO — RBAC + aislamiento
-- ============================================================================
--
-- POR QUÉ
-- ---------------------------------------------------------------------------
-- El club necesitaba un rol intermedio entre Admin y Operador: el DUEÑO DE
-- GRUPO (también llamado banquero). No es un admin —no debe ver ni tocar los
-- otros grupos— y no es un operador —necesita gestionar sus clientes, saldos,
-- comisiones y límites—. Este script:
--
--   1. Da de alta los tipos de usuario `admin_grupo` y `banquero` si no existen.
--   2. Les asigna la matriz base desde los MISMOS módulos que un admin, menos
--      el maestro de seguridad (que queda solo para el SuperAdmin).
--   3. Se apoya en los resolutores de grupo que YA existen
--      (`public.grupo_del_usuario`, `public.usuario_en_grupo`, `public.usuario_en_cliente`
--      → ver sql/grupos_usuarios.sql) para el aislamiento por RLS.
--
-- LO QUE **NO** HACE ESTE ARCHIVO (a propósito)
-- ---------------------------------------------------------------------------
-- Las reglas ABAC y el catálogo de atributos NO se escriben acá a mano: se
-- GENERAN desde el registro maestro en TypeScript con
--
--     node pruebas/generar-seed-maestro.mjs
--
-- y quedan en `src/core/db/maestro_seed.sql`. La razón está escrita en
-- `src/core/db/seguridad_maestro.sql` (líneas 216-219): si la copia SQL y la
-- copia TS divergen, la UI muestra un botón habilitado que la base rebota. Las
-- reglas de aislamiento del dueño de grupo (`clientes:*:mismo_grupo`,
-- `grupos:guardar:mismo_grupo`, `contabilidad:mismo_grupo`, con el operador
-- `en_atributo` sobre los atributos `grupo` / `usuario_grupos`) se declaran en
-- `src/features/seguridad/lib/abac.ts` y viajan al seed por ese generador.
--
-- CÓMO EJECUTARLO
-- ---------------------------------------------------------------------------
-- 1. Regenerar/pegar `src/core/db/maestro_seed.sql` (trae atributos + reglas).
-- 2. Pegar TODO este archivo en el SQL Editor de Supabase y correr.
-- Requiere que `src/core/db/seguridad_maestro.sql` ya esté aplicado (crea
-- `capacidad`, `tipo_usuario`, `tipo_usuario_capacidad`, `atributo`,
-- `regla_abac`, `usuario_atributo`).
--
-- ES IDEMPOTENTE: se puede correr las veces que haga falta. NO borra datos.
--
-- NO se ejecuta desde el repositorio: el proyecto corre con `output: "export"`
-- y no tiene conexión privilegiada a la base.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) TIPOS DE USUARIO
-- ---------------------------------------------------------------------------
-- `es_principal` queda en false: el dueño de grupo NO es el principal. Si lo
-- fuera, el RBAC le daría acceso total por la precedencia de `resolver.ts`.
insert into public.tipo_usuario (nombre, descripcion, activo, es_principal)
values
  ('admin_grupo', 'Dueño de Grupo / Banquero: administra solo su grupo, aislado por RLS y ABAC.', true, false),
  ('banquero',    'Banquero por modalidad: cobra comisiones y gestiona convenios de su grupo.',     true, false)
on conflict (nombre) do update
  set descripcion = excluded.descripcion,
      activo      = excluded.activo,
      es_principal = false;

-- ---------------------------------------------------------------------------
-- 2) MATRIZ BASE del rol (los módulos del club, sin el maestro de seguridad)
-- ---------------------------------------------------------------------------
-- Se copian TODAS las capacidades de los módulos que el dueño de grupo usa.
-- `seguridad` queda FUERA a propósito: administrar el maestro es de SuperAdmin.
--
-- El copy es por MÓDULO (no una lista fija): así, cuando el registro maestro
-- suma una capacidad nueva a `clientes`, el dueño de grupo la hereda sin tocar
-- este script otra vez.
with modulos_grupo as (
  select unnest(array[
    'general', 'clientes', 'grupos', 'jugadas', 'contabilidad', 'tickets', 'portal'
  ]) as modulo
),
caps as (
  select c.id as capacidad_id
  from public.capacidad c
  join modulos_grupo m on m.modulo = c.modulo
)
insert into public.tipo_usuario_capacidad (tipo_usuario_id, capacidad_id)
select tu.id, caps.capacidad_id
from public.tipo_usuario tu
cross join caps
where tu.nombre in ('admin_grupo', 'banquero')
on conflict (tipo_usuario_id, capacidad_id) do nothing;

-- ---------------------------------------------------------------------------
-- 3) ATRIBUTO DE USUARIO `usuario_grupos` (para el que no tenga grupo_id)
-- ---------------------------------------------------------------------------
-- Los resolutores de `grupos_usuarios.sql` trabajan con `usuario_sistema.grupo_id`
-- (un grupo por usuario). Un banquero que administra VARIOS grupos necesita una
-- lista: el atributo `usuario_grupos` (declarado en abac.ts) la guarda. Se
-- garantiza acá que exista la fila del catálogo por si el seed todavía no se
-- regeneró; si ya existe, no se toca.
insert into public.atributo (clave, nombre, tipo, descripcion, origen)
values
  ('grupo', 'Grupo del registro', 'texto',
   'Grupo de venta del registro (cliente, ticket, movimiento). Aísla a cada dueño de grupo.',
   'registro.grupo_id'),
  ('usuario_grupos', 'Grupos asignados al usuario', 'lista',
   'Grupos de venta del usuario de la sesión. El dueño de grupo administra solo los suyos.',
   'usuario.grupos')
on conflict (clave) do nothing;

-- ---------------------------------------------------------------------------
-- 4) ASIGNARLE AL USUARIO SU(S) GRUPO(S)
-- ---------------------------------------------------------------------------
-- Al usuario con tipo `admin_grupo`/`banquero` se le marca su grupo primario en
-- `usuario_sistema.grupo_id` (lo que ya leen `grupo_del_usuario`/`usuario_en_grupo`)
-- y, si administra más de uno, se completa el array `usuario_grupos`. Ejemplo
-- COMENTADO porque toca datos reales: descomentar y ajustar `usuario`/`grupo`.
--
-- update public.usuario_sistema
--    set grupo_id = (select id from public.grupos_venta where nombre = 'ARGENTINA')
--  where id = '<usuario_sistema.id>';
--
-- insert into public.usuario_atributo (usuario_id, atributo_id, valor)
-- select '<usuario_sistema.id>',
--        (select id from public.atributo where clave = 'usuario_grupos'),
--        jsonb_build_array('ARGENTINA', 'MVP')
-- on conflict (usuario_id, atributo_id) do update set valor = excluded.valor;

commit;

-- ============================================================================
-- NOTAS
-- ----------------------------------------------------------------------------
-- · El aislamiento del dueño de grupo queda en DOS capas: ABAC (decide si el
--   botón/función se habilita, en el cliente, mirando el grupo del registro
--   contra `usuario_grupos`) y RLS (decide si la fila se lee o escribe, en la
--   base, vía `grupo_del_usuario`/`usuario_en_grupo`). Ninguna de las dos sola
--   alcanza: ABAC sin RLS deja la anon-key leyendo todo, y RLS sin ABAC deja
--   botones que fallan al apretarlos.
-- · Si `tickets_apuestas` no tiene columna `grupo_id` en esta instalación, el
--   ABAC sigue anclando el ticket al grupo del cliente que juega hasta que se
--   corra la migración que la agrega (ver sql/multi_grupos.sql).
-- · Para auditar quién cambió la matriz, el maestro ya escribe en
--   `public.auditoria` vía `club_log_accion`; no hace falta nada extra acá.
-- ============================================================================
