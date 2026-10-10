-- Actualizar saldos/Aval de clientes ARGENTINA según hoja proporcionada
BEGIN;

UPDATE clientes SET saldo_actual=2031.13, aval=2000.00 WHERE UPPER(nombre)=UPPER('ARELY') AND grupo_id=(SELECT id FROM grupos_venta WHERE UPPER(nombre)=UPPER('ARGENTINA') LIMIT 1);
UPDATE clientes SET saldo_actual=-10.00, aval=0.00 WHERE UPPER(nombre)=UPPER('ARRAEZ') AND grupo_id=(SELECT id FROM grupos_venta WHERE UPPER(nombre)=UPPER('ARGENTINA') LIMIT 1);
UPDATE clientes SET saldo_actual=1887.88, aval=2000.00 WHERE UPPER(nombre)=UPPER('AYARI') AND grupo_id=(SELECT id FROM grupos_venta WHERE UPPER(nombre)=UPPER('ARGENTINA') LIMIT 1);
UPDATE clientes SET saldo_actual=-50.00, aval=0.00 WHERE UPPER(nombre)=UPPER('BERSAREZ') AND grupo_id=(SELECT id FROM grupos_venta WHERE UPPER(nombre)=UPPER('ARGENTINA') LIMIT 1);
UPDATE clientes SET saldo_actual=459.78, aval=0.00 WHERE UPPER(nombre)=UPPER('BG') AND grupo_id=(SELECT id FROM grupos_venta WHERE UPPER(nombre)=UPPER('ARGENTINA') LIMIT 1);
UPDATE clientes SET saldo_actual=350.00, aval=500.00 WHERE UPPER(nombre)=UPPER('CAMACHO') AND grupo_id=(SELECT id FROM grupos_venta WHERE UPPER(nombre)=UPPER('ARGENTINA') LIMIT 1);
UPDATE clientes SET saldo_actual=0.88, aval=0.00 WHERE UPPER(nombre)=UPPER('CHINO') AND grupo_id=(SELECT id FROM grupos_venta WHERE UPPER(nombre)=UPPER('ARGENTINA') LIMIT 1);
UPDATE clientes SET saldo_actual=54.15, aval=0.00 WHERE UPPER(nombre)=UPPER('EDDIE') AND grupo_id=(SELECT id FROM grupos_venta WHERE UPPER(nombre)=UPPER('ARGENTINA') LIMIT 1);
UPDATE clientes SET saldo_actual=31.50, aval=0.00 WHERE UPPER(nombre)=UPPER('EVERY') AND grupo_id=(SELECT id FROM grupos_venta WHERE UPPER(nombre)=UPPER('ARGENTINA') LIMIT 1);
UPDATE clientes SET saldo_actual=-783.99, aval=0.00 WHERE UPPER(nombre)=UPPER('FORTUNA') AND grupo_id=(SELECT id FROM grupos_venta WHERE UPPER(nombre)=UPPER('ARGENTINA') LIMIT 1);
UPDATE clientes SET saldo_actual=125.75, aval=0.00 WHERE UPPER(nombre)=UPPER('GAETANO') AND grupo_id=(SELECT id FROM grupos_venta WHERE UPPER(nombre)=UPPER('ARGENTINA') LIMIT 1);
UPDATE clientes SET saldo_actual=500.00, aval=500.00 WHERE UPPER(nombre)=UPPER('LAMINE') AND grupo_id=(SELECT id FROM grupos_venta WHERE UPPER(nombre)=UPPER('ARGENTINA') LIMIT 1);
UPDATE clientes SET saldo_actual=500.00, aval=500.00 WHERE UPPER(nombre)=UPPER('LARRY') AND grupo_id=(SELECT id FROM grupos_venta WHERE UPPER(nombre)=UPPER('ARGENTINA') LIMIT 1);
UPDATE clientes SET saldo_actual=212.50, aval=0.00 WHERE UPPER(nombre)=UPPER('LEYBA') AND grupo_id=(SELECT id FROM grupos_venta WHERE UPPER(nombre)=UPPER('ARGENTINA') LIMIT 1);
UPDATE clientes SET saldo_actual=12.50, aval=0.00 WHERE UPPER(nombre)=UPPER('MAKI') AND grupo_id=(SELECT id FROM grupos_venta WHERE UPPER(nombre)=UPPER('ARGENTINA') LIMIT 1);
UPDATE clientes SET saldo_actual=-41.75, aval=0.00 WHERE UPPER(nombre)=UPPER('PARTNER') AND grupo_id=(SELECT id FROM grupos_venta WHERE UPPER(nombre)=UPPER('ARGENTINA') LIMIT 1);
UPDATE clientes SET saldo_actual=14.03, aval=0.00 WHERE UPPER(nombre)=UPPER('ROCA') AND grupo_id=(SELECT id FROM grupos_venta WHERE UPPER(nombre)=UPPER('ARGENTINA') LIMIT 1);
UPDATE clientes SET saldo_actual=1665.00, aval=2000.00 WHERE UPPER(nombre)=UPPER('RUCIO') AND grupo_id=(SELECT id FROM grupos_venta WHERE UPPER(nombre)=UPPER('ARGENTINA') LIMIT 1);
UPDATE clientes SET saldo_actual=-346.25, aval=0.00 WHERE UPPER(nombre)=UPPER('RUSSO') AND grupo_id=(SELECT id FROM grupos_venta WHERE UPPER(nombre)=UPPER('ARGENTINA') LIMIT 1);
UPDATE clientes SET saldo_actual=-190.07, aval=0.00 WHERE UPPER(nombre)=UPPER('SAM') AND grupo_id=(SELECT id FROM grupos_venta WHERE UPPER(nombre)=UPPER('ARGENTINA') LIMIT 1);
UPDATE clientes SET saldo_actual=2000.00, aval=2000.00 WHERE UPPER(nombre)=UPPER('SOLDADO') AND grupo_id=(SELECT id FROM grupos_venta WHERE UPPER(nombre)=UPPER('ARGENTINA') LIMIT 1);
UPDATE clientes SET saldo_actual=104.30, aval=0.00 WHERE UPPER(nombre)=UPPER('SPEEDY') AND grupo_id=(SELECT id FROM grupos_venta WHERE UPPER(nombre)=UPPER('ARGENTINA') LIMIT 1);
UPDATE clientes SET saldo_actual=178.00, aval=0.00 WHERE UPPER(nombre)=UPPER('THOR') AND grupo_id=(SELECT id FROM grupos_venta WHERE UPPER(nombre)=UPPER('ARGENTINA') LIMIT 1);
UPDATE clientes SET saldo_actual=-290.67, aval=0.00 WHERE UPPER(nombre)=UPPER('URIEL') AND grupo_id=(SELECT id FROM grupos_venta WHERE UPPER(nombre)=UPPER('ARGENTINA') LIMIT 1);

COMMIT;