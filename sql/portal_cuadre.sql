-- ============================================================
--  REGLAS DE TABLAS FIJAS + PORTAL DE CONSULTA DEL CLIENTE
-- ============================================================
--  Ejecutar en Supabase -> SQL Editor (una sola vez).
--  Agrega:
--  1) grupos_venta: responsable, cuenta_bancaria, moneda_cuadre
--  2) clientes: metodo_pago, dia_cuadre, forma_cuadre, tasa_cuadre,
--     portal_habilitado, portal_token (enlace corto), portal_clave (contrasena)
--  3) solicitudes_tablas: compras del portal pendientes de validacion
-- ============================================================

-- 1) GRUPOS: DATOS DEL RESPONSABLE Y CUADRE --------------------------
alter table public.grupos_venta
    add column if not exists responsable      text,
    add column if not exists cuenta_bancaria  text,
    add column if not exists moneda_cuadre    text not null default 'USD',
    add column if not exists comision_default numeric not null default 2.5;

comment on column public.grupos_venta.moneda_cuadre is 'Moneda en la que se cuadra (liquida) al grupo';
comment on column public.grupos_venta.comision_default is 'Comision estandar del grupo (2.5%) aplicada al monto decidido';

-- 2) CLIENTES: FORMA DE PAGO Y CUADRE SEMANAL ------------------------
alter table public.clientes
    add column if not exists metodo_pago        text,
    add column if not exists dia_cuadre         text,
    add column if not exists forma_cuadre       text,
    add column if not exists tasa_cuadre        numeric not null default 0,
    add column if not exists portal_habilitado  boolean not null default false,
    add column if not exists portal_token       text,
    add column if not exists portal_clave       text;

comment on column public.clientes.dia_cuadre  is 'Dia de la semana en que se cuadra con este cliente';
comment on column public.clientes.tasa_cuadre is 'Tasa con la que se cuadre semanalmente con el cliente';

create index if not exists idx_clientes_portal_token on public.clientes (portal_token);

-- 3) SOLICITUDES DE COMPRA DESDE EL PORTAL ----------------------------
create table if not exists public.solicitudes_tablas (
    id                  uuid primary key default gen_random_uuid(),
    cliente_id          uuid not null references public.clientes(id) on delete cascade,
    cliente_nombre      text not null,
    grupo_id            uuid references public.grupos_venta(id),
    grupo_nombre        text,
    tabla_id            uuid references public.tablas_fijas(id),
    hipodromo           text,
    carrera             int,
    ejemplar_numero     text,
    ejemplar_nombre     text,
    cantidad            int  not null default 1,
    pts_ejemplar        numeric,
    premio_por_tabla    numeric,
    comision_porcentaje numeric not null default 2.5,
    moneda              text not null default 'USD',
    tasa_cambio         numeric not null default 1,
    monto_total         numeric,
    costo_usd           numeric,
    recibo              text,                -- texto del recibo emitido al aprobar
    estado              text not null default 'Pendiente',  -- Pendiente | Aprobada | Rechazada
    atendida_por        text,
    created_at          timestamptz not null default now(),
    atendida_at         timestamptz
);

comment on table public.solicitudes_tablas is 'Compras de tablas fijas solicitadas desde el portal del cliente; requieren validacion del administrador';

-- Permisos (el modelo del sistema usa la llave anon en todas las tablas)
alter table public.solicitudes_tablas enable row level security;

create policy "solicitudes_select" on public.solicitudes_tablas for select using (true);
create policy "solicitudes_insert" on public.solicitudes_tablas for insert with check (true);
create policy "solicitudes_update" on public.solicitudes_tablas for update using (true) with check (true);
create policy "solicitudes_delete" on public.solicitudes_tablas for delete using (true);

grant select, insert, update, delete on public.solicitudes_tablas to anon, authenticated;

-- VERIFICACION ---------------------------------------------------------
-- select id, nombre, responsable, cuenta_bancaria, moneda_cuadre, comision_default from public.grupos_venta;
-- select nombre, metodo_pago, dia_cuadre, forma_cuadre, tasa_cuadre, portal_token, portal_clave from public.clientes limit 5;
-- select * from public.solicitudes_tablas order by created_at desc limit 5;