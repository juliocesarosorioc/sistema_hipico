-- ============================================================================
-- fechas_asiento_y_movimiento_contabilidad.sql
--
-- Agrega y asegura las columnas:
--  - fecha_asiento: fecha colocada manualmente por el operador para reflejar
--    cuándo realizó la operación contable.
--  - fecha_movimiento: fecha interna del sistema para reflejar cuándo se
--    realizó en la plataforma (timestamp real de auditoría).
-- En tablas: depositos, transacciones, contabilidad_asientos y movimientos_operador.
-- ============================================================================

begin;

-- 1. depositos (Ingresos de clientes)
alter table public.depositos
  add column if not exists fecha_asiento date default current_date,
  add column if not exists fecha_movimiento timestamptz default now();

update public.depositos
   set fecha_asiento = coalesce(fecha_asiento, fecha::date, current_date),
       fecha_movimiento = coalesce(fecha_movimiento, created_at, now())
 where fecha_asiento is null or fecha_movimiento is null;

-- 2. transacciones (Caja, Retiros y Traslados)
alter table public.transacciones
  add column if not exists fecha_asiento date default current_date,
  add column if not exists fecha_movimiento timestamptz default now();

update public.transacciones
   set fecha_asiento = coalesce(fecha_asiento, fecha::date, current_date),
       fecha_movimiento = coalesce(fecha_movimiento, created_at, now())
 where fecha_asiento is null or fecha_movimiento is null;

-- 3. contabilidad_asientos (NIIF / Partida Doble)
alter table public.contabilidad_asientos
  add column if not exists fecha_asiento date default current_date,
  add column if not exists fecha_movimiento timestamptz default now();

update public.contabilidad_asientos
   set fecha_asiento = coalesce(fecha_asiento, fecha_contable, current_date),
       fecha_movimiento = coalesce(fecha_movimiento, fecha_hora_registro, created_at, now())
 where fecha_asiento is null or fecha_movimiento is null;

-- 4. movimientos_operador (Instrucciones de Dueño / Operador)
alter table public.movimientos_operador
  add column if not exists fecha_asiento date default current_date,
  add column if not exists fecha_movimiento timestamptz default now();

update public.movimientos_operador
   set fecha_asiento = coalesce(fecha_asiento, fecha_creacion::date, current_date),
       fecha_movimiento = coalesce(fecha_movimiento, fecha_creacion, now())
 where fecha_asiento is null or fecha_movimiento is null;

commit;
