-- ============================================================================
-- purga_jugadas_saldos_grupos.sql
-- Borra todas las jugadas y todos los saldos.
-- Mantiene los avales y los libres en todos los grupos.
-- Deja SOLO los grupos Argentina, Madrid y Espartanos y elimina el resto.
-- ============================================================================

begin;

-- 1. Eliminar jugadas (tickets) y reclamos
delete from public.tickets_apuestas;
delete from public.tickets_jugadas;

-- Limpieza condicional de tablas secundarias
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

-- 2. Limpiar saldos manteniendo avales y libres
update public.clientes
   set saldo_actual = 0;

-- 3. Dejar solo los grupos Argentina, Madrid y Espartanos y eliminar el resto
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

-- Reubicar clientes y resolver colisiones de nombres (uq_clientes_grupo_nombre)
do $$
declare
  v_grupo_valido uuid;
begin
  select id into v_grupo_valido from public.grupos_venta where upper(trim(nombre)) = 'ARGENTINA' limit 1;
  if v_grupo_valido is null then
    select id into v_grupo_valido from public.grupos_venta where upper(trim(nombre)) in ('MADRID', 'ESPARTANOS') limit 1;
  end if;

  -- A. Consolidar clientes cuyo nombre ya existe en ARGENTINA (ej. THOR)
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

  delete from public.clientes c_src
   where c_src.grupo_id not in (select id from public.grupos_venta where upper(trim(nombre)) in ('ARGENTINA', 'MADRID', 'ESPARTANOS'))
     and exists (
       select 1 
         from public.clientes c_dest 
        where c_dest.grupo_id = v_grupo_valido 
          and upper(trim(c_dest.nombre)) = upper(trim(c_src.nombre))
          and c_dest.id <> c_src.id
     );

  -- B. Consolidar duplicados entre grupos a eliminar
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

  -- C. Reubicar clientes limpios y sin colisiones
  update public.clientes
     set grupo_id = v_grupo_valido
   where grupo_id is not null
     and grupo_id not in (select id from public.grupos_venta where upper(trim(nombre)) in ('ARGENTINA', 'MADRID', 'ESPARTANOS'));

  -- D. Limpiar tablas puente
  if to_regclass('public.clientes_grupos') is not null then
    delete from public.clientes_grupos
     where grupo_id not in (select id from public.grupos_venta where upper(trim(nombre)) in ('ARGENTINA', 'MADRID', 'ESPARTANOS'));
  end if;

  if to_regclass('public.convenio_tipo_grupo') is not null then
    delete from public.convenio_tipo_grupo
     where grupo_id not in (select id from public.grupos_venta where upper(trim(nombre)) in ('ARGENTINA', 'MADRID', 'ESPARTANOS'));
  end if;
end $$;

-- 4. Desactivar y eliminar otros grupos
update public.grupos_venta
   set activo = false
 where upper(trim(nombre)) not in ('ARGENTINA', 'MADRID', 'ESPARTANOS');

delete from public.grupos_venta
 where upper(trim(nombre)) not in ('ARGENTINA', 'MADRID', 'ESPARTANOS');

commit;
