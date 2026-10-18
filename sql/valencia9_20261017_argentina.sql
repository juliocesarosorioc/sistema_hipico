-- ============================================================================
-- VALENCIA C9 — jugadas registradas para el 18/10 que deben quedar el 17/10/2026
-- ============================================================================
-- Contexto: en el hipódromo VALENCIA, carrera 9, las ÚNICAS jugadas de esa
-- carrera quedaron con fecha de carrera 18/10/2026 por error. Deben quedar el
-- día 17/10/2026 y en el GRUPO ARGENTINA con comisión del 5%.
--
-- Qué toca (public.tickets_apuestas):
--   · fecha_carrera                 -> 2026-10-17   (el "día de la jugada")
--   · nota_auditoria.fecha_carrera  -> 2026-10-17   (misma fuente que el monitor
--                                     y el Reporte Diario; la columna es TEXT)
--   · fecha_registro                -> se corre 1 día atrás SOLO si su día local
--                                     (America/Caracas) es 18/10, para que la
--                                     ventana de liquidación del 17/10 las
--                                     encuentre (leerTickets filtra por
--                                     fecha_registro).
--   · grupo_cobro_id / grupo_cobro_nombre / grupo_comision_id /
--     grupo_comision_nombre         -> ARGENTINA
--   · comision_porcentaje           -> 5.00
--
-- Respaldo: public.tickets_bkp_valencia9_20261017 (por si hay que revertir).
--
-- IMPORTANTE (después): abrir en la app Gestión -> editar las jugadas de
-- VALENCIA C9 y usar "Recalcular", para que premios y neteo salgan con el 5% y
-- el grupo ARGENTINA.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) Localizar el grupo ARGENTINA (falla si no hay exactamente uno)
-- ---------------------------------------------------------------------------
do $$
declare
  v_id    uuid;
  v_nom   text;
  v_total int;
begin
  select count(*) into v_total
    from public.grupos_venta
   where upper(btrim(nombre)) like '%ARGENTINA%';

  if v_total = 0 then
    raise exception 'No existe ningun grupo con "ARGENTINA" en el nombre (grupos_venta).';
  end if;
  if v_total > 1 then
    raise exception 'Hay % grupos con "ARGENTINA" en el nombre: afinar el criterio antes de correr el script.', v_total;
  end if;

  select id, nombre into v_id, v_nom
    from public.grupos_venta
   where upper(btrim(nombre)) like '%ARGENTINA%';

  create temp table _grupo_arg on commit drop as
  select v_id as id, v_nom as nombre;

  raise notice 'Grupo destino: % (id %)', v_nom, v_id;
end $$;

-- ---------------------------------------------------------------------------
-- 2) Diagnóstico: "qué pasó" con las jugadas de VALENCIA C9 (solo lee y avisa).
--    Si no encuentra ninguna candidata, aborta sin cambiar nada.
-- ---------------------------------------------------------------------------
do $$
declare
  v_total   int;
  v_d18     int;
  v_d17     int;
  v_sinn    int;
  v_reg17   int;
  v_reg18   int;
  v_regotro int;
  v_grupo   text;
  v_com_min numeric;
  v_com_max numeric;
  v_estados text;
begin
  select count(*),
         count(*) filter (where t.fecha_carrera = date '2026-10-18'),
         count(*) filter (where t.fecha_carrera = date '2026-10-17'),
         count(*) filter (where t.fecha_carrera is null),
         count(*) filter (where (t.fecha_registro at time zone 'America/Caracas')::date = date '2026-10-17'),
         count(*) filter (where (t.fecha_registro at time zone 'America/Caracas')::date = date '2026-10-18'),
         count(*) filter (where (t.fecha_registro at time zone 'America/Caracas')::date
                              not in (date '2026-10-17', date '2026-10-18')),
         min(t.comision_porcentaje),
         max(t.comision_porcentaje),
         string_agg(distinct coalesce(t.grupo_cobro_nombre, t.grupo_comision_nombre, '(sin grupo)'), ' | '),
         string_agg(distinct coalesce(t.estado, '(sin estado)'), ' | ')
    into v_total, v_d18, v_d17, v_sinn, v_reg17, v_reg18, v_regotro,
         v_com_min, v_com_max, v_grupo, v_estados
    from public.tickets_apuestas t
   where upper(btrim(t.hipodromo)) like '%VALENCIA%'
     and t.carrera = 9
     and (
           t.fecha_carrera in (date '2026-10-17', date '2026-10-18')
        or (t.fecha_carrera is null
            and (t.fecha_registro at time zone 'America/Caracas')::date in (date '2026-10-17', date '2026-10-18'))
     );

  raise notice '--------------------------------------------------------------';
  raise notice 'VALENCIA C9 - jugadas candidatas: %', coalesce(v_total, 0);
  raise notice '  fecha_carrera: 18/10=%  17/10=%  sin fecha=%', coalesce(v_d18, 0), coalesce(v_d17, 0), coalesce(v_sinn, 0);
  raise notice '  venta (dia local): 17/10=%  18/10=%  otro dia=%', coalesce(v_reg17, 0), coalesce(v_reg18, 0), coalesce(v_regotro, 0);
  raise notice '  grupo actual: %', coalesce(v_grupo, '(ninguno)');
  raise notice '  comision actual: % a %', v_com_min, v_com_max;
  raise notice '  estados: %', coalesce(v_estados, '(ninguno)');
  raise notice '--------------------------------------------------------------';

  if coalesce(v_total, 0) = 0 then
    raise exception 'No encontre jugadas de VALENCIA C9 en el 17-18/10/2026. Nada que hacer (revisar hipodromo/carrera).';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3) Respaldar las filas que se van a cambiar
-- ---------------------------------------------------------------------------
create table if not exists public.tickets_bkp_valencia9_20261017
  (like public.tickets_apuestas including defaults);

insert into public.tickets_bkp_valencia9_20261017
select t.*
  from public.tickets_apuestas t
 where upper(btrim(t.hipodromo)) like '%VALENCIA%'
   and t.carrera = 9
   and (
         t.fecha_carrera in (date '2026-10-17', date '2026-10-18')
      or (t.fecha_carrera is null
          and (t.fecha_registro at time zone 'America/Caracas')::date in (date '2026-10-17', date '2026-10-18'))
   );

-- ---------------------------------------------------------------------------
-- 4) Poner las jugadas el 17/10/2026 en el GRUPO ARGENTINA con comisión 5%.
--    El UPDATE se arma dinámicamente porque la columna `grupo` puede no existir
--    en instalaciones nuevas (la app sólo usa grupo_cobro_* / grupo_comision_*).
-- ---------------------------------------------------------------------------
do $$
declare
  v_col_grupo text := '';
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'tickets_apuestas'
       and column_name  = 'grupo'
  ) then
    v_col_grupo := 'grupo = (select nombre from _grupo_arg),';
  end if;

  execute format($upd$
    update public.tickets_apuestas t
       set fecha_carrera = date '2026-10-17',
           nota_auditoria = case
             when t.nota_auditoria ~ '^\s*[\{\[]'
               then (t.nota_auditoria::jsonb
                     || jsonb_build_object('fecha_carrera', date '2026-10-17'))::text
             else t.nota_auditoria
           end,
           fecha_registro = case
             when (t.fecha_registro at time zone 'America/Caracas')::date = date '2026-10-18'
               then t.fecha_registro - interval '1 day'
             else t.fecha_registro
           end,
           %s
           grupo_cobro_id        = (select id from _grupo_arg),
           grupo_cobro_nombre    = (select nombre from _grupo_arg),
           grupo_comision_id     = (select id from _grupo_arg),
           grupo_comision_nombre = (select nombre from _grupo_arg),
           comision_porcentaje   = 5.00
     where upper(btrim(t.hipodromo)) like '%%VALENCIA%%'
       and t.carrera = 9
       and (
             t.fecha_carrera in (date '2026-10-17', date '2026-10-18')
          or (t.fecha_carrera is null
              and (t.fecha_registro at time zone 'America/Caracas')::date in (date '2026-10-17', date '2026-10-18'))
       )
  $upd$, v_col_grupo);
end $$;

commit;

-- ---------------------------------------------------------------------------
-- 5) Verificación final: cómo quedaron
-- ---------------------------------------------------------------------------
select t.hipodromo,
       t.carrera,
       t.fecha_carrera,
       (t.fecha_registro at time zone 'America/Caracas')::date as dia_venta,
       t.grupo_cobro_nombre,
       t.comision_porcentaje,
       t.estado,
       count(*)            as jugadas,
       sum(t.monto_jugado) as monto_total
  from public.tickets_apuestas t
 where upper(btrim(t.hipodromo)) like '%VALENCIA%'
   and t.carrera = 9
 group by t.hipodromo, t.carrera, t.fecha_carrera, 4,
          t.grupo_cobro_nombre, t.comision_porcentaje, t.estado
 order by t.fecha_carrera, t.estado;

-- Detalle fila a fila (útil para comparar contra el respaldo):
--   select t.id, t.fecha_carrera,
--          (t.fecha_registro at time zone 'America/Caracas') as venta_local,
--          t.nota_auditoria, t.grupo_cobro_nombre, t.comision_porcentaje, t.estado
--     from public.tickets_apuestas t
--    where upper(btrim(t.hipodromo)) like '%VALENCIA%' and t.carrera = 9
--    order by t.fecha_carrera, t.id;
--
-- Para revertir (si hiciera falta):
--   update public.tickets_apuestas t
--      set fecha_carrera          = b.fecha_carrera,
--          nota_auditoria         = b.nota_auditoria,
--          fecha_registro         = b.fecha_registro,
--          grupo_cobro_id         = b.grupo_cobro_id,
--          grupo_cobro_nombre     = b.grupo_cobro_nombre,
--          grupo_comision_id      = b.grupo_comision_id,
--          grupo_comision_nombre  = b.grupo_comision_nombre,
--          comision_porcentaje    = b.comision_porcentaje
--     from public.tickets_bkp_valencia9_20261017 b
--    where b.id = t.id;
-- ============================================================================
