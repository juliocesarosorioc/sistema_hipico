-- ============================================================
--  PAQUETE FINAL: PENDIENTES DE INFRAESTRUCTURA (ejecutar UNA vez)
-- ============================================================
--  Combina (en orden seguro) los scripts que faltaban:
--    1) columnas_faltantes  -> clientes.telefono/comision/socio_asignado
--    2) tasas_referencia    -> historial de tasas BCV/Binance/EURO con fecha
--    3) seguridad           -> tabla auditoria + RPC club_log_accion + RLS
--    4) limpieza_auditoria  -> RPC club_limpiar_auditoria (borra >N dias)
--
--  TODO es idempotente (if not exists / create or replace), así que si
--  el SQL Editor revierte todo por un error, corrige y pega de nuevo.
--  Verificación sugerida después de correrlo:
--     select public.club_limpiar_auditoria(30);
--  (borra auditoría con más de 30 días y devuelve cuántas filas borró)
-- ============================================================

-- ============================================================
-- (1) COLUMNAS FALTANTES EN CLIENTES
-- ============================================================
ALTER TABLE public.clientes
    ADD COLUMN IF NOT EXISTS telefono            TEXT,
    ADD COLUMN IF NOT EXISTS comision            NUMERIC NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS socio_asignado      TEXT,
    ADD COLUMN IF NOT EXISTS mostrar_saldo_socio BOOLEAN NOT NULL DEFAULT false;

-- ============================================================
-- (2) TASAS DE REFERENCIA CON FECHA DE APLICACION
-- ============================================================
create table if not exists public.tasas_referencia (
    id             uuid primary key default gen_random_uuid(),
    tipo           text not null,             -- 'BCV' | 'BINANCE' | 'EURO'
    tasa           numeric not null,          -- Bs por 1 unidad
    fecha_aplicar  date not null,             -- fecha en que debe tomarse
    created_at     timestamptz not null default now()
);

create index if not exists idx_tasas_ref_tipo_fecha
    on public.tasas_referencia (tipo, fecha_aplicar desc);

comment on table public.tasas_referencia is
    'Historial de tasas de referencia: BCV, Binance y EURO con su fecha de aplicacion';

-- ============================================================
-- (3) SEGURIDAD Y AUDITORIA (tabla + RPC SECURITY DEFINER)
-- ============================================================
create table if not exists public.auditoria (
    id       bigint generated always as identity primary key,
    fecha    timestamptz not null default now(),
    usuario  text not null default 'anon',
    modulo   text not null,
    accion   text not null,
    ip       text,
    navegador text,
    ubicacion text
);

create index if not exists idx_auditoria_fecha on public.auditoria (fecha desc);
create index if not exists idx_auditoria_modulo on public.auditoria (modulo);

-- Funcion segura de escritura (la app SIEMPRE loguea por aqui)
create or replace function public.club_log_accion(
    p_usuario text,
    p_modulo text,
    p_accion text,
    p_ip text default null,
    p_navegador text default null,
    p_ubicacion text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.auditoria (usuario, modulo, accion, ip, navegador, ubicacion)
    values (left(coalesce(p_usuario, 'anon'), 80), left(p_modulo, 40), left(p_accion, 300),
            left(p_ip, 45), left(p_navegador, 300), left(p_ubicacion, 120));
end;
$$;

-- RLS: anon NO inserta ni lee directo; solo via la RPC
alter table public.auditoria enable row level security;

drop policy if exists "anon_insert_bloqueado" on public.auditoria;
create policy "anon_insert_bloqueado" on public.auditoria
    for insert to anon with check (false);

drop policy if exists "anon_read_temporal" on public.auditoria;
create policy "anon_read_temporal" on public.auditoria
    for select to anon using (true);

revoke all on public.auditoria from anon;
grant execute on function public.club_log_accion(text, text, text, text, text, text) to anon;

-- ============================================================
-- (4) LIMPIEZA DE AUDITORIA (RPC segura)
-- ============================================================
create or replace function public.club_limpiar_auditoria(p_dias integer default 30)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_borrados integer;
begin
    if p_dias is null or p_dias < 1 then
        return 0;
    end if;

    delete from public.auditoria
    where fecha < now() - (p_dias || ' days')::interval;

    get diagnostics v_borrados = row_count;
    return v_borrados;
end;
$$;

revoke all on function public.club_limpiar_auditoria(integer) from anon;
grant execute on function public.club_limpiar_auditoria(integer) to anon;