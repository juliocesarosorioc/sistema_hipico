-- ============================================================
--  PLATAFORMA DE TABLAS FIJAS POR GRUPOS
-- ============================================================
--  Ejecutar en Supabase -> SQL Editor (una sola vez).
--  Agrega:
--   1) Tabla grupos_venta + grupo PRINCIPAL por defecto
--   2) clientes.grupo_id (cliente pertenece a un grupo)
--   3) tabla_grupos (inventario de cupos de cada tabla POR grupo)
-- ============================================================

-- 1) GRUPOS DE VENTA -------------------------------------------------
create table if not exists public.grupos_venta (
    id            uuid primary key default gen_random_uuid(),
    nombre        text not null unique,
    moneda        text not null default 'USD',          -- USD | VES
    es_principal  boolean not null default false,       -- el grupo dueño de la contabilidad
    cupo_tabla    int  not null default 100,            -- cupos que recibe cada tabla nueva
    activo        boolean not null default true,
    created_at    timestamptz not null default now()
);

-- Grupo principal por defecto (asegura que siempre exista uno)
insert into public.grupos_venta (nombre, moneda, es_principal, cupo_tabla)
select 'PRINCIPAL', 'USD', true, 100
where not exists (select 1 from public.grupos_venta where es_principal = true);

-- 2) CLIENTES PERTENECEN A UN GRUPO ----------------------------------
alter table public.clientes
    add column if not exists grupo_id uuid references public.grupos_venta(id);

-- Los clientes existentes van al grupo principal
update public.clientes
set grupo_id = (select id from public.grupos_venta where es_principal = true limit 1)
where grupo_id is null;

-- 3) INVENTARIO DE CUPOS POR TABLA Y POR GRUPO -----------------------
create table if not exists public.tabla_grupos (
    id               uuid primary key default gen_random_uuid(),
    tabla_id         uuid not null references public.tablas_fijas(id) on delete cascade,
    grupo_id         uuid not null references public.grupos_venta(id) on delete cascade,
    cupos            int not null default 100,          -- cupos asignados a ese grupo para esa tabla
    cantidad_vendida int not null default 0,
    unique (tabla_id, grupo_id)
);

-- 3.5) VALORES CONGELADOS EN EL TICKET DE VENTA -----------------------
-- El premio y el PTS del ejemplar se guardan al momento de vender, para que
-- modificar la tabla despu�s NO cambie lo que se vendi� antes.
alter table public.tickets_apuestas
    add column if not exists premio_por_tabla numeric,   -- premio pactado en la compra
    add column if not exists pts_ejemplar numeric;       -- PTS del ejemplar vendido

-- MIGRACIÓN OPCIONAL: tablas ya publicadas -> crear inventario en su grupo
-- (se asigna al grupo cuyo nombre coincide con grupo_venta; si no, al principal)
insert into public.tabla_grupos (tabla_id, grupo_id, cupos, cantidad_vendida)
select
    t.id,
    coalesce(g.id, (select id from public.grupos_venta where es_principal = true limit 1)),
    t.limite_ventas,
    t.cantidad_vendida
from public.tablas_fijas t
left join public.grupos_venta g on upper(g.nombre) = upper(t.grupo_venta)
where not exists (select 1 from public.tabla_grupos tg where tg.tabla_id = t.id);

-- VERIFICACIÓN ---------------------------------------------------------
-- select * from public.grupos_venta;
-- select c.nombre, g.nombre as grupo from public.clientes c
--   left join public.grupos_venta g on g.id = c.grupo_id order by g.nombre;