-- ============================================================================
-- POLLAS: columnas que faltan en la tabla viva (`hipodromo_id`, `grupo_id`, `notas`)
-- ============================================================================
-- ERROR QUE ARREGLA
-- ---------------
--   column "hipodromo_id" of relation "pollas" does not exist
--
-- POR QUE PASA
-- ------------
-- `sql/pollas.sql` declara la tabla con `CREATE TABLE IF NOT EXISTS`: si la tabla
-- `pollas` YA existía (creada por una versión anterior, sin `hipodromo_id`),
-- Postgres no agrega la columna y el INSERT de `club_guardar_polla` falla al
-- guardar/crear una Polla.
--
-- QUE HACE
--   · Agrega las columnas que falten (idempotente).
--   · Reconstruye `hipodromo_id` desde `pollas.carreras` (el nombre del hipódromo
--     del primer elemento) cuando todavía está en NULL, para no dejar las Pollas
--     viejas sin vínculo.
--
-- IDEMPOTENTE: se puede correr las veces que haga falta.
-- Ejecutar en el SQL Editor de Supabase.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) Columnas que faltan
-- ---------------------------------------------------------------------------
alter table public.pollas
  add column if not exists hipodromo_id uuid references public.hipodromos(id),
  add column if not exists grupo_id     uuid references public.grupos_venta(id),
  add column if not exists notas        text;

-- ---------------------------------------------------------------------------
-- 2) Backfill del hipódromo desde la primera carrera guardada (si falta)
-- ---------------------------------------------------------------------------
update public.pollas p
   set hipodromo_id = h.id
  from public.hipodromos h
 where p.hipodromo_id is null
   and jsonb_typeof(p.carreras) = 'array'
   and jsonb_array_length(p.carreras) > 0
   and upper(btrim(h.nombre)) = upper(btrim(p.carreras->0->>'hipodromo'));

-- ---------------------------------------------------------------------------
-- 3) Índices
-- ---------------------------------------------------------------------------
create index if not exists pollas_hipodromo_id_idx on public.pollas (hipodromo_id);
create index if not exists pollas_grupo_id_idx     on public.pollas (grupo_id);

commit;

-- ---------------------------------------------------------------------------
-- 4) Verificación
-- ---------------------------------------------------------------------------
select column_name
  from information_schema.columns
 where table_schema = 'public'
   and table_name   = 'pollas'
   and column_name in ('hipodromo_id', 'grupo_id', 'notas')
 order by column_name;

-- Cuántas Pollas siguen sin hipódromo (el nombre guardado no matcheó el catálogo):
--   select id, nombre, carreras->0->>'hipodromo' as hipodromo_guardado
--     from public.pollas where hipodromo_id is null;
-- ============================================================================
