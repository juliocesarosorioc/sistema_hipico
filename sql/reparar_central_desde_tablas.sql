-- ===========================================================================
-- REPARA LA JORNADA PARTIDA DEL 04-10-2026
--
-- QUE PASA, CON DATOS
-- Las 13 carreras de LA RINCONADA del 04-10-2026 quedaron asi:
--
--   C1..C9  y  C13   tablas_fijas.fecha = 2026-10-04   (correcto)
--   C10, C11, C12    tablas_fijas.fecha = 2026-04-10   (INVERTIDA)
--
-- Y de las 13, solo C13 existe en `resultados_carreras` (el central).
--
-- Eso produce DOS sintomas distintos, y por eso no basta con una sola cosa:
--
--   a) C10-C12 NO salen en Tablas Fijas ni en Gestion de Jugadas porque esas
--      pantallas filtran por fecha y la fila esta en `2026-04-10`. Aqui el
--      problema esta en la PROPIA tabla: no hay central que lo arregle.
--
--   b) C1..C12 NO salen en Marcas, Gestion ni Dupletas porque esas leen el
--      central, y no tienen fila. Publicar una tabla no creaba la carrera en el
--      central (solo lo hacia el Modo Manual y solo para carreras vacias); eso
--      ya se corrigio en el codigo (`publicarTabla`/`publicarTablasLote` ahora
--      llaman a `sincronizarCentralDesdeTabla`), pero estas filas son previas y
--      hay que crearlas.
--
-- LA FECHA INVERTIDA
-- `normalizarFechaIso` lee DD-MM-YYYY, que es lo correcto para la operacion. El
-- problema es que la Gaceta entrego "10-04-2026" (mes-dia, como se escribe en
-- Estados Unidos) y eso se guardo como 10 de abril. No se cambia la convencion:
-- se arreglan las filas.
--
-- COMO SE SABE CUALES ESTAN INVERTIDAS, SIN ADIVINAR
-- Se invierte dia y mes y se comprueba que el resultado CAIGA en una fecha donde
-- ESE MISMO hipodromo ya tiene carreras. Si `2026-04-10` invertido da
-- `2026-10-04`, y LA RINCONADA tiene 10 carreras mas ahi, es que esa fila esta
-- invertida. Si una carrera fue la unica de su dia, el intercambio no lleva a
-- ninguna parte y NO se toca: no hay con que confirmarlo.
--
-- ES IDEMPOTENTE. Trae informe antes de escribir. Verifica al final.
-- ===========================================================================

-- Sin meta-comandos de psql (ON_ERROR_STOP, echo): el SQL Editor de Supabase
-- los rechaza con "syntax error" y no ejecutaria nada. El Editor ya corta en el
-- primer error, y `begin`/`commit` deja el script atomico igual.
begin;

-- ---------------------------------------------------------------------------
-- 1) INFORME (esta seccion no escribe nada)
-- ---------------------------------------------------------------------------
-- == 1. Fecha invertida en tablas_fijas ==
--    (dia y mes intercambiados; el intercambio cae en una fecha donde ese
--     hipodromo YA tiene carreras)
select to_char(t.fecha, 'YYYY-MM-DD')                  as fecha_guardada,
       upper(btrim(t.hipodromo))                      as hipodromo,
       t.carrera,
       to_char(
         make_date(extract(year from t.fecha)::int,
                   extract(day   from t.fecha)::int,
                   extract(month from t.fecha)::int),
         'YYYY-MM-DD')                                 as fecha_si_se_invierte,
       (select count(*)
          from public.tablas_fijas o
         where upper(btrim(o.hipodromo)) = upper(btrim(t.hipodromo))
           and o.fecha = make_date(extract(year from t.fecha)::int,
                                   extract(day   from t.fecha)::int,
                                   extract(month from t.fecha)::int)) as carreras_en_la_fecha_correcta
  from public.tablas_fijas t
 where extract(day from t.fecha) between 1 and 12
   and make_date(extract(year from t.fecha)::int,
                 extract(day   from t.fecha)::int,
                 extract(month from t.fecha)::int) <> t.fecha
   and exists (
         select 1 from public.tablas_fijas o
          where upper(btrim(o.hipodromo)) = upper(btrim(t.hipodromo))
            and o.fecha = make_date(extract(year from t.fecha)::int,
                                    extract(day   from t.fecha)::int,
                                    extract(month from t.fecha)::int)
       )
 order by 2, 3;

-- == 2. Publicadas con ejemplares y SIN fila en el central ==
select to_char(t.fecha, 'YYYY-MM-DD') as fecha,
       upper(btrim(t.hipodromo))     as hipodromo,
       t.carrera,
       jsonb_array_length(coalesce(t.caballos, '[]'::jsonb)) as ejemplares
  from public.tablas_fijas t
  left join public.resultados_carreras r
         on r.fecha     = t.fecha
        and r.hipodromo = upper(btrim(t.hipodromo))
        and r.carrera   = t.carrera
 where r.id is null
   and jsonb_array_length(coalesce(t.caballos, '[]'::jsonb)) > 0
 order by 1, 2, 3;

-- == 3. La misma carrera con filas centrales en DOS fechas ==
select upper(btrim(r.hipodromo)) as hipodromo,
       r.carrera,
       count(*) as fechas,
       string_agg(to_char(r.fecha, 'YYYY-MM-DD'), ', ' order by r.fecha) as cuales
  from public.resultados_carreras r
 group by upper(btrim(r.hipodromo)), r.carrera
having count(*) > 1
 order by 1, 2;

-- ---------------------------------------------------------------------------
-- 2) CORRIGE LA FECHA EN resultados_carreras
--
-- Va PRIMERO porque central no tiene colision que resolver aqui (la fila
-- invertida y su destino son fechas distintas y no hay otra fila en el destino).
-- Solo se mueven filas SIN resultado: una carrera ya liquidada en la fecha
-- invertida tiene informacion real (ganadores, dividendos) y no se toca a
-- proposito; esas salen en el informe 3 y se resuelven a mano.
-- ---------------------------------------------------------------------------
update public.resultados_carreras r
   set fecha      = make_date(extract(year from r.fecha)::int,
                              extract(day   from r.fecha)::int,
                              extract(month from r.fecha)::int),
       updated_at = now()
 where extract(day from r.fecha) between 1 and 12
   and coalesce(array_length(r.ganadores, 1), 0) = 0
   and not r.aplicado_a_tablas
   and exists (
         select 1 from public.tablas_fijas t
          where upper(btrim(t.hipodromo)) = upper(btrim(r.hipodromo))
            and t.carrera   = r.carrera
            and t.fecha     = make_date(extract(year from r.fecha)::int,
                                        extract(day   from r.fecha)::int,
                                        extract(month from r.fecha)::int)
       )
   and not exists (
         select 1 from public.tablas_fijas t
          where upper(btrim(t.hipodromo)) = upper(btrim(r.hipodromo))
            and t.carrera   = r.carrera
            and t.fecha     = r.fecha
       );

-- ---------------------------------------------------------------------------
-- 3) CORRIGE LA FECHA EN tablas_fijas
--
-- Ahora sí, con el central ya desacomodado, para que el backfill de la seccion
-- 4 herede la fecha buena.
--
-- Si el destino ya estuviera ocupado por otra tabla de la misma carrera (no
-- debería: serían dos filas distintas de la MISMA carrera y misma fecha), el
-- UPDATE rebotaría por el unique. Por eso se exige que no exista.
-- ---------------------------------------------------------------------------
update public.tablas_fijas t
   set fecha = make_date(extract(year from t.fecha)::int,
                         extract(day   from t.fecha)::int,
                         extract(month from t.fecha)::int)
 where extract(day from t.fecha) between 1 and 12
   and exists (
         select 1 from public.tablas_fijas o
          where upper(btrim(o.hipodromo)) = upper(btrim(t.hipodromo))
            and o.fecha = make_date(extract(year from t.fecha)::int,
                                    extract(day   from t.fecha)::int,
                                    extract(month from t.fecha)::int)
       )
   and not exists (
         select 1 from public.tablas_fijas o
          where upper(btrim(o.hipodromo)) = upper(btrim(t.hipodromo))
            and o.carrera = t.carrera
            and o.fecha   = make_date(extract(year from t.fecha)::int,
                                      extract(day   from t.fecha)::int,
                                      extract(month from t.fecha)::int)
            and o.id      <> t.id
       );

-- ---------------------------------------------------------------------------
-- 4) CREA LA FILA CENTRAL QUE FALTA
--
-- La tabla manda en la OFERTA de la carrera: caballos, distancia, superficie y
-- premio. NO se tocan `ganadores`, `premio_recalculado`, `detalle`, `dividendos`,
-- `orden_llegada` ni `aplicado_a_tablas`: esos son el resultado de la
-- liquidacion, y una fila nueva nunca los tiene.
-- El ON CONFLICT solo pisa campos de oferta, y nunca con un array vacio, para no
-- borrar ejemplares que ya esten cargados.
-- ---------------------------------------------------------------------------
insert into public.resultados_carreras
       (fecha, hipodromo, carrera, caballos, distancia, superficie, premio,
        ganadores, retirados, aplicado_a_tablas, updated_at)
select t.fecha,
       upper(btrim(t.hipodromo)),
       t.carrera,
       coalesce(t.caballos, '[]'::jsonb),
       t.distancia_carrera::text,
       t.superficie,
       t.premio_original,
       '{}'::text[],
       -- 'NO HUBO RETIROS' es la convencion del app: un '' se parsea como "no
       -- hay lista" y la Taquilla lo muestra vacio.
       coalesce(nullif(btrim(t.retirados_oficiales), ''), 'NO HUBO RETIROS'),
       false,
       now()
  from public.tablas_fijas t
 where jsonb_array_length(coalesce(t.caballos, '[]'::jsonb)) > 0
   and not exists (
         select 1 from public.resultados_carreras r
          where r.fecha     = t.fecha
            and r.hipodromo = upper(btrim(t.hipodromo))
            and r.carrera   = t.carrera
       )
on conflict (fecha, hipodromo, carrera) do update
    set caballos    = coalesce(nullif(excluded.caballos, '[]'::jsonb), resultados_carreras.caballos),
        distancia   = coalesce(excluded.distancia,  resultados_carreras.distancia),
        superficie  = coalesce(excluded.superficie, resultados_carreras.superficie),
        premio      = coalesce(excluded.premio,     resultados_carreras.premio),
        updated_at  = now();

-- ---------------------------------------------------------------------------
-- 5) VERIFICACION
-- ---------------------------------------------------------------------------
-- == 5. Verificacion ==
--    5a. Publicadas con ejemplares y SIN central   -> debe ser 0
select count(*) as quedan_sin_central
  from public.tablas_fijas t
  left join public.resultados_carreras r
         on r.fecha     = t.fecha
        and r.hipodromo = upper(btrim(t.hipodromo))
        and r.carrera   = t.carrera
 where r.id is null
   and jsonb_array_length(coalesce(t.caballos, '[]'::jsonb)) > 0;

--    5b. Fecha invertida pendiente               -> debe ser 0
select count(*) as fechas_invertidas
  from public.tablas_fijas t
 where extract(day from t.fecha) between 1 and 12
   and exists (
         select 1 from public.tablas_fijas o
          where upper(btrim(o.hipodromo)) = upper(btrim(t.hipodromo))
            and o.fecha = make_date(extract(year from t.fecha)::int,
                                    extract(day   from t.fecha)::int,
                                    extract(month from t.fecha)::int)
       );

--    5c. La carrera en dos fechas del central     -> debe ser 0
select count(*) as carreras_partidas
  from (
        select upper(btrim(hipodromo)) as h, carrera
          from public.resultados_carreras
         group by upper(btrim(hipodromo)), carrera
        having count(*) > 1
       ) x;

--    5d. Como quedo el 04-10-2026 (control final, informativo)
select to_char(t.fecha, 'YYYY-MM-DD') as fecha,
       upper(btrim(t.hipodromo))     as hipodromo,
       t.carrera,
       jsonb_array_length(coalesce(t.caballos, '[]'::jsonb)) as ejemplares,
       case when r.id is null then 'SIN CENTRAL' else 'ok' end as central
  from public.tablas_fijas t
  left join public.resultados_carreras r
         on r.fecha     = t.fecha
        and r.hipodromo = upper(btrim(t.hipodromo))
        and r.carrera   = t.carrera
 where upper(btrim(t.hipodromo)) = 'LA RINCONADA'
   and jsonb_array_length(coalesce(t.caballos, '[]'::jsonb)) > 0
 order by t.carrera;

commit;
