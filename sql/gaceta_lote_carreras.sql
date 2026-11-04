-- ============================================================================
-- CARGA DE GACETA POR LOTES — UPSERT ACUMULATIVO Y BULK UPSERT TRANSACCIONAL
-- ============================================================================

begin;

do $$
begin
  if to_regclass('public.carreras') is null then
    raise notice 'public.carreras no existe: aplica primero sql/carreras.sql.';
    return;
  end if;

  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public' and tablename = 'carreras'
       and indexname = 'carreras_unico_hipodromo_id'
  ) then
    execute 'create unique index if not exists carreras_unico_hipodromo_id
               on public.carreras (hipodromo_id, fecha, carrera)
               where hipodromo_id is not null';
  end if;
end
$$;

create or replace function public.rpc_guardar_lote_carreras_gaceta(
  p_fecha        date,
  p_hipodromo    text,
  p_carreras     jsonb,
  p_creado_por   text default 'desconocido',
  p_hipodromo_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_carrera  jsonb;
  v_ej       jsonb;
  v_num      int;
  v_nombre   text;
  v_numero   text;
  v_guardado jsonb;
  v_existentes jsonb;
  v_fusionados jsonb := '[]'::jsonb;
  v_vistos   jsonb := '[]'::jsonb;
  v_item     jsonb;
  v_total    integer := 0;
  v_txt_dist   text;
  v_txt_premio text;
  v_distancia  int;
  v_premio     numeric;
begin
  if not coalesce(public.tiene_capacidad(auth.uid(), 'carreras:fn_registrar_carrera'), false) then
    raise exception 'Sin permiso para registrar carreras.' using errcode = '42501';
  end if;

  if to_regclass('public.carreras') is null then
    raise exception 'La matriz de carreras no esta aplicada: ejecuta sql/carreras.sql.';
  end if;

  if p_carreras is null or jsonb_typeof(p_carreras) <> 'array' then
    raise exception 'Las carreras del lote deben ser una lista.';
  end if;

  if jsonb_array_length(p_carreras) = 0 then
    raise exception 'El lote no trae carreras: no se escribe nada.';
  end if;

  if nullif(btrim(coalesce(p_hipodromo, '')), '') is null then
    raise exception 'El lote necesita el hipodromo.';
  end if;

  for v_carrera in select * from jsonb_array_elements(p_carreras) loop
    begin
      v_num := coalesce(nullif(v_carrera ->> 'carrera', '')::int, 0);
    exception when others then
      v_num := 0;
    end;
    if v_num <= 0 then
      continue;
    end if;

    select coalesce(c.caballos, '[]'::jsonb) into v_existentes
      from public.carreras c
     where c.fecha = coalesce(p_fecha, current_date)
       and upper(c.hipodromo) = upper(btrim(p_hipodromo))
       and c.carrera = v_num
     limit 1;

    v_fusionados := '[]'::jsonb;
    v_vistos := '[]'::jsonb;

    for v_item in select * from jsonb_array_elements(coalesce(v_existentes, '[]'::jsonb)) loop
      v_numero := btrim(coalesce(v_item ->> 'numero', ''));
      if v_numero = '' then
        continue;
      end if;
      v_fusionados := v_fusionados || jsonb_build_array(v_item);
      v_vistos := v_vistos || jsonb_build_array(v_numero);
    end loop;

    for v_ej in
      select * from jsonb_array_elements(coalesce(v_carrera -> 'ejemplares', v_carrera -> 'caballos', '[]'::jsonb))
    loop
      v_numero := btrim(coalesce(v_ej ->> 'numero', ''));
      v_nombre := upper(btrim(coalesce(v_ej ->> 'nombre', '')));
      if v_numero = '' or v_nombre = '' then
        continue;
      end if;

      if v_vistos ? v_numero then
        select jsonb_agg(
          case
            when e ->> 'numero' = v_numero then
              coalesce(v_ej, '{}'::jsonb) || coalesce(
                jsonb_strip_nulls(
                  jsonb_build_object(
                    'nombre', nullif(e ->> 'nombre', ''),
                    'nacionalidad', nullif(e ->> 'nacionalidad', ''),
                    'retirado', coalesce((e ->> 'retirado')::boolean, false)
                  )
                ),
                '{}'::jsonb
              )
            else e
          end
        )
        into v_fusionados
        from jsonb_array_elements(v_fusionados) e;
      else
        v_fusionados := v_fusionados || jsonb_build_array(v_ej);
        v_vistos := v_vistos || jsonb_build_array(v_numero);
      end if;
    end loop;

    v_txt_dist := btrim(coalesce(v_carrera ->> 'distancia', ''));
    if v_txt_dist <> '' then
      begin
        v_distancia := nullif(regexp_replace(v_txt_dist, '[^0-9]', '', 'g'), '')::int;
      exception when others then
        v_distancia := null;
      end;
    else
      v_distancia := null;
    end if;

    v_txt_premio := btrim(coalesce(v_carrera ->> 'premio', ''));
    if v_txt_premio = '' then
      v_premio := null;
    elsif v_txt_premio ~ '^\d{1,3}(\.\d{3})+$' then
      v_premio := replace(v_txt_premio, '.', '')::numeric;
    elsif v_txt_premio ~ '^\d+,\d+$' then
      v_premio := replace(v_txt_premio, ',', '.')::numeric;
    elsif v_txt_premio ~ '^\d+(\.\d+)?$' then
      v_premio := v_txt_premio::numeric;
    else
      v_premio := null;
    end if;

    insert into public.carreras (
      fecha, hipodromo, hipodromo_id, carrera, estado, caballos,
      distancia, superficie, premio, hora, origen, actualizado_por, updated_at
    )
    values (
      coalesce(p_fecha, current_date),
      upper(btrim(p_hipodromo)),
      p_hipodromo_id,
      v_num,
      'Programada',
      v_fusionados,
      v_distancia,
      nullif(upper(btrim(coalesce(v_carrera ->> 'superficie', ''))), ''),
      v_premio,
      nullif(btrim(coalesce(v_carrera ->> 'hora', '')), ''),
      'ia',
      coalesce(p_creado_por, 'desconocido'),
      now()
    )
    on conflict (fecha, hipodromo, carrera) do update
      set caballos = coalesce(excluded.caballos, public.carreras.caballos),
          distancia = coalesce(excluded.distancia, public.carreras.distancia),
          superficie = coalesce(excluded.superficie, public.carreras.superficie),
          premio = coalesce(excluded.premio, public.carreras.premio),
          hora = coalesce(excluded.hora, public.carreras.hora),
          hipodromo_id = coalesce(excluded.hipodromo_id, public.carreras.hipodromo_id),
          actualizado_por = coalesce(p_creado_por, 'desconocido'),
          updated_at = now();

    v_total := v_total + 1;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'guardadas', v_total,
    'fecha', coalesce(p_fecha, current_date),
    'hipodromo', upper(btrim(p_hipodromo))
  );
end;
$$;

revoke all on function public.rpc_guardar_lote_carreras_gaceta(date, text, jsonb, text, uuid) from public;
grant execute on function public.rpc_guardar_lote_carreras_gaceta(date, text, jsonb, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3) RPC BULK UPSERT MULTI-HIPÓDROMO EN 1 SOLA TRANSACCIÓN
-- ---------------------------------------------------------------------------
create or replace function public.upsert_lote_carreras_completo(
  p_carreras jsonb,
  p_origen text default 'ia',
  p_usuario text default 'sistema'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_c jsonb;
  v_fecha date;
  v_hipodromo text;
  v_carrera int;
  v_distancia text;
  v_superficie text;
  v_hora text;
  v_premio numeric;
  v_estado text;
  v_caballos jsonb;
  v_retirados text;
  v_guardadas int := 0;
begin
  if p_carreras is null or jsonb_typeof(p_carreras) <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'p_carreras debe ser un arreglo JSONB.');
  end if;

  for v_c in select * from jsonb_array_elements(p_carreras) loop
    begin
      v_fecha := coalesce(nullif(btrim(v_c->>'fecha'), '')::date, current_date);
    exception when others then
      v_fecha := current_date;
    end;
    v_hipodromo := upper(btrim(coalesce(v_c->>'hipodromo', v_c->>'hipodromo_nombre', '')));
    begin
      v_carrera := coalesce(nullif(btrim(coalesce(v_c->>'carrera', v_c->>'numero_carrera', '')), '')::int, 0);
    exception when others then
      v_carrera := 0;
    end;
    if v_hipodromo = '' or v_carrera <= 0 then
      continue;
    end if;

    v_distancia := nullif(btrim(coalesce(v_c->>'distancia', '')), '');
    v_superficie := coalesce(nullif(upper(btrim(coalesce(v_c->>'superficie', ''))), ''), 'ARENA');
    v_hora := nullif(btrim(coalesce(v_c->>'hora', '')), '');
    begin
      v_premio := coalesce(nullif(regexp_replace(coalesce(v_c->>'premio', ''), '[^0-9.]', '', 'g'), '')::numeric, 0);
    exception when others then
      v_premio := 0;
    end;
    v_estado := coalesce(nullif(btrim(coalesce(v_c->>'estado', '')), ''), 'Programada');
    v_caballos := coalesce(v_c->'caballos', v_c->'ejemplares', '[]'::jsonb);
    v_retirados := nullif(btrim(coalesce(v_c->>'retirados', '')), '');

    insert into public.carreras (
      fecha, hipodromo, carrera, estado, caballos, retirados,
      distancia, superficie, premio, hora, origen, actualizado_por, updated_at
    ) values (
      v_fecha, v_hipodromo, v_carrera, v_estado, v_caballos, v_retirados,
      v_distancia, v_superficie, v_premio, v_hora,
      coalesce(p_origen, 'ia'), coalesce(p_usuario, 'sistema'), now()
    )
    on conflict (fecha, hipodromo, carrera) do update
      set caballos = case
            when jsonb_typeof(excluded.caballos) = 'array' and jsonb_array_length(excluded.caballos) > 0
            then excluded.caballos
            else public.carreras.caballos
          end,
          distancia = coalesce(excluded.distancia, public.carreras.distancia),
          superficie = coalesce(excluded.superficie, public.carreras.superficie),
          premio = case when coalesce(excluded.premio, 0) > 0 then excluded.premio else public.carreras.premio end,
          hora = coalesce(excluded.hora, public.carreras.hora),
          retirados = coalesce(excluded.retirados, public.carreras.retirados),
          origen = coalesce(excluded.origen, public.carreras.origen),
          actualizado_por = coalesce(excluded.actualizado_por, public.carreras.actualizado_por),
          updated_at = now();

    v_guardadas := v_guardadas + 1;
  end loop;

  return jsonb_build_object('ok', true, 'guardadas', v_guardadas);
end;
$$;

grant execute on function public.upsert_lote_carreras_completo(jsonb, text, text) to authenticated, anon, service_role;

commit;
