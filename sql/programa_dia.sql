-- ============================================================
-- PROGRAMA DEL DÍA (compartido entre módulos)
-- Tabla única por fecha con el hipódromo(s) y las carreras que
-- se cargaron desde la Gaceta/Ensamblaje. Taquilla, Venta de
-- Tablas, Liquidación y W.P.S. la leen para precargar.
-- ============================================================
create table if not exists public.programa_dia (
    id          uuid primary key default gen_random_uuid(),
    fecha       date not null default current_date,
    hipodromos  text[] not null default '{}',
    carreras    jsonb not null default '[]',
    resumen     text not null default '',
    creado_por  text,
    updated_at  timestamptz not null default now(),
    constraint  programa_dia_fecha_unico unique (fecha)
);

-- La app trabaja con la anon key (sin auth): se desactiva RLS y se
-- entregan permisos para que cualquier operador lea/escriba.
alter table public.programa_dia disable row level security;
grant all privileges on table public.programa_dia to anon, authenticated, service_role;