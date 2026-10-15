-- ============================================================
--  RESET TOTAL DE HIPÓDROMOS
--  1) Garantiza esquema (pais, estado) y permisos del rol anon
--  2) BORRA TODOS los hipódromos existentes
--  3) Crea de una sola vez la lista completa:
--     Venezuela (4) + Estados Unidos (18)  [22 pistas]
--
--  Copiar y pegar TODO este bloque en el SQL Editor de Supabase y ejecutar.
-- ============================================================

-- ---------- 1) ESQUEMA + PERMISOS ----------
alter table public.hipodromos
    add column if not exists pais   text not null default 'OTRO',
    add column if not exists estado text not null default 'Activo';

-- Permisos para que la app lea/escriba sin RLS
alter table public.hipodromos disable row level security;
grant usage on schema public to anon;
grant select, insert, update, delete on table public.hipodromos to anon;

-- ---------- 2) BORRAR TODO ----------
delete from public.hipodromos;

-- ---------- 3) CREAR TODO EN UNA SOLA VEZ ----------
insert into public.hipodromos (nombre, pais) values
    -- VENEZUELA
    ('La Rinconada', 'VE'),
    ('Valencia', 'VE'),
    ('Hipódromo Nacional de Santa Rita', 'VE'),
    ('La Pomona', 'VE'),
    -- ESTADOS UNIDOS
    ('Aqueduct', 'USA'),
    ('Belmont Park', 'USA'),
    ('Charles Town', 'USA'),
    ('Churchill Downs', 'USA'),
    ('Del Mar', 'USA'),
    ('Fair Grounds', 'USA'),
    ('Finger Lakes', 'USA'),
    ('Golden Gate Fields', 'USA'),
    ('Gulfstream Park', 'USA'),
    ('Keeneland', 'USA'),
    ('Laurel Park', 'USA'),
    ('Los Alamitos', 'USA'),
    ('Monmouth Park', 'USA'),
    ('Oaklawn Park', 'USA'),
    ('Pimlico', 'USA'),
    ('Santa Anita', 'USA'),
    ('Saratoga', 'USA'),
    ('Tampa Bay Downs', 'USA');

-- Verificación: debe listar 22 hipódromos en orden alfabético
--   select nombre, pais from public.hipodromos order by nombre;