-- =============================================================================
-- TABLA Y VISTA DE CARGAS RÁPIDAS DE SALDO Y AVAL (AUDITORÍA Y TAREAS PENDIENTES)
-- =============================================================================
-- Permite registrar incrementos o ajustes de saldo (Colocar Aval, Sumar Aval,
-- Colocar Pozo, Sumar Pozo) sin comprobante obligatorio en el momento.
-- Queda registrado como tarea pendiente para que el operador anexe el soporte
-- o la administración verifique y concilie todos los incrementos.

create table if not exists public.cargas_rapidas_saldo (
    id                    text primary key,
    cliente_id            uuid not null references public.clientes(id) on delete cascade,
    cliente_nombre        text not null,
    grupo_id              uuid references public.grupos_venta(id) on delete set null,
    modalidad             text not null check (modalidad in ('COLOCAR_AVAL', 'SUMAR_AVAL', 'COLOCAR_POZO', 'SUMAR_POZO')),
    monto                 numeric(12,2) not null check (monto > 0),
    valor_anterior        numeric(12,2) not null default 0,
    valor_nuevo           numeric(12,2) not null default 0,
    campo_modificado      text not null check (campo_modificado in ('aval', 'saldo_actual')),
    operador              text not null default 'operador',
    fecha_creacion        timestamptz not null default now(),
    nota                  text default '',
    estado_soporte        text not null default 'PENDIENTE_SOPORTE' check (estado_soporte in ('PENDIENTE_SOPORTE', 'SOPORTE_ANEXADO', 'VERIFICADO_ADMIN')),
    comprobante_imagen    text,
    banco_nombre          text,
    referencia            text,
    fecha_soporte         timestamptz,
    anexado_por           text,
    verificado_por        text,
    fecha_verificacion    timestamptz,
    deposito_id           bigint references public.depositos(id) on delete set null,
    created_at            timestamptz not null default now(),
    updated_at            timestamptz not null default now()
);

-- Índices de consulta rápida
create index if not exists idx_cargas_rapidas_cliente on public.cargas_rapidas_saldo (cliente_id);
create index if not exists idx_cargas_rapidas_estado on public.cargas_rapidas_saldo (estado_soporte);
create index if not exists idx_cargas_rapidas_fecha on public.cargas_rapidas_saldo (fecha_creacion desc);

-- RLS
alter table public.cargas_rapidas_saldo enable row level security;

create policy "cargas_rapidas_select" on public.cargas_rapidas_saldo
    for select using (true);

create policy "cargas_rapidas_insert" on public.cargas_rapidas_saldo
    for insert with check (true);

create policy "cargas_rapidas_update" on public.cargas_rapidas_saldo
    for update using (true);
