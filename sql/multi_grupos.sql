-- ============================================================
--  CLIENTE EN VARIOS GRUPOS + RETIROS POR DEFECTO
-- ============================================================
--  Ejecutar en Supabase -> SQL Editor (idempotente, puede correrse
--  junto con el resto del paquete).
--  Agrega:
--   1) tabla clientes_grupos (un cliente puede pertenecer a VARIOS grupos)
--   2) backfill: los clientes actuales se registran como miembros en su
--      grupo principal (clientes.grupo_id -> clientes_grupos)
--   3) tablas_fijas.retirados_oficiales pasa a tener como valor por defecto
--      'NO HUBO RETIROS' (los datos viejos con 'Ninguno' se normalizan)
-- ============================================================

-- 1) PERTENENCIA MULTI-GRUPO ------------------------------------------
create table if not exists public.clientes_grupos (
    id            uuid primary key default gen_random_uuid(),
    cliente_id    uuid not null references public.clientes(id) on delete cascade,
    grupo_id      uuid not null references public.grupos_venta(id) on delete cascade,
    es_principal  boolean not null default false,  -- se marca el grupo principal del cliente
    activo        boolean not null default true,
    created_at    timestamptz not null default now(),
    unique (cliente_id, grupo_id)
);

comment on table public.clientes_grupos is
    'Un cliente puede pertenecer a varios grupos de venta; el grupo principal es clientes.grupo_id (es_principal=true)';

create index if not exists idx_clientes_grupos_cliente on public.clientes_grupos (cliente_id);
create index if not exists idx_clientes_grupos_grupo   on public.clientes_grupos (grupo_id);

-- Permisos (mismo modelo de la llave anon que usa el sistema)
alter table public.clientes_grupos enable row level security;

create policy "clientes_grupos_select" on public.clientes_grupos for select using (true);
create policy "clientes_grupos_insert" on public.clientes_grupos for insert with check (true);
create policy "clientes_grupos_update" on public.clientes_grupos for update using (true) with check (true);
create policy "clientes_grupos_delete" on public.clientes_grupos for delete using (true);

grant select, insert, update, delete on public.clientes_grupos to anon, authenticated;

-- 2) BACKFILL: clientes actuales -> su grupo principal ------------------
insert into public.clientes_grupos (cliente_id, grupo_id, es_principal)
select c.id, c.grupo_id, true
from public.clientes c
where c.grupo_id is not null
on conflict (cliente_id, grupo_id) do nothing;

-- Los clientes SIN grupo quedan en el grupo principal por defecto
update public.clientes c
set grupo_id = (select g.id from public.grupos_venta g where g.es_principal = true limit 1)
where c.grupo_id is null;

-- 3) RETIROS POR DEFECTO EN TABLAS FIJAS --------------------------------
alter table public.tablas_fijas
    add column if not exists retirados_oficiales text not null default 'NO HUBO RETIROS';

comment on column public.tablas_fijas.retirados_oficiales is
    'Ejemplares retirados de la carrera separados por coma (ej: "2,5") o "NO HUBO RETIROS" como valor por defecto';

-- Normaliza los registros viejos ('Ninguno'/'') al nuevo valor por defecto
update public.tablas_fijas
set retirados_oficiales = 'NO HUBO RETIROS'
where retirados_oficiales is null
   or trim(retirados_oficiales) = ''
   or upper(trim(retirados_oficiales)) in ('NINGUNO', 'NINGUNA', 'NONE');

-- VERIFICACION -----------------------------------------------------------
-- select c.nombre, count(*) as grupos from public.clientes_grupos cg
--   join public.clientes c on c.id = cg.cliente_id
--   group by c.nombre order by grupos desc;