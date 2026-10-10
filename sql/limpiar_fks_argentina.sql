-- ============================================================================
--  Limpiar dependencias de los clientes del grupo ARGENTINA
-- ============================================================================
--  Se ejecuta ANTES de `restaurar_clientes_argentina.sql` (que borra y
--  reinserta la cartera ARGENTINA). Este script NO borra clientes: solo las
--  filas que los referencian, para que el DELETE de `clientes` no choque con
--  una FK (23503).
--
--  IMPORTANTE: no se hardcodean nombres de tablas ni columnas. Se descubren
--  desde `pg_constraint` TODAS las claves foráneas que apuntan a
--  `public.clientes` y se borran las filas que referencian a un cliente del
--  grupo ARGENTINA. Así el script no vuelve a fallar por tablas/columnas que
--  no existen en la base viva:
--    · 42P01 "relation does not exist"   (p. ej. saldos_movimientos)
--    · 42703 "column does not exist"     (p. ej. cliente1_id)
--
--  Idempotente: se puede correr las veces que haga falta. Si una tabla no
--  tiene filas de ARGENTINA, el DELETE simplemente no hace nada.
--  Ejecutar en Supabase → SQL Editor.
-- ============================================================================
begin;

do $$
declare
  r    record;
  pass int;
begin
  -- Varias pasadas: si una tabla no se puede borrar todavía porque otra la
  -- referencia (dependencia indirecta), se reintenta en la pasada siguiente
  -- una vez que la hija ya quedó limpia. Cada statement va en su subtransacción
  -- (bloque exception) para que un fallo no aborte el script completo.
  for pass in 1..5 loop
    for r in
      select n.nspname as sch, c.relname as tbn, a.attname as col
      from pg_constraint con
      join pg_class c     on c.oid = con.conrelid
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = con.conrelid
                         and a.attnum = any (con.conkey)
      where con.contype = 'f'
        and con.confrelid = 'public.clientes'::regclass
    loop
      begin
        execute format(
          'delete from %I.%I where %I in (
             select cl.id
               from public.clientes cl
               join public.grupos_venta g on g.id = cl.grupo_id
              where upper(g.nombre) = upper(''ARGENTINA''))',
          r.sch, r.tbn, r.col
        );
      exception when others then
        -- Dependencia aún no liberada: se reintenta en la próxima pasada.
        null;
      end;
    end loop;
  end loop;
end $$;

commit;

-- ----------------------------------------------------------------------------
-- Verificación (opcional): referencias que aún queden a clientes ARGENTINA.
-- Debe dar 0 filas en todas las tablas antes de restaurar.
-- ----------------------------------------------------------------------------
-- select 'tickets_apuestas' as tabla, count(*) as pendientes
--   from public.tickets_apuestas t
--   join public.clientes c on c.id = t.cliente_juega_id
--   join public.grupos_venta g on g.id = c.grupo_id
--  where upper(g.nombre) = upper('ARGENTINA');
