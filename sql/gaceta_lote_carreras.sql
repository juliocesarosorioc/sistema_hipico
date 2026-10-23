-- ============================================================================
-- CARGA DE GACETA POR LOTES — UPSERT ACUMULATIVO
-- ============================================================================
-- POR QUÉ EXISTE
-- --------------
-- La gaceta se carga por LOTES: el operador sube el documento de un
-- hipódromo hoy y el de otro mañana, y a veces el mismo documento en dos
-- partes (Belmont 1-3 y luego Belmont 4-6).
--
-- Con un UPSERT normal (on conflict do update) la fila de la carrera se
-- REESCRIBE entera: el segundo lote borraba los ejemplares del primero, y una
-- carrera leída a medias (6 de 10 ejemplares) se quedaba con 6. Peor: si la
-- carrera no venía en el lote, algunas rutas la eliminaban del hipódromo
-- entero.
--
-- Esta RPC hace las dos cosas bien:
--
--   1) Escribe cada carrera del lote con `on conflict (fecha, hipodromo,
--      carrera) do update`, así que nunca hay filas duplicadas.
--   2) FUSIONA el arreglo de ejemplares por NÚMERO DE GUALDRAPA: los números
--      nuevos se agregan, los repetidos se actualizan y los que el lote NO
--      trae se CONSERVAN.
--
-- Y nunca borra: las carreras de un hipódromo que no vienen en este lote
-- siguen ahí. La clave del upsert es (hipodromo_id, fecha, numero_carrera),
-- que es la identidad real de una carrera en la plataforma.
--
-- Idempotente: se puede correr las veces que haga falta. NO borra datos.
-- Ejecutar en el SQL Editor de Supabase (SQL puro, sin metacomandos).
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) INDICE UNICO POR (hipodromo_id, fecha, carrera)
-- ---------------------------------------------------------------------------
-- La tabla `carreras` ya es UNIQUE por (fecha, hipodromo, carrera) —con el
-- TEXTO del hipódromo—, pero la identidad real de una carrera es el ID del
-- hipódromo. Este índice permite el upsert por ID y evita que dos grafías
-- del mismo hipódromo ("LA RINCONADA" / "La Rinconada") creen carreras
-- gemelas.
--
-- Se crea solo si NO existe: si la tabla tiene filas con hipodromo_id NULL
-- (carreras cargadas antes de que existiera la columna), el índice UNIQUE
-- aceptaría NULLs repetidos sin quejarse, y no rompe nada.
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

-- ---------------------------------------------------------------------------
-- 2) RPC DE CARGA POR LOTES
-- ---------------------------------------------------------------------------
create or replace function public.rpc_guardar_lote_carreras_gaceta(
  p_fecha        date,
  p_hipodromo    text,
  p_hipodromo_id uuid default null,
  p_carreras     jsonb,
  p_creado_por   text default 'desconocido'
)
returns jsonb
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
  v_es_uevo  boolean;
  v_total    integer := 0;
begin
  ------------------------------------------------------------------
  -- 1) PERMISO EN EL SERVIDOR
  --
  --    Registrar carreras en la matriz es la misma operación que hace el
  --    botón "Registrar carrera" del monitor: usa su capacidad. Sin sesión
  --    de Supabase `auth.uid()` es null y `tiene_capacidad` devuelve false:
  --    cierra en falso.
  ------------------------------------------------------------------
  if not coalesce(public.tiene_capacidad(auth.uid(), 'carreras:fn_registrar_carrera'), false) then
    raise exception 'Sin permiso para registrar carreras.' using errcode = '42501';
  end if;

  if to_regclass('public.carreras') is null then
    raise exception 'La matriz de carreras no esta aplicada: ejecuta sql/carreras.sql.';
  end if;

  if p_carreras is null or jsonb_typeof(p_carreras) <> 'array' then
    raise exception 'Las carreras del lote deben ser una lista.';
  end if;

  if nullif(btrim(coalesce(p_hipodromo, '')), '') is null then
    raise exception 'El lote necesita el hipodromo.';
  end if;

  ------------------------------------------------------------------
  -- 2) CADA CARRERA DEL LOTE
  ------------------------------------------------------------------
  for v_carrera in select * from jsonb_array_elements(p_carreras) loop
    begin
      v_num := coalesce(nullif(v_carrera ->> 'carrera', '')::int, 0);
    exception when others then
      v_num := 0;
    end;
    if v_num <= 0 then
      continue;
    end if;

    ----------------------------------------------------------------
    -- 2a) EJEMPLARES: FUSION POR NUMERO DE GUALDRAPA
    --
    --     Se leen los ejemplares YA GUARDADOS de esa carrera y se les
    --     agrega el lote, numero a numero. Los que el lote no trae se
    --     conservan: un lote parcial NUNCA deja la carrera a medias.
    ----------------------------------------------------------------
    select coalesce(c.caballos, '[]'::jsonb) into v_existentes
      from public.carreras c
     where c.fecha = coalesce(p_fecha, current_date)
       and upper(c.hipodromo) = upper(btrim(p_hipodromo))
       and c.carrera = v_num
     limit 1;

    v_fusionados := '[]'::jsonb;
    v_vistos := '[]'::jsonb;

    -- Primero los que YA estaban guardados.
    for v_item in select * from jsonb_array_elements(coalesce(v_existentes, '[]'::jsonb)) loop
      v_numero := btrim(coalesce(v_item ->> 'numero', ''));
      if v_numero = '' then
        continue;
      end if;
      v_fusionados := v_fusionados || jsonb_build_array(v_item);
      v_vistos := v_vistos || jsonb_build_array(v_numero);
    end loop;

    -- Despues los del lote: si el numero ya estaba, se ACTUALIZA (el dato
    -- nuevo pisa al viejo solo si trae contenido); si no, se agrega.
    for v_ej in
      select * from jsonb_array_elements(coalesce(v_carrera -> 'ejemplares', v_carrera -> 'caballos', '[]'::jsonb))
    loop
      v_numero := btrim(coalesce(v_ej ->> 'numero', ''));
      v_nombre := upper(btrim(coalesce(v_ej ->> 'nombre', '')));
      if v_numero = '' or v_nombre = '' then
        continue;
      end if;

      if v_vistos ? v_numero then
        -- Reemplaza la entrada existente por la nueva, completando los campos
        -- que la nueva NO trae con los que ya estaban.
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

    ----------------------------------------------------------------
    -- 2b) UPSERT DE LA CARRERA
    --
    --     `on conflict (fecha, hipodromo, carrera) do update`: la fila se
    --     ACTUALIZA, nunca se duplica. Y las carreras del hipodromo que NO
    --     vienen en este lote NO se tocan: el hipodromo sigue completo.
    ----------------------------------------------------------------
    insert into public.carreras (
      fecha, hipodromo, hipodromo_id, carrera, estado, caballos,
      distancia, superficie, premio, origen, actualizado_por, updated_at
    )
    values (
      coalesce(p_fecha, current_date),
      upper(btrim(p_hipodromo)),
      p_hipodromo_id,
      v_num,
      'Programada',
      v_fusionados,
      nullif(btrim(coalesce(v_carrera ->> 'distancia', '')), ''),
      nullif(upper(btrim(coalesce(v_carrera ->> 'superficie', ''))), ''),
      nullif(btrim(coalesce(v_carrera ->> 'premio', '')), '')::numeric,
      'ia',
      coalesce(p_creado_por, 'desconocido'),
      now()
    )
    on conflict (fecha, hipodromo, carrera) do update
      set caballos = coalesce(excluded.caballos, public.carreras.caballos),
          distancia = coalesce(excluded.distancia, public.carreras.distancia),
          superficie = coalesce(excluded.superficie, public.carreras.superficie),
          premio = coalesce(excluded.premio, public.carreras.premio),
          hipodromo_id = coalesce(excluded.hipodromo_id, public.carreras.hipodromo_id),
          actualizado_por = coalesce(p_creado_por, 'desconocido'),
          updated_at = now();

    v_total := v_total + 1;
  end loop;

  ------------------------------------------------------------------
  -- 3) RESPUESTA
  ------------------------------------------------------------------
  return jsonb_build_object(
    'ok', true,
    'guardadas', v_total,
    'fecha', coalesce(p_fecha, current_date),
    'hipodromo', upper(btrim(p_hipodromo))
  );
end;
$$;

revoke all on function public.rpc_guardar_lote_carreras_gaceta(date, text, uuid, jsonb, text) from public;
grant execute on function public.rpc_guardar_lote_carreras_gaceta(date, text, uuid, jsonb, text) to authenticated;

commit;
