-- ============================================================================
-- MVP — CARGA / ACTUALIZACION DE CLIENTES Y SALDOS
-- ============================================================================
-- Ejecutar en Supabase -> SQL Editor.
--
-- Fuente: reporte de WhatsApp «MVP FUSION» — Belmont Park, 1era — 15-10-2026.
-- Deja la cartera del grupo MVP con los 75 clientes y saldos del listado.
-- Es IDEMPOTENTE y NO destructivo:
--   · a quien YA esta en MVP (por nombre, sin importar mayusculas) le
--     actualiza `saldo_actual` y `libre`;
--   · a quien NO esta todavia lo da de alta en MVP en modo "aval".
-- No borra filas ni cambia ids: los tickets, jugadas y liquidaciones que ya
-- apuntan a un cliente siguen enlazados a la misma fila. Los clientes de MVP
-- que NO aparecen en esta lista quedan intactos.
--
-- `libre = true` corresponde a los clientes marcados con OK (✅) en el listado;
-- los marcados con ⚠️ quedan `libre = false`.
--
-- Chequeo del listado: 75 clientes · 66 con saldo > 0 ·
--   9 con saldo < 0 · suma de saldos = 7951690.15
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
      ('ADOLFO',             412.50, false),
      ('ALAMBRE',          41250.00, false),
      ('AR',                  60.00, false),
      ('ARDILLA',          24462.00, false),
      ('AREVALO',         250000.00, false),
      ('ARRSIETE',           501.25, false),
      ('BEBE',              9975.00, true),
      ('BENELLI',          39000.00, true),
      ('BORREGO',         250000.00, false),
      ('CARACAZO',         29902.56, false),
      ('CARS',            -18500.00, true),
      ('CH',               29691.40, false),
      ('CHEO',             43941.37, false),
      ('CHIRE',             3275.00, true),
      ('COMISIONADO',          0.50, false),
      ('DELTA',           200000.00, false),
      ('DINERO',          180000.00, false),
      ('DODORIA',          50000.00, false),
      ('DOM',            -415645.96, true),
      ('ECUADOR',         109275.00, false),
      ('ENGER',           536500.00, false),
      ('FABIANA',         245340.00, true),
      ('FABIO',             6390.00, false),
      ('GALLETA',          22425.00, false),
      ('GAMES',          -159700.00, true),
      ('GOOD',              8823.85, false),
      ('GRANPRIX',            50.00, false),
      ('GRINGO',             210.00, false),
      ('GUASON',           44253.83, false),
      ('GUAYANA',          11637.50, true),
      ('HADES',           -17500.00, true),
      ('HOUSTON',          65150.00, false),
      ('INFANTE',         240200.00, false),
      ('ITALO',              855.00, false),
      ('JALEN',            14250.00, true),
      ('JESSICA',         -12026.25, true),
      ('JJ',              186200.00, true),
      ('KAWASAKI',          -139.08, false),
      ('KK',               39425.81, true),
      ('KOREA',            10005.80, false),
      ('MAESTRO',          58600.00, true),
      ('MAGALLANES',      413931.34, false),
      ('MATHIA',           53430.00, false),
      ('MIGUELON',         40000.00, false),
      ('MONEY',               50.00, false),
      ('MOSTAZA',         195000.00, false),
      ('MUDIN',           188127.19, false),
      ('NEWYORK',         207200.00, false),
      ('PAIZITA',         250937.50, false),
      ('PARCERO',         494637.50, false),
      ('PARIS',            10091.25, false),
      ('PARLEYS',         150000.00, false),
      ('PELON',          -320402.50, true),
      ('PETER',           200000.00, false),
      ('PROFE',           200000.00, false),
      ('PS',               93707.50, false),
      ('RAFA',            740100.00, false),
      ('RANGNAROK',       131000.00, true),
      ('RH',             -124650.00, true),
      ('ROBATAXI',         27809.46, true),
      ('RONALDO',         996500.00, false),
      ('SANCHEZ',          29100.00, false),
      ('SANTOS',          200000.00, false),
      ('SARIEL',           94598.80, true),
      ('SHANGO',              72.50, false),
      ('TURCO',            50000.00, false),
      ('WISKY',            79653.75, false),
      ('YAIBER',             177.56, false),
      ('YARACUY',         171743.50, true),
      ('YAYAJU',           74669.72, false),
      ('YERSON',             503.00, false),
      ('YOLMER',            2750.00, true),
      ('YOYO',             -1000.00, true),
      ('YULI',             24250.00, true),
      ('ZEUS',           1149150.00, false)
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
      ('ADOLFO',             412.50, false),
      ('ALAMBRE',          41250.00, false),
      ('AR',                  60.00, false),
      ('ARDILLA',          24462.00, false),
      ('AREVALO',         250000.00, false),
      ('ARRSIETE',           501.25, false),
      ('BEBE',              9975.00, true),
      ('BENELLI',          39000.00, true),
      ('BORREGO',         250000.00, false),
      ('CARACAZO',         29902.56, false),
      ('CARS',            -18500.00, true),
      ('CH',               29691.40, false),
      ('CHEO',             43941.37, false),
      ('CHIRE',             3275.00, true),
      ('COMISIONADO',          0.50, false),
      ('DELTA',           200000.00, false),
      ('DINERO',          180000.00, false),
      ('DODORIA',          50000.00, false),
      ('DOM',            -415645.96, true),
      ('ECUADOR',         109275.00, false),
      ('ENGER',           536500.00, false),
      ('FABIANA',         245340.00, true),
      ('FABIO',             6390.00, false),
      ('GALLETA',          22425.00, false),
      ('GAMES',          -159700.00, true),
      ('GOOD',              8823.85, false),
      ('GRANPRIX',            50.00, false),
      ('GRINGO',             210.00, false),
      ('GUASON',           44253.83, false),
      ('GUAYANA',          11637.50, true),
      ('HADES',           -17500.00, true),
      ('HOUSTON',          65150.00, false),
      ('INFANTE',         240200.00, false),
      ('ITALO',              855.00, false),
      ('JALEN',            14250.00, true),
      ('JESSICA',         -12026.25, true),
      ('JJ',              186200.00, true),
      ('KAWASAKI',          -139.08, false),
      ('KK',               39425.81, true),
      ('KOREA',            10005.80, false),
      ('MAESTRO',          58600.00, true),
      ('MAGALLANES',      413931.34, false),
      ('MATHIA',           53430.00, false),
      ('MIGUELON',         40000.00, false),
      ('MONEY',               50.00, false),
      ('MOSTAZA',         195000.00, false),
      ('MUDIN',           188127.19, false),
      ('NEWYORK',         207200.00, false),
      ('PAIZITA',         250937.50, false),
      ('PARCERO',         494637.50, false),
      ('PARIS',            10091.25, false),
      ('PARLEYS',         150000.00, false),
      ('PELON',          -320402.50, true),
      ('PETER',           200000.00, false),
      ('PROFE',           200000.00, false),
      ('PS',               93707.50, false),
      ('RAFA',            740100.00, false),
      ('RANGNAROK',       131000.00, true),
      ('RH',             -124650.00, true),
      ('ROBATAXI',         27809.46, true),
      ('RONALDO',         996500.00, false),
      ('SANCHEZ',          29100.00, false),
      ('SANTOS',          200000.00, false),
      ('SARIEL',           94598.80, true),
      ('SHANGO',              72.50, false),
      ('TURCO',            50000.00, false),
      ('WISKY',            79653.75, false),
      ('YAIBER',             177.56, false),
      ('YARACUY',         171743.50, true),
      ('YAYAJU',           74669.72, false),
      ('YERSON',             503.00, false),
      ('YOLMER',            2750.00, true),
      ('YOYO',             -1000.00, true),
      ('YULI',             24250.00, true),
      ('ZEUS',           1149150.00, false)
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
