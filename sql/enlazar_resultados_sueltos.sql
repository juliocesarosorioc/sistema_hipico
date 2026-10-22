-- ============================================================================
-- ENLAZAR RESULTADOS SUELTOS — arregla el progreso de la jornada
-- ============================================================================
--
-- SÍNTOMA QUE ARREGLA
-- -------------------
-- En el «Progreso de la jornada» del Monitor de Jugadas la barra se queda en
-- 0% para siempre: sale "Programadas: N, Con resultado: 0" aunque la jornada ya
-- tenga carreras con pizarra cargada y liquidadas (las tarjetas de arriba sí
-- cuentan, porque leen otra fuente).
--
-- CAUSA
-- -----
-- El catálogo de carreras se lee de la matriz `carreras` con el resultado
-- EMBEBIDO (`resultados_carreras(*)`). PostgREST resuelve ese embed por la FK
-- `resultados_carreras.carrera_id -> carreras.id`. La migración
-- (sql/carreras.sql §3) llena esa columna con una igualdad EXACTA:
--
--     c.hipodromo = upper(trim(r.hipodromo))
--
-- Si la matriz guardó "La Rinconada" y el libro de resultados "LA RINCONADA"
-- (o al revés), la fila NO se enlaza, queda `carrera_id IS NULL` y el embed no
-- devuelve NADA — sin error—. El catálogo entero queda sin `ganadores` y todo
-- contador derivado de ahí se cae a cero.
--
-- QUÉ HACE ESTE SCRIPT
-- --------------------
-- Reintenta el enlace por la CLAVE CANÓNICA que usa toda la app: hipódromo en
-- mayúsculas sin espacios (`regexp_replace(upper(trim(hipodromo)), '\s+', '',
-- 'g')`) + número de carrera + fecha. Es exactamente la clave de
-- `src/features/carreras/lib/claves.ts` (`claveCarrera`), así que una fila que
-- la app cruza bien también queda enlazada acá.
--
-- NO cambia el dato de las carreras ni de los resultados: solo rellena la FK
-- `carrera_id`, que es lo que el embed necesita. Idempotente (solo toca las
-- filas con `carrera_id IS NULL`) y trae la REVERSA al pie.
-- ============================================================================

-- 1) Respaldo: qué filas se van a tocar (por si hay que revertir a mano).
drop table if exists public._respaldo_resultados_sueltos;
create table public._respaldo_resultados_sueltos as
select r.id, r.carrera_id, now() as respaldado_at
  from public.resultados_carreras r
 where r.carrera_id is null;

-- 2) Enlace por clave canónica (mayúsculas sin espacios) + fecha + carrera.
--    Se elige la carrera de la MATRIZ que coincida; si hubiera dos, `distinct on`
--    deja una sola y no multiplica la fila de resultados.
with candidatos as (
  select distinct on (r.id)
         r.id            as resultado_id,
         c.id            as carrera_id
    from public.resultados_carreras r
    join public.carreras c
      on c.fecha = r.fecha
     and regexp_replace(upper(trim(c.hipodromo)), '\s+', '', 'g')
       = regexp_replace(upper(trim(r.hipodromo)), '\s+', '', 'g')
     and c.carrera = r.carrera
   where r.carrera_id is null
   order by r.id, c.id
)
update public.resultados_carreras r
   set carrera_id = k.carrera_id
  from candidatos k
 where r.id = k.resultado_id
   and r.carrera_id is null;

-- 3) También cubre el caso inverso: carrera de la matriz que tiene resultado
--    pero cuya fila de resultados quedó enlazada a otra carrera (duplicado de
--    jornada). Se desenlaza la FK equivocada para que el embed vuelva a ser
--    1:1 y no traiga la pizarra de otra carrera.
update public.resultados_carreras r
   set carrera_id = null
  from public.carreras c
 where r.carrera_id = c.id
   and (c.fecha <> r.fecha
        or c.carrera <> r.carrera
        or regexp_replace(upper(trim(c.hipodromo)), '\s+', '', 'g')
           <> regexp_replace(upper(trim(r.hipodromo)), '\s+', '', 'g'));

-- 4) Verificación: no debe quedar ningún resultado suelto de una carrera que
--    SÍ está en la matriz (esos son los que rompen el progreso).
select count(*) as resultados_sueltos_que_rompen_el_progreso
  from public.resultados_carreras r
  join public.carreras c
    on c.fecha = r.fecha
   and regexp_replace(upper(trim(c.hipodromo)), '\s+', '', 'g')
     = regexp_replace(upper(trim(r.hipodromo)), '\s+', '', 'g')
   and c.carrera = r.carrera
 where r.carrera_id is null;

-- ---------------------------------------------------------------------------
-- REVERSA (solo si hiciera falta deshacer el enlace)
-- ---------------------------------------------------------------------------
-- update public.resultados_carreras r
--    set carrera_id = b.carrera_id
--   from public._respaldo_resultados_sueltos b
--  where r.id = b.id;
--
-- Luego:  drop table if exists public._respaldo_resultados_sueltos;
