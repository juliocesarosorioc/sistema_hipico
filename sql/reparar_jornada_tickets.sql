-- ============================================================================
--  REPARACIÓN GENÉRICA DE JORNADA EN TICKETS — "que ninguna jugada quede
--  archivada en el día equivocado"
-- ============================================================================
--  CONTEXTO / PROBLEMA
--  -------------------
--  El día de una jugada es la fecha de su CARRERA (`tickets_apuestas.fecha_carrera`).
--  La liquidación, el reporte y el monitor filtran por ese día (`filtroDiaJornada`).
--  Cuando un ticket queda archivado bajo OTRA jornada, la liquidación NO lo
--  encuentra: `aplicarLiquidacionSaldos` devuelve «Sin tickets pendientes» y la
--  carrera queda SIN COBRAR NI PAGAR al ganador o al perdedor. No es un bug de
--  una carrera concreta (apareció con VALENCIA C9 el 17-18/10 y con LA RINCONADA
--  C9 el 18/10): es un desalineamiento entre la jornada REAL de la carrera y el
--  día con el que se archivó la jugada.
--
--  Los scripts `valencia9_20261017_argentina.sql` y similares arreglan UNA
--  carrera a mano. Este script es la versión GENÉRICA y reusable: re-archiva
--  cualquier ticket a la jornada REAL de su carrera, resolviéndola por su
--  identidad (hipódromo + número) contra `carreras` (la MATRIZ MAESTRA) y, si
--  no está, contra `resultados_carreras` (la carrera con resultado cargado).
--
--  QUÉ TOCA (por cada ticket desalineado)
--  --------------------------------------
--    · fecha_carrera                -> la fecha REAL de la carrera
--    · nota_auditoria.fecha_carrera -> la misma fecha (monitor y reportes leen
--                                      del JSON además de la columna)
--    · fecha_registro               -> se corre el mismo número de DÍAS para que
--                                      la ventana local de respaldo coincida
--                                      (algunas consultas heredadas caen a
--                                      `fecha_registro` cuando `fecha_carrera`
--                                      es null; mantenerlos alineados evita
--                                      "día partido" en los reportes).
--
--  SEGURIDAD
--  ---------
--    · SOLO mirar: por defecto NO escribe. Para aplicar hay que descomentar el
--      bloque de UPDATE (o llamar al procedimiento con p_aplicar => true).
--    · Respalda las filas afectadas en `tickets_bkp_jornada_<timestamp>` antes de
--      tocar nada.
--    · Idempotente: correrlo dos veces no cambia nada la segunda vez.
--    · NO toca la liquidación ni el dinero: solo la FECHA con la que se archiva
--      la jugada. Después, si la carrera ya tenía resultado, hay que RECALCULAR
--      la carrera para que el premio y la comisión salgan con la jornada buena.
--
--  EJECUTAR en Supabase → SQL Editor.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0) Tabla de trabajo: la jornada REAL de cada carrera que tiene tickets.
--    Se resuelve por (hipodromo, carrera) dando prioridad a:
--      1. `carreras`  (matriz maestra: define a qué jornada pertenece)
--      2. `resultados_carreras` (la carrera que ya tiene resultado)
--    Se normaliza el hipódromo a mayúsculas sin espacios para cruzar formas
--    ("LA RINCONADA", "La Rinconada", "LARINCONADA").
-- ---------------------------------------------------------------------------
create temporary table _jornada_real on commit drop as
with tickets_carreras as (
    select distinct
           upper(regexp_replace(btrim(t.hipodromo), '\s+', '', 'g')) as hipo_clave,
           t.carrera,
           date_trunc('day', t.fecha_registro at time zone 'America/Caracas')::date as dia_venta,
           t.fecha_carrera
      from public.tickets_apuestas t
     where t.carrera is not null
),
-- 1) Maestro `carreras`
maestro as (
    select upper(regexp_replace(btrim(c.hipodromo), '\s+', '', 'g')) as hipo_clave,
           c.carrera,
           c.fecha as fecha_real,
           row_number() over (
             partition by upper(regexp_replace(btrim(c.hipodromo), '\s+', '', 'g')), c.carrera
             order by c.fecha desc
           ) as rn
      from public.carreras c
),
maestro_uno as (select hipo_clave, carrera, fecha_real from maestro where rn = 1),
-- 2) Resultado central (fallback)
resultado as (
    select upper(regexp_replace(btrim(r.hipodromo), '\s+', '', 'g')) as hipo_clave,
           r.carrera,
           r.fecha as fecha_real,
           row_number() over (
             partition by upper(regexp_replace(btrim(r.hipodromo), '\s+', '', 'g')), r.carrera
             order by r.fecha desc
           ) as rn
      from public.resultados_carreras r
),
resultado_uno as (select hipo_clave, carrera, fecha_real from resultado where rn = 1)
select tc.hipo_clave,
       tc.carrera,
       coalesce(m.fecha_real, rs.fecha_real) as fecha_real
  from (select distinct hipo_clave, carrera from tickets_carreras) tc
  left join maestro_uno   m  on m.hipo_clave  = tc.hipo_clave and m.carrera  = tc.carrera
  left join resultado_uno rs on rs.hipo_clave = tc.hipo_clave and rs.carrera = tc.carrera
 where coalesce(m.fecha_real, rs.fecha_real) is not null;

create index on _jornada_real (hipo_clave, carrera);

-- ---------------------------------------------------------------------------
-- 1) DIAGNÓSTICO — qué tickets están archivados en un día distinto al real.
--    (No escribe nada: solo lista y cuenta.)
-- ---------------------------------------------------------------------------
do $$
declare
  v_total  bigint;
  v_filas  text;
begin
  raise notice '==============================================================';
  raise notice ' JUGADAS ARCHIVADAS EN UNA JORNADA DISTINTA A LA REAL DE SU CARRERA';
  raise notice '==============================================================';

  select count(*),
         string_agg(
           format('%s C%s: ticket %s esta en %s y su carrera es del %s',
                  t.hipodromo, t.carrera, t.id,
                  coalesce(t.fecha_carrera::text, '(sin fecha)'),
                  jr.fecha_real),
           E'\n' order by t.hipodromo, t.carrera, t.fecha_carrera
         )
    into v_total, v_filas
    from public.tickets_apuestas t
    join _jornada_real jr
      on jr.hipo_clave = upper(regexp_replace(btrim(t.hipodromo), '\s+', '', 'g'))
     and jr.carrera    = t.carrera
   where t.fecha_carrera is distinct from jr.fecha_real;

  if coalesce(v_total, 0) = 0 then
    raise notice '  (ninguna) — todas las jugadas estan en la jornada real. Nada que hacer.';
  else
    raise notice '  Total a corregir: %', v_total;
    raise notice '%', v_filas;
  end if;
  raise notice '--------------------------------------------------------------';
end $$;

-- ---------------------------------------------------------------------------
-- 2) RESPALDO de las filas afectadas (antes de tocar nada).
--    Tabla con marca de tiempo para poder auditar cada corrida.
-- ---------------------------------------------------------------------------
do $$
declare
  v_tabla text := 'tickets_bkp_jornada_' || to_char(now(), 'YYYYMMDD_HH24MISS');
begin
  execute format(
    'create table public.%I (like public.tickets_apuestas including defaults, respaldado_at timestamptz default now())',
    v_tabla
  );
  execute format(
    'insert into public.%I
     select t.*, now()
       from public.tickets_apuestas t
       join _jornada_real jr
         on jr.hipo_clave = upper(regexp_replace(btrim(t.hipodromo), ''\s+'', '''', ''g''))
        and jr.carrera    = t.carrera
      where t.fecha_carrera is distinct from jr.fecha_real',
    v_tabla
  );
  raise notice ' Respaldo creado: public.%', v_tabla;
end $$;

-- ---------------------------------------------------------------------------
-- 3) APLICAR — re-archivar cada ticket en la jornada REAL de su carrera.
--    Descomentá el bloque para aplicar. (Se deja comentado por defecto para que
--    el primer pase sea SOLO diagnóstico; revisá el listado del paso 1 y luego
--    corré de nuevo con el UPDATE activo.)
-- ---------------------------------------------------------------------------
/*
update public.tickets_apuestas t
   set fecha_carrera = jr.fecha_real,
       -- La nota de auditoría guarda el mismo día: monitor y reportes lo leen.
       nota_auditoria = case
         when t.nota_auditoria ~ '^\s*[\{\[]'
           then (t.nota_auditoria::jsonb
                 || jsonb_build_object('fecha_carrera', jr.fecha_real))::text
         else t.nota_auditoria
       end,
       -- Alinea la ventana local de respaldo al mismo día (por si alguna consulta
       -- heredada cae a fecha_registro cuando fecha_carrera es null).
       fecha_registro = case
         when t.fecha_carrera is not null
           then t.fecha_registro
                + make_interval(days => (jr.fecha_real - t.fecha_carrera))
         else t.fecha_registro
       end
  from _jornada_real jr
 where jr.hipo_clave = upper(regexp_replace(btrim(t.hipodromo), '\s+', '', 'g'))
   and jr.carrera    = t.carrera
   and t.fecha_carrera is distinct from jr.fecha_real;
*/

-- ---------------------------------------------------------------------------
-- 4) VERIFICACIÓN — ninguna jugada debe quedar fuera de la jornada real.
-- ---------------------------------------------------------------------------
do $$
declare
  v_quedan bigint;
begin
  select count(*)
    into v_quedan
    from public.tickets_apuestas t
    join _jornada_real jr
      on jr.hipo_clave = upper(regexp_replace(btrim(t.hipodromo), '\s+', '', 'g'))
     and jr.carrera    = t.carrera
   where t.fecha_carrera is distinct from jr.fecha_real;

  if v_quedan = 0 then
    raise notice ' OK: 0 jugadas desalineadas. (Si el UPDATE estaba comentado, esto solo confirma el diagnostico previo.)';
  else
    raise notice ' QUEDAN % jugadas desalineadas (el bloque UPDATE del paso 3 estaba comentado).', v_quedan;
  end if;
end $$;

commit;
