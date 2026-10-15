-- ============================================================================
-- FIX: public.tiene_capacidad devolvia NULL sin fila de usuario
-- ============================================================================
-- Que arregla
-- -----------
-- `tiene_capacidad(u, clave)` armaba su resultado como
--     (es_principal) OR (excepcion) OR (base del tipo)
-- Sin fila en `usuario_sistema` (o con `u` null, como el rol `anon`) las tres
-- ramas dan NULL. `NULL OR ...` es NULL, y en un guard
--     if not public.tiene_capacidad(auth.uid(), '...') then raise ...
-- `not NULL` es NULL: el `IF` NO dispara y la RPC sigue de largo. O sea que el
-- guard "cerraba en falso" solo en el comentario, no en la practica.
--
-- El arreglo envuelve todo el resultado en `coalesce(..., false)`. No cambia la
-- logica de permiso: solo garantiza que la funcion devuelva un booleano de
-- verdad. Las policies no se veian afectadas (en un WHERE, NULL ya es false),
-- pero cualquier guard `if not ...` si.
--
-- Idempotente: `create or replace` conserva los grants y el owner.
-- Ejecutar en el SQL Editor de Supabase. Aplicar ANTES de confiar en los guards
-- de `sql/remate_cierre.sql` y `sql/remate_pujas_rpc.sql`.
-- ============================================================================

create or replace function public.tiene_capacidad(u uuid, clave text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with fila as (select * from public.usuario_de(u))
  select coalesce(
    -- 1. principal
    (select f.es_principal from fila f)
    -- 2. excepción individual: decide sola, y su "denegado" gana
    or coalesce((
        select case uc.decision
                 when 'permitido' then true
                 when 'denegado'  then false
               end
        from fila f
        join public.usuario_capacidad uc on uc.usuario_id = f.id
        join public.capacidad c on c.id = uc.capacidad_id
        where f.activo and c.clave = clave
        limit 1
      ), false)
    -- 3. base del tipo
    or exists (
        select 1
        from fila f
        join public.tipo_usuario tu on tu.id = f.tipo_usuario_id
        join public.tipo_usuario_capacidad tc on tc.tipo_usuario_id = tu.id
        join public.capacidad c on c.id = tc.capacidad_id
        where f.activo and tu.activo and c.clave = clave
          and coalesce(tc.decision, 'heredado') <> 'denegado'
      ),
    false
  );
$$;

-- Mismos permisos que antes: la matriz solo se consulta con sesion.
revoke all on function public.tiene_capacidad(uuid, text) from public, anon;
grant execute on function public.tiene_capacidad(uuid, text) to authenticated;
