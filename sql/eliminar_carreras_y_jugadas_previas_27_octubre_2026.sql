-- ============================================================================
-- eliminar_carreras_y_jugadas_previas_27_octubre_2026.sql
-- 
-- Elimina todas las carreras y jugadas registradas PREVIO al 27-10-2026.
-- ============================================================================

begin;

create or replace function pg_temp.obtener_expr_fecha(p_tabla text) returns text as $$
declare
  v_found_cols text[];
begin
  if to_regclass('public.' || quote_ident(p_tabla)) is null then
    return null;
  end if;

  select array_agg(quote_ident(column_name) || '::text' order by ordinal_position)
    into v_found_cols
    from information_schema.columns
   where table_schema = 'public'
     and table_name = p_tabla
     and column_name in (
       'fecha_carrera',
       'fecha_contable',
       'fecha_jugada',
       'fecha_registro',
       'fecha_hora_registro',
       'fecha',
       'fin',
       'inicio',
       'created_at',
       'creado_at'
     );

  if v_found_cols is null or array_length(v_found_cols, 1) = 0 then
    return null;
  end if;

  return 'coalesce(' || array_to_string(v_found_cols, ', ') || ')';
end;
$$ language plpgsql;

create or replace function pg_temp.eliminar_filas_previas(p_tabla text, p_fecha text) returns void as $$
declare
  v_expr text;
begin
  if to_regclass('public.' || quote_ident(p_tabla)) is null then
    return;
  end if;

  v_expr := pg_temp.obtener_expr_fecha(p_tabla);
  if v_expr is null then
    return;
  end if;

  execute format('delete from public.%I where left(trim(%s), 10) < %L', p_tabla, v_expr, p_fecha);
end;
$$ language plpgsql;

-- 1. Tablas hijas con FKs
do $$
declare
  v_expr text;
begin
  if to_regclass('public.remate_caballos') is not null and to_regclass('public.remates') is not null then
    v_expr := pg_temp.obtener_expr_fecha('remates');
    if v_expr is not null then
      execute format('delete from public.remate_caballos where remate_id in (select id from public.remates where left(trim(%s), 10) < %L)', v_expr, '2026-10-27');
    end if;
  end if;

  if to_regclass('public.polla_combinaciones') is not null and to_regclass('public.pollas') is not null then
    v_expr := pg_temp.obtener_expr_fecha('pollas');
    if v_expr is not null then
      execute format('delete from public.polla_combinaciones where polla_id in (select id from public.pollas where left(trim(%s), 10) < %L)', v_expr, '2026-10-27');
    end if;
  end if;

  if to_regclass('public.tabla_fija_caballos') is not null and to_regclass('public.tablas_fijas') is not null then
    v_expr := pg_temp.obtener_expr_fecha('tablas_fijas');
    if v_expr is not null then
      execute format('delete from public.tabla_fija_caballos where tabla_id in (select id from public.tablas_fijas where left(trim(%s), 10) < %L)', v_expr, '2026-10-27');
    end if;
  end if;

  if to_regclass('public.tabla_grupos') is not null and to_regclass('public.tablas_fijas') is not null then
    v_expr := pg_temp.obtener_expr_fecha('tablas_fijas');
    if v_expr is not null then
      execute format('delete from public.tabla_grupos where tabla_id in (select id from public.tablas_fijas where left(trim(%s), 10) < %L)', v_expr, '2026-10-27');
    end if;
  end if;

  -- Solicitudes de tablas (FK solicitudes_tablas_tabla_id_fkey hacia tablas_fijas)
  if to_regclass('public.solicitudes_tablas') is not null and to_regclass('public.tablas_fijas') is not null then
    v_expr := pg_temp.obtener_expr_fecha('tablas_fijas');
    if v_expr is not null then
      execute format('delete from public.solicitudes_tablas where tabla_id in (select id from public.tablas_fijas where left(trim(%s), 10) < %L)', v_expr, '2026-10-27');
    end if;
    v_expr := pg_temp.obtener_expr_fecha('solicitudes_tablas');
    if v_expr is not null then
      execute format('delete from public.solicitudes_tablas where left(trim(%s), 10) < %L', v_expr, '2026-10-27');
    end if;
  end if;

  if to_regclass('public.carrera_ejemplares') is not null and to_regclass('public.carreras') is not null then
    execute 'delete from public.carrera_ejemplares where carrera_id in (select id from public.carreras where fecha < ''2026-10-27''::date)';
  end if;
end $$;

-- 2. Jugadas y apuestas previas
select pg_temp.eliminar_filas_previas('tickets_apuestas', '2026-10-27');
select pg_temp.eliminar_filas_previas('tickets_jugadas', '2026-10-27');
select pg_temp.eliminar_filas_previas('wps_tickets', '2026-10-27');
select pg_temp.eliminar_filas_previas('dupletas', '2026-10-27');
select pg_temp.eliminar_filas_previas('remate_pujas', '2026-10-27');
select pg_temp.eliminar_filas_previas('remates', '2026-10-27');
select pg_temp.eliminar_filas_previas('polla_ventas', '2026-10-27');
select pg_temp.eliminar_filas_previas('pollas', '2026-10-27');
select pg_temp.eliminar_filas_previas('tablas_fijas', '2026-10-27');
select pg_temp.eliminar_filas_previas('marcas_carrera', '2026-10-27');
select pg_temp.eliminar_filas_previas('cuaderno_jugadas', '2026-10-27');
select pg_temp.eliminar_filas_previas('jugadas_auditoria', '2026-10-27');

-- 3. Carreras, resultados y gacetas
select pg_temp.eliminar_filas_previas('resultados_carreras', '2026-10-27');
select pg_temp.eliminar_filas_previas('carreras', '2026-10-27');
select pg_temp.eliminar_filas_previas('programa_dia', '2026-10-27');
select pg_temp.eliminar_filas_previas('gaceta_procesada', '2026-10-27');
select pg_temp.eliminar_filas_previas('cierres_jornada', '2026-10-27');

commit;
