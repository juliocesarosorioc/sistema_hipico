-- ============================================================================
-- MEMORIA HISTÓRICA DE EJEMPLARES + REGISTRO DE GACETA CON HISTORIAL
-- ============================================================================
-- POR QUÉ EXISTE
-- --------------
-- La "Inteligencia Hípica" (la pantalla de Proyecciones) necesita saber qué
-- ha hecho cada caballo ANTES de la carrera que se va a proyectar: cuántas
-- veces corrió, cuántas llegó arriba, qué Beyer/Speed Rating traía, con qué
-- jinete y entrenador suele correr y cuál es su Índice de Consistencia.
--
-- Sin eso, la proyección es una opinión con número. Con eso, es un modelo.
--
-- DE DÓNDE SALE LA MEMORIA
-- ------------------------
-- De la propia plataforma: cada vez que se procesa una gaceta, cada ejemplar
-- que aparece queda con una fila en `memoria_historica_caballos`. Esa tabla
-- es la fuente de verdad del historial y se alimenta con la RPC
-- `rpc_registrar_gaceta_e_historial`, que hace las DOS cosas de un solo
-- golpe: deja constancia de la gaceta procesada (`gaceta_procesada`) y
-- escribe el histórico de cada caballo.
--
-- LO QUE SE REGISTRA Y LO QUE SE CUENTA (importante, y por qué)
-- -------------------------------------------------------------
-- La gaceta se procesa ANTES de que la carrera se corra, así que en ese
-- momento se sabe QUIÉN corre, pero no en qué puesto quedó. Por eso:
--
--   - La fila se guarda SIEMPRE (la participación es un hecho).
--   - El `puesto` se rellena con el resultado OFICIAL si ya está cargado
--     (`resultados_carreras.orden_llegada`); si la carrera todavía no corrió,
--     queda en 0 = "participación, resultado pendiente".
--   - La consulta de memoria (`rpc_obtener_memoria_historica_caballos`) solo
--     cuenta las actuaciones con `puesto > 0`: una carrera que todavía no se
--     corrió NO puedeaccountar como actuación del caballo, porque no hay
--     actuación. Volver a procesar la gaceta después de la carrera completa
--     el `puesto` (el `on conflict do update` lo refresca).
--
-- POR QUÉ UNA RPC Y NO UN INSERT DESDE EL NAVEGADOR
-- --------------------------------------------------
-- Porque el histórico es un dato que se escribe UNA vez por carrera y no puede
-- duplicarse: si dos operadores suben la misma gaceta, el caballo no puede
-- tener dos actuaciones de la misma carrera. La RPC resuelve eso con la
-- restricción UNIQUE y con el `on conflict do update`, y de paso valida la
-- capacidad del operador EN EL SERVIDOR.
--
-- EL ÍNDICE DE CONSISTENCIA GODET
-- -------------------------------
-- Es la medida que la pizarra prospectiva usa para separar a un ejemplar
-- CONSTANTE de uno que lucky:
--
--     índice = 100 × ( Σ peso(carrera) × [1 si terminó en el top 3] )
--                   / ( Σ peso(carrera) )
--
-- El peso de la carrera sube con el premio (una carrera de $50.000 pesa más
-- que una de $2.000) y baja si el ejemplar NO llegó al top 3. Un caballo que
-- corre muchas carreras y no gana nunca tiene índice 0: el modelo lo sabe
-- antes de que salga.
--
-- Idempotente: se puede correr las veces que haga falta. NO borra datos.
-- Ejecutar en el SQL Editor de Supabase (SQL puro, sin metacomandos).
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) MEMORIA HISTÓRICA
-- ---------------------------------------------------------------------------
create table if not exists public.memoria_historica_caballos (
  id            uuid primary key default gen_random_uuid(),
  -- El ejemplar del padrón. Es `uuid` porque `public.ejemplares.id` lo es.
  ejemplar_id   uuid references public.ejemplares(id) on delete cascade,
  -- Se guarda el nombre ADEMÁS del id: si el ejemplar no está en el padrón
  -- (todavía no se vinculó), la actuación no se pierde.
  nombre        text not null,
  nacionalidad  text not null default 'VE',
  fecha         date not null,
  hipodromo     text not null default '',
  carrera       int  not null default 0,
  -- Puesto obtenido. 0 = la carrera todavía no corrió (participación
  -- registrada, resultado pendiente). Es lo que distingue "nohay historial"
  -- de "corrido y no pudo".
  puesto        int  not null default 0,
  distancia     int,
  superficie    text,
  premio        numeric,
  jinete        text,
  entrenador    text,
  -- Beyer (Short) y Speed Rating (Long): los dos se guardan porque según el
  -- país se usa uno u otro, y el modelo usa el que haya.
  beyer         int,
  speed_rating  int,
  created_at    timestamptz not null default now(),
  constraint memoria_historica_unica unique (nombre, nacionalidad, fecha, hipodromo, carrera)
);

create index if not exists ix_memoria_historica_nombre
  on public.memoria_historica_caballos (upper(nombre), upper(nacionalidad));
create index if not exists ix_memoria_historica_fecha
  on public.memoria_historica_caballos (fecha desc);

comment on table public.memoria_historica_caballos is
  'Historial de actuaciones por ejemplar: alimenta la memoria historica de la Inteligencia Hipica.';

-- ---------------------------------------------------------------------------
-- 2) RLS: la memoria se LEE con capacidad y se ESCRIBE solo por la RPC.
-- ---------------------------------------------------------------------------
alter table public.memoria_historica_caballos enable row level security;

drop policy if exists memoria_historica_select on public.memoria_historica_caballos;
create policy memoria_historica_select on public.memoria_historica_caballos
  for select to authenticated
  using (
    public.tiene_capacidad(auth.uid(), 'inteligencia_hipica:celda_memoria_historica')
    or public.tiene_capacidad(auth.uid(), 'inteligencia_hipica:ruta_proyecciones')
  );

-- Sin política de INSERT/UPDATE/DELETE: la escritura es de la RPC
-- `security definer`, que valida la capacidad en el servidor.

-- ---------------------------------------------------------------------------
-- 3) REGISTRO DE GACETA CON HISTORIAL
-- ---------------------------------------------------------------------------
-- Deja constancia de la gaceta procesada Y escribe el histórico de cada
-- ejemplar que aparece en ella. Es idempotente: reprocesar la misma gaceta
-- no duplica actuaciones (la restricción UNIQUE de la tabla de memoria lo
-- garantiza) ni el historial; y REFRESCA el `puesto` si la carrera ya
-- corrió mientras tanto.
create or replace function public.rpc_registrar_gaceta_e_historial(
  p_fecha       date,
  p_carreras    jsonb,
  p_creado_por  text default 'desconocido'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_carrera   jsonb;
  v_ej        jsonb;
  v_fecha     date;
  v_hipo      text;
  v_num       int;
  v_nombre    text;
  v_nac       text;
  v_numero    text;
  v_ej_id     uuid;
  v_registros integer := 0;
  v_historial integer := 0;
  v_con_puesto integer := 0;

  -- Texto tal como viene del documento (para castear sin que una rareza
  -- aborte la gaceta entera).
  v_txt_fecha  text;
  v_txt_num    text;
  v_txt_dist   text;
  v_txt_premio text;
  v_txt_puesto text;

  v_fecha_c   date;
  v_distancia int;
  v_premio    numeric;
  v_puesto    int;
  v_superficie text;
begin
  ------------------------------------------------------------------
  -- 1) PERMISO EN EL SERVIDOR
  --
  --    Registrar una gaceta es escribir en el padrón y en el histórico: usa
  --    la misma capacidad que el alta de ejemplares. Sin sesión de Supabase
  --    `auth.uid()` es null y `tiene_capacidad` devuelve false: cierra en
  --    falso.
  ------------------------------------------------------------------
  if not coalesce(public.tiene_capacidad(auth.uid(), 'ejemplares:fn_guardar_ejemplar'), false) then
    raise exception 'Sin permiso para registrar la gaceta.' using errcode = '42501';
  end if;

  if p_carreras is null or jsonb_typeof(p_carreras) <> 'array' then
    raise exception 'Las carreras de la gaceta deben ser una lista.';
  end if;

  ------------------------------------------------------------------
  -- 2) HISTORIAL DE LA GACETA (una fila por documento procesado)
  ------------------------------------------------------------------
  begin
    insert into public.gaceta_procesada (fecha_gaceta, num_carreras, contenido, creado_por)
    values (p_fecha, jsonb_array_length(p_carreras), p_carreras, coalesce(p_creado_por, 'desconocido'));
    v_historial := 1;
  exception
    when undefined_table then
      -- La tabla de historial puede no existir todavía: el histórico de
      -- ejemplares es lo que NO puede faltar, así que se sigue.
      null;
  end;

  ------------------------------------------------------------------
  -- 3) HISTORICO POR EJEMPLAR
  ------------------------------------------------------------------
  for v_carrera in select * from jsonb_array_elements(p_carreras) loop
    -- La fecha de la carrera: la del documento si trae, si no la de la
    -- jornada que eligio el operador.
    v_fecha_c := coalesce(p_fecha, current_date);
    v_txt_fecha := btrim(coalesce(v_carrera ->> 'fecha', ''));
    if v_txt_fecha <> '' then
      begin
        v_fecha_c := v_txt_fecha::date;
      exception when others then
        v_fecha_c := coalesce(p_fecha, current_date);
      end;
    end if;

    v_hipo := upper(btrim(coalesce(v_carrera ->> 'hipodromo', '')));

    v_txt_num := btrim(coalesce(v_carrera ->> 'carrera', ''));
    begin
      v_num := coalesce(nullif(v_txt_num, '')::int, 0);
    exception when others then
      v_num := 0;
    end;

    -- DISTANCIA: viene como "1400", "1400 m" o "1.400". Se quedan los
    -- dígitos y se descarta el separador de miles: "1.400" son 1400 metros,
    -- no 1.4.
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

    -- PREMIO: en Venezuela el separador de miles es el punto ("8.000") y el
    -- decimal es la coma ("8,50"). Postgres leeria "8.000" como 8. Se
    -- distinguen los dos formatos por la forma del texto.
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

    v_superficie := nullif(upper(btrim(coalesce(v_carrera ->> 'superficie', ''))), '');

    for v_ej in
      select * from jsonb_array_elements(
        coalesce(v_carrera -> 'ejemplares', v_carrera -> 'caballos', '[]'::jsonb)
      )
    loop
      v_nombre := upper(btrim(coalesce(v_ej ->> 'nombre', '')));
      if v_nombre = '' then
        continue;
      end if;
      v_nac := upper(btrim(coalesce(v_ej ->> 'nacionalidad', 'VE')));
      if v_nac = '' then
        v_nac := 'VE';
      end if;
      v_numero := btrim(coalesce(v_ej ->> 'numero', ''));

      -- Se busca el ejemplar en el padron para poder enlazarlo. Si todavia no
      -- esta, se crea: el padron es la base de las estadisticas.
      select e.id into v_ej_id
        from public.ejemplares e
       where upper(e.nombre) = v_nombre
         and upper(e.nacionalidad) = v_nac
       limit 1;

      if v_ej_id is null then
        begin
          insert into public.ejemplares (nombre, nacionalidad)
          values (v_nombre, v_nac)
          on conflict do nothing;
          select e.id into v_ej_id
            from public.ejemplares e
           where upper(e.nombre) = v_nombre
             and upper(e.nacionalidad) = v_nac
           limit 1;
        exception when others then
          v_ej_id := null;
        end;
      end if;

      ----------------------------------------------------------------
      -- PUESTO: primero el resultado oficial si la carrera ya corrio,
      -- si no el dato que traiga la gaceta, si no 0 (pendiente).
      ----------------------------------------------------------------
      v_puesto := 0;

      if v_num <> 0 and v_numero <> '' then
        begin
          select el ->> 'puesto' into v_txt_puesto
            from public.resultados_carreras r,
                 lateral jsonb_array_elements(coalesce(r.orden_llegada, '[]'::jsonb)) el
           where r.fecha = v_fecha_c
             and upper(btrim(coalesce(r.hipodromo, ''))) = v_hipo
             and r.carrera = v_num
             and el ->> 'numero' = v_numero
           limit 1;
        exception when others then
          v_txt_puesto := null;
        end;

        if v_txt_puesto is not null and btrim(v_txt_puesto) <> '' then
          begin
            v_puesto := coalesce(nullif(btrim(v_txt_puesto), '')::int, 0);
          exception when others then
            v_puesto := 0;
          end;
        else
          -- Sin `orden_llegada`: se intenta con la lista de ganadores, que
          -- puede venir como texto ("1/2/3") o como arreglo.
          begin
            if exists (
              select 1
                from public.resultados_carreras r
               where r.fecha = v_fecha_c
                 and upper(btrim(coalesce(r.hipodromo, ''))) = v_hipo
                 and r.carrera = v_num
                 and (
                   (jsonb_typeof(r.ganadores) = 'array'
                    and r.ganadores @> to_jsonb(v_numero))
                   or (
                     jsonb_typeof(r.ganadores) <> 'array'
                     and position('/' || v_numero || '/' in '/' || coalesce(r.ganadores::text, '') || '/') > 0
                   )
                 )
            ) then
              v_puesto := 1;
            end if;
          exception when others then
            v_puesto := 0;
          end;
        end if;
      end if;

      -- Si la gaceta traia el puesto (a veces lo trae), y no hay resultado
      -- oficial, se respeta el dato del documento.
      if v_puesto = 0 then
        v_txt_puesto := btrim(coalesce(v_ej ->> 'puesto', ''));
        if v_txt_puesto <> '' then
          begin
            v_puesto := coalesce(nullif(v_txt_puesto, '')::int, 0);
          exception when others then
            v_puesto := 0;
          end;
        end if;
      end if;

      if v_puesto > 0 then
        v_con_puesto := v_con_puesto + 1;
      end if;

      insert into public.memoria_historica_caballos (
        ejemplar_id, nombre, nacionalidad, fecha, hipodromo, carrera,
        puesto, distancia, superficie, premio, jinete, entrenador,
        beyer, speed_rating
      )
      values (
        v_ej_id, v_nombre, v_nac, v_fecha_c, v_hipo, v_num,
        v_puesto,
        v_distancia,
        v_superficie,
        v_premio,
        nullif(btrim(coalesce(v_ej ->> 'jinete', '')), ''),
        nullif(btrim(coalesce(v_ej ->> 'entrenador', '')), ''),
        -- Beyer y Speed Rating: enteros. El texto se valida ANTES de castear
        -- (una rareza del documento no puede abortar la gaceta entera) y se
        -- guarda NULL si no es un número.
        case
          when btrim(coalesce(v_ej ->> 'beyer', '')) ~ '^[0-9]{1,4}$'
            then (btrim(v_ej ->> 'beyer'))::int
          else null
        end,
        case
          when btrim(coalesce(v_ej ->> 'speed_rating', '')) ~ '^[0-9]{1,4}$'
            then (btrim(v_ej ->> 'speed_rating'))::int
          else null
        end
      )
      on conflict (nombre, nacionalidad, fecha, hipodromo, carrera) do update
        set puesto = excluded.puesto,
            ejemplar_id = coalesce(excluded.ejemplar_id, public.memoria_historica_caballos.ejemplar_id),
            distancia = coalesce(excluded.distancia, public.memoria_historica_caballos.distancia),
            superficie = coalesce(excluded.superficie, public.memoria_historica_caballos.superficie),
            premio = coalesce(excluded.premio, public.memoria_historica_caballos.premio),
            jinete = coalesce(excluded.jinete, public.memoria_historica_caballos.jinete),
            entrenador = coalesce(excluded.entrenador, public.memoria_historica_caballos.entrenador),
            beyer = coalesce(excluded.beyer, public.memoria_historica_caballos.beyer),
            speed_rating = coalesce(excluded.speed_rating, public.memoria_historica_caballos.speed_rating);
      v_registros := v_registros + 1;
    end loop;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'participaciones', v_registros,
    'con_resultado', v_con_puesto,
    'historial', v_historial,
    'carreras', jsonb_array_length(p_carreras)
  );
end;
$$;

revoke all on function public.rpc_registrar_gaceta_e_historial(date, jsonb, text) from public;
grant execute on function public.rpc_registrar_gaceta_e_historial(date, jsonb, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4) MEMORIA HISTORICA DE UN LOTE DE EJEMPLARES
-- ---------------------------------------------------------------------------
-- Devuelve, por ejemplar, todo lo que el modelo necesita para proyectarlo:
-- actuaciones, aciertos, serie de ratings, jinete y entrenador habituales y el
-- Índice de Consistencia Godet.
--
-- Solo cuenta las actuaciones con `puesto > 0`: una carrera registrada por la
-- gaceta pero que todavía no se corrió NO es una actuación del caballo.
create or replace function public.rpc_obtener_memoria_historica_caballos(
  p_nombres     text[],
  p_fecha_corte date default null
)
returns table (
  nombre                  text,
  nacionalidad            text,
  actuaciones             int,
  placements              int,
  win_rate                numeric,
  indice_consistencia_godet numeric,
  speed_rating            int,
  serie_speed_rating      int[],
  jinete_habitual         text,
  entrenador_habitual     text,
  historial               jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limite date := coalesce(p_fecha_corte, current_date);
begin
  return query
  with base as (
    select
      m.nombre,
      m.nacionalidad,
      m.fecha,
      m.hipodromo,
      m.carrera,
      m.puesto,
      m.distancia,
      m.superficie,
      m.premio,
      m.jinete,
      m.entrenador,
      m.beyer,
      m.speed_rating
    from public.memoria_historica_caballos m
    where upper(m.nombre) = any (select upper(x) from unnest(coalesce(p_nombres, '{}'::text[])) x)
      and m.fecha <= v_limite
      and m.puesto > 0
  ),
  agregado as (
    select
      b.nombre,
      b.nacionalidad,
      count(*)::int                                                   as actuaciones,
      count(*) filter (where b.puesto between 1 and 3)::int             as placements,
      round(
        100.0 * count(*) filter (where b.puesto between 1 and 3)::numeric
        / nullif(count(*), 0),
        2
      )                                                               as win_rate,
      -- Índice de Consistencia Godet: el premio pondera cada actuación.
      -- Un caballo que sólo corre carreras chicas no compite con uno que
      -- corre las grandes, aunque arranque igual.
      round(
        100.0
        * coalesce(sum(
            case when b.puesto between 1 and 3
                 then greatest(coalesce(b.premio, 0), 1)
                 else 0
            end
          ), 0)
        / nullif(sum(greatest(coalesce(b.premio, 0), 1)), 0),
        2
      )                                                               as indice_consistencia_godet,
      max(coalesce(b.speed_rating, b.beyer, 0))::int                    as speed_rating,
      -- El jinete y el entrenador habituales: el que más veces los montó/cargó.
      (select x.jinete
         from (select jinete, count(*) c from base y
                where y.nombre = b.nombre and y.nacionalidad = b.nacionalidad
                  and y.jinete is not null
                group by jinete) x
        order by x.c desc limit 1)                                    as jinete_habitual,
      (select x.entrenador
         from (select entrenador, count(*) c from base y
                where y.nombre = b.nombre and y.nacionalidad = b.nacionalidad
                  and y.entrenador is not null
                group by entrenador) x
        order by x.c desc limit 1)                                    as entrenador_habitual
    from base b
    group by b.nombre, b.nacionalidad
  )
  select
    a.nombre,
    a.nacionalidad,
    a.actuaciones,
    a.placements,
    a.win_rate,
    a.indice_consistencia_godet,
    a.speed_rating,
    coalesce(
      (
        select array_agg(coalesce(h.speed_rating, h.beyer, 0) order by h.fecha desc)
          from (
            select y.fecha, y.speed_rating, y.beyer
              from base y
             where y.nombre = a.nombre and y.nacionalidad = a.nacionalidad
             order by y.fecha desc
             limit 12
           ) h
      ),
      '{}'::int[]
    ),
    a.jinete_habitual,
    a.entrenador_habitual,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'fecha', h.fecha,
            'hipodromo', h.hipodromo,
            'carrera', h.carrera,
            'puesto', h.puesto,
            'distancia', h.distancia,
            'superficie', h.superficie,
            'premio', h.premio
          )
          order by h.fecha desc
        )
          from (
            select y.fecha, y.hipodromo, y.carrera, y.puesto, y.distancia, y.superficie, y.premio
              from base y
             where y.nombre = a.nombre and y.nacionalidad = a.nacionalidad
             order by y.fecha desc
             limit 25
           ) h
      ),
      '[]'::jsonb
    )
  from agregado a
  order by a.indice_consistencia_godet desc nulls last, a.actuaciones desc;
end;
$$;

revoke all on function public.rpc_obtener_memoria_historica_caballos(text[], date) from public;
grant execute on function public.rpc_obtener_memoria_historica_caballos(text[], date) to authenticated;

commit;
