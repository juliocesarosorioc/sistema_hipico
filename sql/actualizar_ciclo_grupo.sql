-- ============================================================================
-- ACTUALIZAR EL CICLO DE UN GRUPO — RPC de escritura de dia_inicio/fin_semana
-- ============================================================================
-- ES IDEMPOTENTE. Aplicarlo varias veces no cambia nada.
-- Ejecutar en el SQL Editor de Supabase.
--
-- ----------------------------------------------------------------------------
-- POR QUÉ EXISTE
-- ----------------------------------------------------------------------------
-- `grupos_venta` tiene RLS encendido con policy SOLO de lectura
-- (grupos_venta_lectura.sql + semana_vigente.sql). Un UPDATE desde el cliente
-- se traduce en 0 filas SIN error (PostgREST no avisa: la fila queda oculta
-- por RLS), y la RPC del legacy `club_actualizar_grupo` NO escribe los días
-- del ciclo. Resultado real: "Editar Fecha Inicio / Fin" del dashboard decía
-- "actualizado" y no cambiaba nada.
--
-- Esta función es la única vía de escritura de `dia_inicio_semana` /
-- `dia_fin_semana` desde la app, con el mismo patrón que
-- `club_fijar_semana_vigente` (sql/semana_vigente.sql): `security definer`
-- porque la app nunca escribe estas columnas con un update suelto, y
-- validación del rango 1..7 (1=Lunes … 7=Domingo).
--
-- El front llama a esta RPC desde `actualizarGrupo` (src/lib/grupos.ts)
-- cuando el patch trae los días del ciclo. La función es `security definer`:
-- el RLS NO la frena (la ejecuta el dueño), por eso se revoca el EXECUTE a
-- `anon`/`public` y solo se deja a `authenticated` — la llave pública del
-- navegador no debe poder mover el ciclo.
-- ----------------------------------------------------------------------------

create or replace function public.club_actualizar_ciclo_grupo(
  p_grupo_id   uuid,
  p_dia_inicio int default null,
  p_dia_fin    int default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dia_inicio int;
  v_dia_fin    int;
  v_row        public.grupos_venta%rowtype;
begin
  select * into v_row from public.grupos_venta where id = p_grupo_id;
  if not found then
    raise exception 'El grupo % no existe.', p_grupo_id
      using errcode = 'P0002';
  end if;

  -- DEFAULT NULL = dejar el día que ya tiene el grupo (patch parcial).
  v_dia_inicio := coalesce(p_dia_inicio, v_row.dia_inicio_semana, 1);
  v_dia_fin    := coalesce(p_dia_fin, v_row.dia_fin_semana, 7);

  if v_dia_inicio not between 1 and 7 or v_dia_fin not between 1 and 7 then
    raise exception 'Los días de inicio y corte van de 1 (lunes) a 7 (domingo).'
      using errcode = '22003';
  end if;

  update public.grupos_venta
     set dia_inicio_semana = v_dia_inicio,
         dia_fin_semana    = v_dia_fin
   where id = p_grupo_id;
end;
$$;

comment on function public.club_actualizar_ciclo_grupo(uuid, int, int) is
  'Actualiza los días de inicio y corte del ciclo de un grupo (1=Lunes..7=Domingo).';

-- EXECUTE solo a los autenticados (mismo criterio que la de semana vigente).
revoke execute on function public.club_actualizar_ciclo_grupo(uuid, int, int) from public, anon;
grant execute on function public.club_actualizar_ciclo_grupo(uuid, int, int) to authenticated;