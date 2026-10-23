-- Repara public.carreras exclusivamente desde carreras cargadas en programa_dia.
--
-- No se consulta tickets_apuestas, resultados, ni reportes: esos datos no crean
-- carreras. Las cargas futuras escriben programa_dia y la matriz central desde
-- guardarPrograma; esta migracion solo recupera filas cargadas anteriormente.
-- Si la carrera no existe en programa_dia, debe volver a cargarse desde su fuente.
begin;

do $$
begin
  if to_regclass('public.carreras') is null then
    raise exception 'Falta public.carreras: ejecuta primero sql/carreras.sql';
  end if;
  if to_regclass('public.programa_dia') is null then
    raise exception 'Falta public.programa_dia: ejecuta primero sql/carreras.sql';
  end if;
end
$$;

insert into public.carreras (
  fecha,
  hipodromo,
  carrera,
  estado,
  caballos,
  distancia,
  superficie,
  premio,
  hora,
  origen
)
select
  p.fecha,
  upper(btrim(carrera_json ->> 'hipodromo')),
  (carrera_json ->> 'carrera')::integer,
  'Programada',
  coalesce(carrera_json -> 'caballos', carrera_json -> 'ejemplares', '[]'::jsonb),
  nullif(carrera_json ->> 'distancia', ''),
  nullif(carrera_json ->> 'superficie', ''),
  nullif(carrera_json ->> 'premio', '')::numeric,
  nullif(carrera_json ->> 'hora', ''),
  'ia'
from public.programa_dia p
cross join lateral jsonb_array_elements(p.carreras) as carrera_json
where nullif(btrim(carrera_json ->> 'hipodromo'), '') is not null
  and (carrera_json ->> 'carrera') ~ '^[0-9]+$'
  and (carrera_json ->> 'carrera')::integer > 0
  and not exists (
    select 1
      from public.carreras c
     where c.fecha = p.fecha
       and c.carrera = (carrera_json ->> 'carrera')::integer
       and regexp_replace(upper(btrim(c.hipodromo)), '\s+', '', 'g')
           = regexp_replace(upper(btrim(carrera_json ->> 'hipodromo')), '\s+', '', 'g')
  )
on conflict (fecha, hipodromo, carrera) do nothing;

commit;

-- Verificacion para la jornada reportada:
-- select fecha, hipodromo, carrera, caballos
--   from public.carreras
--  where fecha = date '2026-10-22'
--    and regexp_replace(upper(btrim(hipodromo)), '\s+', '', 'g') = 'BELMONTPARK'
--  order by carrera;
