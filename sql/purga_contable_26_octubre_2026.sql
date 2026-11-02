-- ============================================================================
-- purga_contable_26_octubre_2026.sql
-- 
-- Elimina todo registro contable financiero y de jugadas del 26-10-2026 hacia atrás
-- (incluido el 26).
--
-- Conserva intacto:
--   ✅ Jugadas y tickets de la semana activa (29-10-2026 al 01-11-2026)
--   ✅ Asientos contables NIIF de la semana activa (29-10-2026 al 01-11-2026)
--   ✅ Perfiles de clientes, saldos, avales y grupos
-- ============================================================================

begin;

do $$
begin
  -- 1. Desactivar los triggers específicos de inmutabilidad (sin tocar triggers del sistema)
  if exists (select 1 from pg_trigger where tgname = 'trg_bloquear_borrado_asiento_niif') then
    alter table public.asientos_niif disable trigger trg_bloquear_borrado_asiento_niif;
  end if;
  if exists (select 1 from pg_trigger where tgname = 'trg_bloquear_borrado_linea_niif') then
    alter table public.asientos_niif_lineas disable trigger trg_bloquear_borrado_linea_niif;
  end if;

  -- 2. Eliminar líneas de asientos NIIF <= 2026-10-26 (primero las líneas hijas para respetar FK)
  if to_regclass('public.asientos_niif_lineas') is not null and to_regclass('public.asientos_niif') is not null then
    delete from public.asientos_niif_lineas
     where asiento_id in (
       select id from public.asientos_niif where fecha <= '2026-10-26'::date
     );
  end if;

  -- 3. Eliminar cabeceras de asientos NIIF <= 2026-10-26
  if to_regclass('public.asientos_niif') is not null then
    delete from public.asientos_niif where fecha <= '2026-10-26'::date;
  end if;

  -- 4. Reactivar los triggers de inmutabilidad
  if exists (select 1 from pg_trigger where tgname = 'trg_bloquear_borrado_asiento_niif') then
    alter table public.asientos_niif enable trigger trg_bloquear_borrado_asiento_niif;
  end if;
  if exists (select 1 from pg_trigger where tgname = 'trg_bloquear_borrado_linea_niif') then
    alter table public.asientos_niif_lineas enable trigger trg_bloquear_borrado_linea_niif;
  end if;

  -- 5. Purgar contabilidad_asientos alternativa si existe
  if to_regclass('public.contabilidad_asientos_lineas') is not null and to_regclass('public.contabilidad_asientos') is not null then
    delete from public.contabilidad_asientos_lineas
     where asiento_id in (
       select id from public.contabilidad_asientos where fecha_contable::text <= '2026-10-26'
     );
    delete from public.contabilidad_asientos where fecha_contable::text <= '2026-10-26';
  end if;

  -- 6. Garantizar que tickets y jugadas <= 2026-10-26 queden en cero
  if to_regclass('public.tickets_apuestas') is not null then
    delete from public.tickets_apuestas
     where coalesce(fecha_carrera::date, fecha_registro::date) <= '2026-10-26'::date;
  end if;

  if to_regclass('public.tickets_jugadas') is not null then
    delete from public.tickets_jugadas
     where coalesce(fecha_jugada::date, creado_at::date) <= '2026-10-26'::date;
  end if;

  if to_regclass('public.carreras') is not null then
    delete from public.carreras where fecha <= '2026-10-26'::date;
  end if;

  if to_regclass('public.resultados_carreras') is not null then
    delete from public.resultados_carreras where fecha <= '2026-10-26'::date;
  end if;
end $$;

commit;
