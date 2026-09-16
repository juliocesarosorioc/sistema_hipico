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

alter table public.tasas_referencia disable row level security;
grant all privileges on table public.tasas_referencia to anon;

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

alter table public.ejemplares disable row level security;
grant all privileges on table public.ejemplares to anon;

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

alter table public.gaceta_procesada disable row level security;
grant all privileges on table public.gaceta_procesada to anon;

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

-- Limpieza de duplicados exactos y cuasi-duplicados (fuzzy: ignora espacios)
-- ANTES de crear el índice único, para que filas históricas repetidas
-- ("LA RINCONADA" y "LA RINCONADA") no hagan fallar el índice.
-- Antes de borrar, se reasigna TODA referencia (FK) que apunte al duplicado
-- hacia el hipódromo que se conserva; si aún no se puede borrar, se
-- renombra el duplicado para que la normalización sea única.
do $$
declare
    rec   record;
    fk    record;
    keep  public.hipodromos.id%type;
begin
    for rec in
        with normalizados as (
            select
                id,
                upper(regexp_replace(nombre, '\s+', '', 'g')) as norm,
                row_number() over (
                    partition by upper(regexp_replace(nombre, '\s+', '', 'g'))
                    order by fecha_creacion desc
                ) as rn
            from public.hipodromos
        )
        select * from normalizados where rn > 1
    loop
        select id into keep
          from public.hipodromos
         where upper(regexp_replace(nombre, '\s+', '', 'g')) = rec.norm
           and id <> rec.id
         order by fecha_creacion desc
         limit 1;

        -- 1) Reapuntar hacia el hipódromo conservado TODAS las FKs que
        --    referencian al duplicado (wps_tickets u otras).
        for fk in
            select c.conrelid::regclass::text as tbl,
                   a.attname as col
              from pg_constraint c
              join pg_attribute a
                on a.attrelid = c.conrelid
               and a.attnum = any(c.conkey)
             where c.contype = 'f'
               and c.confrelid = 'public.hipodromos'::regclass
        loop
            execute format('update %s set %I = $1 where %I = $2', fk.tbl, fk.col, fk.col)
                using keep, rec.id;
        end loop;

        -- 2) Cuadrar los textos de tickets de tabla fija (sin FK; por consistencia)
        if exists (
            select 1 from information_schema.tables
            where table_schema = 'public' and table_name = 'tickets_apuestas'
        ) then
            update public.tickets_apuestas
               set hipodromo = k.nombre
              from public.hipodromos k
             where tickets_apuestas.hipodromo is not null
               and upper(regexp_replace(tickets_apuestas.hipodromo, '\s+', '', 'g')) = rec.norm
               and k.id = keep;
        end if;

        -- 3) Eliminar el duplicado (o renombrarlo si algo aún lo retiene)
        begin
            delete from public.hipodromos where id = rec.id;
        exception when foreign_key_violation then
            update public.hipodromos
               set nombre = nombre || ' #' || upper(md5(random()::text))
             where id = rec.id;
            raise notice 'hipodromo duplicado id=% no se borró; se renombró para desbloquear el índice único.', rec.id;
        end;
    end loop;
end;
$$;

create unique index if not exists uq_hipodromos_nombre_norm
    on public.hipodromos (upper(regexp_replace(nombre, '\s+', '', 'g')));

alter table public.hipodromos
    add column if not exists pais text not null default 'OTRO',
    add column if not exists estado text not null default 'Activo';

alter table public.hipodromos disable row level security;
grant all privileges on table public.hipodromos to anon;

-- ---- Siembra: HIPÓDROMOS DE VENEZUELA ----
do $$
begin
    insert into public.hipodromos (nombre, pais)
    select v.nombre, v.pais
    from (values
        ('LA RINCONADA', 'VE'),
        ('VALENCIA', 'VE'),
        ('LA PASTORA', 'VE'),
        ('SANTA RITA', 'VE'),
        ('MARACAIBO', 'VE'),
        ('BARQUISIMETO', 'VE'),
        ('ACARIGUA', 'VE'),
        ('GUANARE', 'VE'),
        ('ELORZA', 'VE'),
        ('CALABOZO', 'VE'),
        ('TUCUPIDO', 'VE'),
        ('SAN FERNANDO DE APURE', 'VE'),
        ('GUASDUALITO', 'VE'),
        ('PALMARITO', 'VE'),
        ('SAN JUAN DE LOS MORROS', 'VE'),
        ('CAGUA', 'VE'),
        ('LOS TEQUES', 'VE'),
        ('PUNTO FIJO', 'VE'),
        ('CUMANÁ', 'VE'),
        ('MATURÍN', 'VE'),
        ('CIUDAD BOLÍVAR', 'VE'),
        ('PUERTO ORDAZ', 'VE'),
        ('UPATA', 'VE'),
        ('TUMEREMO', 'VE'),
        ('EL CALLAO', 'VE'),
        ('SANTA ELENA DE UAIREN', 'VE'),
        ('SAN FELIX', 'VE')
    ) as v(nombre, pais)
    where not exists (
        select 1 from public.hipodromos h
        where upper(regexp_replace(h.nombre, '\s+', '', 'g')) = upper(regexp_replace(v.nombre, '\s+', '', 'g'))
          and upper(h.pais) = v.pais
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
        ('CHURCHILL DOWNS', 'USA'),
        ('SARATOGA', 'USA'),
        ('BELMONT PARK', 'USA'),
        ('AQUEDUCT', 'USA'),
        ('KEENELAND', 'USA'),
        ('DEL MAR', 'USA'),
        ('SANTA ANITA', 'USA'),
        ('GULFSTREAM PARK', 'USA'),
        ('TAMPA BAY DOWNS', 'USA'),
        ('FAIR GROUNDS', 'USA'),
        ('OAKLAWN PARK', 'USA'),
        ('PIMLICO', 'USA'),
        ('MONMOUTH PARK', 'USA'),
        ('PARX RACING', 'USA'),
        ('LAUREL PARK', 'USA'),
        ('WOODBINE', 'USA'),
        ('HAWTHORNE', 'USA'),
        ('ARLINGTON PARK', 'USA'),
        ('LONE STAR PARK', 'USA'),
        ('REMINGTON PARK', 'USA'),
        ('ZIA PARK', 'USA'),
        ('SUNLAND PARK', 'USA'),
        ('ALBUQUERQUE', 'USA'),
        ('TURF PARADISE', 'USA'),
        ('EVANGELINE DOWNS', 'USA'),
        ('LOUISIANA DOWNS', 'USA'),
        ('DELTA DOWNS', 'USA'),
        ('FAIR MEADOWS', 'USA'),
        ('WILL ROGERS DOWNS', 'USA'),
        ('INDIANA GRAND', 'USA'),
        ('HORSESHOE INDIANAPOLIS', 'USA'),
        ('BELTERRA PARK', 'USA'),
        ('THISTLEDOWN', 'USA'),
        ('MAHONING VALLEY', 'USA'),
        ('MOUNT AIRY', 'USA'),
        ('PENN NATIONAL', 'USA'),
        ('PRESQUE ISLE DOWNS', 'USA'),
        ('CHARLES TOWN', 'USA'),
        ('HOLLYWOOD CASINO AT PENN', 'USA'),
        ('MEADOWLANDS', 'USA'),
        ('FREEHOLD RACEWAY', 'USA'),
        ('YONKERS RACEWAY', 'USA'),
        ('POCONO DOWNS', 'USA'),
        ('HARRINGTON RACEWAY', 'USA'),
        ('DOVER DOWNS', 'USA'),
        ('SCIOTO DOWNS', 'USA'),
        ('NORTHFIELD PARK', 'USA'),
        ('HIALEAH PARK', 'USA'),
        ('CALDER RACE COURSE', 'USA'),
        ('GULFSTREAM PARK WEST', 'USA')
    ) as v(nombre, pais)
    where not exists (
        select 1 from public.hipodromos h
        where upper(regexp_replace(h.nombre, '\s+', '', 'g')) = upper(regexp_replace(v.nombre, '\s+', '', 'g'))
          and upper(h.pais) = v.pais
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

-- ============================================================
-- (9) PLATAFORMA DE TABLAS POR GRUPOS: PERMISOS EXPLÍCITOS
--     Cuando plataforma_tablas.sql se ejecutó ANTES que la sección
--     (7), sus tablas pudieron quedar con RLS activado por defecto.
--     Esto bloquea la lectura anidada tabla_grupos(*) que usan
--     Venta de Tablas, el Portal y el Monitor (dropdown vacíos).
--     Aquí se normaliza TODO de forma idempotente.
-- ============================================================

-- Tablas aseguradas primero (idempotente: no fallan si ya existen o no)
create table if not exists public.grupos_venta (
    id            uuid primary key default gen_random_uuid(),
    nombre        text not null unique,
    moneda        text not null default 'USD',
    es_principal  boolean not null default false,
    cupo_tabla    int  not null default 100,
    activo        boolean not null default true,
    created_at    timestamptz not null default now()
);

create table if not exists public.tabla_grupos (
    id               uuid primary key default gen_random_uuid(),
    tabla_id         bigint not null references public.tablas_fijas(id) on delete cascade,
    grupo_id         uuid not null references public.grupos_venta(id) on delete cascade,
    cupos            int not null default 100,
    cantidad_vendida int not null default 0,
    unique (tabla_id, grupo_id)
);

create table if not exists public.clientes_grupos (
    id            uuid primary key default gen_random_uuid(),
    cliente_id    uuid not null,
    grupo_id      uuid not null references public.grupos_venta(id) on delete cascade,
    unique (cliente_id, grupo_id)
);

create table if not exists public.solicitudes_tablas (
    id            uuid primary key default gen_random_uuid(),
    cliente_id    uuid not null,
    cliente_nombre text not null,
    tabla_id      bigint not null,
    grupo_id      uuid,
    grupo_nombre  text,
    hipodromo     text not null,
    carrera       int not null,
    ejemplar_numero int not null,
    ejemplar_nombre text not null,
    pts_ejemplar  numeric not null default 0,
    cantidad      int not null default 1,
    monto_total   numeric not null default 0,
    moneda        text not null default 'USD',
    estado        text not null default 'Pendiente',
    atendida_por  text,
    atendida_at   timestamptz,
    recibo        text,
    created_at    timestamptz not null default now()
);

-- Normalización de columnas del grupo (idempotente; el app usa estos nombres)
alter table public.grupos_venta
    add column if not exists responsable      text,
    add column if not exists cuenta_bancaria  text,
    add column if not exists moneda_cuadre    text not null default 'USD',
    add column if not exists comision_default numeric not null default 2.5;

-- Permisos: RLS apagado + anon con acceso total (lectura anidada tabla_grupos*)
alter table public.grupos_venta     disable row level security;
alter table public.tabla_grupos     disable row level security;
alter table public.clientes_grupos  disable row level security;
alter table public.solicitudes_tablas disable row level security;
alter table public.tablas_fijas     disable row level security;

grant all privileges on table public.grupos_venta      to anon;
grant all privileges on table public.tabla_grupos      to anon;
grant all privileges on table public.clientes_grupos   to anon;
grant all privileges on table public.solicitudes_tablas to anon;
grant all privileges on table public.tablas_fijas      to anon;
alter table public.solicitudes_tablas disable row level security;
grant all privileges on table public.solicitudes_tablas to anon;

-- ============================================================
-- (9.5) RPC SEGURA: GARANTIZAR GRUPO PRINCIPAL
--      security definer: corre como dueño de la tabla, así el rol
--      anon puede crear/proteger el grupo PRINCIPAL aunque el RLS de
--      grupos_venta esté activo (Ensamblaje y Venta dependen de esto).
-- ============================================================
create or replace function public.club_garantizar_grupo_principal()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_id uuid;
begin
    -- Ya existe un grupo marcado como principal?
    select id into v_id
    from public.grupos_venta
    where es_principal = true
    limit 1;

    if v_id is null then
        -- ¿Ya hay uno llamado PRINCIPAL pero sin el flag? -> promuévelo
        select id into v_id
        from public.grupos_venta
        where upper(trim(nombre)) = 'PRINCIPAL'
        limit 1;

        if v_id is not null then
            update public.grupos_venta
            set es_principal = true, activo = true,
                moneda_cuadre = coalesce(moneda_cuadre, 'USD'),
                comision_default = coalesce(comision_default, 2.5)
            where id = v_id;
        else
            -- No existe: créalo
            insert into public.grupos_venta
                (nombre, moneda, es_principal, cupo_tabla, activo, responsable, moneda_cuadre, comision_default)
            values
                ('PRINCIPAL', 'USD', true, 100, true, 'Sistema', 'USD', 2.5)
            on conflict (nombre) do nothing
            returning id into v_id;
        end if;
    end if;

    return v_id;
end;
$$;

revoke all on function public.club_garantizar_grupo_principal() from anon;
grant execute on function public.club_garantizar_grupo_principal() to anon;

-- ============================================================
-- (9.6) RPC SEGURA: ASEGURAR EJEMPLAR EN EL PADRÓN
--      security definer: corre como dueño de la tabla, así el rol
--      anon puede insertar/reutilizar el ejemplar aunque el RLS de
--      ejemplares esté activo (Gaceta y Ensamblaje dependen de esto).
--      Devuelve el id existente o el recién creado; lanza error si
--      no puede. Lógica idéntica al INSERT con fallback del cliente.
-- ============================================================
create or replace function public.club_asegurar_ejemplar(v_nombre text, v_nacionalidad text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_id uuid;
    v_norm text;
    v_nac  text;
begin
    v_norm := upper(btrim(coalesce(v_nombre, '')));
    v_nac  := upper(btrim(coalesce(v_nacionalidad, 'VE')));
    if v_norm = '' then
        return null;
    end if;

    select e.id into v_id
    from public.ejemplares e
    where lower(e.nombre) = lower(v_norm)
      and upper(e.nacionalidad) = upper(v_nac)
    limit 1;

    if v_id is null then
        insert into public.ejemplares (nombre, nacionalidad)
        values (v_norm, v_nac)
        on conflict (lower(nombre), upper(nacionalidad)) do nothing
        returning id into v_id;
    end if;

    if v_id is null then
        select e.id into v_id
        from public.ejemplares e
        where lower(e.nombre) = lower(v_norm)
          and upper(e.nacionalidad) = upper(v_nac)
        limit 1;
    end if;

    return v_id;
end;
$$;

revoke all on function public.club_asegurar_ejemplar(text, text) from anon;
grant execute on function public.club_asegurar_ejemplar(text, text) to anon;

-- ============================================================
-- (9.7) RPC SEGURA: LISTAR EL PADRÓN DE EJEMPLARES
--      security definer: devuelve el padrón completo aunque el RLS
--      de ejemplares esté activo (la app usa la anon key). Si la RPC
--      no existe aún, el cliente cae al SELECT directo.
-- ============================================================
create or replace function public.club_listar_ejemplares()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_out jsonb;
begin
    select coalesce(jsonb_agg(
        jsonb_build_object('id', e.id, 'nombre', e.nombre, 'nacionalidad', e.nacionalidad, 'created_at', e.created_at)
        order by e.nombre
    ), '[]'::jsonb)
    into v_out
    from public.ejemplares e;

    return v_out;
end;
$$;

revoke all on function public.club_listar_ejemplares() from anon;
grant execute on function public.club_listar_ejemplares() to anon;

-- ============================================================
-- (10) RESULTADO CENTRAL DE CARRERAS (compartido entre módulos)
--      Una sola fila por (hipódromo, carrera, fecha). La Taquilla
--      carga aquí el resultado oficial (ganador/empates y
--      retirados); el mismo se usa para recalcular el premio de
--      las tablas fijas (baja proporcional) y para que
--      Liquidación (saldos) pague sin re-preguntar el ganador.
-- ============================================================
create table if not exists public.resultados_carreras (
    id               uuid primary key default gen_random_uuid(),
    fecha            date not null default current_date,
    hipodromo        text not null,
    carrera          int  not null,
    ganadores        text[],                 -- números ganadores (empates = varios)
    retirados        text,                   -- ej: '2, 5' o 'NO HUBO RETIROS'
    premio_oficial   numeric,                -- premio publicado en la gaceta
    premio_recalculado numeric,              -- premio con baja proporcional aplicada
    detalle          jsonb not null default '[]',  -- [{numero, valor, retirado}]
    aplicado_a_tablas boolean not null default false,
    cargado_por      text,
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now(),
    constraint resultados_carreras_unico unique (fecha, hipodromo, carrera)
);

alter table public.resultados_carreras
    add column if not exists dividendos    jsonb,   -- { win, place, show, puestos, marcas }: pago por $1
    add column if not exists orden_llegada jsonb;   -- [{numero, puesto}] orden de llegada oficial

alter table public.resultados_carreras disable row level security;
grant all privileges on table public.resultados_carreras to anon, authenticated, service_role;

-- ============================================================
-- (11) VENTA DE TABLAS: GRUPO QUE COBRA Y GRUPO QUE RECIBE COMISIÓN
--      El ticket congela además del premio/PTS al grupo que factura
--      (grupo_cobro) y al grupo destinatario de la comisión
--      (grupo_comision), para que las liquidaciones no dependan de
--      los valores actuales de la tabla ni del grupo.
-- ============================================================
alter table public.tickets_apuestas
    add column if not exists grupo_cobro_id      uuid,
    add column if not exists grupo_cobro_nombre  text,
    add column if not exists grupo_comision_id   uuid,
    add column if not exists grupo_comision_nombre text,
    add column if not exists monto_decidido      numeric,
    add column if not exists ejemplar_numero     int;

alter table public.tickets_apuestas disable row level security;
grant all privileges on table public.tickets_apuestas to anon;

-- ============================================================
-- (12) CONVENIOS POR TIPO DE JUGADA Y GRUPO
--      Matriz de comisión que usa Grupos (js/grupos.js): cada grupo
--      define la comisión/base y si permite cruces POR jugada.
-- ============================================================
create table if not exists public.convenio_tipo_grupo (
    id                uuid primary key default gen_random_uuid(),
    tipo_jugada_id    bigint not null references public.tipos_jugadas(id) on delete cascade,
    grupo_id          uuid not null references public.grupos_venta(id) on delete cascade,
    comision          text not null default '5%',
    comision_base     text not null default 'PREMIO',
    comision_porcentaje numeric not null default 5,
    permite_cruces    boolean not null default true,
    created_at        timestamptz not null default now(),
    constraint convenio_tipo_grupo_unico unique (tipo_jugada_id, grupo_id)
);

alter table public.convenio_tipo_grupo disable row level security;
grant all privileges on table public.convenio_tipo_grupo to anon;

-- ============================================================
-- (13) TICKETS POR SOLUCIONAR: DISPUTAS DE JUGADAS
--      El cliente disputa una jugada desde el Portal; la casa
--      responde cambiando CREADO -> EN_REVISION -> SOLUCIONADO
--      y (opcional) abonando/reembolsando al saldo del cliente.
--      Al cerrar, el cliente responde una encuesta de satisfacción
--      (1-5) con comentario opcional.
-- ============================================================
create table if not exists public.tickets_jugadas (
    id                   uuid primary key default gen_random_uuid(),
    numero_ticket        serial unique,
    cliente_id           uuid references public.clientes(id),
    cliente_nombre       text,
    jugada_origen        text,
    jugada_id            text,
    tipo_jugada          text,
    fecha_jugada         date,
    hipodromo            text,
    carrera              int,
    monto                numeric,
    premio_recalculado   numeric,
    motivo               text,
    imagen_soporte       text,
    estado               text not null default 'CREADO'
        check (estado in ('CREADO', 'EN_REVISION', 'SOLUCIONADO')),
    respuesta_casa       text,
    accion_aplicada      text check (accion_aplicada in ('ABONO','REEMBOLSO','RECHAZO','AJUSTE')),
    monto_resuelto       numeric,
    respondido_por       text,
    respondido_at        timestamptz,
    encuesta_satisfaccion int check (encuesta_satisfaccion between 1 and 5),
    encuesta_comentario  text,
    encuesta_at          timestamptz,
    creado_por           text,
    creado_at            timestamptz not null default now(),
    updated_at           timestamptz not null default now()
);

create index if not exists idx_tickets_jugadas_estado on public.tickets_jugadas (estado);
create index if not exists idx_tickets_jugadas_cliente on public.tickets_jugadas (cliente_id);
create index if not exists idx_tickets_jugadas_fecha on public.tickets_jugadas (fecha_jugada desc);

alter table public.tickets_jugadas disable row level security;
grant all privileges on table public.tickets_jugadas to anon;

-- ============================================================
-- (14) NÚMERO DE CUENTA DE GRUPO: FORMATO XXXX-XX-XXXX-XXXX-XX
--      Regla: solo números, máximo 16 caracteres del número, con
--      guiones cada 4-2-4-4-2 (16 dígitos). El campo
--      grupos_venta.cuenta_bancaria guarda "BANCO / N° <número>".
--      Se valida SOLO el número (la parte después de "N°").
--      Constraint NOT VALID: no rompe filas históricas con otros
--      formatos; bloquea sólamente escrituras NUEVAS inválidas.
-- ============================================================
create or replace function public.club_cuenta_bancaria_valida(p_cuenta text)
returns boolean
language plpgsql
immutable
as $$
declare
    v_numero text;
begin
    if p_cuenta is null or btrim(p_cuenta) = '' then
        return true; -- sin cuenta: válido (el banco sí es obligatorio por la app)
    end if;
    -- Extraer la parte posterior a "N°" (puede existir o no)
    v_numero := split_part(p_cuenta, 'N°', 2);
    v_numero := btrim(v_numero);
    if v_numero = '' then
        return true; -- solo se indicó el banco
    end if;
    -- Formato estricto: 4-2-4-4-2 dígitos con guiones (20 caracteres totales)
    return v_numero ~ '^[0-9]{4}-[0-9]{2}-[0-9]{4}-[0-9]{4}-[0-9]{2}$';
end;
$$;

do $$
begin
    -- Idempotente: no intenta crear el constraint dos veces
    if not exists (
        select 1 from pg_constraint
        where conname = 'ck_grupos_venta_cuenta_bancaria_formato'
          and conrelid = 'public.grupos_venta'::regclass
    ) then
        alter table public.grupos_venta
            add constraint ck_grupos_venta_cuenta_bancaria_formato
            check (public.club_cuenta_bancaria_valida(cuenta_bancaria))
            not valid;
    end if;
end;
$$;

grant execute on function public.club_cuenta_bancaria_valida(text) to anon;

-- ============================================================
-- (14.5) RPC SEGURA: LISTAR GRUPOS SIN IMPORTAR EL RLS
--      security definer: corre como dueño de la tabla, así el anon
--      puede leer TODOS los grupos aunque grupos_venta tenga RLS
--      activado (Ensamblaje y Grupos y Convenios dependen de esto).
--      La app cae aquí cuando el SELECT directo falla con 401/403.
-- ============================================================
create or replace function public.club_listar_grupos()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_out jsonb;
begin
    select coalesce(jsonb_agg(
        jsonb_build_object(
            'id', g.id,
            'nombre', g.nombre,
            'moneda', g.moneda,
            'es_principal', g.es_principal,
            'cupo_tabla', g.cupo_tabla,
            'activo', g.activo,
            'responsable', g.responsable,
            'cuenta_bancaria', g.cuenta_bancaria,
            'moneda_cuadre', g.moneda_cuadre,
            'comision_default', g.comision_default,
            'created_at', g.created_at
        )
        order by g.es_principal desc, g.nombre asc
    ), '[]'::jsonb)
    into v_out
    from public.grupos_venta g;

    return v_out;
end;
$$;

revoke all on function public.club_listar_grupos() from anon;
grant execute on function public.club_listar_grupos() to anon;

-- ============================================================
-- (14.6) RPC SEGURAS: CRUD DE GRUPOS DE VENTA
--      security definer: corren como dueño de las tablas, así el
--      anon puede crear/editar/activar/desactivar/eliminar grupos
--      aunque los_venta quede con RLS activo. Se parametriza con
--      jsonb para no exponer columnas individuales.
-- ============================================================
create or replace function public.club_guardar_grupo(p_datos jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_id uuid;
    v_nombre text := upper(trim(coalesce(p_datos->>'nombre', '')));
    v_moneda text := coalesce(p_datos->>'moneda', 'USD');
    v_moneda_cuadre text := coalesce(p_datos->>'moneda_cuadre', 'USD');
    v_principal boolean := coalesce((p_datos->>'es_principal')::boolean, false);
    v_cupo integer := coalesce((p_datos->>'cupo_tabla')::integer, 100);
    v_comision numeric := coalesce((p_datos->>'comision_default')::numeric, 2.5);
    v_responsable text := nullif(upper(trim(coalesce(p_datos->>'responsable', ''))), '');
    v_cuenta text := nullif(trim(coalesce(p_datos->>'cuenta_bancaria', '')), '');
begin
    if v_nombre = '' then
        raise exception 'Indique el nombre del grupo';
    end if;
    if v_cuenta is not null and not public.club_cuenta_bancaria_valida(v_cuenta) then
        raise exception 'Número de cuenta inválido. Use el formato XXXX-XX-XXXX-XXXX-XX (solo números).';
    end if;

    -- Un solo PRINCIPAL: limpia el flag antes de asignarlo
    if v_principal then
        update public.grupos_venta set es_principal = false where es_principal = true;
    end if;

    -- Reutiliza por nombre normalizado (no depende de un unique constraint real)
    select id into v_id
    from public.grupos_venta
    where lower(trim(nombre)) = lower(v_nombre)
    limit 1;

    if v_id is null then
        insert into public.grupos_venta
            (nombre, moneda, moneda_cuadre, es_principal, cupo_tabla, comision_default, responsable, cuenta_bancaria, activo)
        values
            (v_nombre, v_moneda, v_moneda_cuadre, v_principal, v_cupo, v_comision, v_responsable, v_cuenta, true)
        returning id into v_id;
    else
        update public.grupos_venta set
            moneda = v_moneda,
            moneda_cuadre = v_moneda_cuadre,
            es_principal = v_principal,
            cupo_tabla = v_cupo,
            comision_default = v_comision,
            responsable = v_responsable,
            cuenta_bancaria = v_cuenta,
            activo = true
        where id = v_id;
    end if;

    return v_id;
end;
$$;

revoke all on function public.club_guardar_grupo(jsonb) from anon;
grant execute on function public.club_guardar_grupo(jsonb) to anon;

create or replace function public.club_actualizar_grupo(p_id uuid, p_datos jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_nombre text := upper(trim(coalesce(p_datos->>'nombre', '')));
    v_moneda text := coalesce(p_datos->>'moneda', 'USD');
    v_moneda_cuadre text := coalesce(p_datos->>'moneda_cuadre', 'USD');
    v_principal boolean := coalesce((p_datos->>'es_principal')::boolean, false);
    v_cupo integer := coalesce((p_datos->>'cupo_tabla')::integer, 100);
    v_comision numeric := coalesce((p_datos->>'comision_default')::numeric, 2.5);
    v_responsable text := nullif(upper(trim(coalesce(p_datos->>'responsable', ''))), '');
    v_cuenta text := nullif(trim(coalesce(p_datos->>'cuenta_bancaria', '')), '');
begin
    if v_nombre = '' then
        raise exception 'Indique el nombre del grupo';
    end if;
    if v_cuenta is not null and not public.club_cuenta_bancaria_valida(v_cuenta) then
        raise exception 'Número de cuenta inválido. Use el formato XXXX-XX-XXXX-XXXX-XX (solo números).';
    end if;

    if v_principal then
        update public.grupos_venta set es_principal = false where es_principal = true and id <> p_id;
    end if;

    update public.grupos_venta set
        nombre = v_nombre,
        moneda = v_moneda,
        moneda_cuadre = v_moneda_cuadre,
        es_principal = v_principal,
        cupo_tabla = v_cupo,
        comision_default = v_comision,
        responsable = v_responsable,
        cuenta_bancaria = v_cuenta
    where id = p_id;
end;
$$;

revoke all on function public.club_actualizar_grupo(uuid, jsonb) from anon;
grant execute on function public.club_actualizar_grupo(uuid, jsonb) to anon;

create or replace function public.club_toggle_grupo(p_id uuid, p_activo boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    update public.grupos_venta set activo = p_activo where id = p_id;
end;
$$;

revoke all on function public.club_toggle_grupo(uuid, boolean) from anon;
grant execute on function public.club_toggle_grupo(uuid, boolean) to anon;

create or replace function public.club_eliminar_grupo(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_principal uuid;
begin
    -- Mueve los clientes del grupo al PRINCIPAL antes de borrar
    select id into v_principal from public.grupos_venta where es_principal = true and id <> p_id limit 1;
    if v_principal is not null then
        update public.clientes set grupo_id = v_principal where grupo_id = p_id;
    end if;
    delete from public.clientes_grupos where grupo_id = p_id;
    delete from public.grupos_venta where id = p_id;
end;
$$;

revoke all on function public.club_eliminar_grupo(uuid) from anon;
grant execute on function public.club_eliminar_grupo(uuid) to anon;

-- ============================================================
-- (14.7) RPC SEGURA: REGISTRAR JUGADOR EN EL GRUPO (venta rápida)
--      Añade/actualiza el cliente y su lazo con el grupo, sin
--      importar el RLS de clientes / clientes_grupos.
-- ============================================================
create or replace function public.club_registrar_cliente_grupo(p_grupo_id uuid, p_nombre text, p_ingreso numeric)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_cliente_id uuid;
    v_nombre text := upper(trim(coalesce(p_nombre, '')));
begin
    if v_nombre = '' then
        raise exception 'Indique el nombre del jugador';
    end if;

    -- Reutiliza el cliente por nombre (normalizado)
    select id into v_cliente_id
    from public.clientes
    where upper(trim(nombre)) = v_nombre
    order by created_at asc
    limit 1;

    if v_cliente_id is null then
        insert into public.clientes (nombre, grupo_id, saldo_actual, libre, modo_juego, aval)
        values (v_nombre, p_grupo_id, coalesce(p_ingreso, 0), true, 'cuadre', false)
        returning id into v_cliente_id;
    end if;

    insert into public.clientes_grupos (grupo_id, cliente_id)
    values (p_grupo_id, v_cliente_id)
    on conflict do nothing;

    return jsonb_build_object('cliente_id', v_cliente_id);
end;
$$;

revoke all on function public.club_registrar_cliente_grupo(uuid, text, numeric) from anon;
grant execute on function public.club_registrar_cliente_grupo(uuid, text, numeric) to anon;

-- ============================================================
-- (15) REFUERZO FINAL DE PERMISOS (RLS apagado + grants anon)
--      La app trabaja 100% con la anon key. Si algún script anterior
--      corrió a medias, o el dashboard re-activó el RLS, el anon
--      recibe 401/403 ("Permisos bloqueados (RLS)"). Esta sección
--      vuelve a normalizar TODAS las tablas y secuencias, y solo deja
--      auditoria con RLS (escritura solo vía club_log_accion).
--      Es idempotente y se ejecuta al FINAL para no dejar esquinas.
-- ============================================================
do $$
declare
    t text;
begin
    for t in
        select tablename from pg_tables
        where schemaname = 'public'
    loop
        if t = 'auditoria' then
            continue;
        end if;
        execute format('alter table public.%I disable row level security', t);
        execute format('grant select, insert, update, delete on table public.%I to anon', t);
        execute format('grant all privileges on table public.%I to authenticated, service_role', t);
    end loop;
end;
$$;

grant usage on schema public to anon;
grant usage, select on all sequences in schema public to anon;

-- auditoría: el anon SOLO lee (escrituras vía RPC segura club_log_accion)
alter table public.auditoria enable row level security;
drop policy if exists "anon_read_temporal" on public.auditoria;
create policy "anon_read_temporal" on public.auditoria
    for select to anon using (true);
revoke insert, update, delete on table public.auditoria from anon;
grant select on table public.auditoria to anon;

-- -------------------- FIN DEL PAQUETE --------------------
-- RECUERDE: ejecute SIEMPRE este archivo COMPLETO en el SQL Editor
-- de Supabase. Es idempotente: puede re-ejecutarse sin romper nada.
-- Verificación:
--   select id, nombre, cuenta_bancaria,
--          public.club_cuenta_bancaria_valida(cuenta_bancaria) as ok
--   from public.grupos_venta;