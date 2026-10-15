-- ============================================================================
-- POLLAS: columna `grupo_id` (aislamiento por grupo)
-- ============================================================================
-- La tabla viva `pollas` quedó sin la columna `grupo_id` aunque el DDL de
-- sql/pollas.sql ya la declara (CREATE TABLE IF NOT EXISTS no agrega columnas
-- a una tabla existente). Sin esta columna, el filtro "ver un grupo" del super
-- administrador no puede acotar las pollas; la app se degrada a "lista
-- completa" hasta que corras este script.
--
-- Es IDEMPOTENTE: se puede correr varias veces.
--
-- Correr desde el SQL Editor de Supabase.
-- ============================================================================

alter table public.pollas
  add column if not exists grupo_id uuid
    references public.grupos_venta(id) on delete set null;

-- Índice para el filtro por grupo en los listados.
create index if not exists pollas_grupo_id_idx
  on public.pollas (grupo_id);

-- ---------------------------------------------------------------------------
-- VERIFICACIÓN (opcional):
--   select column_name from information_schema.columns
--    where table_schema = 'public' and table_name = 'pollas'
--      and column_name = 'grupo_id';
-- ---------------------------------------------------------------------------