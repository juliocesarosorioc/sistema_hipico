-- ============================================================
-- FIX RLS — Inserción manual de Programa del Día y Resultados
-- ============================================================
-- Error observado en producción:
--   "new row violates row-level security policy for table
--    'programa_dia'"
--
-- Causa: `guardarPrograma()` en src/lib/gaceta/programa.ts usa la RPC
-- `club_guardar_programa_dia` y, si falla (p. ej. el bug de columna
-- ambigua 42702), cae a un `.upsert()` directo sobre `programa_dia`.
-- La tabla quedó con RLS ACTIVO en producción (aunque los scripts del
-- repo usaban `disable row level security`), y al no existir política
-- de insert, el upsert es rechazado por RLS. Lo mismo aplica a
-- `resultados_carreras` para la carga manual de carreras (Modo Manual).
--
-- Este script es idempotente: habilita SELECT/INSERT/UPDATE/DELETE
-- sobre `programa_dia` y `resultados_carreras` para los roles
-- anon + authenticated (los que usa el cliente web), manteniendo RLS
-- activo con una política "permitirlo todo" (equivalente al legacy
-- `grant all privileges ... to anon`).
-- ============================================================

-- 1) PROGRAMA DEL DÍA ---------------------------------------------------
alter table public.programa_dia enable row level security;

drop policy if exists "programa_dia_for_all_club" on public.programa_dia;
create policy "programa_dia_for_all_club"
    on public.programa_dia
    for all
    to anon, authenticated
    using (true)
    with check (true);

grant all privileges on table public.programa_dia to anon, authenticated, service_role;

-- 2) RESULTADOS DE CARRERAS ---------------------------------------------
alter table public.resultados_carreras enable row level security;

drop policy if exists "resultados_carreras_for_all_club" on public.resultados_carreras;
create policy "resultados_carreras_for_all_club"
    on public.resultados_carreras
    for all
    to anon, authenticated
    using (true)
    with check (true);

grant all privileges on table public.resultados_carreras to anon, authenticated, service_role;

-- 3) (Opcional) si se prefiere el comportamiento histórico del repo:
--    alter table public.programa_dia        disable row level security;
--    alter table public.resultados_carreras disable row level security;