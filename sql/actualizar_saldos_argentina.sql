-- ============================================================================
-- ARGENTINA — REGISTRO DE CLIENTES, SALDOS Y AVALES  (+ regla de nombre)
-- ============================================================================
-- Ejecutar en Supabase -> SQL Editor. Es IDEMPOTENTE.
--
-- Hace tres cosas:
--   PASO 0  Permite que un MISMO NOMBRE exista en GRUPOS DISTINTOS:
--           quita la restriccion unica global `clientes_nombre_key` y deja
--           unicidad POR GRUPO (grupo_id, nombre). Asi "THOR" puede estar en
--           MVP y en ARGENTINA como dos clientes diferentes.
--   PASO 1  Mueve a ARGENTINA los 11 clientes que hoy estan mal ubicados en
--           PRINCIPAL (y les pone saldo/aval de la lista).
--   PASO 2  Da de alta en ARGENTINA los nombres que faltan (incluye THOR).
--
-- No borra filas ni cambia ids. PRINCIPAL queda con los 5 clientes de prueba
-- que NO son de ARGENTINA (ver el final del archivo).
-- ============================================================================

begin;

-- ============================================================================
-- PASO 0 — Unicidad POR GRUPO en vez de global
-- ============================================================================
-- `clientes_nombre_key` puede ser una constraint o un indice unico; se cubren
-- las dos formas para que no falle.
do $$
begin
  if exists (
    select 1
      from pg_constraint
     where conname = 'clientes_nombre_key'
       and conrelid = 'public.clientes'::regclass
  ) then
    alter table public.clientes drop constraint clientes_nombre_key;
  end if;

  if exists (
    select 1 from pg_indexes
     where schemaname = 'public'
       and tablename  = 'clientes'
       and indexname  = 'clientes_nombre_key'
  ) then
    execute 'drop index public.clientes_nombre_key';
  end if;
end
$$;

-- Mismo nombre permitido entre grupos; dentro del grupo no se repite.
create unique index if not exists uq_clientes_grupo_nombre
  on public.clientes (grupo_id, nombre);

-- ============================================================================
-- PASO 1 — Mover a ARGENTINA los 11 mal ubicados en PRINCIPAL
-- ============================================================================
update public.clientes c
   set grupo_id     = (select id from public.grupos_venta where upper(nombre) = 'ARGENTINA' limit 1),
       saldo_actual = l.saldo,
       aval         = l.aval
  from (values
      ('ALBARRAN',           0.00,    0.00),
      ('AYARI',           2047.13, 2000.00),
      ('CAMACHO',          260.00,  500.00),
      ('CHAVIER',            0.00,    0.00),
      ('CHINO',            -36.62,    0.00),
      ('CLUB',               0.00,    0.00),
      ('EDDIE',             29.70,    0.00),
      ('FEDERICO',           0.00,    0.00),
      ('FORTUNA',        -2563.99,    0.00),
      ('MANUEL',            42.75,    0.00),
      ('SAM',              -97.47,    0.00)
  ) as l(nombre, saldo, aval)
 where upper(c.nombre) = l.nombre
   and c.grupo_id = (select id from public.grupos_venta where upper(nombre) = 'PRINCIPAL' limit 1);

-- Su pertenencia en clientes_grupos tambien pasa a ARGENTINA (PRINCIPAL limpio).
update public.clientes_grupos cg
   set grupo_id     = (select id from public.grupos_venta where upper(nombre) = 'ARGENTINA' limit 1),
       es_principal = true
  from public.clientes c
 where c.id = cg.cliente_id
   and upper(c.nombre) in
       ('ALBARRAN','AYARI','CAMACHO','CHAVIER','CHINO','CLUB',
        'EDDIE','FEDERICO','FORTUNA','MANUEL','SAM');

-- ============================================================================
-- PASO 2 — Dar de alta en ARGENTINA los que faltan (incluye THOR)
-- ============================================================================
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
 where not exists (
   select 1 from public.clientes c
    where upper(c.nombre) = l.nombre
      and c.grupo_id = (select id from public.grupos_venta where upper(nombre) = 'ARGENTINA' limit 1)
 );

commit;

-- ============================================================================
-- PRINCIPAL queda con estos 5 clientes (NO son de ARGENTINA):
--   ANGELO SERGIO TOPETTA ARANA, FORTUNA 2 PRUEBA,
--   JULIO CESAR OSORIO CABRERA, MARISELA, PRIUEBA 1 PUREBA 1
-- Pasan a estar "sueltos" si se quiere dejar PRINCIPAL sin clientes:
-- decidir si se mueven a un grupo o se eliminan.
-- ============================================================================

-- ============================================================================
-- VERIFICACION (opcional)
-- ============================================================================
-- select g.nombre, count(*), sum(c.saldo_actual) as saldo, sum(c.aval) as aval
--   from public.clientes c join public.grupos_venta g on g.id = c.grupo_id
--  group by g.nombre order by g.nombre;
