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

-- OJO: tickets_apuestas SOLO referencia clientes por cliente_juega_id y
-- cliente_consigue_id. Las columnas "cliente1_id/cliente2_id" NO existen en
-- la tabla (error 42703); por eso no se borra por ellas.

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