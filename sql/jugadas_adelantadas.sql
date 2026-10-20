-- ============================================================================
-- MODALIDAD DE TIEMPO DE LA JUGADA — ADELANTADA vs EN VIVO (PROMPT #4)
-- ----------------------------------------------------------------------------
-- PEGAR EN: Supabase → SQL Editor → New query → Run.
--
-- Hasta ahora TODAS las jugadas se asumían "en vivo" (se cargan mientras la
-- carrera está corriendo). Ahora una jugada puede ser ADELANTADA: se cargó ANTES
-- de que se corra la carrera (la parada adelantada de cobro de los clubes).
--
-- El dato se guarda como columna booleana `es_adelantada` en las tablas donde
-- nace la venta:
--
--   · tickets_apuestas → Taquilla/Puestos, Marcas, Tablas Fijas, Dupletas y
--     Remates (todas emiten un ticket normal).
--   · polla_ventas     → Pollas.
--
-- IMPORTANTE: NO se modifica ninguna RPC de venta. Los motores siguen llamando
-- a `club_vender_jugada`, `club_vender_marca`, `club_vender_dupleta`,
-- `club_vender_tabla`, `club_cerrar_remate` y `club_registrar_venta_polla` con
-- la MISMA firma; la marca se escribe DESPUÉS de la venta desde la app:
--
--   · tickets_apuestas → UPDATE directo (mismo camino que usa el Monitor de
--     Jugadas, cuya política `tickets_apuestas_monitor_update` ya habilita
--     UPDATE para `authenticated` con aislamiento por grupo/cliente).
--     Si esa política no estuviera instalada el UPDATE afecta 0 filas y la app
--     avisa con un toast de advertencia SIN romper la venta.
--
--   · polla_ventas → la tabla es de LECTURA para authenticated (la escritura
--     va siempre por RPC, criterio del propio pollas.sql), así que acá se agrega
--     una RPC chica SECURITY DEFINER que solo enciende/apaga el booleano.
--
-- Espejo: src/features/jugadas/lib/modalidad-tiempo.ts (lectura) y
-- src/features/jugadas/lib/marcar-adelantadas.ts (escritura).
-- ============================================================================

alter table public.tickets_apuestas
  add column if not exists es_adelantada boolean default false;

comment on column public.tickets_apuestas.es_adelantada is
  'Modalidad de tiempo de la jugada: true = ADELANTADA (cargada ANTES de correr la '
  'carrera), false/NULL = EN VIVO (comportamiento histórico, cargada durante la carrera).';

alter table public.polla_ventas
  add column if not exists es_adelantada boolean default false;

comment on column public.polla_ventas.es_adelantada is
  'Modalidad de tiempo de la venta de Polla: true = ADELANTADA, false/NULL = EN VIVO.';

-- ---------------------------------------------------------------------------
-- Índice parcial: los reportes filtran `es_adelantada = true` sobre pocas filas
-- de una jornada; el índice parcial lo mantiene minúsculo.
-- ---------------------------------------------------------------------------
create index if not exists tickets_apuestas_adelantadas_idx
  on public.tickets_apuestas (fecha, hipodromo, carrera)
  where es_adelantada;

-- ---------------------------------------------------------------------------
-- RPC para Pollas (única puerta de escritura de polla_ventas, igual que el
-- resto del módulo). SECURITY DEFINER porque `authenticated` solo tiene SELECT
-- sobre la tabla: sin esto el marcado afectaría 0 filas en silencio.
-- Solo enciende/apaga el booleano: no toca monto, premio ni acumulado.
-- ---------------------------------------------------------------------------
create or replace function public.club_marcar_adelantada_polla(
  p_venta_id uuid,
  p_adelantada boolean default true
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_venta_id is null then
    return;
  end if;

  update public.polla_ventas
     set es_adelantada = coalesce(p_adelantada, false)
   where id = p_venta_id;
end;
$$;

-- La llave anon del navegador no puede llamarla (solo enciende un booleano, pero
-- el criterio del repo es que la escritura sea de authenticated para arriba).
revoke all on function public.club_marcar_adelantada_polla(uuid, boolean) from public;
revoke all on function public.club_marcar_adelantada_polla(uuid, boolean) from anon;
grant execute on function public.club_marcar_adelantada_polla(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Listo. Verificación rápida que se puede correr en el SQL Editor:
--
--   select column_name from information_schema.columns
--    where table_name in ('tickets_apuestas', 'polla_ventas')
--      and column_name = 'es_adelantada';
--
-- Debe devolver 2 filas.
-- ---------------------------------------------------------------------------
