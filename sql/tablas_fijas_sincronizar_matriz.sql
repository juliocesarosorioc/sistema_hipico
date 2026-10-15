-- ===========================================================================
-- COHERENCIA POR CONSTRUCCION: tablas_fijas -> carreras (MATRIZ MAESTRA)
--
-- QUE HACE
-- Deja la carrera en la MATRIZ MAESTRA `carreras` (sql/carreras.sql) siempre que
-- exista su tabla en `tablas_fijas`. `carreras` es de donde TODOS los modulos de
-- la plataforma listan el catalogo; `tablas_fijas` solo la lee el modulo Tablas.
--
-- EL BUG QUE ARREGLA: "las carreras de hoy solo aparecen en Tablas Fijas"
-- ---------------------------------------------------------------------------
-- El modulo de Tablas lee `tablas_fijas`. Marcas, Gestion de Jugadas,
-- Dupletas, Remates, Liquidacion, Taquilla y el semaforo leen la matriz
-- `carreras`. Son DOS fuentes distintas de "que carreras hay".
--
-- La unica sincronizacion que habia entre ellas era en el CLIENTE
-- (`sincronizarCentralDesdeTabla` -> `registrarCarreraMaestro`), y es
-- best-effort: si esa llamada fallaba, la tabla quedaba publicada y visible en
-- Tablas, pero la carrera NO existia en `carreras` y por lo tanto no aparecia
-- en ningun otro modulo. El operador no podia venderla, cargarle marcas ni
-- sacarle una dupla, y la unica salida era registrarla a mano.
--
-- El trigger que ya existe (`tablas_fijas_sincronizar_central.sql`) no cubria
-- este hueco: escribe `resultados_carreras`, que es el LIBRO DE RESULTADOS, no
-- el catalogo. Como la migracion a la matriz `carreras` movio la lectura de
-- todos los modulos ahi, ese trigger quedo funcionando y aun asi el catalogo se
-- llenaba solo cuando la aplicacion se acordaba de hacerlo.
--
-- La sincronizacion de cliente, ademas, tiene caminos que no puede cubrir:
--   - la RPC `publicarTabla` / `publicarTablasLote`;
--   - el Monitor de Tablas al editar caballos, distancia o premio;
--   - scripts de carga y backfills;
--   - un PostgREST directo (`tablas_fijas` tiene RLS desactivado).
--
-- Con este trigger la coherencia pasa de "hay que acordarse" a "es imposible que
-- no sea": si existe la tabla, existe la carrera en el catalogo.
--
-- LO QUE ESTE TRIGGER NO HACE (y por que)
--   - NO corrige fechas. Para la base "2026-04-10" es una fecha valida; la
--     ambiguedad de la fecha la resuelve la aplicacion (`src/lib/fechas.ts`).
--     Se usa `fecha` (el dia de juego), nunca `fecha_creacion`.
--   - NO borra la carrera de la matriz cuando se borra la tabla. Retirar o
--     cerrar una tabla no significa que la carrera no exista: Taquilla todavia
--     la necesita para resolver cobros y pagos. Dar de baja una carrera es una
--     operacion aparte (`eliminarCarreraMaestro`).
--   - NO toca `retirados`, `invalidado_remate` ni la auditoria
--     (`verificado*`). Son de las personas, no de la tabla: van por
--     `reflejarRetiradosMatriz` / `guardarInvalidadosRemate`.
--   - NO retrocede el estado. Una carrera que ya corrio ("Resultados" o
--     "Liquidada") no vuelve a "Abierta" porque se reabra su tabla.
--   - NO toca resultados. `resultados_carreras` los manda el trigger hermano y
--     Taquilla; aca solo se ENLAZA la fila de resultados con la de la matriz.
--
-- ADEMAS DEL TRIGGER
--   - Respaldo: da de alta en la matriz TODA tabla ya publicada que no
--     estuviera en `carreras` y la enlaza con su resultado y su hipodromo. Sin
--     esto el trigger solo arregla lo que se publique DESPUES de aplicarlo, y
--     el operador seguiria sin ver las carreras de hoy.
--
-- ES IDEMPOTENTE. Aplicarlo varias veces no cambia nada.
-- Ejecutar en el SQL Editor de Supabase.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0) COMPROBACIONES PREVIAS. Un trigger solo puede referenciar columnas que
--    EXISTAN: si falta alguna, la escritura en `tablas_fijas` empieza a fallar
--    en tiempo de ejecucion y eso PARTE LA VENTA. Se verifica PRIMERO y se
--    aborta nombrando exactamente lo que falta.
-- ---------------------------------------------------------------------------
do $$
declare
  v_faltan text;
begin
  if to_regclass('public.carreras') is null then
    raise exception
      'No existe public.carreras (la matriz maestra). Aplica sql/carreras.sql ANTES de este archivo: sin la matriz no hay catalogo que sincronizar.';
  end if;

  select string_agg(c, ', ') into v_faltan
    from unnest(array[
           'fecha', 'hipodromo', 'carrera', 'caballos', 'retirados',
           'invalidado_remate', 'distancia', 'superficie', 'premio',
           'estado', 'origen', 'hipodromo_id', 'verificado', 'updated_at'
         ]) as c
   where not exists (
           select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'carreras'
              and column_name = c);

  if v_faltan is not null then
    raise exception
      'public.carreras no tiene estas columnas: %. No se instalo el trigger: corri primero sql/carreras.sql.', v_faltan;
  end if;
end $$;

-- Misma guarda para `tablas_fijas`. El cuerpo de la funcion SOLO se valida al
-- ejecutarse, asi que sin esto el error aparece recien al publicar.
do $$
declare
  v_faltan text;
begin
  if to_regclass('public.tablas_fijas') is null then
    raise exception 'No existe public.tablas_fijas: este archivo no aplica.';
  end if;

  select string_agg(c, ', ') into v_faltan
    from unnest(array[
           'fecha', 'hipodromo', 'carrera', 'caballos', 'distancia_carrera',
           'superficie', 'premio_original', 'estado'
         ]) as c
   where not exists (
           select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'tablas_fijas'
              and column_name = c);

  if v_faltan is not null then
    raise exception
      'public.tablas_fijas no tiene estas columnas: %. No se instalo el trigger.', v_faltan;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1) EL NUCLEO, COMO FUNCION REUTILIZABLE.
--    Vive aparte del trigger para que el respaldo de la seccion 4 pueda correr
--    EXACTAMENTE la misma logica: si se copiara el INSERT a mano, las dos
--    copias podrian divergir y el respaldo dejaria de representar al trigger.
-- ---------------------------------------------------------------------------
create or replace function public.club_sincronizar_carrera_desde_tabla(
  p_fecha            date,
  p_hipodromo        text,
  p_carrera          integer,
  p_caballos         jsonb,
  p_distancia        text,
  p_superficie       text,
  p_premio           numeric,
  p_estado           text
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_hipo  text;
  v_cab   jsonb;
  v_estado text;
begin
  v_hipo := upper(btrim(coalesce(p_hipodromo, '')));
  -- Sin identificacion no hay carrera que sincronizar. Se devuelve sin error:
  -- una tabla sin fecha o sin hipodromo es un dato incompleto, y abortar aqui
  -- tiraria abajo la escritura de la tabla (y con ella la venta).
  if v_hipo = '' or p_carrera is null or p_fecha is null then
    return;
  end if;

  v_cab := coalesce(p_caballos, '[]'::jsonb);

  -- El estado comercial de la tabla es el del maestro: los dos comparten
  -- vocabulario (Programada | Abierta | Cerrada | Resultados | Liquidada).
  v_estado := case when btrim(coalesce(p_estado, '')) = 'Cerrada'
                   then 'Cerrada' else 'Abierta' end;

  insert into public.carreras
         (fecha, hipodromo, carrera, estado, caballos, distancia, superficie,
          premio, origen, updated_at)
  values (
    p_fecha,
    v_hipo,
    p_carrera,
    v_estado,
    v_cab,
    nullif(btrim(coalesce(p_distancia, '')), ''),
    nullif(btrim(coalesce(p_superficie, '')), ''),
    p_premio,
    'tablas',
    now()
  )
  on conflict (fecha, hipodromo, carrera) do update
      -- La OFERTA la manda la tabla: caballos, distancia, superficie y premio.
      -- Se pisa SOLO con valor real: un array vacio o un null NUNCA borra lo que
      -- un modulo ya cargo en la matriz.
      set estado     = case
                         when carreras.estado in ('Resultados', 'Liquidada')
                           then carreras.estado    -- ya corrio: la tabla no lo retrocede
                         else excluded.estado
                       end,
          caballos   = case
                         when excluded.caballos is not null
                          and jsonb_array_length(excluded.caballos) > 0
                         then excluded.caballos
                         else carreras.caballos
                       end,
          distancia  = coalesce(nullif(btrim(coalesce(excluded.distancia, '')), ''),  carreras.distancia),
          superficie = coalesce(nullif(btrim(coalesce(excluded.superficie, '')), ''), carreras.superficie),
          premio     = coalesce(excluded.premio, carreras.premio),
          -- `origen` solo se rellena si no habia: una carrera cargada por la IA
          -- que despues llega por Tablas sigue siendo de la IA.
          origen     = coalesce(carreras.origen, 'tablas'),
          updated_at = now();
end;
$$;

comment on function public.club_sincronizar_carrera_desde_tabla(
  date, text, integer, jsonb, text, text, numeric, text) is
  'Upsert de la oferta de una tabla en la MATRIZ MAESTRA carreras (la que leen '
  'Marcas, Gestion, Dupletas, Remates, Liquidacion y Taquilla). No toca '
  'retirados, invalidados, auditoria ni resultados.';

-- Solo el trigger y este script la llaman. Sin esto, `security definer` +
-- `execute` por defecto dejarian la funcion ejecutable por `anon`.
revoke all on function public.club_sincronizar_carrera_desde_tabla(
  date, text, integer, jsonb, text, text, numeric, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2) EL TRIGGER
--    Se escucha `fecha` porque mover una tabla de dia reordena el catalogo, y
--    `estado` porque cerrar la tabla es un dato comercial que el maestro refleja.
-- ---------------------------------------------------------------------------
create or replace function public.tgf_tablas_fijas_sincronizar_matriz()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.club_sincronizar_carrera_desde_tabla(
    new.fecha,
    new.hipodromo,
    new.carrera::int,
    coalesce(new.caballos, '[]'::jsonb),
    new.distancia_carrera::text,
    new.superficie,
    new.premio_original::numeric,
    new.estado
  );
  return new;
end;
$$;

comment on function public.tgf_tablas_fijas_sincronizar_matriz() is
  'Trigger de coherence: toda tabla en tablas_fijas tiene su carrera en la '
  'matriz maestra carreras.';

drop trigger if exists trg_tablas_fijas_matriz on public.tablas_fijas;

create trigger trg_tablas_fijas_matriz
after insert or update of fecha, hipodromo, carrera, caballos, distancia_carrera,
     superficie, premio_original, estado
on public.tablas_fijas
for each row
execute function public.tgf_tablas_fijas_sincronizar_matriz();

-- ---------------------------------------------------------------------------
-- 3) ENLACES. `carreras` se lee con el resultado EMBEBIDO (una sola consulta
--    para catalogo + pizarra), asi que `resultados_carreras.carrera_id` tiene que
--    apuntar a la fila de la matriz. `hipodromo_id` se deja enlazado con el
--    catalogo de hipodromos. Ambos "solo si faltan".
-- ---------------------------------------------------------------------------
update public.resultados_carreras r
   set carrera_id = c.id
  from public.carreras c
 where r.carrera_id is null
   and c.fecha = r.fecha
   and c.hipodromo = upper(btrim(r.hipodromo))
   and c.carrera = r.carrera;

update public.carreras c
   set hipodromo_id = h.id
  from public.hipodromos h
 where c.hipodromo_id is null
   and upper(btrim(h.nombre)) = c.hipodromo;

-- ---------------------------------------------------------------------------
-- 4) RESPALDO: toda tabla ya publicada entra en la matriz. El trigger solo
--    arregla lo que se publique DESPUES de aplicarlo; sin esto, las carreras de
--    HOY seguirian sin aparecer en Marcas, Gestion y Dupletas.
-- ---------------------------------------------------------------------------
do $$
declare
  v_t   record;
  v_n   bigint := 0;
begin
  for v_t in
    select fecha,
           upper(btrim(hipodromo))                       as hipo,
           carrera::int                                   as num,
           coalesce(caballos, '[]'::jsonb)                as cab,
           distancia_carrera::text                        as dist,
           superficie                                     as sup,
           premio_original::numeric                       as prem,
           estado                                         as est
      from public.tablas_fijas
     where fecha is not null
       and nullif(btrim(coalesce(hipodromo, '')), '') is not null
       and carrera is not null
  loop
    perform public.club_sincronizar_carrera_desde_tabla(
      v_t.fecha, v_t.hipo, v_t.num, v_t.cab, v_t.dist, v_t.sup, v_t.prem, v_t.est
    );
    v_n := v_n + 1;
  end loop;
  raise notice 'Respaldo: % tablas_fijas sincronizadas con la matriz carreras.', v_n;
end $$;

commit;

-- ===========================================================================
-- VERIFICACION
-- 1) Tablas publicadas que siguen SIN carrera en el catalogo (debe dar 0):
--      SELECT count(*) FROM public.tablas_fijas t
--       WHERE t.fecha IS NOT NULL AND t.carrera IS NOT NULL
--         AND NOT EXISTS (SELECT 1 FROM public.carreras c
--                          WHERE c.fecha = t.fecha
--                            AND c.hipodromo = upper(btrim(t.hipodromo))
--                            AND c.carrera = t.carrera);
-- 2) Carreras de HOY por hipodromo (esto es lo que ven Marcas/Gestion/Dupletas):
--      SELECT hipodromo, count(*), min(carrera), max(carrera)
--        FROM public.carreras WHERE fecha = current_date GROUP BY hipodromo;
-- 3) Resultados sin enlazar a la matriz (debe dar 0):
--      SELECT count(*) FROM public.resultados_carreras WHERE carrera_id IS NULL;
-- 4) De donde viene cada carrera del catalogo:
--      SELECT origen, count(*) FROM public.carreras GROUP BY origen;
-- ===========================================================================
