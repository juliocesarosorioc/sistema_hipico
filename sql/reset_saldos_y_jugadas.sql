-- ============================================================================
-- reset_saldos_y_jugadas.sql
-- 
-- 1. Resetea a 0 todos los saldos de clientes.
-- 2. Borra TODO el historial de jugadas (tickets_apuestas, etc.).
-- 3. MANTIENE estrictamente los avales (clientes.aval).
-- 4. MANTIENE estrictamente los libres (clientes.libre, clientes.modo_juego).
-- 5. Deja SOLO los grupos Argentina, Madrid y Espartanos y elimina el resto.
-- 6. Resuelve automáticamente duplicados de nombres (uq_clientes_grupo_nombre).
-- ============================================================================

begin;

-- ============================================================================
-- PASO 1: BORRADO TOTAL DEL HISTORIAL DE JUGADAS Y TRANSACCIONES
-- ============================================================================

delete from public.tickets_apuestas;
delete from public.tickets_jugadas;

do $$
begin
  if to_regclass('public.wps_tickets') is not null then
    delete from public.wps_tickets;
  end if;
  if to_regclass('public.dupletas') is not null then
    delete from public.dupletas;
  end if;
  if to_regclass('public.remate_pujas') is not null then
    delete from public.remate_pujas;
  end if;
  if to_regclass('public.polla_ventas') is not null then
    delete from public.polla_ventas;
  end if;
  if to_regclass('public.movimientos_caja') is not null then
    delete from public.movimientos_caja;
  end if;
  if to_regclass('public.transacciones_financieras') is not null then
    delete from public.transacciones_financieras;
  end if;
  if to_regclass('public.asientos_niif') is not null then
    delete from public.asientos_niif;
  end if;
  if to_regclass('public.jugadas_auditoria') is not null then
    delete from public.jugadas_auditoria;
  end if;
end $$;

-- ============================================================================
-- PASO 2: RESETEAR A 0 TODOS LOS SALDOS DE CLIENTES
-- Conserva intactos: aval, libre, modo_juego, nombre, cédula, grupo, teléfono
-- ============================================================================

update public.clientes
   set saldo_actual = 0;

-- ============================================================================
-- PASO 3: DEJAR ÚNICAMENTE LOS GRUPOS ARGENTINA, MADRID Y ESPARTANOS
-- ============================================================================

-- 3.1 Asegurar que los 3 grupos permitidos estén activos
update public.grupos_venta
   set activo = true
 where upper(trim(nombre)) in ('ARGENTINA', 'MADRID', 'ESPARTANOS');

-- 3.2 Si alguno de los 3 no existe, crearlo
insert into public.grupos_venta (nombre, moneda, es_principal, cupo_tabla, activo)
select 'ARGENTINA', 'USD', true, 100, true
where not exists (select 1 from public.grupos_venta where upper(trim(nombre)) = 'ARGENTINA');

insert into public.grupos_venta (nombre, moneda, es_principal, cupo_tabla, activo)
select 'MADRID', 'USD', false, 100, true
where not exists (select 1 from public.grupos_venta where upper(trim(nombre)) = 'MADRID');

insert into public.grupos_venta (nombre, moneda, es_principal, cupo_tabla, activo)
select 'ESPARTANOS', 'USD', false, 100, true
where not exists (select 1 from public.grupos_venta where upper(trim(nombre)) = 'ESPARTANOS');

-- 3.3 Reubicar clientes y resolver colisiones de nombres (uq_clientes_grupo_nombre)
do $$
declare
  v_grupo_valido uuid;
begin
  select id into v_grupo_valido from public.grupos_venta where upper(trim(nombre)) = 'ARGENTINA' limit 1;
  if v_grupo_valido is null then
    select id into v_grupo_valido from public.grupos_venta where upper(trim(nombre)) in ('MADRID', 'ESPARTANOS') limit 1;
  end if;

  -- A. Si un cliente de los grupos a eliminar ya existe en ARGENTINA (ej. THOR):
  --    Consolidar el mayor aval y estado libre al cliente de ARGENTINA
  update public.clientes c_dest
     set aval = greatest(coalesce(c_dest.aval, 0), coalesce(c_src.aval, 0)),
         libre = (coalesce(c_dest.libre, false) or coalesce(c_src.libre, false)),
         telefono = coalesce(c_dest.telefono, c_src.telefono),
         devolucion = coalesce(c_dest.devolucion, c_src.devolucion)
    from public.clientes c_src
   where c_dest.grupo_id = v_grupo_valido
     and upper(trim(c_dest.nombre)) = upper(trim(c_src.nombre))
     and c_src.id <> c_dest.id
     and c_src.grupo_id not in (select id from public.grupos_venta where upper(trim(nombre)) in ('ARGENTINA', 'MADRID', 'ESPARTANOS'));

  -- Eliminar el registro duplicado del grupo secundario que ya fue consolidado en ARGENTINA
  delete from public.clientes c_src
   where c_src.grupo_id not in (select id from public.grupos_venta where upper(trim(nombre)) in ('ARGENTINA', 'MADRID', 'ESPARTANOS'))
     and exists (
       select 1 
         from public.clientes c_dest 
        where c_dest.grupo_id = v_grupo_valido 
          and upper(trim(c_dest.nombre)) = upper(trim(c_src.nombre))
          and c_dest.id <> c_src.id
     );

  -- B. Si hay nombres duplicados entre los mismos grupos a eliminar (ej. un cliente en CEB y otro en MVP):
  --    Consolidar aval y libre en uno solo y eliminar el duplicado
  with dupes as (
    select id,
           row_number() over (partition by upper(trim(nombre)) order by coalesce(aval, 0) desc, id) as rn,
           max(coalesce(aval, 0)) over (partition by upper(trim(nombre))) as max_aval,
           bool_or(coalesce(libre, false)) over (partition by upper(trim(nombre))) as any_libre
      from public.clientes
     where grupo_id is not null
       and grupo_id not in (select id from public.grupos_venta where upper(trim(nombre)) in ('ARGENTINA', 'MADRID', 'ESPARTANOS'))
  )
  update public.clientes c
     set aval = d.max_aval,
         libre = d.any_libre
    from dupes d
   where c.id = d.id and d.rn = 1;

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

  -- C. Ahora todos los clientes a reubicar tienen nombres únicos garantizados:
  update public.clientes
     set grupo_id = v_grupo_valido
   where grupo_id is not null
     and grupo_id not in (select id from public.grupos_venta where upper(trim(nombre)) in ('ARGENTINA', 'MADRID', 'ESPARTANOS'));

  -- D. Limpiar membresías en clientes_grupos si existe
  if to_regclass('public.clientes_grupos') is not null then
    delete from public.clientes_grupos
     where grupo_id not in (select id from public.grupos_venta where upper(trim(nombre)) in ('ARGENTINA', 'MADRID', 'ESPARTANOS'));
  end if;

  -- E. Limpiar convenios de grupos eliminados si existe
  if to_regclass('public.convenio_tipo_grupo') is not null then
    delete from public.convenio_tipo_grupo
     where grupo_id not in (select id from public.grupos_venta where upper(trim(nombre)) in ('ARGENTINA', 'MADRID', 'ESPARTANOS'));
  end if;
end $$;

-- 3.4 Desactivar y eliminar todos los demás grupos
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
select count(*) as total_clientes, sum(case when saldo_actual = 0 then 1 else 0 end) as saldos_en_cero from public.clientes;
select count(*) as tickets_restantes from public.tickets_apuestas;
