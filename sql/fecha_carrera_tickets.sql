-- ============================================================================
--  FECHA DE CARRERA en `tickets_apuestas` — "no puede haber jugada sin fecha"
-- ============================================================================
--  Contexto / problema
--  -------------------
--  Los RPC de venta (taquilla, tablas fijas, marcas, dupleta, remates) guardan
--  la fecha de la CARRERA dentro de `nota_auditoria.fecha_carrera`; la columna
--  `fecha_registro` es el momento de la VENTA, no la fecha de la carrera.
--
--  La migración legacy de W/P/S (`migrar-wps-tickets.sql`) NO escribía
--  `fecha_carrera`: esas jugadas quedaron "sin fecha" para el monitor de
--  jugadas y los reportes, que leen la fecha de ahí.
--
--  Qué hace este script
--  --------------------
--   1) agrega la columna `fecha_carrera date` a `tickets_apuestas`,
--   2) backfillea la columna desde `nota_auditoria.fecha_carrera`,
--   3) completa `nota_auditoria.fecha_carrera` en las filas heredadas (el
--      monitor y los reportes siguen leyendo del JSON), usando
--      `fecha_registro::date` como fecha real de la jugada,
--   4) crea un trigger que garantiza que TODA fila nueva o actualizada quede
--      con `fecha_carrera` sí o sí (primero la del JSON, si no la de
--      `fecha_registro`).
--
--  Idempotente: se puede correr de nuevo sin romper nada.
--  Ejecutar en Supabase → SQL Editor.
-- ============================================================================

-- 1) Columna
alter table public.tickets_apuestas
    add column if not exists fecha_carrera date;

-- 2) Columna ← JSON (las ventas vigentes ya traen la fecha de carrera ahí)
update public.tickets_apuestas t
   set fecha_carrera = case
         when t.nota_auditoria ~ '^\s*[\{\[]'
          then (t.nota_auditoria::jsonb ->> 'fecha_carrera')::date
       end
 where t.fecha_carrera is null
   and case when t.nota_auditoria ~ '^\s*[\{\[]'
            then (t.nota_auditoria::jsonb ->> 'fecha_carrera')::date
       end is not null;

-- 3) JSON ← fecha_registro en las heredadas sin fecha de carrera (WPS_LEGACY,
--    marcas viejas, etc.). Así monitor y reportes las muestran con fecha.
update public.tickets_apuestas t
   set nota_auditoria = (t.nota_auditoria::jsonb ||
                         jsonb_build_object('fecha_carrera', t.fecha_registro::date))::text
 where t.fecha_carrera is null
   and t.nota_auditoria ~ '^\s*[\{\[]'
   and (t.nota_auditoria::jsonb ->> 'fecha_carrera') is null;

-- 3b) Último recurso: filas cuyo `nota_auditoria` ni siquiera es JSON.
update public.tickets_apuestas t
   set fecha_carrera = t.fecha_registro::date
 where t.fecha_carrera is null;

-- 4) Garantía de aquí en adelante: ninguna fila nueva/actualizada puede quedar
--    sin fecha de carrera.
create or replace function public.trg_tickets_fecha_carrera()
returns trigger
language plpgsql
as $$
begin
    new.fecha_carrera := case
        when new.nota_auditoria ~ '^\s*[\{\[]'
         and (new.nota_auditoria::jsonb ->> 'fecha_carrera') is not null
            then (new.nota_auditoria::jsonb ->> 'fecha_carrera')::date
        else coalesce(new.fecha_carrera, new.fecha_registro::date)
    end;
    return new;
end;
$$;

drop trigger if exists trg_tickets_fecha_carrera on public.tickets_apuestas;
create trigger trg_tickets_fecha_carrera
    before insert or update of nota_auditoria, fecha_registro
    on public.tickets_apuestas
    for each row
    execute function public.trg_tickets_fecha_carrera();