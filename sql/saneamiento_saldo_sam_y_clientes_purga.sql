-- ============================================================================
-- saneamiento_saldo_sam_y_clientes_purga.sql
-- 
-- Sanea el saldo de 'SAM' y de cualquier cliente cuyos tickets previos hayan sido
-- purgados o no tenga jugadas pendientes/ganadas/perdidas activas.
-- Vincula el saldo directamente a la matriz principal (0.00).
-- ============================================================================

begin;

-- 1. Saneamiento inmediato de SAM en todos los grupos a 0.00
update public.clientes
   set saldo_actual = 0.00
 where upper(trim(nombre)) = 'SAM'
    or upper(trim(coalesce(seudonimo, ''))) = 'SAM';

-- 2. Saneamiento de clientes huérfanos sin tickets de apuestas ni movimientos pendientes
-- (Garantiza que el portal de clientes y los reportes muestren exactamente 0.00)
update public.clientes c
   set saldo_actual = 0.00
 where not exists (
   select 1
     from public.tickets_apuestas t
    where (t.cliente_juega_id = c.id or upper(trim(t.cliente_juega_nombre)) = upper(trim(c.nombre))
        or t.cliente_consigue_id = c.id or upper(trim(coalesce(t.cliente_consigue_nombre, ''))) = upper(trim(c.nombre)))
      and t.anulada is not true
 )
 and not exists (
   select 1
     from public.depositos d
    where d.cliente_id = c.id::text
 )
 and c.saldo_actual <> 0.00;

commit;
