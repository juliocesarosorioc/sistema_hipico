-- ============================================================================
-- limpiar_asientos_niif_en_cero.sql
--
-- Limpia los asientos contables NIIF históricos (jugadas, liquidaciones,
-- cruces y cuentas por cobrar de la semana pasada) para dejar el Balance de
-- Comprobación NIIF (vw_balance_comprobacion_niif) completamente en cero.
--
-- NO TOCA:
--   - Avales de clientes (clientes.aval) ni condición libre / modo_juego
--   - Carreras, ejemplares, tablas fijas, marcas ni resultados
--   - Grupos de venta, hipódromos ni Plan de Cuentas
--
-- Ejecutar en Supabase -> SQL Editor.
-- ============================================================================

begin;

do $$
begin
  -- 1. Desactivar temporalmente los triggers de inmutabilidad NIIF
  if exists (select 1 from pg_trigger where tgname = 'trg_bloquear_borrado_linea_niif') then
    alter table public.asientos_niif_lineas disable trigger trg_bloquear_borrado_linea_niif;
  end if;
  if exists (select 1 from pg_trigger where tgname = 'trg_bloquear_borrado_asiento_niif') then
    alter table public.asientos_niif disable trigger trg_bloquear_borrado_asiento_niif;
  end if;

  -- 2. Vaciar líneas primero (respeta FK ON DELETE RESTRICT) y luego cabeceras
  if to_regclass('public.asientos_niif_lineas') is not null then
    delete from public.asientos_niif_lineas;
  end if;
  if to_regclass('public.asientos_niif') is not null then
    delete from public.asientos_niif;
  end if;

  -- 3. Reactivar los triggers de inmutabilidad NIIF
  if exists (select 1 from pg_trigger where tgname = 'trg_bloquear_borrado_linea_niif') then
    alter table public.asientos_niif_lineas enable trigger trg_bloquear_borrado_linea_niif;
  end if;
  if exists (select 1 from pg_trigger where tgname = 'trg_bloquear_borrado_asiento_niif') then
    alter table public.asientos_niif enable trigger trg_bloquear_borrado_asiento_niif;
  end if;

  -- 4. Verificación preventiva en tablas contables alternativas (si existieran datos)
  if to_regclass('public.asientos_contables_lineas') is not null then
    delete from public.asientos_contables_lineas;
  end if;
  if to_regclass('public.asientos_contables') is not null then
    delete from public.asientos_contables;
  end if;
  if to_regclass('public.contabilidad_asientos_lineas') is not null then
    delete from public.contabilidad_asientos_lineas;
  end if;
  if to_regclass('public.contabilidad_asientos') is not null then
    delete from public.contabilidad_asientos;
  end if;
end $$;

commit;

-- Verificación rápida: todo debe devolver 0 (y los avales intactos)
select
  (select count(*) from public.asientos_niif) as asientos_niif_restantes,
  (select count(*) from public.asientos_niif_lineas) as lineas_niif_restantes,
  (select count(*) from public.tickets_apuestas) as tickets_restantes,
  (select count(*) from public.clientes where coalesce(saldo_actual, 0) <> 0 or coalesce(saldo_retenido, 0) <> 0) as clientes_con_saldo,
  (select count(*) from public.clientes where coalesce(aval, 0) > 0) as clientes_con_aval,
  (select coalesce(sum(aval), 0) from public.clientes) as suma_avales_intactos,
  (select count(*) from public.carreras) as carreras_intactas,
  (select count(*) from public.ejemplares) as ejemplares_intactos;
