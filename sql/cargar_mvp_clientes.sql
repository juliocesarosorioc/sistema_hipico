-- ============================================================================
-- MVP — CARGA / ACTUALIZACION DE CLIENTES Y SALDOS
-- ============================================================================
-- Ejecutar en Supabase -> SQL Editor.
--
-- Deja la cartera del grupo MVP con los clientes y saldos de la lista de abajo.
-- Es IDEMPOTENTE y NO destructivo:
--   · a quien YA esta en MVP (por nombre, sin importar mayusculas) le
--     actualiza `saldo_actual` y `libre`;
--   · a quien NO esta todavia lo da de alta en MVP en modo "aval".
-- No borra filas ni cambia ids: los tickets, jugadas y liquidaciones que ya
-- apuntan a un cliente siguen enlazados a la misma fila.
--
-- `libre = true` corresponde a los clientes marcados con OK en el listado.
-- ============================================================================

begin;

-- 1) Asegurar el grupo de venta MVP -----------------------------------------
insert into public.grupos_venta (nombre, moneda, es_principal, cupo_tabla, activo)
select 'MVP', 'USD', false, 100, true
where not exists (select 1 from public.grupos_venta where upper(nombre) = 'MVP');

-- 2) Actualizar saldo (y libre) de los clientes que YA estan en MVP ----------
update public.clientes c
   set saldo_actual = l.saldo,
       libre        = l.libre
  from (
    values
      ('ADOLFO',      30000.00, false),
      ('ALAMBRE',    244948.18, false),
      ('ANGELO',       1758.06, false),
      ('ANUEL',       30500.00, false),
      ('ARASME',          0.75, false),
      ('AREVALO',    135203.12, false),
      ('BARRILETE',       0.80, false),
      ('BATMAN',        144.38, false),
      ('BEBE',        45800.00, true),
      ('BENELLI',     -1250.00, true),
      ('BORREGO',    258500.00, false),
      ('CALIFORNIA',     -0.01, false),
      ('CARS',       948254.07, true),
      ('CERVEZA',    200000.00, false),
      ('CESAR',      100955.00, false),
      ('CH',         355881.23, false),
      ('CHIRE',        8550.00, true),
      ('CLEOPATRA',     600.00, false),
      ('COLMENAREZ',      0.25, false),
      ('COMIDA',     200000.00, false),
      ('DARIO',      956308.59, true),
      ('DELTA',      200000.00, false),
      ('DINERO',     367937.95, false),
      ('DURAN',         507.19, false),
      ('ECUADOR',     84975.00, false),
      ('ELCURA',        550.00, false),
      ('ENGER',      568000.00, false),
      ('ESCOBAR',        88.75, false),
      ('FABIANA',     28750.00, true),
      ('FABIO',      862640.20, false),
      ('GAELITO',     25825.00, true),
      ('GALLETA',       510.74, false),
      ('GARETH',          0.50, false),
      ('GERMANY',        37.50, false),
      ('GOOD',            2.50, false),
      ('GORRA',           0.01, true),
      ('GOUS',        47432.83, false),
      ('GRINGO',       2925.00, false),
      ('GUASON',          1.81, false),
      ('GUERRERO',      630.77, false),
      ('GUNZO',         200.00, false),
      ('HADES',      -31000.00, true),
      ('HERCULES',      100.00, false),
      ('HOUSTON',     80000.00, false),
      ('INFANTE',    266500.00, false),
      ('INTREPIDO',  158491.42, false),
      ('JAIME',       21400.63, false),
      ('JALEN',      -10000.00, true),
      ('JESSICA',      7900.00, true),
      ('JESUS',         270.00, false),
      ('JJ',         899407.50, true),
      ('JULITO',     700986.72, false),
      ('KAWASAKI',    29188.11, false),
      ('KK',         118778.61, true),
      ('KOREA',       38501.32, false),
      ('LEO',             6.17, false),
      ('LOGAN',           0.40, false),
      ('LUIS',           15.83, false),
      ('MAESTRO',     28500.00, true),
      ('MAGALLANES',  75890.50, false),
      ('MOISES',         82.63, false),
      ('MOSTAZA',    235600.00, false),
      ('MUDIN',      168800.13, false),
      ('MVP',      -1392570.00, true),
      ('NAVEGANTE',   50000.00, false),
      ('NEGRITO',         0.01, false),
      ('NEWYORK',    165660.00, false),
      ('PAJARO',      28500.00, false),
      ('PARAGUANA',       0.68, false),
      ('PARCERO',    612410.28, false),
      ('PARIS',        1332.50, false),
      ('PARLEYS',     -35800.00, false),
      ('PEDILON',    802477.20, true),
      ('PELON',      -147950.00, true),
      ('PETER',       25910.00, false),
      ('PITUFO',     600000.00, false),
      ('PROFE',      260300.00, false),
      ('PS',          62001.00, false),
      ('PULPO',         852.55, false),
      ('RAFA',       678800.82, false),
      ('RANGNAROK', -917501.48, true),
      ('RH',        -102033.90, true),
      ('ROBATAXI',   210045.46, true),
      ('RONALDO',   1251800.00, false),
      ('SANTOS',     200750.00, false),
      ('SHANGO',      54381.17, false),
      ('SIETE',         498.60, false),
      ('SUPERMAN',    91000.00, false),
      ('THOR',       -51980.00, true),
      ('TOYOTA',          3.00, false),
      ('TURCO',          44.87, false),
      ('VICKY',      -10500.00, true),
      ('WILMER',        100.00, false),
      ('YAIBER',        645.00, false),
      ('YARACUY',    291750.00, true),
      ('YAYAJU',      17402.00, false),
      ('YERSON',         75.00, false),
      ('YOLMER',     -12625.00, true),
      ('YOYO',        45749.99, true),
      ('YULI',        10140.00, false),
      ('ZEUS',       579974.06, false),
      ('ZORRO',     -199853.47, true)
  ) as l(nombre, saldo, libre),
  (select id from public.grupos_venta where upper(nombre) = 'MVP' limit 1) as mvp(id)
 where upper(c.nombre) = l.nombre
   and c.grupo_id = mvp.id;

-- 3) Dar de alta en MVP a los clientes que todavia no estan -----------------
insert into public.clientes
  (nombre, libre, saldo_actual, aval, comision, modo_juego, mostrar_saldo_socio, es_socio, grupo_id)
select l.nombre, l.libre, l.saldo, 0.00, 0.00, 'aval', false, false, mvp.id
  from (
    values
      ('ADOLFO',      30000.00, false),
      ('ALAMBRE',    244948.18, false),
      ('ANGELO',       1758.06, false),
      ('ANUEL',       30500.00, false),
      ('ARASME',          0.75, false),
      ('AREVALO',    135203.12, false),
      ('BARRILETE',       0.80, false),
      ('BATMAN',        144.38, false),
      ('BEBE',        45800.00, true),
      ('BENELLI',     -1250.00, true),
      ('BORREGO',    258500.00, false),
      ('CALIFORNIA',     -0.01, false),
      ('CARS',       948254.07, true),
      ('CERVEZA',    200000.00, false),
      ('CESAR',      100955.00, false),
      ('CH',         355881.23, false),
      ('CHIRE',        8550.00, true),
      ('CLEOPATRA',     600.00, false),
      ('COLMENAREZ',      0.25, false),
      ('COMIDA',     200000.00, false),
      ('DARIO',      956308.59, true),
      ('DELTA',      200000.00, false),
      ('DINERO',     367937.95, false),
      ('DURAN',         507.19, false),
      ('ECUADOR',     84975.00, false),
      ('ELCURA',        550.00, false),
      ('ENGER',      568000.00, false),
      ('ESCOBAR',        88.75, false),
      ('FABIANA',     28750.00, true),
      ('FABIO',      862640.20, false),
      ('GAELITO',     25825.00, true),
      ('GALLETA',       510.74, false),
      ('GARETH',          0.50, false),
      ('GERMANY',        37.50, false),
      ('GOOD',            2.50, false),
      ('GORRA',           0.01, true),
      ('GOUS',        47432.83, false),
      ('GRINGO',       2925.00, false),
      ('GUASON',          1.81, false),
      ('GUERRERO',      630.77, false),
      ('GUNZO',         200.00, false),
      ('HADES',      -31000.00, true),
      ('HERCULES',      100.00, false),
      ('HOUSTON',     80000.00, false),
      ('INFANTE',    266500.00, false),
      ('INTREPIDO',  158491.42, false),
      ('JAIME',       21400.63, false),
      ('JALEN',      -10000.00, true),
      ('JESSICA',      7900.00, true),
      ('JESUS',         270.00, false),
      ('JJ',         899407.50, true),
      ('JULITO',     700986.72, false),
      ('KAWASAKI',    29188.11, false),
      ('KK',         118778.61, true),
      ('KOREA',       38501.32, false),
      ('LEO',             6.17, false),
      ('LOGAN',           0.40, false),
      ('LUIS',           15.83, false),
      ('MAESTRO',     28500.00, true),
      ('MAGALLANES',  75890.50, false),
      ('MOISES',         82.63, false),
      ('MOSTAZA',    235600.00, false),
      ('MUDIN',      168800.13, false),
      ('MVP',      -1392570.00, true),
      ('NAVEGANTE',   50000.00, false),
      ('NEGRITO',         0.01, false),
      ('NEWYORK',    165660.00, false),
      ('PAJARO',      28500.00, false),
      ('PARAGUANA',       0.68, false),
      ('PARCERO',    612410.28, false),
      ('PARIS',        1332.50, false),
      ('PARLEYS',     -35800.00, false),
      ('PEDILON',    802477.20, true),
      ('PELON',      -147950.00, true),
      ('PETER',       25910.00, false),
      ('PITUFO',     600000.00, false),
      ('PROFE',      260300.00, false),
      ('PS',          62001.00, false),
      ('PULPO',         852.55, false),
      ('RAFA',       678800.82, false),
      ('RANGNAROK', -917501.48, true),
      ('RH',        -102033.90, true),
      ('ROBATAXI',   210045.46, true),
      ('RONALDO',   1251800.00, false),
      ('SANTOS',     200750.00, false),
      ('SHANGO',      54381.17, false),
      ('SIETE',         498.60, false),
      ('SUPERMAN',    91000.00, false),
      ('THOR',       -51980.00, true),
      ('TOYOTA',          3.00, false),
      ('TURCO',          44.87, false),
      ('VICKY',      -10500.00, true),
      ('WILMER',        100.00, false),
      ('YAIBER',        645.00, false),
      ('YARACUY',    291750.00, true),
      ('YAYAJU',      17402.00, false),
      ('YERSON',         75.00, false),
      ('YOLMER',     -12625.00, true),
      ('YOYO',        45749.99, true),
      ('YULI',        10140.00, false),
      ('ZEUS',       579974.06, false),
      ('ZORRO',     -199853.47, true)
  ) as l(nombre, saldo, libre),
       (select id from public.grupos_venta where upper(nombre) = 'MVP' limit 1) as mvp(id)
 where not exists (
   select 1 from public.clientes c
    where upper(c.nombre) = l.nombre
      and c.grupo_id = mvp.id
 );

commit;

-- ============================================================================
-- VERIFICACION (opcional): cuenta y saldo total del grupo MVP.
-- ============================================================================
-- select count(*) as clientes, sum(saldo_actual) as saldo_total
--   from public.clientes
--  where grupo_id = (select id from public.grupos_venta where upper(nombre) = 'MVP' limit 1);
