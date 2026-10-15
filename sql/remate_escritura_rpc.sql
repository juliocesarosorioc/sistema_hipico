-- ============================================================================
-- REMATES — ESCRITURAS DE LA SUBASTA VIA RPC (security definer)
-- ============================================================================
-- Que arregla
-- -----------
-- `remates` (la subasta) segia escribiendose DIRECTO desde el navegador:
--   crearRemate()            -> insert
--   eliminarRemate()         -> delete
--   guardarIncentivoRemate() -> update incentivo/incentivo_pct
--   guardarEscaleraRemate()  -> update escalera/nota_escalera
-- Con la policy `for all to anon, authenticated using(true) with check(true)`
-- de `sql/remates.sql`, cualquiera con la anon key podia crear, editar o borrar
-- remates sin sesion ni permiso.
--
-- Este script mueve esas cuatro escrituras a funciones `security definer` que
-- exigen capacidad en el SERVIDOR, y deja `remates` en SOLO LECTURA para el
-- navegador. Es el ultimo eslabon de la migracion de Remates a RPC: cierra la
-- tabla, igual que `sql/remate_pujas_rpc.sql` cerro las pujas.
--
-- Funciones
-- ---------
--   club_crear_remate(...)                 Capacidad: remates:fn_guardar_remate.
--   club_eliminar_remate(remate, usuario)  Capacidad: remates:fn_eliminar_remate.
--   club_guardar_incentivo_remate(...)     Capacidad: remates:fn_guardar_remate.
--   club_guardar_escalera_remate(...)      Capacidad: remates:fn_guardar_remate.
--
-- Las tres ultimas y la de crear rechazan si el remate esta Cerrado (para el
-- incentivo/escalera) y validan el nombre, el hipodromo y la fecha al crear.
-- El borrado cae en cascada sobre `remate_caballos` y `remate_pujas`.
--
-- Permisos
-- --------
-- Se conceden SOLO a `authenticated` y se revoca `EXECUTE` de PUBLIC/anon
-- (Postgres lo da a PUBLIC por defecto). `remates` queda SELECT-only para
-- `authenticated`; el service_role conserva la escritura.
--
-- Depende de: sql/remates.sql y sql/remate_pujas.sql (por las columnas
-- `incentivo_pct`, `escalera` y `nota_escalera`) y del fix `tiene_capacidad`.
--
-- Idempotente: se puede correr las veces que haga falta.
-- Ejecutar en el SQL Editor de Supabase (SQL puro, sin metacomandos).
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) Crear remate
-- ---------------------------------------------------------------------------
-- La firma gano `p_grupo_id` (grupo de venta del remate). Se elimina la version
-- vieja para que no queden dos sobrecargas y PostgREST no dude cual llamar.
drop function if exists public.club_crear_remate(text, uuid, text, integer, date, text, text, numeric, text, text);

create or replace function public.club_crear_remate(
  p_nombre       text,
  p_hipodromo_id uuid,
  p_hipodromo    text    default null,
  p_carrera      integer default null,
  p_fecha        date    default null,
  p_hora_cierre  text    default null,
  p_distancia    text    default null,
  p_comision_pct numeric default 20,
  p_notas        text    default null,
  p_grupo_id     uuid    default null,
  p_usuario      text    default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id     uuid;
  v_nombre text;
  v_hip    text;
begin
  if not coalesce(public.tiene_capacidad(auth.uid(), 'remates:fn_guardar_remate'), false) then
    raise exception 'Sin permiso para crear remates' using errcode = '42501';
  end if;

  v_nombre := upper(btrim(coalesce(p_nombre, '')));
  if v_nombre = '' then
    raise exception 'El remate necesita un nombre.';
  end if;
  if p_hipodromo_id is null then
    raise exception 'Elegi el hipodromo.';
  end if;
  if p_fecha is null then
    raise exception 'Elegi la fecha del programa.';
  end if;

  -- El grupo de venta es opcional: si viene, define el banquero de la modalidad
  -- REMATES para todos los tickets del remate. Sin grupo, el ticket queda como
  -- antes (`grupo = 'REMATE'`, sin banquero).
  if p_grupo_id is not null and not exists (
    select 1 from public.grupos_venta where id = p_grupo_id
  ) then
    raise exception 'El grupo de venta indicado no existe.';
  end if;

  -- La tabla viva conserva `hipodromo` (text). Si la app no manda el nombre, se
  -- deriva de `hipodromos` para no dejar la columna legacy en NULL.
  v_hip := upper(btrim(coalesce(p_hipodromo, '')));
  if v_hip = '' then
    select upper(btrim(nombre)) into v_hip
      from public.hipodromos
     where id = p_hipodromo_id;
  end if;

  insert into public.remates (
    nombre, hipodromo_id, hipodromo, carrera, carrera_num,
    fecha, hora_cierre, distancia, comision_pct, notas, grupo_id, estado
  ) values (
    v_nombre,
    p_hipodromo_id,
    nullif(v_hip, ''),
    p_carrera,
    -- Columna legacy de la tabla viva: espeja `carrera` para no quedar NULL.
    p_carrera,
    p_fecha,
    -- La tabla viva tiene `hora_cierre` NOT NULL: "" satisface el constraint.
    coalesce(nullif(btrim(coalesce(p_hora_cierre, '')), ''), ''),
    nullif(btrim(coalesce(p_distancia, '')), ''),
    case when coalesce(p_comision_pct, 0) = 0 then 20 else p_comision_pct end,
    nullif(btrim(coalesce(p_notas, '')), ''),
    p_grupo_id,
    'Abierto'
  )
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 2) Eliminar remate (la cascada se lleva caballos e historial)
-- ---------------------------------------------------------------------------
create or replace function public.club_eliminar_remate(
  p_remate_id uuid,
  p_usuario   text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not coalesce(public.tiene_capacidad(auth.uid(), 'remates:fn_eliminar_remate'), false) then
    raise exception 'Sin permiso para eliminar remates' using errcode = '42501';
  end if;

  if p_remate_id is null then
    raise exception 'Remate requerido';
  end if;

  delete from public.remates where id = p_remate_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3) Incentivo de la casa (monto fijo y/o % del subtotal)
-- ---------------------------------------------------------------------------
create or replace function public.club_guardar_incentivo_remate(
  p_remate_id     uuid,
  p_incentivo     numeric,
  p_incentivo_pct numeric default 0,
  p_usuario       text    default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_estado text;
begin
  if not coalesce(public.tiene_capacidad(auth.uid(), 'remates:fn_guardar_remate'), false) then
    raise exception 'Sin permiso para editar el remate' using errcode = '42501';
  end if;

  if p_remate_id is null then
    raise exception 'Remate requerido';
  end if;

  select estado into v_estado
    from public.remates
   where id = p_remate_id
     for update;
  if not found then
    raise exception 'El remate no existe.';
  end if;
  if lower(btrim(coalesce(v_estado, 'Abierto'))) = 'cerrado' then
    raise exception 'El remate esta cerrado: no admite cambios.';
  end if;

  update public.remates
     set incentivo     = coalesce(p_incentivo, 0),
         incentivo_pct = coalesce(p_incentivo_pct, 0)
   where id = p_remate_id;

  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4) Escalera de pujas + nota
-- ---------------------------------------------------------------------------
create or replace function public.club_guardar_escalera_remate(
  p_remate_id     uuid,
  p_escalera      jsonb,
  p_nota_escalera text default null,
  p_usuario       text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_estado text;
begin
  if not coalesce(public.tiene_capacidad(auth.uid(), 'remates:fn_guardar_remate'), false) then
    raise exception 'Sin permiso para editar el remate' using errcode = '42501';
  end if;

  if p_remate_id is null then
    raise exception 'Remate requerido';
  end if;
  if p_escalera is not null and jsonb_typeof(p_escalera) <> 'array' then
    raise exception 'La escalera tiene que ser una lista de tramos.';
  end if;
  -- Un tramo sin incremento (o en cero) convertiria el error en plata de menos.
  if exists (
    select 1
      from jsonb_array_elements(coalesce(p_escalera, '[]'::jsonb)) e
     where coalesce((e ->> 'incremento')::numeric, 0) <= 0
  ) then
    raise exception 'Cada tramo necesita un incremento mayor a cero.';
  end if;

  select estado into v_estado
    from public.remates
   where id = p_remate_id
     for update;
  if not found then
    raise exception 'El remate no existe.';
  end if;
  if lower(btrim(coalesce(v_estado, 'Abierto'))) = 'cerrado' then
    raise exception 'El remate esta cerrado: no admite cambios.';
  end if;

  update public.remates
     set escalera      = p_escalera,
         nota_escalera = nullif(btrim(coalesce(p_nota_escalera, '')), '')
   where id = p_remate_id;

  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5) Permisos de las RPC: solo authenticated
--    Postgres da EXECUTE a PUBLIC al crear la funcion: hay que revocarlo.
-- ---------------------------------------------------------------------------
revoke all on function public.club_crear_remate(text, uuid, text, integer, date, text, text, numeric, text, uuid, text) from public, anon;
revoke all on function public.club_eliminar_remate(uuid, text) from public, anon;
revoke all on function public.club_guardar_incentivo_remate(uuid, numeric, numeric, text) from public, anon;
revoke all on function public.club_guardar_escalera_remate(uuid, jsonb, text, text) from public, anon;

grant execute on function public.club_crear_remate(text, uuid, text, integer, date, text, text, numeric, text, uuid, text) to authenticated;
grant execute on function public.club_eliminar_remate(uuid, text) to authenticated;
grant execute on function public.club_guardar_incentivo_remate(uuid, numeric, numeric, text) to authenticated;
grant execute on function public.club_guardar_escalera_remate(uuid, jsonb, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6) `remates` pasa a SOLO LECTURA para el navegador
--    (mismo patron que `remate_caballos` y `remate_pujas`).
-- ---------------------------------------------------------------------------
drop policy if exists remates_publico on public.remates;
drop policy if exists remates_lectura on public.remates;
create policy remates_lectura on public.remates
  for select to authenticated
  using (true);

grant select on public.remates to authenticated, service_role;
revoke select on public.remates from anon;
revoke insert, update, delete on public.remates from public, anon, authenticated;
grant insert, update, delete on public.remates to service_role;

commit;
