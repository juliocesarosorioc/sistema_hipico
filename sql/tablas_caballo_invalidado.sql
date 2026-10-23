-- ============================================================================
--  CABALLO INVALIDADO EN TABLAS FIJAS
-- ============================================================================
--  POR QUE ESTE ARCHIVO
--  -------------------
--  Un ejemplar de una tabla fija puede quedar INVALIDADO: el hipodromo lo
--  descalifica (doping, interferencia, error de la pizarra). Un ejemplar
--  INVALIDADO:
--
--    · NO puede ganar, asi que su ticket NUNCA puede quedar 'Ganador' ni
--      generar un pago de premio (la liquidacion lo saca de la lista de
--      ganadores antes de llamar a `club_liquidar_tabla_fija`).
--    · NO reparte: su valor sale de la base de la tabla (igual que el de un
--      retirado), para que el premio del ganador siga cuadrando.
--    · NO se reembolsa: a diferencia del retirado, la apuesta se PIERDE y el
--      monto queda en la casa.
--
--  QUE HACE ESTE ARCHIVO
--  ---------------------
--  1) `public.tabla_fija_caballos`: la TABLA DE CABALLOS de la tabla fija,
--     con las columnas `invalidado` y `motivo_invalidacion`. Los ejemplares
--     viven hoy dentro del array JSONB `tablas_fijas.caballos` (que es lo que
--     lee y escribe la app); esta tabla es la copia NORMALIZADA, con columnas
--     de verdad, para poder consultar, auditar y cruzar sin destripar JSON.
--  2) Un TRIGGER que la mantiene al dia con el JSONB: siempre que la app
--     reescriba el array de ejemplares (editar la tabla, corregir un cuadro,
--     publicar), la tabla normalizada queda igual. No hay dos verdades.
--  3) La RPC `rpc_toggle_caballo_invalidado_tabla_fija`: alterna (o fija) el
--     estado de un ejemplar y devuelve la fila ya actualizada. Va por RPC
--     porque es la RPC la que VALIDA LA CAPACIDAD del operador en el
--     servidor: esconder el boton en la UI no es una barrera.
--
--  IDEMPOTENTE. Es aditivo: no borra ni renombra nada. Se puede correr
--  cuantas veces se quiera.
--
--  Ejecutar en el SQL Editor de Supabase.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0) GUARDA: la tabla de las tablas fijas tiene que existir (con su JSONB)
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.tablas_fijas') is null then
    raise exception 'No existe public.tablas_fijas: este archivo no aplica.';
  end if;

  if not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'tablas_fijas'
       and column_name = 'caballos'
  ) then
    raise exception 'public.tablas_fijas no tiene la columna caballos: este archivo no aplica.';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 1) TABLA DE CABALLOS DE LA TABLA FIJA (normalizada)
--
--    `invalidado` y `motivo_invalidacion` son el estado que la app escribe y
--    lee. La FK a `tablas_fijas` hace que al borrar la tabla se borre su
--    lista de ejemplares (no quedan specimens huerfanos).
-- ---------------------------------------------------------------------------
create table if not exists public.tabla_fija_caballos (
  id                  uuid primary key default gen_random_uuid(),
  tabla_id            bigint not null references public.tablas_fijas(id) on delete cascade,
  numero              text not null,
  nombre              text,
  invalidado          boolean not null default false,
  motivo_invalidacion text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create unique index if not exists tabla_fija_caballos_unico
  on public.tabla_fija_caballos (tabla_id, numero);
create index if not exists tabla_fija_caballos_tabla_idx
  on public.tabla_fija_caballos (tabla_id);

-- ---------------------------------------------------------------------------
-- 1a) RESPALDO: los ejemplares que ya estan en el JSONB de las tablas
--     publicadas entran con su estado actual (`invalidado` + motivo).
-- ---------------------------------------------------------------------------
insert into public.tabla_fija_caballos
  (tabla_id, numero, nombre, invalidado, motivo_invalidacion)
select t.id,
       btrim(e.elem ->> 'numero'),
       nullif(btrim(coalesce(e.elem ->> 'nombre', '')), ''),
       case
         when lower(coalesce(e.elem ->> 'invalidado', '')) in ('true', 't', '1', 'yes', 'si') then true
         else false
       end,
       nullif(btrim(coalesce(e.elem ->> 'motivo_invalidacion', '')), '')
  from public.tablas_fijas t
 cross join lateral jsonb_array_elements(coalesce(t.caballos, '[]'::jsonb)) as e(elem)
 where nullif(btrim(coalesce(e.elem ->> 'numero', '')), '') is not null
on conflict (tabla_id, numero) do nothing;

-- ---------------------------------------------------------------------------
-- 1b) TRIGGER DE COHERENCIA: el JSONB manda, la tabla normalizada sigue.
--
--     La app reescribe el array `caballos` completo en cada edicion (no hay
--     columna por ejemplar). Si la tabla normalizada no se actualizara en el
--     mismo movimiento, quedarian dos verdades: el Monitor diria una cosa y la
--     tabla normalizada otra. Este trigger las ata.
-- ---------------------------------------------------------------------------
create or replace function public.sincronizar_caballos_tabla_fija()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Los ejemplares que ya NO estan en la tabla (el operador quito el cuadro)
  -- se van de la copia normalizada.
  delete from public.tabla_fija_caballos tc
   where tc.tabla_id = new.id
     and not exists (
       select 1
         from jsonb_array_elements(coalesce(new.caballos, '[]'::jsonb)) e
        where btrim(coalesce(e ->> 'numero', '')) = tc.numero);

  insert into public.tabla_fija_caballos
    (tabla_id, numero, nombre, invalidado, motivo_invalidacion)
  select new.id,
         btrim(e ->> 'numero'),
         nullif(btrim(coalesce(e ->> 'nombre', '')), ''),
         case
           when lower(coalesce(e ->> 'invalidado', '')) in ('true', 't', '1', 'yes', 'si') then true
           else false
         end,
         nullif(btrim(coalesce(e ->> 'motivo_invalidacion', '')), '')
    from jsonb_array_elements(coalesce(new.caballos, '[]'::jsonb)) e
   where nullif(btrim(coalesce(e ->> 'numero', '')), '') is not null
  on conflict (tabla_id, numero) do update
     set nombre              = excluded.nombre,
         invalidado          = excluded.invalidado,
         motivo_invalidacion = excluded.motivo_invalidacion,
         updated_at          = now();

  return new;
end
$$;

drop trigger if exists trg_sincronizar_caballos_tabla_fija on public.tablas_fijas;
create trigger trg_sincronizar_caballos_tabla_fija
  after insert or update of caballos on public.tablas_fijas
  for each row execute function public.sincronizar_caballos_tabla_fija();

-- ---------------------------------------------------------------------------
-- 2) RPC: alternar el estado INVALIDADO de un ejemplar
--
--    `p_invalidado` en NULL = ALTERNAR (invierte el estado vigente).
--    `p_invalidado` con valor = dejar el ejemplar en ese estado.
--
--    Devuelve la fila ya actualizada, para que la app refresque el estado
--    local sin releer la tabla entera.
-- ---------------------------------------------------------------------------
create or replace function public.rpc_toggle_caballo_invalidado_tabla_fija(
  p_tabla_id   bigint,
  p_numero     text,
  p_invalidado boolean default null,
  p_motivo     text    default null,
  p_usuario    text    default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tabla       public.tablas_fijas%rowtype;
  v_caballos    jsonb;
  v_num         text;
  v_json        boolean;
  v_normalizado boolean;
  v_actual      boolean;
  v_nuevo       boolean;
  v_motivo      text;
  v_actualizado jsonb;
begin
  -- ------------------------------------------------------------------
  -- GUARDA DE CAPACIDAD (la frontera real; la UI solo esconde el boton).
  -- Misma capacidad que exige el boton de editar la tabla: invalidar un
  -- ejemplar ES corregir la tabla.
  -- ------------------------------------------------------------------
  if not coalesce(public.tiene_capacidad(auth.uid(), 'tablas:btn_editar'), false) then
    raise exception 'Permiso denegado: tablas:btn_editar. La operacion no se ejecuto.';
  end if;

  v_num := btrim(coalesce(p_numero, ''));
  if v_num = '' then
    raise exception 'Indique el numero del ejemplar.';
  end if;

  select * into v_tabla
    from public.tablas_fijas
   where id = p_tabla_id
   for update;
  if not found then
    raise exception 'La tabla fija % no existe.', p_tabla_id;
  end if;

  v_caballos := coalesce(v_tabla.caballos, '[]'::jsonb);

  -- El ejemplar tiene que estar en la tabla: no se inventa.
  if not exists (
    select 1
      from jsonb_array_elements(v_caballos) e
     where btrim(coalesce(e ->> 'numero', '')) = v_num
  ) then
    raise exception 'El ejemplar % no pertenece a la tabla %.', v_num, p_tabla_id;
  end if;

  -- ------------------------------------------------------------------
  -- Estado ACTUAL: el JSONB de la tabla (lo que ve la app) y, como
  -- respaldo, la tabla normalizada. Si alguno de los dos dice que esta
  -- invalidado, lo esta: asi un estado a medias nunca habilita por
  -- error a un ejemplar descalificado.
  -- ------------------------------------------------------------------
  select case
           when lower(coalesce(e ->> 'invalidado', '')) in ('true', 't', '1', 'yes', 'si') then true
           else false
         end
    into v_json
    from jsonb_array_elements(v_caballos) e
   where btrim(coalesce(e ->> 'numero', '')) = v_num
   limit 1;

  select tc.invalidado
    into v_normalizado
    from public.tabla_fija_caballos tc
   where tc.tabla_id = p_tabla_id
     and tc.numero = v_num;

  v_actual := coalesce(v_json, false) or coalesce(v_normalizado, false);

  -- ALTERNAR: si el llamador no dice el estado, se invierte el vigente.
  v_nuevo := case when p_invalidado is null then not v_actual else p_invalidado end;

  v_motivo := case
                when v_nuevo
                  then coalesce(nullif(btrim(coalesce(p_motivo, '')), ''), 'Invalidado en Tabla Fija')
                else null
              end;

  -- ------------------------------------------------------------------
  -- 1) El array JSONB de la tabla (lo que lee y escribe la app).
  -- ------------------------------------------------------------------
  select coalesce(
           jsonb_agg(
             case
               when btrim(coalesce(e ->> 'numero', '')) = v_num
                 then e || jsonb_build_object('invalidado', v_nuevo, 'motivo_invalidacion', v_motivo)
               else e
             end
             order by ord),
           '[]'::jsonb)
    into v_actualizado
    from jsonb_array_elements(v_caballos) with ordinality as x(e, ord);

  update public.tablas_fijas
     set caballos = v_actualizado
   where id = p_tabla_id;

  -- ------------------------------------------------------------------
  -- 2) La tabla normalizada (columnas `invalidado` y `motivo_invalidacion`).
  --    El trigger tambien la actualiza; este UPSERT deja la fila correcta
  --    aunque el trigger se haya creado despues o no exista todavia.
  -- ------------------------------------------------------------------
  insert into public.tabla_fija_caballos
    (tabla_id, numero, nombre, invalidado, motivo_invalidacion)
  select p_tabla_id,
         v_num,
         nullif(btrim(coalesce(e ->> 'nombre', '')), ''),
         v_nuevo,
         v_motivo
    from jsonb_array_elements(v_caballos) e
   where btrim(coalesce(e ->> 'numero', '')) = v_num
  on conflict (tabla_id, numero) do update
     set nombre              = coalesce(excluded.nombre, public.tabla_fija_caballos.nombre),
         invalidado          = excluded.invalidado,
         motivo_invalidacion = excluded.motivo_invalidacion,
         updated_at          = now();

  -- ------------------------------------------------------------------
  -- 3) Auditoria (best-effort: si `club_log_accion` no esta instalada, el
  --    cambio igual queda guardado).
  -- ------------------------------------------------------------------
  if exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'club_log_accion'
  ) then
    perform public.club_log_accion(
      coalesce(p_usuario, 'anon'),
      'TABLAS_FIJAS',
      format('INVALIDAR ejemplar %s de la tabla %s: %s.',
             v_num, p_tabla_id,
             case when v_nuevo then 'invalidado' else 'habilitado' end)
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'tabla_id', p_tabla_id,
    'numero', v_num,
    'invalidado', v_nuevo,
    'motivo_invalidacion', v_motivo
  );
end;
$$;

-- La RPC exige sesion con capacidad: `anon` no puede ejecutarla.
revoke all on function public.rpc_toggle_caballo_invalidado_tabla_fija(bigint, text, boolean, text, text) from public, anon;
grant execute on function public.rpc_toggle_caballo_invalidado_tabla_fija(bigint, text, boolean, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3) RLS de la tabla de caballos: se LEE, pero se ESCRIBE solo por la RPC
--    (que corre como security definer y con la guarda de capacidad).
-- ---------------------------------------------------------------------------
alter table public.tabla_fija_caballos enable row level security;

drop policy if exists tabla_fija_caballos_lectura on public.tabla_fija_caballos;
create policy tabla_fija_caballos_lectura on public.tabla_fija_caballos
  for select to anon, authenticated using (true);

-- ---------------------------------------------------------------------------
-- VERIFICACION
-- ---------------------------------------------------------------------------
--  select * from public.tabla_fija_caballos where invalidado;
--
--  select id, hipodromo, carrera, caballos
--    from public.tablas_fijas
--   where id = (select tabla_id from public.tabla_fija_caballos where invalidado limit 1);

commit;
