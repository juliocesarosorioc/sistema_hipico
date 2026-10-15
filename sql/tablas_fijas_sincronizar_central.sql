-- ===========================================================================
-- COHERENCIA POR CONSTRUCCION: tablas_fijas -> resultados_carreras
--
-- QUE HACE
-- Un trigger AFTER INSERT OR UPDATE sobre `tablas_fijas` que mantiene la fila
-- de `resultados_carreras` (el "central" que leen Marcas, Gestion de Jugadas y
-- Dupletas) siempre en existencia y con la MISMA oferta de la tabla.
--
-- POR QUE HACE FALTA, SI LA APLICACION YA SINCRONIZA
-- Porque la sincronizacion del cliente es solo UNA de las formas de escribir en
-- `tablas_fijas`. Tambien escriben:
--   - la RPC `publicarTabla` / `publicarTablasLote`;
--   - el Monitor de Tablas, al editar caballos o distancia;
--   - scripts de carga y backfills;
--   - un PostgREST directo (la tabla tiene RLS desactivado).
-- Cada uno de esos caminos puede olvidar sincronizar el central, y entonces la
-- carrera queda publicada (se vende) pero invisible para Marcas y Gestion.
--
-- Esto paso de verdad: el 04-10-2026 se publicaron 13 carreras y SOLO C13 llego
-- al central. Publicar una tabla NO creaba la carrera en `resultados_carreras`;
-- solo lo hacia el Modo Manual, y solo para carreras vacias.
--
-- Aqui la fila del central no se puede "olvidar": si existe la tabla, existe el
-- central. Eso convierte la coherencia de "hay que acordarse" a "es imposible
-- que no sea".
--
-- LO QUE ESTE TRIGGER NO HACE (y por que)
--   - NO corrige fechas. Un trigger no sabe si el operador quiso el 4 de
--     octubre o el 10 de abril: para la base "2026-04-10" es una fecha
--     perfectamente valida. La ambiguedad de la fecha se resuelve en la
--     aplicacion, donde si se sabe que convencion usa la operacion
--     (`src/lib/fechas.ts` y `src/lib/tablas/validar-carga.ts`).
--   - NO toca resultados de liquidacion. `ganadores`, `dividendos`,
--     `premio_recalculado`, `detalle`, `orden_llegada` y `aplicado_a_tablas`
--     son el producto de liquidar la carrera. Si estan llenos, la fila central
--     se respeta tal cual: solo se le completa lo que le falte. Un trigger que
--     "fuera de si las carreras" volveria a cargar desde la tabla con datos
--     desactualizados.
--   - NO borra central cuando se borra la tabla. Cerrar o retirar una tabla no
--     significa que la carrera no exista.
--
-- ES IDEMPOTENTE. Aplicarlo varias veces no cambia nada.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- La funcion
-- ---------------------------------------------------------------------------
create or replace function public.tgf_tablas_fijas_sincronizar_central()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_hipo text;
  v_cab  jsonb;
begin
  v_hipo := upper(btrim(new.hipodromo));
  v_cab  := coalesce(new.caballos, '[]'::jsonb);

  -- Sin hipodromo o sin ejemplares no hay oferta que sincronizar (una tabla
  -- vacia no genera nada en el central).
  if v_hipo is null or v_hipo = '' or jsonb_array_length(v_cab) = 0 then
    return new;
  end if;

  insert into public.resultados_carreras
         (fecha, hipodromo, carrera, caballos, distancia, superficie, premio,
          ganadores, retirados, aplicado_a_tablas, updated_at)
  values (
    new.fecha,
    v_hipo,
    new.carrera,
    v_cab,
    new.distancia_carrera::text,
    new.superficie,
    new.premio_original,
    '{}'::text[],
    coalesce(nullif(btrim(new.retirados_oficiales), ''), 'NO HUBO RETIROS'),
    false,
    now()
  )
  on conflict (fecha, hipodromo, carrera) do update
      -- La OFERTA la manda la tabla: caballos, distancia, superficie, premio y
      -- los retiros. Se pisa solo con valor real: un array vacio o un null
      -- NUNCA borra lo que ya estaba cargado en el central.
      set caballos   = case
                         when excluded.caballos is not null
                          and jsonb_array_length(excluded.caballos) > 0
                         then excluded.caballos
                         else resultados_carreras.caballos
                       end,
          distancia  = coalesce(excluded.distancia,  resultados_carreras.distancia),
          superficie = coalesce(excluded.superficie, resultados_carreras.superficie),
          premio     = coalesce(excluded.premio,     resultados_carreras.premio),
          retirados  = coalesce(nullif(btrim(excluded.retirados), ''),
                                resultados_carreras.retirados),
          updated_at = now()
    -- `ganadores`, `premio_recalculado`, `premio_oficial`, `detalle`,
    -- `dividendos`, `orden_llegada` y `aplicado_a_tablas` NO aparecen en el SET:
      -- quedan intactos. Es lo que permite que la aplicacion siga siendo dueña de
      -- la liquidacion sin pelearse con el trigger.
  where resultados_carreras.ganadores is null
     or array_length(resultados_carreras.ganadores, 1) = 0;

  return new;
end;
$$;

comment on function public.tgf_tablas_fijas_sincronizar_central() is
  'Mantiene resultados_carreras en existencia mientras exista la tabla en '
  'tablas_fijas. No toca resultados de liquidacion. La fecha se valida en la '
  'aplicacion (src/lib/fechas.ts).';

-- ---------------------------------------------------------------------------
-- Comprobacion de columnas, ANTES de instalar el trigger.
--
-- El trigger solo puede referenciar columnas que EXISTAN: si falta alguna, la
-- escritura en `tablas_fijas` empieza a fallar en tiempo de ejecucion y eso
-- parte la venta. Se verifica PRIMERO y se aborta con el nombre exacto de lo que
-- falta, en vez de dejar un trigger que revienta al primer INSERT.
-- ---------------------------------------------------------------------------
do $$
declare
  v_faltan text;
begin
  select string_agg(c, ', ')
    into v_faltan
    from unnest(array[
           'fecha', 'hipodromo', 'carrera', 'caballos', 'distancia',
           'superficie', 'premio', 'ganadores', 'retirados',
           'aplicado_a_tablas', 'updated_at'
         ]) as c
   where not exists (
           select 1 from information_schema.columns
            where table_schema = 'public'
              and table_name = 'resultados_carreras'
              and column_name = c
         );

  if v_faltan is not null then
    raise exception
      'resultados_carreras no tiene estas columnas: %. No se instalo el trigger: '
      'creelas antes (ver sql/migrar_fk_hipodromos.sql).', v_faltan;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Misma guarda para las columnas de `tablas_fijas` que el trigger VIGILA en su
-- `update of`. El CREATE TRIGGER valida esa lista AL INSTANTE (el cuerpo de la
-- funcion, en cambio, solo se valida al ejecutarse): si falta una columna, el
-- trigger no se instala y el error recien se ve al publicar. Se comprueba aqui
-- para fallar con el nombre exacto antes de tocar el trigger.
-- ---------------------------------------------------------------------------
do $$
declare
  v_faltan text;
begin
  select string_agg(c, ', ')
    into v_faltan
    from unnest(array[
           'fecha', 'hipodromo', 'carrera', 'caballos', 'distancia_carrera',
           'superficie', 'premio_original', 'retirados_oficiales', 'estado'
         ]) as c
   where not exists (
           select 1 from information_schema.columns
            where table_schema = 'public'
              and table_name = 'tablas_fijas'
              and column_name = c
         );

  if v_faltan is not null then
    raise exception
      'tablas_fijas no tiene estas columnas: %. No se instalo el trigger: el '
      'CREATE TRIGGER exige que existan todas las columnas de su UPDATE OF.',
      v_faltan;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- El trigger
-- ---------------------------------------------------------------------------
drop trigger if exists trg_tablas_fijas_central on public.tablas_fijas;

create trigger trg_tablas_fijas_central
after insert or update of fecha, hipodromo, carrera, caballos, distancia_carrera,
     superficie, premio_original, retirados_oficiales, estado
on public.tablas_fijas
for each row
execute function public.tgf_tablas_fijas_sincronizar_central();

-- ---------------------------------------------------------------------------
-- Verificacion posterior: el trigger quedo instalado y sobre la columna que
-- importa. Si `fecha` no esta en la lista de columnas del trigger, un cambio
-- de fecha reordenaria la tabla sin sincronizar el central, que es justamente
-- como se partedio la jornada.
-- ---------------------------------------------------------------------------
do $$
declare
  v_cols text;
begin
  select string_agg(a.attname, ', ' order by a.attname)
    into v_cols
    from pg_trigger t
    join pg_attribute a on a.attrelid = t.tgrelid and a.attnum = any (t.tgattr)
   where t.tgname = 'trg_tablas_fijas_central'
     and not a.attisdropped;

  if v_cols is null then
    raise warning 'El trigger trg_tablas_fijas_central no quedo instalado.';
  elsif v_cols not like '%fecha%' then
    raise exception
      'El trigger no escucha cambios de `fecha` (vigila: %). Sin eso, mover una '
      'tabla de dia no actualiza el central.', v_cols;
  else
    raise notice 'OK: trigger instalado, vigila %', v_cols;
  end if;
end $$;
