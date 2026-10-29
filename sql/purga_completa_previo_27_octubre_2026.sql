-- ============================================================================
-- purga_completa_previo_27_octubre_2026.sql
-- 
-- Elimina TODA la información registrada previo al 27-10-2026:
--   - Carreras, ejemplares y resultados oficiales (< 2026-10-27)
--   - Todas las jugadas y apuestas de todas las modalidades (< 2026-10-27)
--   - Tablas fijas, remates, dupletas, pollas, marcas, WPS (< 2026-10-27)
--   - Movimientos financieros, caja, asientos y auditorías (< 2026-10-27)
--   - Cierres de jornada, transcripciones y gacetas (< 2026-10-27)
-- 
-- CONSERVA INTACTOS:
--   ✅ Clientes (todos los datos, reseteando saldo a 0)
--   ✅ AVALES de los clientes (clientes.aval se mantiene 100%)
--   ✅ Clientes LIBRES (clientes.libre y modo_juego se mantienen 100%)
--   ✅ Grupos autorizados: ARGENTINA, MADRID y ESPARTANOS
--   ✅ Catálogos maestros: Hipódromos, Tipos de Jugadas, Monedas y Tasas
-- 
-- 100% DINÁMICO Y RESILIENTE:
--   Detecta automáticamente las columnas existentes en cada tabla
--   (incluyendo fecha_contable, fecha_carrera, fecha_registro, etc.)
--   evitando errores 42703 (columna inexistente) y errores 23505 (duplicados).
-- ============================================================================

begin;

-- ============================================================================
-- HELPER DINÁMICO: Obtiene la expresión de fecha real de cualquier tabla
-- ============================================================================
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

-- ============================================================================
-- HELPER DINÁMICO: Elimina filas previas a una fecha según columnas reales
-- ============================================================================
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

-- ============================================================================
-- 1. TABLAS HIJAS Y DEPENDIENTES (Evitar violaciones de FK)
-- ============================================================================
do $$
declare
  v_expr text;
begin
  -- Remate caballos
  if to_regclass('public.remate_caballos') is not null and to_regclass('public.remates') is not null then
    v_expr := pg_temp.obtener_expr_fecha('remates');
    if v_expr is not null then
      execute format('delete from public.remate_caballos where remate_id in (select id from public.remates where left(trim(%s), 10) < %L)', v_expr, '2026-10-27');
    end if;
  end if;

  -- Polla combinaciones
  if to_regclass('public.polla_combinaciones') is not null and to_regclass('public.pollas') is not null then
    v_expr := pg_temp.obtener_expr_fecha('pollas');
    if v_expr is not null then
      execute format('delete from public.polla_combinaciones where polla_id in (select id from public.pollas where left(trim(%s), 10) < %L)', v_expr, '2026-10-27');
    end if;
  end if;

  -- Tabla fija caballos
  if to_regclass('public.tabla_fija_caballos') is not null and to_regclass('public.tablas_fijas') is not null then
    v_expr := pg_temp.obtener_expr_fecha('tablas_fijas');
    if v_expr is not null then
      execute format('delete from public.tabla_fija_caballos where tabla_id in (select id from public.tablas_fijas where left(trim(%s), 10) < %L)', v_expr, '2026-10-27');
    end if;
  end if;

  -- Tabla grupos
  if to_regclass('public.tabla_grupos') is not null and to_regclass('public.tablas_fijas') is not null then
    v_expr := pg_temp.obtener_expr_fecha('tablas_fijas');
    if v_expr is not null then
      execute format('delete from public.tabla_grupos where tabla_id in (select id from public.tablas_fijas where left(trim(%s), 10) < %L)', v_expr, '2026-10-27');
    end if;
  end if;

  -- Solicitudes tablas (FK solicitudes_tablas_tabla_id_fkey hacia tablas_fijas)
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

  -- Asientos NIIF líneas
  if to_regclass('public.asientos_niif_lineas') is not null and to_regclass('public.asientos_niif') is not null then
    v_expr := pg_temp.obtener_expr_fecha('asientos_niif');
    if v_expr is not null then
      execute format('delete from public.asientos_niif_lineas where asiento_id in (select id from public.asientos_niif where left(trim(%s), 10) < %L)', v_expr, '2026-10-27');
    end if;
  end if;

  -- Contabilidad asientos líneas (detecta dinámicamente fecha_contable en contabilidad_asientos)
  if to_regclass('public.contabilidad_asientos_lineas') is not null and to_regclass('public.contabilidad_asientos') is not null then
    v_expr := pg_temp.obtener_expr_fecha('contabilidad_asientos');
    if v_expr is not null then
      execute format('delete from public.contabilidad_asientos_lineas where asiento_id in (select id from public.contabilidad_asientos where left(trim(%s), 10) < %L)', v_expr, '2026-10-27');
    end if;
  end if;

  -- Carrera ejemplares
  if to_regclass('public.carrera_ejemplares') is not null and to_regclass('public.carreras') is not null then
    execute 'delete from public.carrera_ejemplares where carrera_id in (select id from public.carreras where fecha < ''2026-10-27''::date)';
  end if;
end $$;

-- ============================================================================
-- 2. PURGA DINÁMICA DE APUESTAS Y JUGADAS (< 2026-10-27)
-- ============================================================================
select pg_temp.eliminar_filas_previas('tickets_apuestas', '2026-10-27');
select pg_temp.eliminar_filas_previas('tickets_jugadas', '2026-10-27');
select pg_temp.eliminar_filas_previas('wps_tickets', '2026-10-27');
select pg_temp.eliminar_filas_previas('dupletas', '2026-10-27');
select pg_temp.eliminar_filas_previas('remate_pujas', '2026-10-27');
select pg_temp.eliminar_filas_previas('remates', '2026-10-27');
select pg_temp.eliminar_filas_previas('polla_ventas', '2026-10-27');
select pg_temp.eliminar_filas_previas('pollas', '2026-10-27');
select pg_temp.eliminar_filas_previas('solicitudes_tablas', '2026-10-27');
select pg_temp.eliminar_filas_previas('tablas_fijas', '2026-10-27');
select pg_temp.eliminar_filas_previas('marcas_carrera', '2026-10-27');
select pg_temp.eliminar_filas_previas('portal_jugadas_externas', '2026-10-27');
select pg_temp.eliminar_filas_previas('cuaderno_jugadas', '2026-10-27');
select pg_temp.eliminar_filas_previas('jugadas_auditoria', '2026-10-27');

-- ============================================================================
-- 3. RESULTADOS, CARRERAS Y PROGRAMAS (< 2026-10-27)
-- ============================================================================
select pg_temp.eliminar_filas_previas('resultados_carreras', '2026-10-27');
select pg_temp.eliminar_filas_previas('cruces_carrera_config', '2026-10-27');
select pg_temp.eliminar_filas_previas('carreras', '2026-10-27');
select pg_temp.eliminar_filas_previas('programa_dia', '2026-10-27');
select pg_temp.eliminar_filas_previas('gaceta_procesada', '2026-10-27');
select pg_temp.eliminar_filas_previas('cierres_jornada', '2026-10-27');
select pg_temp.eliminar_filas_previas('ih_carreras_programa', '2026-10-27');
select pg_temp.eliminar_filas_previas('ih_inscripciones_carrera', '2026-10-27');
select pg_temp.eliminar_filas_previas('ih_tendencia_jornada', '2026-10-27');
select pg_temp.eliminar_filas_previas('ih_cuadros_maestros_5y6', '2026-10-27');

-- ============================================================================
-- 4. MOVIMIENTOS FINANCIEROS Y CONTABLES (< 2026-10-27)
-- ============================================================================
select pg_temp.eliminar_filas_previas('movimientos_caja', '2026-10-27');
select pg_temp.eliminar_filas_previas('transacciones_financieras', '2026-10-27');
select pg_temp.eliminar_filas_previas('asientos_niif', '2026-10-27');
select pg_temp.eliminar_filas_previas('contabilidad_asientos', '2026-10-27');
select pg_temp.eliminar_filas_previas('libro_mayor_clientes', '2026-10-27');
select pg_temp.eliminar_filas_previas('whatsapp_envios', '2026-10-27');

-- Notificaciones anteriores excepto las de configuración del portal
do $$
begin
  if to_regclass('public.notificaciones') is not null then
    delete from public.notificaciones
     where tipo <> 'config_bloqueo_jugadas'
       and left(trim(coalesce(created_at::text, '1900-01-01')), 10) < '2026-10-27';
  end if;
end $$;

-- ============================================================================
-- 5. CLIENTES: RESETEAR SALDO A 0 MANTENIENDO SUS AVALES Y CONDICIÓN LIBRE
-- ============================================================================
update public.clientes
   set saldo_actual = 0;

-- ============================================================================
-- 6. GRUPOS: MANTENER ARGENTINA, MADRID Y ESPARTANOS (FUSIÓN SIN DUPLICADOS)
-- ============================================================================

-- Asegurar que los 3 grupos principales existan y estén activos
update public.grupos_venta
   set activo = true
 where upper(trim(nombre)) in ('ARGENTINA', 'MADRID', 'ESPARTANOS');

insert into public.grupos_venta (nombre, moneda, es_principal, cupo_tabla, activo)
select 'ARGENTINA', 'USD', true, 100, true
where not exists (select 1 from public.grupos_venta where upper(trim(nombre)) = 'ARGENTINA');

insert into public.grupos_venta (nombre, moneda, es_principal, cupo_tabla, activo)
select 'MADRID', 'USD', false, 100, true
where not exists (select 1 from public.grupos_venta where upper(trim(nombre)) = 'MADRID');

insert into public.grupos_venta (nombre, moneda, es_principal, cupo_tabla, activo)
select 'ESPARTANOS', 'USD', false, 100, true
where not exists (select 1 from public.grupos_venta where upper(trim(nombre)) = 'ESPARTANOS');

-- Reubicar clientes en el grupo principal sin violar la restricción única uq_clientes_grupo_nombre
do $$
declare
  v_grupo_valido uuid;
begin
  select id into v_grupo_valido from public.grupos_venta where upper(trim(nombre)) = 'ARGENTINA' limit 1;
  if v_grupo_valido is null then
    select id into v_grupo_valido from public.grupos_venta where upper(trim(nombre)) in ('MADRID', 'ESPARTANOS') limit 1;
  end if;

  -- PASO A: Absorber clientes que ya existen en ARGENTINA (preserva mayor aval y libre)
  update public.clientes c_dest
     set aval = greatest(coalesce(c_dest.aval, 0), coalesce(c_src.aval, 0)),
         libre = (coalesce(c_dest.libre, false) or coalesce(c_src.libre, false)),
         telefono = coalesce(c_dest.telefono, c_src.telefono),
         devolucion = coalesce(c_dest.devolucion, c_src.devolucion)
    from (
      select upper(trim(nombre)) as nom_norm,
             max(coalesce(aval, 0)) as aval,
             bool_or(coalesce(libre, false)) as libre,
             max(telefono) as telefono,
             max(devolucion) as devolucion
        from public.clientes
       where grupo_id is not null
         and grupo_id not in (select id from public.grupos_venta where upper(trim(nombre)) in ('ARGENTINA', 'MADRID', 'ESPARTANOS'))
       group by upper(trim(nombre))
    ) c_src
   where c_dest.grupo_id = v_grupo_valido
     and upper(trim(c_dest.nombre)) = c_src.nom_norm;

  -- Eliminar las filas externas ya absorbidas en ARGENTINA
  delete from public.clientes
   where grupo_id is not null
     and grupo_id not in (select id from public.grupos_venta where upper(trim(nombre)) in ('ARGENTINA', 'MADRID', 'ESPARTANOS'))
     and upper(trim(nombre)) in (
       select upper(trim(nombre)) from public.clientes where grupo_id = v_grupo_valido
     );

  -- PASO B: Consolidar duplicados entre los propios grupos externos
  with agrupados as (
    select id,
           row_number() over (partition by upper(trim(nombre)) order by coalesce(aval, 0) desc, id) as rn,
           max(coalesce(aval, 0)) over (partition by upper(trim(nombre))) as max_aval,
           bool_or(coalesce(libre, false)) over (partition by upper(trim(nombre))) as any_libre
      from public.clientes
     where grupo_id is not null
       and grupo_id not in (select id from public.grupos_venta where upper(trim(nombre)) in ('ARGENTINA', 'MADRID', 'ESPARTANOS'))
  )
  update public.clientes c
     set aval = a.max_aval,
         libre = a.any_libre
    from agrupados a
   where c.id = a.id and a.rn = 1;

  delete from public.clientes
   where id in (
     select id from (
       select id,
              row_number() over (partition by upper(trim(nombre)) order by coalesce(aval, 0) desc, id) as rn
         from public.clientes
        where grupo_id is not null
          and grupo_id not in (select id from public.grupos_venta where upper(trim(nombre)) in ('ARGENTINA', 'MADRID', 'ESPARTANOS'))
     ) s where s.rn > 1
   );

  -- PASO C: Mover clientes limpios a ARGENTINA (garantizado cero colisiones)
  update public.clientes
     set grupo_id = v_grupo_valido
   where grupo_id is not null
     and grupo_id not in (select id from public.grupos_venta where upper(trim(nombre)) in ('ARGENTINA', 'MADRID', 'ESPARTANOS'));

  -- PASO D: Limpiar relaciones secundarias huérfanas
  if to_regclass('public.clientes_grupos') is not null then
    delete from public.clientes_grupos
     where grupo_id not in (select id from public.grupos_venta where upper(trim(nombre)) in ('ARGENTINA', 'MADRID', 'ESPARTANOS'));
  end if;

  if to_regclass('public.convenio_tipo_grupo') is not null then
    delete from public.convenio_tipo_grupo
     where grupo_id not in (select id from public.grupos_venta where upper(trim(nombre)) in ('ARGENTINA', 'MADRID', 'ESPARTANOS'));
  end if;
end $$;

-- Desactivar y eliminar grupos obsoletos
update public.grupos_venta
   set activo = false
 where upper(trim(nombre)) not in ('ARGENTINA', 'MADRID', 'ESPARTANOS');

delete from public.grupos_venta
 where upper(trim(nombre)) not in ('ARGENTINA', 'MADRID', 'ESPARTANOS');

commit;

-- ============================================================================
-- VERIFICACIÓN FINAL
-- ============================================================================
select nombre, activo, es_principal from public.grupos_venta order by nombre;

select count(*) as total_clientes, 
       sum(case when aval > 0 then 1 else 0 end) as clientes_con_aval,
       sum(case when libre = true or modo_juego = 'libre' then 1 else 0 end) as clientes_libres,
       sum(case when saldo_actual = 0 then 1 else 0 end) as clientes_saldo_cero
  from public.clientes;

select count(*) as carreras_restantes from public.carreras;
select count(*) as tickets_restantes from public.tickets_apuestas;
