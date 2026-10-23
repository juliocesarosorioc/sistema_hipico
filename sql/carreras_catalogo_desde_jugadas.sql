-- Mantiene public.carreras como la unica fuente del catalogo.
--
-- Requiere sql/carreras.sql y public.tickets_apuestas con las columnas
-- hipodromo, carrera, nota_auditoria y fecha_registro.
--
-- Repara carreras historicas con tickets que no llegaron a la matriz y crea
-- la fila de catalogo cuando se inserta una jugada nueva. Los reportes siguen
-- leyendo tickets; el semaforo y los selectores leen exclusivamente carreras.
begin;

do $$
begin
  if to_regclass('public.carreras') is null then
    raise exception 'Falta public.carreras: ejecuta primero sql/carreras.sql';
  end if;
  if to_regclass('public.tickets_apuestas') is null then
    raise exception 'Falta public.tickets_apuestas';
  end if;
end
$$;

create or replace function public.club_fecha_carrera_desde_ticket(
  p_nota_auditoria text,
  p_fecha_registro timestamptz
)
returns date
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_fecha date;
begin
  if coalesce(p_nota_auditoria, '') ~ '^\s*[\{\[]' then
    begin
      v_fecha := nullif(p_nota_auditoria::jsonb ->> 'fecha_carrera', '')::date;
    exception
      when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
        v_fecha := null;
    end;
  end if;

  return coalesce(v_fecha, p_fecha_registro::date, current_date);
end;
$$;

create or replace function public.club_asegurar_carrera_catalogo(
  p_fecha date,
  p_hipodromo text,
  p_carrera integer
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_hipodromo text := upper(btrim(coalesce(p_hipodromo, '')));
  v_clave_hipodromo text;
  v_hipodromo_guardado text;
begin
  if p_fecha is null or v_hipodromo = '' or coalesce(p_carrera, 0) <= 0 then
    return;
  end if;

  v_clave_hipodromo := regexp_replace(v_hipodromo, '\s+', '', 'g');

  perform pg_advisory_xact_lock(
    hashtextextended(p_fecha::text || '|' || v_clave_hipodromo || '|' || p_carrera::text, 0)
  );

  select c.hipodromo
    into v_hipodromo_guardado
    from public.carreras c
   where c.fecha = p_fecha
     and c.carrera = p_carrera
     and regexp_replace(upper(btrim(c.hipodromo)), '\s+', '', 'g') = v_clave_hipodromo
   order by c.updated_at desc nulls last
   limit 1;

  if found then
    return;
  end if;

  insert into public.carreras (fecha, hipodromo, carrera, estado, caballos, origen)
  values (p_fecha, v_hipodromo, p_carrera, 'Programada', '[]'::jsonb, 'central')
  on conflict (fecha, hipodromo, carrera) do nothing;
end;
$$;

create or replace function public.club_catalogar_carrera_de_ticket()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.club_asegurar_carrera_catalogo(
    public.club_fecha_carrera_desde_ticket(new.nota_auditoria::text, new.fecha_registro),
    new.hipodromo,
    new.carrera
  );
  return new;
end;
$$;

revoke all on function public.club_fecha_carrera_desde_ticket(text, timestamptz) from public, anon, authenticated;
revoke all on function public.club_asegurar_carrera_catalogo(date, text, integer) from public, anon, authenticated;
revoke all on function public.club_catalogar_carrera_de_ticket() from public, anon, authenticated;

-- Completa el catalogo desde la informacion historica existente.
do $$
declare
  r record;
begin
  for r in
    select distinct
      public.club_fecha_carrera_desde_ticket(t.nota_auditoria::text, t.fecha_registro) as fecha,
      t.hipodromo,
      t.carrera::integer as carrera
    from public.tickets_apuestas t
    where nullif(btrim(t.hipodromo), '') is not null
      and t.carrera::text ~ '^[0-9]+$'
      and t.carrera::integer > 0
  loop
    perform public.club_asegurar_carrera_catalogo(r.fecha, r.hipodromo, r.carrera);
  end loop;
end;
$$;

drop trigger if exists trg_catalogar_carrera_de_ticket on public.tickets_apuestas;
create trigger trg_catalogar_carrera_de_ticket
  after insert or update of hipodromo, carrera, nota_auditoria, fecha_registro
  on public.tickets_apuestas
  for each row
  execute function public.club_catalogar_carrera_de_ticket();

commit;

-- Verificacion: estas filas deben aparecer en el catalogo (incluidas las que
-- antes solo aparecian en reportes):
-- select fecha, hipodromo, carrera, caballos
--   from public.carreras
--  where fecha = date '2026-10-22'
--    and regexp_replace(upper(btrim(hipodromo)), '\s+', '', 'g') = 'BELMONTPARK'
--  order by carrera;
