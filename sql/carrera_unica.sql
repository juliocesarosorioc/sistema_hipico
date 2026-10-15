-- ============================================================================
-- CARRERA ÚNICA — una sola data de carreras
-- ============================================================================
-- POR QUÉ ESTE ARCHIVO
-- -------------------
-- La identidad de una carrera estaba copiada en 5 lugares (programa_dia,
-- carreras, resultados_carreras, tablas_fijas y los JSON de cada módulo) y se
-- unía por texto: `upper(trim(hipodromo))` + número + fecha. Sin llave real
-- aparecían carreras huérfanas ("LA RINCONADA" vs "RINCONADA") y cada módulo
-- preguntaba "qué carreras hay" por su cuenta.
--
-- Este script deja UNA sola entidad — `carreras` (matriz, ya creada por
-- sql/carreras.sql) — y cuelga de ella los hechos:
--
--   carreras                 -> identidad única (fecha + hipodromo + carrera)
--     ├── carrera_ejemplares -> inscripción 1:N (número, nombre, retirado, INV)
--     └── (resultados_carreras.carrera_id UNIQUE) 1:1 -> ganadores/orden/dividendos
--   tablas_fijas / marcas_carrera / dupletas / remates -> carrera_id (FK)
--
--   programa_dia             -> documento crudo de la IA. NO lo lee la UI.
--   v_carrera                -> UNA vista con la forma que ya consume la app.
--
-- COMPATIBILIDAD
-- --------------
-- Aditivo e idempotente. NO borra ni renombra nada. Mientras la app siga
-- escribiendo `carreras.caballos`, un trigger lo refleja en `carrera_ejemplares`
-- para que no haya dos verdades. Cuando la app migre, el trigger se retira.
--
-- PRERREQUISITO: sql/carreras.sql ya aplicado (crea `carreras` y enlaza
-- `resultados_carreras.carrera_id`).
--
-- Ejecutar en el SQL Editor de Supabase. SQL puro, sin metacomandos.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0) GUARDA: la matriz tiene que existir
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.carreras') is null then
    raise exception 'Aplicá primero sql/carreras.sql: no existe public.carreras.';
  end if;
  if to_regclass('public.resultados_carreras') is null then
    raise exception 'No existe public.resultados_carreras.';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 1) INSCRIPCIÓN 1:N — `carrera_ejemplares`
-- ---------------------------------------------------------------------------
create table if not exists public.carrera_ejemplares (
  id                uuid primary key default gen_random_uuid(),
  carrera_id        uuid not null references public.carreras(id) on delete cascade,
  numero            text not null,
  nombre            text,
  nacionalidad      text,
  retirado          boolean not null default false,
  invalidado_remate boolean not null default false,
  orden             integer,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create unique index if not exists carrera_ejemplares_unico
  on public.carrera_ejemplares (carrera_id, numero);
create index if not exists carrera_ejemplares_carrera_idx
  on public.carrera_ejemplares (carrera_id);

-- 1a) RESPALDO desde `carreras.caballos`. Los retirados/invalidados salen de las
--     listas de texto de la matriz (mismo dato que hoy lee la app).
insert into public.carrera_ejemplares
  (carrera_id, numero, nombre, nacionalidad, retirado, invalidado_remate, orden)
select c.id,
       btrim(e.elem ->> 'numero'),
       nullif(btrim(coalesce(e.elem ->> 'nombre', '')), ''),
       nullif(btrim(coalesce(e.elem ->> 'nacionalidad', '')), ''),
       coalesce((e.elem ->> 'retirado')::boolean, false)
         or btrim(e.elem ->> 'numero') = any (
              string_to_array(regexp_replace(coalesce(c.retirados, ''), '\s', '', 'g'), ',')
            ),
       btrim(e.elem ->> 'numero') = any (
              string_to_array(regexp_replace(coalesce(c.invalidado_remate, ''), '\s', '', 'g'), ',')
            ),
       e.ord
from public.carreras c
cross join lateral jsonb_array_elements(coalesce(c.caballos, '[]'::jsonb))
  with ordinality as e(elem, ord)
where nullif(btrim(coalesce(e.elem ->> 'numero', '')), '') is not null
on conflict (carrera_id, numero) do nothing;

-- 1b) TRIGGER de compatibilidad: la app sigue escribiendo `carreras.caballos`;
--     acá se refleja en la tabla hija para que no existan dos verdades.
create or replace function public.sincronizar_ejemplares_carrera()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  ret text[];
  inv text[];
begin
  ret := string_to_array(regexp_replace(coalesce(new.retirados, ''), '\s', '', 'g'), ',');
  inv := string_to_array(regexp_replace(coalesce(new.invalidado_remate, ''), '\s', '', 'g'), ',');

  delete from public.carrera_ejemplares where carrera_id = new.id;

  insert into public.carrera_ejemplares
    (carrera_id, numero, nombre, nacionalidad, retirado, invalidado_remate, orden)
  select new.id,
         btrim(e.elem ->> 'numero'),
         nullif(btrim(coalesce(e.elem ->> 'nombre', '')), ''),
         nullif(btrim(coalesce(e.elem ->> 'nacionalidad', '')), ''),
         coalesce((e.elem ->> 'retirado')::boolean, false)
           or coalesce(btrim(e.elem ->> 'numero') = any (ret), false),
         coalesce(btrim(e.elem ->> 'numero') = any (inv), false),
         e.ord
  from jsonb_array_elements(coalesce(new.caballos, '[]'::jsonb))
    with ordinality as e(elem, ord)
  where nullif(btrim(coalesce(e.elem ->> 'numero', '')), '') is not null
  on conflict (carrera_id, numero) do nothing;

  return new;
end
$$;

drop trigger if exists trg_sincronizar_ejemplares on public.carreras;
create trigger trg_sincronizar_ejemplares
  after insert or update of caballos, retirados, invalidado_remate on public.carreras
  for each row execute function public.sincronizar_ejemplares_carrera();

-- RLS: la hija la escribe el trigger (security definer). La app solo lee.
alter table public.carrera_ejemplares enable row level security;

drop policy if exists carrera_ejemplares_lectura on public.carrera_ejemplares;
create policy carrera_ejemplares_lectura on public.carrera_ejemplares
  for select to anon, authenticated using (true);

grant select on public.carrera_ejemplares to anon, authenticated;
grant all    on public.carrera_ejemplares to service_role;

-- ---------------------------------------------------------------------------
-- 2) RESULTADO 1:1 — `resultados_carreras` deja de ser lista de carreras
-- ---------------------------------------------------------------------------
-- El resultado es UNO por carrera. El índice único lo obliga, y de paso impide
-- que vuelva a colarse una segunda fila "lista" para la misma carrera.
create unique index if not exists resultados_carreras_carrera_id_uidx
  on public.resultados_carreras (carrera_id)
  where carrera_id is not null;

-- Por si quedó alguna fila sin enlazar (el loop de carreras.sql las enlaza, pero
-- una carrera creada después de esa corrida pudo quedar suelta).
update public.resultados_carreras r
   set carrera_id = c.id
  from public.carreras c
 where r.carrera_id is null
   and c.fecha = r.fecha
   and c.hipodromo = upper(btrim(r.hipodromo))
   and c.carrera = r.carrera;

-- ---------------------------------------------------------------------------
-- 3) VISTA ÚNICA — la forma que ya consume la app, en un solo select
-- ---------------------------------------------------------------------------
create or replace view public.v_carrera as
select
  c.id,
  c.fecha,
  c.hipodromo,
  c.hipodromo_id,
  c.carrera,
  c.estado,
  c.distancia,
  c.superficie,
  c.premio,
  c.hora,
  c.origen,
  c.registrado_por,
  c.actualizado_por,
  c.verificado,
  c.verificado_por,
  c.verificado_at,
  c.created_at,
  c.updated_at,
  coalesce(ej.caballos, '[]'::jsonb)    as caballos,
  coalesce(ej.retirados, '{}'::text[])  as retirados,
  coalesce(ej.invalidados, '{}'::text[]) as invalidados,
  r.ganadores,
  r.orden_llegada,
  r.dividendos,
  coalesce(r.aplicado_a_tablas, false) as aplicado_a_tablas
from public.carreras c
left join lateral (
  select
    jsonb_agg(
      jsonb_build_object(
        'numero',            e.numero,
        'nombre',            e.nombre,
        'nacionalidad',      e.nacionalidad,
        'retirado',          e.retirado,
        'invalidado_remate', e.invalidado_remate
      )
      order by e.orden nulls last, e.numero
    ) as caballos,
    array_agg(e.numero) filter (where e.retirado) as retirados,
    array_agg(e.numero) filter (where e.invalidado_remate) as invalidados
  from public.carrera_ejemplares e
  where e.carrera_id = c.id
) ej on true
left join public.resultados_carreras r on r.carrera_id = c.id;

grant select on public.v_carrera to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4) HIJOS DE JUGADAS: `carrera_id` (FK) en vez de join por texto
-- ---------------------------------------------------------------------------
-- Solo tablas con (fecha, hipodromo, carrera). `dupletas` va aparte porque
-- enlaza DOS carreras (carrera1 / carrera2).
do $$
declare
  t text;
  lista text[] := array['tablas_fijas', 'marcas_carrera', 'remates'];
begin
  foreach t in array lista loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;
    if not exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = t and column_name = 'carrera'
    ) then
      continue;
    end if;

    execute format('alter table public.%I add column if not exists carrera_id uuid', t);
    execute format('alter table public.%I drop constraint if exists %I', t, t || '_carrera_id_fkey');
    execute format(
      'alter table public.%I add constraint %I foreign key (carrera_id) references public.carreras(id) on delete set null',
      t, t || '_carrera_id_fkey'
    );

    execute format($f$
      update public.%I x
         set carrera_id = c.id
        from public.carreras c
       where x.carrera_id is null
         and c.fecha = x.fecha
         and c.hipodromo = upper(btrim(x.hipodromo))
         and c.carrera = x.carrera
    $f$, t);

    execute format('create index if not exists %I on public.%I (carrera_id)', t || '_carrera_id_idx', t);
  end loop;
end
$$;

-- `dupletas`: enlaza dos carreras del mismo día.
do $$
begin
  if to_regclass('public.dupletas') is null then
    return;
  end if;
  alter table public.dupletas add column if not exists carrera1_id uuid;
  alter table public.dupletas add column if not exists carrera2_id uuid;
  alter table public.dupletas drop constraint if exists dupletas_carrera1_id_fkey;
  alter table public.dupletas drop constraint if exists dupletas_carrera2_id_fkey;
  alter table public.dupletas
    add constraint dupletas_carrera1_id_fkey foreign key (carrera1_id) references public.carreras(id) on delete set null;
  alter table public.dupletas
    add constraint dupletas_carrera2_id_fkey foreign key (carrera2_id) references public.carreras(id) on delete set null;

  update public.dupletas x
     set carrera1_id = c.id
    from public.carreras c
   where x.carrera1_id is null
     and c.fecha = x.fecha
     and c.hipodromo = upper(btrim(x.hipodromo))
     and c.carrera = x.carrera1;

  update public.dupletas x
     set carrera2_id = c.id
    from public.carreras c
   where x.carrera2_id is null
     and c.fecha = x.fecha
     and c.hipodromo = upper(btrim(x.hipodromo))
     and c.carrera = x.carrera2;

  create index if not exists dupletas_carrera1_id_idx on public.dupletas (carrera1_id);
  create index if not exists dupletas_carrera2_id_idx on public.dupletas (carrera2_id);
end
$$;

commit;

-- ============================================================================
-- VERIFICACIÓN (debe dar 0 en las tres)
-- ============================================================================
-- 1) Carreras sin ejemplares (la inscripción no llegó):
--      select count(*) from public.carreras c
--       where not exists (select 1 from public.carrera_ejemplares e where e.carrera_id = c.id);
-- 2) Resultados sin carrera enlazada:
--      select count(*) from public.resultados_carreras where carrera_id is null;
-- 3) Hijos de jugadas sin carrera enlazada:
--      select count(*) from public.tablas_fijas where carrera_id is null;
--      select count(*) from public.marcas_carrera where carrera_id is null;
-- ============================================================================
