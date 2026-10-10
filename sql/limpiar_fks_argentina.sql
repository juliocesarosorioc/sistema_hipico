-- Restaurar cartera de clientes (grupo ARGENTINA) - Versión segura con FKs
BEGIN;

-- 1. Limpiar dependencias que referencian clientes del grupo ARGENTINA
DELETE FROM tickets_apuestas 
WHERE cliente_juega_id IN (
  SELECT c.id FROM clientes c
  JOIN grupos_venta g ON g.id = c.grupo_id
  WHERE UPPER(g.nombre)=UPPER('ARGENTINA')
);

DELETE FROM tickets_apuestas 
WHERE cliente_consigue_id IN (
  SELECT c.id FROM clientes c
  JOIN grupos_venta g ON g.id = c.grupo_id
  WHERE UPPER(g.nombre)=UPPER('ARGENTINA')
);

DELETE FROM tickets_apuestas 
WHERE cliente1_id IN (
  SELECT c.id FROM clientes c
  JOIN grupos_venta g ON g.id = c.grupo_id
  WHERE UPPER(g.nombre)=UPPER('ARGENTINA')
);

DELETE FROM tickets_apuestas 
WHERE cliente2_id IN (
  SELECT c.id FROM clientes c
  JOIN grupos_venta g ON g.id = c.grupo_id
  WHERE UPPER(g.nombre)=UPPER('ARGENTINA')
);

DELETE FROM clientes_grupos 
WHERE cliente_id IN (
  SELECT c.id FROM clientes c
  JOIN grupos_venta g ON g.id = c.grupo_id
  WHERE UPPER(g.nombre)=UPPER('ARGENTINA')
);

DELETE FROM saldos_movimientos 
WHERE cliente_id IN (
  SELECT c.id FROM clientes c
  JOIN grupos_venta g ON g.id = c.grupo_id
  WHERE UPPER(g.nombre)=UPPER('ARGENTINA')
);

-- 2. Borrar clientes del grupo ARGENTINA
DELETE FROM clientes 
WHERE grupo_id = (SELECT id FROM grupos_venta WHERE UPPER(nombre)=UPPER('ARGENTINA') LIMIT 1);

COMMIT;