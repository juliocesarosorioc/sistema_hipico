-- ============================================================================
-- REMATES — esquema idempotente + RLS
-- ============================================================================
-- Que arregla
-- -----------
-- 1) La app hace `remates?select=*,hipodromos(nombre)` y PostgREST responde
--    PGRST200 ("Could not find a relationship between 'remates' and
--    'hipodromos'"). No hay FK entre las dos tablas: `remates` guardo el
--    hipodromo como TEXTO (`hipodromo`), no como `hipodromo_id uuid`. Sin la
--    FK el embed `hipodromos(nombre)` no se resuelve y TODO el listado falla.
--
-- 2) El esquema vivo esta a medias respecto de lo que escribe `src/lib/remates.ts`:
--      remates         -> falta hipodromo_id, carrera, comision_pct, fecha_registro
--      remate_caballos -> falta ejemplar_numero, created_at
--    `crearRemate()` inserta `carrera`/`comision_pct` y `normalizarRemate()`
--    espera `fecha_registro`; sin columnas, el insert muere con PGRST204.
--
-- 3) `remate_caballos` no tiene FK de `cliente_id` a `clientes`, asi que
--    `remate_caballos?select=*,clientes(nombre)` tampoco resuelve el embed.
--
-- Que hace
-- --------
--   - Crea las tablas si no existen (instalacion limpia) con el esquema completo.
--   - `add column if not exists` para completar la tabla ya existente (no
--     destruye `hipodromo` ni nada de lo que ya estaba).
--   - Agrega las FK (hipodromo_id, remate_id, cliente_id) con guarda por nombre.
--   - `remates` y `remate_caballos` quedan SOLO LECTURA para `authenticated`
--     (sin `anon`): la app corre con sesion iniciada, o sea rol `authenticated`,
--     y todas las escrituras de Remates pasan por las RPC `security definer` de
--     `sql/remate_pujas_rpc.sql` (pujas) y `sql/remate_escritura_rpc.sql`
--     (crear/editar/borrar el remate).
--
-- Tipo uuid confirmado en la base: remates.id, remate_caballos.id,
-- remate_caballos.remate_id, remate_caballos.cliente_id, hipodromos.id,
-- clientes.id. `remate_caballos.numero` es integer.
--
-- Idempotente: se puede correr las veces que haga falta.
-- Ejecutar en el SQL Editor de Supabase (SQL puro, sin metacomandos).
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) Tablas (para bases nuevas; en una base existente es no-op)
-- ---------------------------------------------------------------------------
create table if not exists public.remates (
  id             uuid primary key default gen_random_uuid(),
  nombre         text not null,
  hipodromo_id   uuid references public.hipodromos(id),
  hipodromo      text,
  carrera        integer,
  fecha          date,
  hora_cierre    text,
  distancia      text,
  comision_pct   numeric default 20,
  incentivo      numeric default 0,
  notas          text,
  grupo_id       uuid references public.grupos_venta(id),
  estado         text default 'Abierto',
  fecha_registro timestamptz default now()
);

create table if not exists public.remate_caballos (
  id              uuid primary key default gen_random_uuid(),
  remate_id       uuid references public.remates(id) on delete cascade,
  numero          integer,
  nombre          text,
  monto_usd       numeric default 0,
  cliente_id      uuid references public.clientes(id),
  ejemplar_numero text,
  prob_porcentaje numeric,
  prob_implicita  numeric,
  created_at      timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- 2) Completar el esquema vivo (la tabla ya existe a medias)
-- ---------------------------------------------------------------------------
alter table public.remates
  add column if not exists hipodromo_id   uuid,
  add column if not exists carrera        integer,
  add column if not exists comision_pct   numeric default 20,
  add column if not exists grupo_id       uuid,
  add column if not exists fecha_registro timestamptz default now();

alter table public.remate_caballos
  add column if not exists ejemplar_numero text,
  add column if not exists created_at      timestamptz default now();

-- UUID autogenerado en el insert (la app NO manda `id`).
alter table public.remates         alter column id set default gen_random_uuid();
alter table public.remate_caballos alter column id set default gen_random_uuid();

-- Defaults de negocio (la app lee comision 20 / incentivo 0 / estado Abierto).
alter table public.remates alter column comision_pct set default 20;
alter table public.remates alter column incentivo    set default 0;
alter table public.remates alter column estado       set default 'Abierto';

-- La tabla viva tiene columnas legacy NOT NULL (`hipodromo`, `carrera_num`,
-- `hora_cierre`) que la app no siempre completa: el remate puede no tener hora
-- de cierre y el Nº de carrera va en `carrera`/`carrera_num`. Se relajan para
-- que el insert no muera con 23502.
alter table public.remates alter column hipodromo    drop not null;
alter table public.remates alter column carrera_num  drop not null;
alter table public.remates alter column hora_cierre  drop not null;

-- ---------------------------------------------------------------------------
-- 3) Claves foraneas que resuelven los embeds de PostgREST.
--    Con guarda por nombre para ser idempotente.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'remates_hipodromo_id_fkey') then
    alter table public.remates
      add constraint remates_hipodromo_id_fkey
      foreign key (hipodromo_id) references public.hipodromos(id);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'remates_grupo_id_fkey') then
    alter table public.remates
      add constraint remates_grupo_id_fkey
      foreign key (grupo_id) references public.grupos_venta(id);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'remate_caballos_remate_id_fkey') then
    alter table public.remate_caballos
      add constraint remate_caballos_remate_id_fkey
      foreign key (remate_id) references public.remates(id) on delete cascade;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'remate_caballos_cliente_id_fkey') then
    alter table public.remate_caballos
      add constraint remate_caballos_cliente_id_fkey
      foreign key (cliente_id) references public.clientes(id);
  end if;
end
$$;

create index if not exists remates_fecha_registro_idx      on public.remates (fecha_registro desc);
create index if not exists remate_caballos_remate_id_idx   on public.remate_caballos (remate_id);

-- ---------------------------------------------------------------------------
-- 4) RLS + grants
--    `remates`: SOLO LECTURA para authenticated; escribe via RPC
--    (`sql/remate_escritura_rpc.sql`).
--    `remate_caballos`: SOLO LECTURA para authenticated; escribe via RPC
--    (`sql/remate_pujas_rpc.sql`).
-- ---------------------------------------------------------------------------
alter table public.remates         enable row level security;
alter table public.remate_caballos enable row level security;

grant usage on schema public to anon, authenticated;

-- `remates` paso a SOLO LECTURA para el navegador: crear/editar/borrar la
-- subasta va por las RPC de sql/remate_escritura_rpc.sql. Si se deja el
-- `for all using(true)`, cualquiera con la anon key podria escribirla.
drop policy if exists remates_publico on public.remates;
drop policy if exists remates_lectura on public.remates;
create policy remates_lectura on public.remates
  for select to authenticated
  using (true);

-- `remate_caballos` paso a ser SOLO LECTURA para el navegador: las escrituras de
-- pujas van por las RPC `security definer` de sql/remate_pujas_rpc.sql. Si se
-- deja el `for all using(true)`, cualquiera con la anon key podria escribir.
drop policy if exists remate_caballos_publico on public.remate_caballos;
drop policy if exists remate_caballos_lectura on public.remate_caballos;
create policy remate_caballos_lectura on public.remate_caballos
  for select to authenticated
  using (true);

grant select on public.remates to authenticated, service_role;
revoke select on public.remates from anon;
revoke insert, update, delete on public.remates from public, anon, authenticated;
grant insert, update, delete on public.remates to service_role;

grant select on public.remate_caballos to authenticated, service_role;
revoke select on public.remate_caballos from anon;
revoke insert, update, delete on public.remate_caballos from anon, authenticated;
grant insert, update, delete on public.remate_caballos to service_role;

commit;
