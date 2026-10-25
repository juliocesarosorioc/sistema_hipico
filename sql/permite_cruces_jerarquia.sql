-- Jerarquía de cruces por modalidad y excepciones por carrera.
-- La tabla de grupos de este proyecto se llama `grupos_venta`.
-- Requiere `sql/grupos_usuarios.sql` para aplicar RLS por grupo.
begin;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'grupos_venta' and column_name = 'cruce_mismo_ejemplar'
  ) then
    alter table public.grupos_venta add column cruce_mismo_ejemplar boolean not null default false;
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'grupos_venta' and column_name = 'permite_cruces'
    ) then
      update public.grupos_venta
        set cruce_mismo_ejemplar = coalesce(permite_cruces, false);
    end if;
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'grupos_venta' and column_name = 'cruce_diferente_ejemplar'
  ) then
    alter table public.grupos_venta add column cruce_diferente_ejemplar boolean not null default false;
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'grupos_venta' and column_name = 'permite_cruces'
    ) then
      update public.grupos_venta
        set cruce_diferente_ejemplar = coalesce(permite_cruces, false);
    end if;
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'clientes' and column_name = 'cruce_mismo_ejemplar'
  ) then
    alter table public.clientes add column cruce_mismo_ejemplar boolean default null;
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'clientes' and column_name = 'permite_cruces'
    ) then
      update public.clientes
        set cruce_mismo_ejemplar = permite_cruces
        where permite_cruces is not null;
    end if;
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'clientes' and column_name = 'cruce_diferente_ejemplar'
  ) then
    alter table public.clientes add column cruce_diferente_ejemplar boolean default null;
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'clientes' and column_name = 'permite_cruces'
    ) then
      update public.clientes
        set cruce_diferente_ejemplar = permite_cruces
        where permite_cruces is not null;
    end if;
  end if;
end $$;

create or replace function public.club_actualizar_cruces_grupo(
  p_id uuid,
  p_mismo_ejemplar boolean,
  p_diferente_ejemplar boolean
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.tiene_capacidad(auth.uid(), 'grupos:fn_guardar_grupo') then
    raise exception 'Sin permiso para configurar cruces del grupo' using errcode = '42501';
  end if;
  update public.grupos_venta
     set cruce_mismo_ejemplar = coalesce(p_mismo_ejemplar, false),
         cruce_diferente_ejemplar = coalesce(p_diferente_ejemplar, false)
   where id = p_id and public.usuario_en_grupo(auth.uid(), id::text);
  if not found then
    raise exception 'Grupo inexistente o fuera del alcance del usuario';
  end if;
  return true;
end;
$$;
revoke all on function public.club_actualizar_cruces_grupo(uuid, boolean, boolean) from public, anon;
grant execute on function public.club_actualizar_cruces_grupo(uuid, boolean, boolean) to authenticated, service_role;

create table if not exists public.cruces_carrera_config (
  grupo_id uuid not null references public.grupos_venta(id) on delete cascade,
  fecha date not null,
  hipodromo text not null,
  carrera integer not null check (carrera > 0),
  cruces_carrera_override jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (grupo_id, fecha, hipodromo, carrera),
  constraint cruces_carrera_config_objeto check (jsonb_typeof(cruces_carrera_override) = 'object')
);

alter table public.resultados_carreras
  add column if not exists cruces_carrera_override jsonb not null default '{}'::jsonb;

create or replace function public.sincronizar_cruces_carrera_resultado()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.detalle is not null
     and jsonb_typeof(new.detalle) = 'object'
     and new.detalle ? 'cruces_carrera_override' then
    new.cruces_carrera_override := coalesce(new.detalle -> 'cruces_carrera_override', '{}'::jsonb);
  end if;
  return new;
end;
$$;
grant execute on function public.sincronizar_cruces_carrera_resultado() to authenticated, service_role;

drop trigger if exists resultados_carreras_cruces_carrera on public.resultados_carreras;
create trigger resultados_carreras_cruces_carrera
  before insert or update of detalle on public.resultados_carreras
  for each row execute function public.sincronizar_cruces_carrera_resultado();

alter table public.cruces_carrera_config enable row level security;
drop policy if exists cruces_carrera_config_authenticated on public.cruces_carrera_config;
create policy cruces_carrera_config_authenticated
  on public.cruces_carrera_config for all to authenticated
  using (public.usuario_en_grupo(auth.uid(), grupo_id::text))
  with check (public.usuario_en_grupo(auth.uid(), grupo_id::text));
grant select, insert, update, delete on public.cruces_carrera_config to authenticated, service_role;

commit;
