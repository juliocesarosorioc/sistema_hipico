-- ============================================================
--  PAQUETE FINAL: PENDIENTES DE INFRAESTRUCTURA
-- ============================================================
--  Combina (en orden seguro) los scripts que faltaban:
--    1) columnas_faltantes  -> clientes.telefono/comision/socio_asignado
--    2) tasas_referencia    -> historial de tasas BCV/Binance/EURO con fecha
--    3) seguridad           -> tabla auditoria + RPC club_log_accion + RLS
--    4) limpieza_auditoria  -> RPC club_limpiar_auditoria (borra >N dias)
--    5) grupos_venta        -> permisos del rol anon (0 errores 401/403)
--    6) gaceta_procesada    -> historial de transcripciones de la gaceta IA
--    7) permisos globales   -> RLS apagado + grants al rol anon (TODAS las tablas)
--    8) hipodromos/jugadas  -> columnas de calculo + siembra de hipodromos VE/USA
--
--  IMPORTANTE: ejecute SIEMPRE el archivo COMPLETO (no solo un fragmento).
--  TODO es idempotente (if not exists / create or replace / DO con fallos
--  aislados), así que puede pegarlo y ejecutarlo nuevamente las veces que
--  quiera sin romper nada: completa columnas, permisos y siembra que falten.
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

-- ============================================================
-- (7) PERMISOS DE LA APP CON EL ROL ANON (evita errores 401/403)
--     La app funciona 100% con la anon key (sin autenticación).
--     Si alguna tabla quedó con RLS activado desde el dashboard
--     (p.ej. grupos_venta), el anon no puede insertar/leer y
--     Supabase responde 401. Aquí se normaliza TODO el esquema:
--     RLS desactivado + privilegios concedidos al rol anon.
-- ============================================================
do $$
declare
    t text;
begin
    for t in
        select tablename from pg_tables
        where schemaname = 'public'
    loop
        -- auditoria se trata aparte: solo lectura para anon (escrituras via club_log_accion)
        if t = 'auditoria' then
            continue;
        end if;
        execute format('alter table public.%I disable row level security', t);
        execute format('grant select, insert, update, delete on table public.%I to anon', t);
    end loop;
end;
$$;

grant usage on schema public to anon;

-- auditoría: el anon SOLO lee (el insert queda vedado; las escrituras van por club_log_accion)
alter table public.auditoria enable row level security;
drop policy if exists "anon_read_temporal" on public.auditoria;
create policy "anon_read_temporal" on public.auditoria
    for select to anon using (true);
revoke all on public.auditoria from anon;
grant select on table public.auditoria to anon;

-- VERIFICACIÓN (debe devolver filas):
--   select * from public.auditoria order by fecha desc limit 5;

-- ============================================================
-- (8) HIPÓDROMOS Y JUGADAS: ESQUEMA + SIEMBRA AUTOMÁTICA
--     - hipodromos: se agrega 'pais' y se siembran TODOS los
--       hipódromos de Venezuela y EE.UU. (orden alfabético en la
--       app es automático: Order By nombre).
--     - tipos_jugadas: se agregan columnas de cálculo y se
--       siembran las jugadas estándar (idempotente: no duplica).
--     La app los muestra ordenados alfabéticamente por nombre.
-- ============================================================

-- ---- hipodromos: esquema mínimo garantizado ----
create table if not exists public.hipodromos (
    id             bigint generated by default as identity primary key,
    nombre         text not null,
    estado         text not null default 'Activo',
    fecha_creacion timestamptz not null default now(),
    pais           text not null default 'OTRO'
);

alter table public.hipodromos
    add column if not exists pais text not null default 'OTRO',
    add column if not exists estado text not null default 'Activo';

-- ---- Siembra: HIPÓDROMOS DE VENEZUELA ----
do $$
begin
    insert into public.hipodromos (nombre, pais)
    select v.nombre, v.pais
    from (values
        ('La Rinconada', 'VE'),
        ('Valencia', 'VE'),
        ('Hipódromo Nacional de Santa Rita', 'VE'),
        ('La Pomona', 'VE')
    ) as v(nombre, pais)
    where not exists (
        select 1 from public.hipodromos h
        where lower(h.nombre) = lower(v.nombre)
    );
exception when others then
    raise notice 'No se pudo sembrar hipodromos de VE: %', sqlerrm;
end;
$$;

-- ---- Siembra: HIPÓDROMOS DE ESTADOS UNIDOS ----
do $$
begin
    insert into public.hipodromos (nombre, pais)
    select v.nombre, v.pais
    from (values
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
        ('Tampa Bay Downs', 'USA')
    ) as v(nombre, pais)
    where not exists (
        select 1 from public.hipodromos h
        where lower(h.nombre) = lower(v.nombre)
    );
exception when others then
    raise notice 'No se pudo sembrar hipodromos de USA: %', sqlerrm;
end;
$$;

-- ---- tipos_jugadas: esquema mínimo garantizado + columnas de cálculo ----
create table if not exists public.tipos_jugadas (
    id                   bigint generated by default as identity primary key,
    nombre               text not null,
    base_comision        text not null default '5%',
    modalidad_pago       text,
    activo               boolean not null default true,
    comision_porcentaje  numeric not null default 5,
    comision_base        text not null default 'PREMIO',
    tipo_calculo         text not null default 'POR_UNIDAD',
    premio_a_pagar       numeric not null default 1,
    permite_cruces       boolean not null default true
);

alter table public.tipos_jugadas
    add column if not exists comision_porcentaje numeric not null default 5,
    add column if not exists comision_base text not null default 'PREMIO',
    add column if not exists tipo_calculo text not null default 'POR_UNIDAD',
    add column if not exists premio_a_pagar numeric not null default 1,
    add column if not exists permite_cruces boolean not null default true;

-- ---- Siembra: JUGADAS ESTÁNDAR (solo si no existen) ----
do $$
begin
    insert into public.tipos_jugadas (nombre, activo, comision_porcentaje, comision_base, tipo_calculo, premio_a_pagar, permite_cruces)
    select v.nombre, true, v.comision, v.base, v.calculo, v.pago, true
    from (values
        ('GANADOR',     5,  'PREMIO',    'POR_UNIDAD', 1.5),
        ('TABLA',       5,  'PREMIO',    'POR_TABLA',  1.0),
        ('EXACTA',      5,  'PREMIO',    'POR_UNIDAD', 8.0),
        ('TRIFECTA',    5,  'PREMIO',    'POR_UNIDAD', 20.0),
        ('SUPERFECTA',  5,  'PREMIO',    'POR_UNIDAD', 40.0)
    ) as v(nombre, comision, base, calculo, pago)
    where not exists (
        select 1 from public.tipos_jugadas t
        where lower(t.nombre) = lower(v.nombre)
    );
exception when others then
    raise notice 'No se pudo sembrar las jugadas estandar: %', sqlerrm;
end;
$$;

-- VERIFICACIÓN (debe devolver los hipódromos sembrados + jugadas):
--   select nombre, pais from public.hipodromos order by nombre;
--   select nombre, tipo_calculo, premio_a_pagar from public.tipos_jugadas order by nombre;

-- ============================================================
-- (8) PROGRAMA DEL DÍA (compartido entre módulos)
--     Tabla única por fecha con el hipódromo(s) y las carreras
--     cargadas desde la Gaceta/Ensamblaje. Taquilla, Venta de
--     Tablas, Liquidación y W.P.S. la leen para precargar.
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

alter table public.programa_dia disable row level security;
grant all privileges on table public.programa_dia to anon, authenticated, service_role;