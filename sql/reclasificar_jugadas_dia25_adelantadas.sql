-- ============================================================================
-- sql/reclasificar_jugadas_dia25_adelantadas.sql
-- ----------------------------------------------------------------------------
-- PEGAR EN: Supabase -> SQL Editor -> New query -> Run.
--
-- QUE HACE (y QUE NO HACE)
-- ------------------------
-- Pedido del club: las jugadas cargadas para el DIA 25 que TODAVIA NO ESTAN
-- LIQUIDADAS deben quedar marcadas como ADELANTADAS.
--
--   · SI: marcar `es_adelantada = true` en las jugadas del 25 que siguen
--     'Pendiente' (sin resultado asignado), tanto en `tickets_apuestas` como en
--     `polla_ventas` (si la tabla existe).
--   · NO: no se toca ningun saldo (`clientes.saldo_actual` / `aval`).
--   · NO: no se borra ninguna fila (ni anuladas ni de ningun otro tipo).
--   · NO: no se tocan las jugadas ya liquidadas (estado <> 'Pendiente'),
--     porque reclasificarlas reabriria cierres y cambiaria comisiones de
--     liquidaciones ya emitidas.
--
-- SEGURIDAD / REVERSA
-- -------------------
-- Antes de modificar nada, este script guarda un RESPALDO de las filas que va a
-- tocar en las tablas `_respaldo_adelantadas_*`. Si algo sale mal, se revierte
-- con los UPDATE al pie del archivo.
--
-- Idempotente: se puede correr varias veces. La segunda vez ya no encuentra
-- filas 'Pendiente' sin marcar y no cambia nada.
--
-- VERIFICAR
-- ---------
--   select count(*) from public.tickets_apuestas
--    where es_adelantada
--      and extract(day from coalesce(
--            fecha_carrera,
--            nullif(nota_auditoria::jsonb ->> 'fecha_carrera', '')::date)) = 25;
--
--   select count(*) from public._respaldo_adelantadas_tickets;
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0) Fecha objetivo: el DIA 25 de cualquier mes/anio, segun interpretacion
--    acordada ("todas las del dia 25"). Si en cambio querrias SOLO un 25
--    concreto, reemplaza la condicion por:
--        t.fecha_carrera = date '2026-10-25'
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1) RESPALDO de los tickets que se van a marcar (una foto ANTES de tocar).
-- ---------------------------------------------------------------------------
create table if not exists public._respaldo_adelantadas_tickets (
    ticket_id        bigint primary key,
    es_adelantada    boolean,
    respaldado_at    timestamptz not null default now()
);

insert into public._respaldo_adelantadas_tickets (ticket_id, es_adelantada)
select t.id, t.es_adelantada
  from public.tickets_apuestas t
 where coalesce(t.anulada, false) = false
   and t.estado = 'Pendiente'
   and coalesce(
         t.fecha_carrera,
         case when t.nota_auditoria ~ '^\s*[\{\[]'
              then nullif(t.nota_auditoria::jsonb ->> 'fecha_carrera', '')::date
          end
       ) is not null
   and extract(day from coalesce(
         t.fecha_carrera,
         case when t.nota_auditoria ~ '^\s*[\{\[]'
              then nullif(t.nota_auditoria::jsonb ->> 'fecha_carrera', '')::date
          end
       )) = 25
   and coalesce(t.es_adelantada, false) = false
on conflict (ticket_id) do nothing;

-- ---------------------------------------------------------------------------
-- 2) MARCAR como adelantadas las jugadas del 25 sin liquidar.
--    `estado = 'Pendiente'` = sin resultado asignado (no liquidada).
--    La fecha se resuelve por la columna `fecha_carrera` y, si faltara, por el
--    `nota_auditoria.fecha_carrera` (mismo criterio que usa la app), así ninguna
--    jugada del 25 se queda sin marcar por venir de una fila heredada.
-- ---------------------------------------------------------------------------
update public.tickets_apuestas t
   set es_adelantada = true
 where coalesce(t.anulada, false) = false
   and t.estado = 'Pendiente'
   and coalesce(
         t.fecha_carrera,
         case when t.nota_auditoria ~ '^\s*[\{\[]'
              then nullif(t.nota_auditoria::jsonb ->> 'fecha_carrera', '')::date
          end
       ) is not null
   and extract(day from coalesce(
         t.fecha_carrera,
         case when t.nota_auditoria ~ '^\s*[\{\[]'
              then nullif(t.nota_auditoria::jsonb ->> 'fecha_carrera', '')::date
          end
       )) = 25
   and coalesce(t.es_adelantada, false) = false;

-- ---------------------------------------------------------------------------
-- 3) Pollas: mismo criterio, pero SOLO si las columnas/tabla existen.
--    `polla_ventas` no tiene `fecha_carrera` (usa `fecha_registro`) ni un flag
--    de "liquidada" propio: se toma como adelantada la venta del 25 cuya
--    `es_adelantada` aun es false. Se guarda respaldo igual.
-- ---------------------------------------------------------------------------
do $$
begin
    if exists (
        select 1 from information_schema.tables
         where table_schema = 'public' and table_name = 'polla_ventas'
    ) and exists (
        select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'polla_ventas'
           and column_name = 'es_adelantada'
    ) then

        create table if not exists public._respaldo_adelantadas_pollas (
            venta_id      uuid primary key,
            es_adelantada boolean,
            respaldado_at timestamptz not null default now()
        );

        insert into public._respaldo_adelantadas_pollas (venta_id, es_adelantada)
        select v.id, v.es_adelantada
          from public.polla_ventas v
         where v.fecha_registro is not null
           and extract(day from v.fecha_registro) = 25
           and coalesce(v.es_adelantada, false) = false
        on conflict (venta_id) do nothing;

        update public.polla_ventas v
           set es_adelantada = true
         where v.fecha_registro is not null
           and extract(day from v.fecha_registro) = 25
           and coalesce(v.es_adelantada, false) = false;
    end if;
end $$;

commit;

-- ============================================================================
-- REVERSA (solo si hace falta deshacer TODO lo de arriba).
-- Descomentar y correr en una consulta aparte.
-- ============================================================================
-- begin;
--   update public.tickets_apuestas t
--      set es_adelantada = r.es_adelantada
--     from public._respaldo_adelantadas_tickets r
--    where t.id = r.ticket_id;
--
--   do $$
--   begin
--       if exists (select 1 from information_schema.tables
--                   where table_schema='public' and table_name='_respaldo_adelantadas_pollas') then
--           update public.polla_ventas v
--              set es_adelantada = r.es_adelantada
--             from public._respaldo_adelantadas_pollas r
--            where v.id = r.venta_id;
--       end if;
--   end $$;
-- commit;

-- ============================================================================
-- LIMPIEZA de los respaldos (recien cuando ya confirmaste que todo cuadra).
-- ============================================================================
-- drop table if exists public._respaldo_adelantadas_tickets;
-- drop table if exists public._respaldo_adelantadas_pollas;
