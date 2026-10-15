-- ============================================================
--  PAGOS / INGRESOS Y EGRESOS / DATOS DEL CLIENTE (VZLA)
-- ============================================================
--  Ejecutar en Supabase -> SQL Editor (una sola vez).
--  Agrega:
--  1) clientes: email, cedula_rif, direccion, datos_pago (jsonb),
--     codigo_pais (telefono internacional)
--  2) notificaciones: avisos del portal del cliente (ej: pedido de
--     actualizacion de datos) que el administrador debe revisar
--  3) depositos (INGRESOS): modalidad, banco, referencia, moneda,
--     tasa_cambio y monto_usd
--  4) transacciones_financieras (EGRESOS/TRASLADOS): los anteriores +
--     numero_cuenta, tipo_cuenta, cedula_rif y nombre del BENEFICIARIO
--     cuando la plataforma es quien paga
-- ============================================================

-- 1) CLIENTES: DATOS DE CONTACTO Y PAGO -----------------------------
alter table public.clientes
    add column if not exists email          text,
    add column if not exists cedula_rif     text,
    add column if not exists direccion      text,
    add column if not exists codigo_pais    text not null default '+58',
    add column if not exists datos_pago     jsonb;   -- { banco, codigo, tipo_cuenta, numero_cuenta, titular } | { tipo_contacto, dato, ... }

-- 2) NOTIFICACIONES PARA EL ADMIN ------------------------------------
create table if not exists public.notificaciones (
    id            uuid primary key default gen_random_uuid(),
    tipo          text not null,                 -- 'portal_datos' | 'other'
    titulo        text not null,
    mensaje       text,
    cliente_id    uuid references public.clientes(id) on delete set null,
    cliente_nombre text,
    datos         jsonb,                          -- datos enviados por el cliente
    estado        text not null default 'Nueva',  -- Nueva | Aplicada | Ignorada
    atendida_por  text,
    created_at    timestamptz not null default now(),
    atendida_at   timestamptz
);

comment on table public.notificaciones is 'Avisos que genera el portal del cliente y debe atender el administrador';

create index if not exists idx_notificaciones_estado on public.notificaciones (estado, created_at desc);
create index if not exists idx_notificaciones_cliente on public.notificaciones (cliente_id);

-- Permisos (el modelo del sistema usa la llave anon en todas las tablas)
alter table public.notificaciones enable row level security;

create policy "notif_select" on public.notificaciones for select using (true);
create policy "notif_insert" on public.notificaciones for insert with check (true);
create policy "notif_update" on public.notificaciones for update using (true) with check (true);
create policy "notif_delete" on public.notificaciones for delete using (true);

grant select, insert, update, delete on public.notificaciones to anon, authenticated;

-- 3) DEPOSITOS (INGRESOS): REGISTRO COMPLETO --------------------------
alter table public.depositos
    add column if not exists modalidad    text,      -- EFECTIVO | ZELLE | BINANCE | PAGO MOVIL | TRANSFERENCIA | BANCO <nombre> | OTRO
    add column if not exists banco_id     uuid,
    add column if not exists banco_nombre text,
    add column if not exists banco_codigo text,
    add column if not exists referencia   text,
    add column if not exists moneda       text not null default 'USD',   -- USD | Bs
    add column if not exists tasa_cambio  numeric not null default 1,
    add column if not exists monto_usd    numeric;                       -- equivalencia en dolares

-- 4) TRANSACCIONES FINANCIERAS (EGRESOS / TRASLADOS) ------------------
alter table public.transacciones_financieras
    add column if not exists modalidad         text,   -- EFECTIVO | ZELLE | BINANCE | PAGO MOVIL | TRANSFERENCIA | BANCO <nombre> | OTRO
    add column if not exists banco_id          uuid,
    add column if not exists banco_nombre      text,
    add column if not exists banco_codigo      text,
    add column if not exists referencia        text,
    add column if not exists moneda            text not null default 'USD',
    add column if not exists tasa_cambio       numeric not null default 1,
    add column if not exists monto_usd         numeric,
    -- Datos del BENEFICIARIO cuando la plataforma ES QUIEN PAGA:
    add column if not exists numero_cuenta     text,
    add column if not exists tipo_cuenta       text,   -- CORRIENTE | AHORRO
    add column if not exists cedula_rif        text,
    add column if not exists nombre_beneficiario text;

-- VERIFICACION ---------------------------------------------------------
-- select nombre, email, cedula_rif, codigo_pais, datos_pago from public.clientes limit 5;
-- select * from public.notificaciones order by created_at desc limit 5;
-- select * from public.depositos order by fecha desc limit 5;
-- select * from public.transacciones_financieras order by fecha desc limit 5;