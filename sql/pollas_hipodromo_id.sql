-- ============================================================================
-- POLLAS: columnas que faltan en la tabla viva
--   (`hipodromo_id`, `grupo_id`, `notas` y los premios por % `premio_*_pct`)
--   + la columna VIEJA `hipodromo` (texto) que impedía crear Pollas.
-- ============================================================================
-- ERRORES QUE ARREGLA
-- -------------------
--   1) column "hipodromo_id" of relation "pollas" does not exist
--   2) null value in column "hipodromo" of relation "pollas" violates not-null
--      constraint
--
-- POR QUE PASA
-- ------------
-- `sql/pollas.sql` declara la tabla con `CREATE TABLE IF NOT EXISTS`: si la tabla
-- `pollas` YA existía (creada por una versión anterior, sin `hipodromo_id`),
-- Postgres no agrega la columna y el INSERT de `club_guardar_polla` falla al
-- guardar/crear una Polla. Lo mismo pasa con las columnas nuevas de premios por
-- porcentaje (`premio_1o_pct`, `premio_2o_pct`, `premio_3o_pct`).
--
-- La versión vieja de la tabla además tenía `hipodromo` (TEXTO, NOT NULL) — el
-- nombre del hipódromo — porque todavía no existía `hipodromo_id` (uuid). El RPC
-- nuevo escribe `hipodromo_id` y NO el texto, así que el INSERT moría con:
--   null value in column "hipodromo" of relation "pollas" violates not-null
-- La app ya no lee ese texto (usa `hipodromo_id`), pero la columna seguía
-- obligando. Acá se le quita el NOT NULL y se rellena donde falte.
--
-- QUE HACE
--   · Agrega las columnas que falten (idempotente).
--   · Reconstruye `hipodromo_id` desde `pollas.carreras` (el nombre del hipódromo
--     del primer elemento) cuando todavía está en NULL, para no dejar las Pollas
--     viejas sin vínculo.
--   · Si la columna vieja `hipodromo` (texto) existe, le quita el NOT NULL y la
--     rellena (desde el catálogo por `hipodromo_id` o desde la 1ª carrera).
--
-- IDEMPOTENTE: se puede correr las veces que haga falta.
-- Ejecutar en el SQL Editor de Supabase.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) Columnas que faltan
-- ---------------------------------------------------------------------------
alter table public.pollas
  add column if not exists hipodromo_id   uuid references public.hipodromos(id),
  add column if not exists grupo_id       uuid references public.grupos_venta(id),
  add column if not exists notas          text,
  add column if not exists premio_1o_pct  numeric,
  add column if not exists premio_2o_pct  numeric,
  add column if not exists premio_3o_pct  numeric;

-- ---------------------------------------------------------------------------
-- 2) Backfill del hipódromo (uuid) desde la primera carrera guardada (si falta)
-- ---------------------------------------------------------------------------
update public.pollas p
   set hipodromo_id = h.id
  from public.hipodromos h
 where p.hipodromo_id is null
   and jsonb_typeof(p.carreras) = 'array'
   and jsonb_array_length(p.carreras) > 0
   and upper(btrim(h.nombre)) = upper(btrim(p.carreras->0->>'hipodromo'));

-- ---------------------------------------------------------------------------
-- 2bis) Columna vieja `hipodromo` (TEXTO, NOT NULL): quitarle el NOT NULL
--
-- Es la causa del error "null value in column hipodromo ... violates not-null
-- constraint" al crear una Polla. Se hace con SQL dinámico porque en las bases
-- nuevas la columna NO existe y un `alter`/`update` estático rompería el script.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'pollas'
       and column_name  = 'hipodromo'
  ) then
    execute 'alter table public.pollas alter column hipodromo drop not null';
    -- Relleno para las filas viejas: el nombre del catálogo por id o el de la 1ª
    -- carrera. Las nuevas quedan en blanco; la app lee `hipodromo_id`.
    execute $relleno$
      update public.pollas p
         set hipodromo = coalesce(
               (select h.nombre from public.hipodromos h where h.id = p.hipodromo_id),
               nullif(btrim(p.carreras->0->>'hipodromo'), ''),
               'SIN HIPODROMO'
             )
       where p.hipodromo is null
    $relleno$;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3) Índices
-- ---------------------------------------------------------------------------
create index if not exists pollas_hipodromo_id_idx on public.pollas (hipodromo_id);
create index if not exists pollas_grupo_id_idx     on public.pollas (grupo_id);

commit;

-- ---------------------------------------------------------------------------
-- 4) Verificación
-- ---------------------------------------------------------------------------
select column_name, is_nullable
  from information_schema.columns
 where table_schema = 'public'
   and table_name   = 'pollas'
   and column_name in (
     'hipodromo', 'hipodromo_id', 'grupo_id', 'notas',
     'premio_1o_pct', 'premio_2o_pct', 'premio_3o_pct'
   )
 order by column_name;

-- Cuántas Pollas siguen sin hipódromo (el nombre guardado no matcheó el catálogo):
--   select id, nombre, carreras->0->>'hipodromo' as hipodromo_guardado
--     from public.pollas where hipodromo_id is null;
-- ============================================================================
