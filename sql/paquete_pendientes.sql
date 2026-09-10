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
-- (0) SEUDONIMO, APELLIDO Y MODO DE JUEGO EN CLIENTES
--     seudonimo: alias obligatorio para operar (crear clientes)
--     apellido:  es opcional junto al nombre real
--     modo_juego: 'aval' (limite) | 'libre' | 'pozo' (abona primero)
-- ============================================================
ALTER TABLE public.clientes
    ADD COLUMN IF NOT EXISTS seudonimo  TEXT,
    ADD COLUMN IF NOT EXISTS apellido   TEXT,
    ADD COLUMN IF NOT EXISTS modo_juego TEXT NOT NULL DEFAULT 'aval';

-- Espalda: los clientes existentes heredan su nombre como seudonimo
UPDATE public.clientes
   SET seudonimo = nombre
 WHERE seudonimo IS NULL OR seudonimo = '';

-- Espalda: los que jugaban libre mantienen su modo; el resto queda 'aval'
UPDATE public.clientes
   SET modo_juego = 'libre'
 WHERE libre = true AND modo_juego = 'aval';

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

-- ============================================================
-- (5) PADRON DE EJEMPLARES + DISTANCIA Y SUPERFICIE EN TABLAS FIJAS
--     Base para la futura herramienta de estadisticas de ejemplares
--     de Venezuela: el nombre NO se repite; si hay homonimos, se
--     desambigua por NACIONALIDAD (ej: 'DUKE' (VE) vs 'DUKE' (USA)).
--     Al ensamblar una tabla fija se vincula el ejemplar (ejemplar_id)
--     y se guarda su valor en la tabla (valor_ejemplar).
-- ============================================================
create table if not exists public.ejemplares (
    id            uuid primary key default gen_random_uuid(),
    nombre        text not null,
    nacionalidad  text not null default 'VE',
    created_at    timestamptz not null default now()
);

create unique index if not exists uq_ejemplares_nombre_nac
    on public.ejemplares (lower(nombre), upper(nacionalidad));

comment on table public.ejemplares is
    'Padron de ejemplares: nombre unico por nacionalidad (base de estadisticas)';

comment on column public.ejemplares.nombre is 'Nombre oficial del ejemplar (unico por nacionalidad)';
comment on column public.ejemplares.nacionalidad is 'Pais de origen del ejemplar: VE, USA, BR, AR, etc.';

alter table public.tablas_fijas
    add column if not exists distancia_carrera numeric,
    add column if not exists superficie      text;

comment on column public.tablas_fijas.distancia_carrera is 'Distancia de la carrera en metros (ej: 1100, 1300, 1600)';
comment on column public.tablas_fijas.superficie is 'Superficie de la pista: ARENA, FANGO, CESPED, TAPETA, etc.';

-- ============================================================
-- (6) HISTORIAL DE GACETAS PROCESADAS POR IA
--     Guarda el resultado de la transcripción (JSON) cuando se
--     convierte la gaceta hípica en carreras a cargar. Sirve de
--     memoria para la futura herramienta de estadísticas.
-- ============================================================
create table if not exists public.gaceta_procesada (
    id            uuid primary key default gen_random_uuid(),
    fecha_gaceta  date,
    num_carreras  int not null default 0,
    contenido     jsonb not null,               -- carreras extraidas: [{carrera, hipodromo, distancia, superficie, premio, ejemplares:[{numero,nombre,nacionalidad,pts}]}]
    creado_por    text,
    created_at    timestamptz not null default now()
);

create index if not exists idx_gaceta_procesada_fecha on public.gaceta_procesada (fecha_gaceta desc);

comment on table public.gaceta_procesada is
    'Historial de transcripciones de la gaceta hípica realizadas con IA';

comment on column public.gaceta_procesada.contenido is
    'JSON con las carreras y ejemplares extraidos de la gaceta por la IA';