-- ============================================================================
-- MATRIZ MAESTRA DE CARRERAS
-- ============================================================================
-- POR QUE ESTE ARCHIVO
-- -------------------
-- Antes NO habia una tabla maestra. Cada modulo resolvia "que carreras hay"
-- por su cuenta y el unico grano de "una fila por carrera" era
-- `resultados_carreras`, que es el LIBRO DE RESULTADOS. Eso obligaba a que
-- una carrera solo existiera para el resto de la plataforma cuando alguien
-- corria resultados o pulsaba Publicar: al revés, porque para APOSTAR hay que
-- tener la carrera ANTES de que exista resultado.
--
-- `carreras` es la matriz unica. A partir de aca TODOS los modales de
-- jugadas (Tablas, Marcas, Gestion, Dupletas) mas Liquidacion, Remates,
-- Taquilla y el semaforo leen el catalogo de carreras de ACA.
--
--   programa_dia        -> documento/respaldo del programa de la IA (jsonb)
--   carreras            -> MATRIZ MAESTRA (una fila por carrera)  <<<
--   resultados_carreras -> SOLO resultados (ganadores, dividendos, orden)
--   tablas_fijas        -> la tabla de juego (premios, estado Abierta/Cerrada)
--
-- Que hace
-- --------
--   1) Crea `carreras` con grano (fecha, hipodromo, carrera).
--   2) RESPALDA desde `resultados_carreras` y desde el `programa_dia` de la IA
--      (incluidas las carreras que solo existen en el JSON de la IA).
--   3) Enlaza `resultados_carreras.carrera_id` -> `carreras.id`, para que el
--      maestro se lea con UN solo query (embebido) junto al resultado.
--   4) Enlaza `carreras.hipodromo_id` -> `hipodromos.id`.
--   5) Endurece `programa_dia`: hoy tiene RLS DESACTIVADO y permisos para
--      `anon`, o sea que sin login se puede leer y escribir el programa.
--
-- Idempotente: se puede correr las veces que haga falta. NO borra datos.
-- Ejecutar en el SQL Editor de Supabase (SQL puro, sin metacomandos).
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0) SI `carreras` EXISTE CON FORMA LEGACY (sin la columna `carrera`) Y ESTA
--    VACIA, SE ELIMINA PARA RECREARLA CON EL GRANO CORRECTO.
-- ---------------------------------------------------------------------------
-- `create table if not exists` es un mentiroso: si la tabla ya existia con otra
-- forma (p. ej. la vieja tabla por hipodromo/dia, con `estado` y `retirados`
-- pero sin `carrera`) NO la reemplaza, y el respaldo de mas abajo falla por el
-- grano/unique viejo. Con filas NO se toca nada (se aborta para no perder
-- datos); vacia, se borra para que el `create` de abajo construya la matriz.
do $$
declare
  hay_filas     bigint;
  tiene_carrera boolean;
begin
  if to_regclass('public.carreras') is not null then
    select exists (
      select 1 from pg_attribute
       where attrelid = 'public.carreras'::regclass
         and attname = 'carrera'
         and not attisdropped
    ) into tiene_carrera;
    if not tiene_carrera then
      execute 'select count(*) from public.carreras' into hay_filas;
      if hay_filas = 0 then
        execute 'drop table public.carreras cascade';
        raise notice 'public.carreras tenia forma legacy y estaba vacia: se elimino para recrearla como matriz.';
      else
        raise exception 'public.carreras ya existe con forma legacy (% filas) y sin columna carrera. No se borra: respalda esas filas antes de correr este script.', hay_filas;
      end if;
    end if;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 1) MATRIZ MAESTRA
-- ---------------------------------------------------------------------------
create table if not exists public.carreras (
  id            uuid primary key default gen_random_uuid(),
  fecha         date not null default current_date,
  hipodromo     text not null,
  -- `hipodromo_id` NO se declara aqui a proposito: su tipo tiene que ser
  -- EXACTAMENTE el de `hipodromos.id`, que en esta base es `uuid` (no bigint).
  -- Declararlo aqui como `bigint` hacia fallar la FK con
  -- "42804: bigint and uuid are of incompatible types" y abortaba TODO el
  -- script. Se agrega mas abajo, leyendo el tipo del catalogo.
  carrera       int  not null,
  -- Ciclo de vida comercial: Programada | Abierta | Cerrada | Resultados | Liquidada
  estado        text not null default 'Programada',
  -- [{numero, nombre?, nacionalidad?, retirado?}] — pueden ser solo numero.
  caballos      jsonb not null default '[]'::jsonb,
  retirados     text,
  distancia     text,
  superficie    text,
  premio        numeric,
  hora          text,
  -- De donde salio la fila: ia | manual | tablas | central
  origen        text not null default 'ia',
  registrado_por text,
  -- --- AUDITORIA ---------------------------------------------------------
  -- Quien toco la fila por ultima vez y quien la verifico. Sin esto no hay
  -- forma de saber si una carrera de la matriz fue revisada o solo cargada.
  actualizado_por text,
  verificado     boolean not null default false,
  verificado_por text,
  verificado_at  timestamptz,
  -- --- INVALIDADO DE REMATE ---------------------------------------------
  -- OJO: esto NO es lo mismo que `retirados`. Retirar saca el ejemplar de
  -- TODOS los modulos; invalidar en Remates solo impide pujar en ese modulo y
  -- deja la participacion intacta. Se guardan separados a proposito: mezclarlos
  -- haria que un INV de Remates desapareciera de Tablas, Marcas y Taquilla.
  invalidado_remate text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint carreras_unico unique (fecha, hipodromo, carrera)
);

-- ---------------------------------------------------------------------------
-- 1a) ASEGURAR LA FORMA DE LA TABLA (esto YA EXISTIA con otra forma)
-- ---------------------------------------------------------------------------
-- `create table if not exists` es un MENTIROSO: si `public.carreras` ya existe,
-- no hace nada y en silencio. Asi que si la tabla venia de otro lado —o de una
-- corrida anterior a medias— el `create` de arriba se salteo y el respaldo
-- revienta con "42703: column carrera of relation carreras does not exist",
-- porque las columnas OBLIGATORIAS nunca se agregaban: solo las opcionales.
--
-- Por eso las columnas que definen el grano (fecha, hipodromo, carrera) y la
-- primary key se verifican una por una contra el catalogo de PostgreSQL.
do $$
declare
  hay_filas  bigint;
  faltaba_clave text;
begin
  select count(*) into hay_filas from public.carreras;

  -- --- id: uuid, primary key ---------------------------------------------
  if not exists (
    select 1 from pg_attribute
     where attrelid = 'public.carreras'::regclass and attname = 'id' and not attisdropped
  ) then
    execute 'alter table public.carreras add column id uuid default gen_random_uuid()';
  end if;
  -- Un id inventado es peor que un id faltante: sin PK no hay a quien enlazar
  -- el resultado. Se rellena y se declara NOT NULL, pero nunca en silencio.
  execute 'update public.carreras set id = gen_random_uuid() where id is null';
  execute 'alter table public.carreras alter column id set not null';
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.carreras'::regclass and contype = 'p'
  ) then
    execute 'alter table public.carreras add constraint carreras_pkey primary key (id)';
  end if;

  -- --- fecha / hipodromo / carrera: el grano -------------------------------
  faltaba_clave := '';
  if not exists (
    select 1 from pg_attribute
     where attrelid = 'public.carreras'::regclass and attname = 'fecha' and not attisdropped
  ) then
    execute 'alter table public.carreras add column fecha date';
    execute 'update public.carreras set fecha = current_date where fecha is null';
    faltaba_clave := faltaba_clave || 'fecha, ';
  end if;
  if not exists (
    select 1 from pg_attribute
     where attrelid = 'public.carreras'::regclass and attname = 'hipodromo' and not attisdropped
  ) then
    execute 'alter table public.carreras add column hipodromo text';
    faltaba_clave := faltaba_clave || 'hipodromo, ';
  end if;
  if not exists (
    select 1 from pg_attribute
     where attrelid = 'public.carreras'::regclass and attname = 'carrera' and not attisdropped
  ) then
    execute 'alter table public.carreras add column carrera integer';
    faltaba_clave := faltaba_clave || 'carrera, ';
  end if;

  execute 'alter table public.carreras alter column fecha     set default current_date';

  -- Sin hipodromo ni numero de carrera no hay fila: se identificaria sola.
  -- Antes de inventar nada, se cuenta cuantas filas quedaron sin poder identificar.
  execute 'update public.carreras set hipodromo = upper(trim(hipodromo)) where hipodromo is not null';

  if hay_filas > 0 and exists (
       select 1 from public.carreras
        where hipodromo is null or btrim(hipodromo) = '' or carrera is null
  ) then
    raise exception
      'public.carreras YA EXISTIA con otra forma (le faltan: %) y tiene % filas que no se pueden identificar por (fecha, hipodromo, carrera). No se inventan claves: revisa esa tabla antes de seguir.',
      rtrim(falta_clave, ', '), hay_filas;
  end if;

  if exists (select 1 from public.carreras where hipodromo is null or carrera is null) then
    -- Tabla vacia: no hay nada que identificar, se completa el grano.
    execute 'update public.carreras set hipodromo = ''SIN HIPODROMO'' where hipodromo is null';
    execute 'update public.carreras set carrera = 0 where carrera is null';
    raise warning 'public.carreras existia sin la columna carrera/hipodromo y estaba vacia: se creo la tabla con el grano correcto.';
  end if;

  execute 'alter table public.carreras alter column hipodromo set not null';
  execute 'alter table public.carreras alter column carrera   set not null';
end
$$;

-- Columnas opcionales: se completan aunque la tabla ya existiera.
alter table public.carreras add column if not exists estado        text;
alter table public.carreras add column if not exists caballos      jsonb;
alter table public.carreras add column if not exists retirados     text;
alter table public.carreras add column if not exists distancia     text;
alter table public.carreras add column if not exists superficie    text;
alter table public.carreras add column if not exists premio        numeric;
alter table public.carreras add column if not exists hora          text;
alter table public.carreras add column if not exists origen        text;
alter table public.carreras add column if not exists registrado_por text;
alter table public.carreras add column if not exists actualizado_por text;
alter table public.carreras add column if not exists verificado     boolean;
alter table public.carreras add column if not exists verificado_por text;
alter table public.carreras add column if not exists verificado_at  timestamptz;
alter table public.carreras add column if not exists invalidado_remate text;
alter table public.carreras add column if not exists created_at    timestamptz;
alter table public.carreras add column if not exists updated_at    timestamptz;

alter table public.carreras alter column estado     set default 'Programada';
alter table public.carreras alter column caballos   set default '[]'::jsonb;
alter table public.carreras alter column origen     set default 'ia';
alter table public.carreras alter column verificado set default false;
alter table public.carreras alter column created_at set default now();
alter table public.carreras alter column updated_at set default now();

-- `estado`, `caballos`, `origen` y `verificado` llegan como NULL desde una tabla
-- que ya existia. La app los lee directo, asi que un NULL ahi se ve como carrera
-- rota o como "sin verificar" indistinguible de "verificada".
update public.carreras set estado     = 'Programada' where estado     is null;
update public.carreras set caballos   = '[]'::jsonb    where caballos   is null;
update public.carreras set origen     = 'ia'          where origen     is null;
update public.carreras set verificado = false         where verificado is null;

-- El UNIQUE del grano es lo que permite el `on conflict (fecha, hipodromo,
-- carrera) do nothing` de los respaldos. Si la tabla venia de otro lado, el
-- constraint del `create table` tampoco existe: se crea como indice unico, que
-- para `on conflict` es exactamente lo mismo.
create unique index if not exists carreras_unico_idx
  on public.carreras (fecha, hipodromo, carrera);

-- ---------------------------------------------------------------------------
-- 1b) CLAVE FORANEA AL CATALOGO DE HIPODROMOS, CON EL TIPO LEIDO DE LA TABLA
-- ---------------------------------------------------------------------------
-- Una FK exige que ambos lados sean del MISMO tipo. `hipodromos.id` es `uuid`
-- en esta base; suponer `bigint` (como se hizo la primera vez) revienta con
-- 42804 y, al estar todo dentro de la transaccion, tira ABAJO el script entero
-- — no se creaba ni la tabla ni el respaldo. Por eso el tipo se pregunta a
-- PostgreSQL en vez de escribirse a mano: asi el archivo funciona tanto en esta
-- base (uuid) como en una legacy que tuviera bigint.
do $$
declare
  id_tipo  oid;    -- tipo real de hipodromos.id
  col_tipo oid;    -- tipo actual de carreras.hipodromo_id, si existe
  tipo_txt text;   -- su nombre SQL ("uuid", "bigint", ...)
begin
  select h.atttypid into id_tipo
    from pg_attribute h
   where h.attrelid = 'public.hipodromos'::regclass
     and h.attname = 'id'
     and not h.attisdropped;

  if id_tipo is null then
    raise exception 'No existe public.hipodromos.id: aplica primero el SQL de hipodromos';
  end if;

  -- OJO: `format('%s', oid)` imprimiria el NUMERO del OID (2951), no "uuid",
  -- y `alter table add column 2951` no existe. El nombre del tipo sale de
  -- format_type().
  tipo_txt := format_type(id_tipo, null);

  select c.atttypid into col_tipo
    from pg_attribute c
   where c.attrelid = 'public.carreras'::regclass
     and c.attname = 'hipodromo_id'
     and not c.attisdropped;

  -- Si una corrida anterior dejo la columna del tipo equivocado, se rehace en
  -- vez de fallar. Perder la columna no pierde datos: solo el enlace, que se
  -- vuelve a llenar en el paso 3b.
  if col_tipo is not null and col_tipo <> id_tipo then
    execute 'alter table public.carreras drop column hipodromo_id';
    col_tipo := null;
  end if;

  if col_tipo is null then
    execute format('alter table public.carreras add column hipodromo_id %s', tipo_txt);
  end if;

  -- La FK se rehace siempre: es barata (indice incluido) y self-healing si
  -- quedo a medias de una corrida anterior.
  execute 'alter table public.carreras drop constraint if exists carreras_hipodromo_id_fkey';
  execute 'alter table public.carreras
             add constraint carreras_hipodromo_id_fkey
             foreign key (hipodromo_id) references public.hipodromos(id)';
end
$$;

-- ---------------------------------------------------------------------------
-- 2) RESPALDO
-- ---------------------------------------------------------------------------

-- 2a) Desde el libro de resultados: toda carrera que ya se conoce.
insert into public.carreras
  (fecha, hipodromo, carrera, estado, caballos, retirados,
   distancia, superficie, premio, hora, origen)
select r.fecha,
       upper(trim(r.hipodromo)),
       r.carrera,
       case when r.aplicado_a_tablas then 'Liquidada'
            when coalesce(array_length(r.ganadores, 1), 0) > 0 then 'Resultados'
            else 'Programada' end,
       coalesce(r.caballos, '[]'::jsonb),
       r.retirados,
       r.distancia,
       r.superficie,
       r.premio,
       r.hora,
       'central'
from public.resultados_carreras r
on conflict (fecha, hipodromo, carrera) do nothing;

-- 2b) Desde el programa de la IA: carreras que solo viven en el JSON.
--     Acepta las dos claves con las que la IA guarda los ejemplares.
insert into public.carreras
  (fecha, hipodromo, carrera, estado, caballos, distancia, superficie, premio, hora, origen)
select p.fecha,
       upper(trim(carrera_json ->> 'hipodromo')),
       (carrera_json ->> 'carrera')::int,
       'Programada',
       coalesce(carrera_json -> 'caballos', carrera_json -> 'ejemplares', '[]'::jsonb),
       nullif(carrera_json ->> 'distancia', ''),
       nullif(carrera_json ->> 'superficie', ''),
       nullif(carrera_json ->> 'premio', '')::numeric,
       nullif(carrera_json ->> 'hora', ''),
       'ia'
from public.programa_dia p
cross join lateral jsonb_array_elements(p.carreras) as carrera_json
where nullif(trim(carrera_json ->> 'hipodromo'), '') is not null
  and (carrera_json ->> 'carrera') ~ '^[0-9]+$'
  and (carrera_json ->> 'carrera')::int > 0
on conflict (fecha, hipodromo, carrera) do nothing;

-- ---------------------------------------------------------------------------
-- 3) ENLACES
-- ---------------------------------------------------------------------------

-- 3a) Cada resultado apunta a su carrera en la matriz.
-- Mismo criterio que 1b: `carrera_id` se crea con el tipo REAL de `carreras.id`
-- y la FK se rehace, para que un intento anterior a medias no deje el script
-- sin poder terminar.
do $$
declare
  id_tipo  oid;
  col_tipo oid;
  tipo_txt text;
begin
  select c.atttypid into id_tipo
    from pg_attribute c
   where c.attrelid = 'public.carreras'::regclass
     and c.attname = 'id'
     and not c.attisdropped;

  if id_tipo is null then
    raise exception 'No existe public.carreras.id';
  end if;

  tipo_txt := format_type(id_tipo, null);

  select r.atttypid into col_tipo
    from pg_attribute r
   where r.attrelid = 'public.resultados_carreras'::regclass
     and r.attname = 'carrera_id'
     and not r.attisdropped;

  if col_tipo is not null and col_tipo <> id_tipo then
    execute 'alter table public.resultados_carreras drop column carrera_id';
    col_tipo := null;
  end if;

  if col_tipo is null then
    execute format('alter table public.resultados_carreras add column carrera_id %s', tipo_txt);
  end if;

  execute 'alter table public.resultados_carreras drop constraint if exists resultados_carreras_carrera_id_fkey';
  execute 'alter table public.resultados_carreras
             add constraint resultados_carreras_carrera_id_fkey
             foreign key (carrera_id) references public.carreras(id) on delete set null';
end
$$;

create index if not exists resultados_carreras_carrera_id_idx
  on public.resultados_carreras (carrera_id)
  where carrera_id is not null;

update public.resultados_carreras r
   set carrera_id = c.id
  from public.carreras c
 where r.carrera_id is null
   and c.fecha = r.fecha
   and c.hipodromo = upper(trim(r.hipodromo))
   and c.carrera = r.carrera;

-- 3b) Cada carrera apunta a su hipodromo del catalogo.
update public.carreras c
   set hipodromo_id = h.id
  from public.hipodromos h
 where c.hipodromo_id is null
   and upper(trim(h.nombre)) = c.hipodromo;

-- ---------------------------------------------------------------------------
-- 4) INDICES
-- ---------------------------------------------------------------------------
-- El unico (fecha, hipodromo, carrera) ya sirve para listar un dia entero y
-- para preguntar por un hipodromo: son los dos accesos que hace la app.
create index if not exists carreras_fecha_hipodromo_idx on public.carreras (fecha, hipodromo);
create index if not exists carreras_hipodromo_id_idx on public.carreras (hipodromo_id);

-- ---------------------------------------------------------------------------
-- 5) RLS + PERMISOS
-- ---------------------------------------------------------------------------
-- Escritura SOLO para el usuario autenticado. `anon` (que hoy corre en algunos
-- clientes) solo lee: con esto se cierra la escritura de carreras sin login.
alter table public.carreras enable row level security;

drop policy if exists carreras_publico on public.carreras;
create policy carreras_publico on public.carreras
  for all to authenticated
  using (true) with check (true);

grant usage on schema public to anon, authenticated;
grant select on public.carreras to anon;
grant select, insert, update, delete on public.carreras to authenticated, service_role;

-- 5b) ENDURECIMIENTO de programa_dia: RLS estaba desactivado y `anon`
--     podia escribir el programa entero sin estar autenticado.
alter table public.programa_dia enable row level security;

drop policy if exists programa_dia_publico on public.programa_dia;
create policy programa_dia_publico on public.programa_dia
  for all to authenticated
  using (true) with check (true);

grant select on public.programa_dia to anon;
grant select, insert, update, delete on public.programa_dia to authenticated, service_role;

commit;

-- ============================================================================
-- VERIFICACION
-- ============================================================================
-- 1) La matriz tiene las carreras de resultados y las de la IA:
--      SELECT count(*) FROM public.carreras;
-- 2) No quedo ninguna carrera huerfana (debe devolver 0):
--      SELECT count(*) FROM public.resultados_carreras r
--       WHERE r.carrera_id IS NULL;
-- 3) Toda carrera quedo enlazada a su hipodromo (debe devolver 0):
--      SELECT count(*) FROM public.carreras WHERE hipodromo_id IS NULL;
-- 4) Cuantas carreras trae la IA que antes NO existian como libro de resultados:
--      SELECT origen, count(*) FROM public.carreras GROUP BY origen;
-- ============================================================================