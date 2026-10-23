begin;

create table if not exists public.expediente_inteligencia_ejemplares (
  id uuid primary key default gen_random_uuid(),
  ejemplar_id uuid references public.ejemplares(id) on delete set null,
  nombre text not null,
  nombre_normalizado text not null,
  pais text not null default 'VE',
  peso_fisico_kg numeric,
  peso_optimo_kg numeric,
  historial jsonb not null default '[]'::jsonb,
  trackeos jsonb not null default '[]'::jsonb,
  notas_analista text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint expediente_inteligencia_ejemplar_unico unique (nombre_normalizado, pais)
);

create index if not exists expediente_inteligencia_nombre_pais_idx
  on public.expediente_inteligencia_ejemplares (nombre_normalizado, pais);

alter table public.expediente_inteligencia_ejemplares enable row level security;
revoke all on public.expediente_inteligencia_ejemplares from anon;
revoke insert, update, delete on public.expediente_inteligencia_ejemplares from authenticated;
grant select on public.expediente_inteligencia_ejemplares to authenticated;
drop policy if exists expediente_inteligencia_select on public.expediente_inteligencia_ejemplares;
create policy expediente_inteligencia_select
  on public.expediente_inteligencia_ejemplares
  for select to authenticated
  using (
    public.tiene_capacidad(auth.uid(), 'inteligencia_hipica:ruta_proyecciones')
    or public.tiene_capacidad(auth.uid(), 'inteligencia_hipica:celda_memoria_historica')
  );

create or replace function public.rpc_guardar_expediente_inteligencia_ejemplar(
  p_nombre text,
  p_pais text default 'VE',
  p_ejemplar_id uuid default null,
  p_peso_fisico_kg numeric default null,
  p_peso_optimo_kg numeric default null,
  p_historial jsonb default '[]'::jsonb,
  p_trackeos jsonb default '[]'::jsonb,
  p_notas text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_nombre text := upper(btrim(coalesce(p_nombre, '')));
  v_normalizado text;
  v_pais text := upper(btrim(coalesce(p_pais, 'VE')));
  v_id uuid;
begin
  if not coalesce(
    public.tiene_capacidad(auth.uid(), 'inteligencia_hipica:celda_memoria_historica'),
    false
  ) then
    raise exception 'Sin permiso para actualizar el expediente hípico.'
      using errcode = '42501';
  end if;

  if v_nombre = '' then
    raise exception 'El nombre del ejemplar es obligatorio.' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_historial, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_trackeos, '[]'::jsonb)) <> 'array' then
    raise exception 'Historial y trackeos deben ser arreglos JSON.' using errcode = '22023';
  end if;

  v_normalizado := upper(regexp_replace(
    translate(v_nombre, 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNAEIOUUN'),
    '[^[:alnum:]]+',
    ' ',
    'g'
  ));
  v_normalizado := btrim(v_normalizado);
  v_pais := case v_pais
    when 'VEN' then 'VE'
    when 'VENEZUELA' then 'VE'
    when 'US' then 'USA'
    when 'EUA' then 'USA'
    when 'EEUU' then 'USA'
    when 'MEX' then 'MX'
    when 'BRA' then 'BR'
    when 'ARG' then 'AR'
    when 'PAN' then 'PA'
    when 'PER' then 'PE'
    when 'COL' then 'CO'
    when 'URU' then 'UY'
    else v_pais
  end;

  insert into public.expediente_inteligencia_ejemplares (
    ejemplar_id, nombre, nombre_normalizado, pais, peso_fisico_kg, peso_optimo_kg,
    historial, trackeos, notas_analista
  ) values (
    p_ejemplar_id, v_nombre, v_normalizado, v_pais, p_peso_fisico_kg, p_peso_optimo_kg,
    coalesce(p_historial, '[]'::jsonb), coalesce(p_trackeos, '[]'::jsonb), p_notas
  )
  on conflict (nombre_normalizado, pais) do update set
    ejemplar_id = coalesce(excluded.ejemplar_id, expediente_inteligencia_ejemplares.ejemplar_id),
    nombre = excluded.nombre,
    peso_fisico_kg = coalesce(excluded.peso_fisico_kg, expediente_inteligencia_ejemplares.peso_fisico_kg),
    peso_optimo_kg = coalesce(excluded.peso_optimo_kg, expediente_inteligencia_ejemplares.peso_optimo_kg),
    historial = (
      select coalesce(jsonb_agg(elemento), '[]'::jsonb)
      from (
        select distinct elemento
        from jsonb_array_elements(
          expediente_inteligencia_ejemplares.historial || excluded.historial
        ) as entradas(elemento)
      ) unicos
    ),
    trackeos = (
      select coalesce(jsonb_agg(elemento), '[]'::jsonb)
      from (
        select distinct elemento
        from jsonb_array_elements(
          expediente_inteligencia_ejemplares.trackeos || excluded.trackeos
        ) as entradas(elemento)
      ) unicos
    ),
    notas_analista = coalesce(excluded.notas_analista, expediente_inteligencia_ejemplares.notas_analista),
    updated_at = now()
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'nombre_normalizado', v_normalizado, 'pais', v_pais);
end;
$$;

revoke all on function public.rpc_guardar_expediente_inteligencia_ejemplar(
  text, text, uuid, numeric, numeric, jsonb, jsonb, text
) from public, anon;
grant execute on function public.rpc_guardar_expediente_inteligencia_ejemplar(
  text, text, uuid, numeric, numeric, jsonb, jsonb, text
) to authenticated;

commit;
