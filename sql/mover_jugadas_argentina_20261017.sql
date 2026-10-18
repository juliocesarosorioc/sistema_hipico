-- ============================================================================
-- JUGADAS DEL 17/10/2026 -> GRUPO ARGENTINA + COMISION 5%
-- ============================================================================
-- Mueve TODAS las jugadas registradas el día local 17/10/2026 (hora Venezuela,
-- America/Caracas) al grupo ARGENTINA y les congela comisión del 5%.
--
-- Qué toca:
--   tickets_apuestas.grupo / grupo_cobro_id / grupo_cobro_nombre  (grupo de cobro)
--   tickets_apuestas.grupo_comision_id / grupo_comision_nombre    (grupo que cobra)
--   tickets_apuestas.comision_porcentaje = 5.00                   (comisión tercios)
--
-- El día se mide por `fecha_registro AT TIME ZONE 'America/Caracas'` (la misma
-- ventana local que usa la app en reportes/liquidación), NO por el prefijo UTC.
--
-- Antes de tocar nada se copian las filas afectadas a una tabla de respaldo
-- (tickets_bkp_20261017_argentina) por si hay que revertir.
--
-- IMPORTANTE: las jugadas YA decididas (Ganador/Perdedor/Retirado) quedan con el
-- estado viejo; la comisión nueva recién se aplica al recalcular. Después de
-- correr este script, abrir en la app Gestión -> editar jugadas de cada carrera
-- afectada y usar "Recalcular" para que premios/neteo salgan con 5% y el grupo
-- ARGENTINA.
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
-- 2) Respaldar las filas que se van a cambiar
-- ---------------------------------------------------------------------------
create table if not exists public.tickets_bkp_20261017_argentina
  (like public.tickets_apuestas including defaults);

insert into public.tickets_bkp_20261017_argentina
select t.*
  from public.tickets_apuestas t
 where (t.fecha_registro at time zone 'America/Caracas')::date = date '2026-10-17'
   and (t.grupo_cobro_id is distinct from (select id from _grupo_arg)
        or t.comision_porcentaje is distinct from 5.00);

-- ---------------------------------------------------------------------------
-- 3) Mover al grupo ARGENTINA y congelar comision 5%
-- ---------------------------------------------------------------------------
update public.tickets_apuestas t
   set grupo                = (select nombre from _grupo_arg),
       grupo_cobro_id       = (select id from _grupo_arg),
       grupo_cobro_nombre   = (select nombre from _grupo_arg),
       grupo_comision_id    = (select id from _grupo_arg),
       grupo_comision_nombre= (select nombre from _grupo_arg),
       comision_porcentaje  = 5.00
 where (t.fecha_registro at time zone 'America/Caracas')::date = date '2026-10-17'
   and (t.grupo_cobro_id is distinct from (select id from _grupo_arg)
        or t.comision_porcentaje is distinct from 5.00);

commit;

-- ---------------------------------------------------------------------------
-- 4) Verificación: qué quedó movido (por hipódromo/carrera/estado)
-- ---------------------------------------------------------------------------
select t.hipodromo,
       t.carrera,
       t.estado,
       count(*)                          as jugadas,
       sum(t.monto_jugado)               as monto_total,
       min(t.comision_porcentaje)        as comision_min,
       max(t.comision_porcentaje)        as comision_max
  from public.tickets_apuestas t
 where (t.fecha_registro at time zone 'America/Caracas')::date = date '2026-10-17'
 group by t.hipodromo, t.carrera, t.estado
 order by t.hipodromo, t.carrera, t.estado;

-- Para revertir (si hiciera falta), comparar contra el respaldo:
--   select count(*) from public.tickets_bkp_20261017_argentina;
