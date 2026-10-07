-- ============================================================================
-- SEMILLA DE GRUPOS DE VENTA  (para Marcas y para el resto del sistema)
--
-- POR QUE ESTE ARCHIVO EXISTE
-- La venta de Marcas es SIEMPRE Grupo -> Cliente. Verificado en la base real
-- (2026-09-27): `grupos_venta` tiene 0 filas, `clientes_grupos` tiene 0 filas y
-- TODOS los clientes tienen grupo_id = null. O sea que la cascada no tiene ni un
-- solo dato: el modal de venta abriria con la lista de clientes vacia y no se
-- podria cobrar nada.
--
-- Ademas, el rol `anon` (la unica credencial que tiene la app) NO puede
-- insertar en `grupos_venta` ni en `clientes_grupos`: la politica RLS los
-- bloquea con 42501. Se comprobo a proposito. Por eso esta semilla se ejecuta
-- desde el SQL Editor y no desde la app.
--
-- ORDEN DE EJECUCION
--   1) sql/marcas_venta.sql      (tabla marcas_carrera + las 3 RPC)
--   2) ESTE ARCHIVO               (grupos y pertenencias)
--   3) node pruebas/e2e-marcas.mjs
--
-- Es idempotente: se puede volver a ejecutar sin duplicar nada.
-- ============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1) Los dos grupos base.
--
-- `es_principal` marca el grupo dueno de la contabilidad: es el que se propone
-- cuando se crea un cliente. `cupo_tabla` son las tablas que recibe cada tabla
-- nueva del dia.
-- -----------------------------------------------------------------------------
insert into public.grupos_venta (nombre, moneda, es_principal, cupo_tabla, activo)
values
  ('PRINCIPAL', 'USD', true,  100, true),
  ('SECUNDARIO', 'USD', false, 100, true)
on conflict (nombre) do update
   set activo = true,
       moneda = excluded.moneda;

-- -----------------------------------------------------------------------------
-- 2) Que un grupo principal exista de verdad.
--
-- `es_principal` no tiene restriccion de unicidad en la base, asi que este
-- script podria dejar dos grupos marcados como principales y la app elegiria
-- cualquiera. Se deja exactamente uno.
-- -----------------------------------------------------------------------------
update public.grupos_venta
   set es_principal = (nombre = 'PRINCIPAL')
 where nombre in ('PRINCIPAL', 'SECUNDARIO');

-- -----------------------------------------------------------------------------
-- 3) Clientes sin grupo al grupo principal.
--
-- Solo toca clientes SIN grupo: a quien ya tiene uno no se le cambia, porque su
-- grupo pudo ser elegido a proposito. Los que si tienen grupo pero no aparecen
-- en `clientes_grupos` se agregan al principal como multi-grupo, que es como
-- la app los lista (grupos_venta.clientes = clientes.grupo_id U clientes_grupos).
-- -----------------------------------------------------------------------------
with principal as (
  select id from public.grupos_venta where nombre = 'PRINCIPAL'
)
update public.clientes c
   set grupo_id = (select id from principal)
 where c.grupo_id is null
   and exists (select 1 from principal);

insert into public.clientes_grupos (cliente_id, grupo_id, es_principal)
select c.id, g.id, (c.grupo_id = g.id)
  from public.clientes c
 cross join (select id from public.grupos_venta where nombre = 'PRINCIPAL') g
 where c.grupo_id is not null
on conflict (cliente_id, grupo_id) do nothing;

commit;

-- ============================================================================
-- VERIFICACION (debe devolver 2 grupos y 0 clientes huerfanos)
-- ============================================================================
select nombre, moneda, es_principal, cupo_tabla, activo
  from public.grupos_venta
 order by es_principal desc, nombre;

select
  (select count(*) from public.clientes)                                    as clientes_total,
  (select count(*) from public.clientes where grupo_id is null)             as clientes_sin_grupo,
  (select count(*) from public.clientes_grupos)                            as pertenencias,
  (select count(*) from public.grupos_venta where activo)                   as grupos_activos;

-- Si `clientes_sin_grupo` es > 0, la cascada sigue incompleta.

-- ============================================================================
-- REVERSIÓN
--
-- Solo si se sembró esto y nada más se ha guardado. Ojo: `delete` en clientes
-- pondría `grupo_id` a null y el modal de venta volvería a quedar vacío.
-- ============================================================================
-- begin;
--   delete from public.clientes_grupos
--     where grupo_id in (select id from public.grupos_venta where nombre in ('PRINCIPAL','SECUNDARIO'));
--   update public.clientes set grupo_id = null
--    where grupo_id in (select id from public.grupos_venta where nombre in ('PRINCIPAL','SECUNDARIO'));
--   delete from public.grupos_venta where nombre in ('PRINCIPAL','SECUNDARIO');
-- commit;
