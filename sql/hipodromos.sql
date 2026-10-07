-- ============================================================================
-- HIPODROMOS — activar todos, suspender y baja lógica
-- ============================================================================
-- Que arregla / que agrega
-- -----------------------
-- 1) ACTIVA TODOS los hipódromos registrados: los que estaban en 'Inactivo'
--    quedan en 'Activo'. El módulo los tenía ocultos y el usuario no encontraba
--    hipódromos que sí estaban cargados.
--
-- 2) `eliminado_en`: BAJA LÓGICA. Eliminar un hipódromo ya no borra la fila ni
--    rompe las FK de carreras, tablas, tickets y liquidaciones: la fila queda
--    con fecha de baja y deja de ofrecerse. Todo lo que ya se registró con ese
--    nombre sigue intacto y visible en el historial.
--
--    Reagregar un hipódromo dado de baja REACTIVA esa misma fila (mismo id, mismo
--    historial) en vez de crear una nueva: el nombre tiene índice único, así que
--    sin esto el alta del mismo hipódromo fallaba con 23505.
--
-- 3) `estado` admite 'Suspendido': el hipódromo sigue en el catálogo y se puede
--    reactivar, pero no se ofrece en los módulos de jugadas.
--
-- Que NO hace
-- -----------
-- No borra ni modifica carreras, tablas fijas, tickets ni liquidaciones.
--
-- Idempotente: se puede correr las veces que haga falta.
-- Ejecutar en el SQL Editor de Supabase (SQL puro, sin metacomandos).
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) Columnas del borrado lógico
-- ---------------------------------------------------------------------------
alter table public.hipodromos add column if not exists eliminado_en timestamptz;
alter table public.hipodromos add column if not exists eliminado_por text;

-- Una fila dada de baja NUNCA se ofrece; la lista de-selectores usa esto.
create index if not exists hipodromos_vigentes_idx
  on public.hipodromos (nombre)
  where eliminado_en is null;

create index if not exists hipodromos_estado_idx on public.hipodromos (estado);

-- `estado` puede ser 'Activo' | 'Inactivo' | 'Suspendido'.
alter table public.hipodromos alter column estado set default 'Activo';

-- Normaliza estados raros/vacíos que vinieron de la migración legacy.
update public.hipodromos
   set estado = 'Activo'
 where estado is null
    or btrim(estado) = ''
    or estado not in ('Activo', 'Inactivo', 'Suspendido');

-- ---------------------------------------------------------------------------
-- 2) ACTIVAR TODOS los hipódromos registrados
-- ---------------------------------------------------------------------------
-- Solo los que NO están dados de baja: un archivado no se reactiva en bloque.
update public.hipodromos
   set estado = 'Activo'
 where eliminado_en is null
   and coalesce(estado, '') <> 'Activo';

-- ---------------------------------------------------------------------------
-- 3) RLS: escribir solo el usuario autenticado
-- ---------------------------------------------------------------------------
alter table public.hipodromos enable row level security;

drop policy if exists hipodromos_publico on public.hipodromos;
create policy hipodromos_publico on public.hipodromos
  for all to authenticated
  using (true) with check (true);

-- OJO: la policy es solo de `authenticated`. El `grant` a `anon` de abajo no
-- abre nada — con RLS activo y sin policy para `anon`, PostgREST devuelve 0
-- filas. Se deja por compatibilidad con consultas antiguas; la app siempre
-- entra como `authenticated`.
grant usage on schema public to anon, authenticated;
grant select on public.hipodromos to anon;
grant select, insert, update, delete on public.hipodromos to authenticated, service_role;

commit;

-- ============================================================================
-- VERIFICACION
-- ============================================================================
-- 1) Ninguno queda colgado en un estado raro (debe devolver 0 filas):
--      SELECT nombre, estado FROM public.hipodromos
--       WHERE estado IS NULL OR btrim(estado) = ''
--          OR estado NOT IN ('Activo','Inactivo','Suspendido');
--
-- 2) Los registrados visibles, por estado:
--      SELECT estado, count(*) FROM public.hipodromos
--       WHERE eliminado_en IS NULL GROUP BY estado;
--
-- 3) Cuáles están archivados (deben salir vacíos la primera vez):
--      SELECT nombre, eliminado_en FROM public.hipodromos
--       WHERE eliminado_en IS NOT NULL ORDER BY eliminado_en DESC;
-- ============================================================================
