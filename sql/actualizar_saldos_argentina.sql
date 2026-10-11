-- ============================================================================
-- ARGENTINA — REGISTRO DE CLIENTES, SALDOS Y AVALES
-- ============================================================================
-- Ejecutar en Supabase -> SQL Editor.
--
-- OJO: `clientes.nombre` tiene una restriccion UNICA GLOBAL
-- (`clientes_nombre_key`). Un nombre solo puede existir UNA vez en la tabla,
-- aunque sea de otro grupo. Por eso este script:
--   1) actualiza a los que YA estan en el grupo ARGENTINA (idempotente);
--   2) da de alta SOLO los nombres que no existen en ningun grupo.
-- A quien ya existe en OTRO grupo NO lo toca (no lo mueve por su cuenta):
-- para eso esta la seccion 3, descomentable, con la lista explicita.
--
-- No borra filas ni cambia ids.
-- ============================================================================

begin;

-- Lista de referencia (nombre, saldo, aval) del grupo ARGENTINA.
-- Se repite en cada bloque porque en SQL un CTE no se reutiliza entre sentencias.

-- 1) Actualizar saldo y aval de los clientes que YA estan en ARGENTINA ------
update public.clientes c
   set saldo_actual = l.saldo,
       aval         = l.aval
  from (values
      ('AAA',                0.00,    0.00),
      ('ALBARRAN',           0.00,    0.00),
      ('ALBERTO',            0.00,    0.00),
      ('ANDERSON',           0.00,    0.00),
      ('ARELY',           2353.18, 2000.00),
      ('ARRAEZ',           -53.00,    0.00),
      ('AYARI',           2047.13, 2000.00),
      ('AZULES',             0.00,    0.00),
      ('BARAKI',             0.00,    0.00),
      ('BERSAREZ',        -262.50,    0.00),
      ('BG',               553.78,    0.00),
      ('CAMACHO',          260.00,  500.00),
      ('CASA',               0.00,    0.00),
      ('CHAVIER',            0.00,    0.00),
      ('CHINO',            -36.62,    0.00),
      ('CLUB',               0.00,    0.00),
      ('DERBY',              0.00,    0.00),
      ('DEVOLUCION',         0.00,    0.00),
      ('DEVOLUCIONES',       0.00,    0.00),
      ('DUARTE',             0.00,    0.00),
      ('EDDIE',             29.70,    0.00),
      ('EDDY',               0.00,    0.00),
      ('EVERY',             48.00,    0.00),
      ('FEDERICO',           0.00,    0.00),
      ('FORTUNA',        -2563.99,    0.00),
      ('GAETANO',          144.25,    0.00),
      ('GALICIA',            0.00,    0.00),
      ('GANADORES',          0.00,    0.00),
      ('GC',                 0.00,    0.00),
      ('GUAYANA',            0.00,    0.00),
      ('HEISBER',            0.00,    0.00),
      ('HOUSE',              0.00,    0.00),
      ('INFANTINO',          0.00,    0.00),
      ('INFILTRADO',         0.00,    0.00),
      ('JADE',               0.00,    0.00),
      ('JHONSON',            0.00,    0.00),
      ('JOSEGREGORIO',       0.00,    0.00),
      ('LAMINE',           478.50,  500.00),
      ('LARRY',            500.00,  500.00),
      ('LEGISA',             0.00,    0.00),
      ('LEYBA',            307.50,    0.00),
      ('LIVERPOOL',          0.00,    0.00),
      ('LOPEZ',              0.00,    0.00),
      ('MAKI',              12.50,    0.00),
      ('MANUEL',            42.75,    0.00),
      ('MARCAS Y TABLAS',    0.00,    0.00),
      ('MARCAS Y TABLAS SAM',0.00,    0.00),
      ('MEMPHIS',         -300.00,    0.00),
      ('NADAL',              0.00,    0.00),
      ('NEWCASTLE',          0.00,    0.00),
      ('PALMERA',            0.00,    0.00),
      ('PARTNER',         1569.05,    0.00),
      ('PH',               200.25,  200.00),
      ('PILOTO',             0.00,    0.00),
      ('POLAR',              0.00,    0.00),
      ('POLLA',              0.00,    0.00),
      ('POLLAS HIPICAS',     0.00,    0.00),
      ('PULMON',             0.00,    0.00),
      ('REMATE',             0.00,    0.00),
      ('ROCA',              46.53,    0.00),
      ('RUCIO',           1386.00, 2000.00),
      ('RUIJANO',            0.00,    0.00),
      ('RUSSO',           -333.25,    0.00),
      ('SAM',              -97.47,    0.00),
      ('SHAFLAN',         -300.00,    0.00),
      ('SOLDADO',         2000.00, 2000.00),
      ('SPEEDY',           132.80,    0.00),
      ('THOR',             254.00,    0.00),
      ('TICO',               0.00,    0.00),
      ('URIEL',            -69.17,    0.00),
      ('VALVERDE',        -166.75,    0.00)
  ) as l(nombre, saldo, aval)
 where upper(c.nombre) = l.nombre
   and c.grupo_id = (select id from public.grupos_venta where upper(nombre) = 'ARGENTINA' limit 1);

-- 2) Dar de alta los nombres que NO existen en ningun grupo -----------------
--    (evita el error 23505 `clientes_nombre_key` si el nombre ya esta en otro
--     grupo; esos quedan pendientes de la seccion 3).
insert into public.clientes
  (nombre, libre, saldo_actual, aval, comision, modo_juego, mostrar_saldo_socio, es_socio, grupo_id)
select l.nombre, false, l.saldo, l.aval, 0.00, 'aval', false, false,
       (select id from public.grupos_venta where upper(nombre) = 'ARGENTINA' limit 1)
  from (values
      ('AAA',                0.00,    0.00),
      ('ALBARRAN',           0.00,    0.00),
      ('ALBERTO',            0.00,    0.00),
      ('ANDERSON',           0.00,    0.00),
      ('ARELY',           2353.18, 2000.00),
      ('ARRAEZ',           -53.00,    0.00),
      ('AYARI',           2047.13, 2000.00),
      ('AZULES',             0.00,    0.00),
      ('BARAKI',             0.00,    0.00),
      ('BERSAREZ',        -262.50,    0.00),
      ('BG',               553.78,    0.00),
      ('CAMACHO',          260.00,  500.00),
      ('CASA',               0.00,    0.00),
      ('CHAVIER',            0.00,    0.00),
      ('CHINO',            -36.62,    0.00),
      ('CLUB',               0.00,    0.00),
      ('DERBY',              0.00,    0.00),
      ('DEVOLUCION',         0.00,    0.00),
      ('DEVOLUCIONES',       0.00,    0.00),
      ('DUARTE',             0.00,    0.00),
      ('EDDIE',             29.70,    0.00),
      ('EDDY',               0.00,    0.00),
      ('EVERY',             48.00,    0.00),
      ('FEDERICO',           0.00,    0.00),
      ('FORTUNA',        -2563.99,    0.00),
      ('GAETANO',          144.25,    0.00),
      ('GALICIA',            0.00,    0.00),
      ('GANADORES',          0.00,    0.00),
      ('GC',                 0.00,    0.00),
      ('GUAYANA',            0.00,    0.00),
      ('HEISBER',            0.00,    0.00),
      ('HOUSE',              0.00,    0.00),
      ('INFANTINO',          0.00,    0.00),
      ('INFILTRADO',         0.00,    0.00),
      ('JADE',               0.00,    0.00),
      ('JHONSON',            0.00,    0.00),
      ('JOSEGREGORIO',       0.00,    0.00),
      ('LAMINE',           478.50,  500.00),
      ('LARRY',            500.00,  500.00),
      ('LEGISA',             0.00,    0.00),
      ('LEYBA',            307.50,    0.00),
      ('LIVERPOOL',          0.00,    0.00),
      ('LOPEZ',              0.00,    0.00),
      ('MAKI',              12.50,    0.00),
      ('MANUEL',            42.75,    0.00),
      ('MARCAS Y TABLAS',    0.00,    0.00),
      ('MARCAS Y TABLAS SAM',0.00,    0.00),
      ('MEMPHIS',         -300.00,    0.00),
      ('NADAL',              0.00,    0.00),
      ('NEWCASTLE',          0.00,    0.00),
      ('PALMERA',            0.00,    0.00),
      ('PARTNER',         1569.05,    0.00),
      ('PH',               200.25,  200.00),
      ('PILOTO',             0.00,    0.00),
      ('POLAR',              0.00,    0.00),
      ('POLLA',              0.00,    0.00),
      ('POLLAS HIPICAS',     0.00,    0.00),
      ('PULMON',             0.00,    0.00),
      ('REMATE',             0.00,    0.00),
      ('ROCA',              46.53,    0.00),
      ('RUCIO',           1386.00, 2000.00),
      ('RUIJANO',            0.00,    0.00),
      ('RUSSO',           -333.25,    0.00),
      ('SAM',              -97.47,    0.00),
      ('SHAFLAN',         -300.00,    0.00),
      ('SOLDADO',         2000.00, 2000.00),
      ('SPEEDY',           132.80,    0.00),
      ('THOR',             254.00,    0.00),
      ('TICO',               0.00,    0.00),
      ('URIEL',            -69.17,    0.00),
      ('VALVERDE',        -166.75,    0.00)
  ) as l(nombre, saldo, aval)
 where not exists (select 1 from public.clientes c where upper(c.nombre) = l.nombre);

commit;

-- ============================================================================
-- 3) PENDIENTE / OPCIONAL — clientes que YA existen en OTRO grupo
-- ============================================================================
-- Por la restriccion UNICA GLOBAL `clientes_nombre_key`, estos 12 nombres no
-- pudieron insertarse en ARGENTINA porque ya existen en otro grupo:
--
--   En PRINCIPAL (11): ALBARRAN, AYARI, CAMACHO, CHAVIER, CHINO, CLUB,
--                      EDDIE, FEDERICO, FORTUNA, MANUEL, SAM
--   En MVP       (1):  THOR
--
-- Si esos clientes DEBEN quedar en ARGENTINA, descomenta y corre este bloque
-- (los MUEVE: cambia su grupo_id y pisa saldo/aval; el nombre sigue siendo
-- unico). Revisa antes sobre todo THOR, que hoy esta en MVP.
--
-- update public.clientes c
--    set grupo_id     = (select id from public.grupos_venta where upper(nombre) = 'ARGENTINA' limit 1),
--        saldo_actual = l.saldo,
--        aval         = l.aval
--   from (values
--      ('ALBARRAN', 0.00, 0.00),
--      ('AYARI',    2047.13, 2000.00),
--      ('CAMACHO',  260.00, 500.00),
--      ('CHAVIER',  0.00, 0.00),
--      ('CHINO',    -36.62, 0.00),
--      ('CLUB',     0.00, 0.00),
--      ('EDDIE',    29.70, 0.00),
--      ('FEDERICO', 0.00, 0.00),
--      ('FORTUNA', -2563.99, 0.00),
--      ('MANUEL',   42.75, 0.00),
--      ('SAM',     -97.47, 0.00),
--      ('THOR',    254.00, 0.00)
--   ) as l(nombre, saldo, aval)
--  where upper(c.nombre) = l.nombre;

-- ============================================================================
-- VERIFICACION (opcional): clientes y saldo total del grupo ARGENTINA.
-- ============================================================================
-- select count(*) as clientes, sum(saldo_actual) as saldo_total, sum(aval) as aval_total
--   from public.clientes
--  where grupo_id = (select id from public.grupos_venta where upper(nombre) = 'ARGENTINA' limit 1);
