-- ============================================================================
-- POLLAS — esquema idempotente + RLS + RPC
-- ============================================================================
-- QUE ES
-- ------
-- Un juego de aciertos por puntos sobre el programa del día. La casa configura
-- qué carreras entran (de la matriz central) y qué puntos da cada puesto; cada
-- jugador compra combinaciones (un ejemplar por carrera) y gana quien más
-- puntos suma.
--
-- QUE HACE ESTE SCRIPT
-- --------------------
--   - `pollas`: la Polla (qué carreras, puntos, precio, comisión, acumulado).
--   - `polla_ventas`: quién compró cuántas combinaciones, y su texto original.
--   - `polla_combinaciones`: una fila por combinación comprada. Se guarda cada
--     ejemplar con la clave de su carrera, para que el resultado se lea de la
--     matriz central y no de una copia.
--   - `polla_acumulado`: el acumulado, con su saldo y su meta.
--   - RLS: LECTURA para `authenticated`, escritura SOLO por RPC `security
--     definer`. Es el mismo criterio que Remates (sql/remates.sql): la app corre
--     con la llave del navegador, así que cualquier `for all using (true)` deja
--     que cualquiera que tenga la URL edite los premios de la casa.
--
-- QUE NO HACE
-- -----------
--   - No guarda el resultado de las carreras. Se lee de `resultados_carreras`
--     (la matriz central) SIEMPRE. Guardar una copia del resultado haría que dos
--     verdades se contradijeran si alguien corrige la pizarra.
--   - No calcula puntos ni premios: eso es `src/lib/pollas/core.ts`, que es puro
--     y está probado. La base guarda; el cálculo es del cliente y se audita con
--     las mismas pruebas.
--
-- IDEMPOTENTE: se puede correr las veces que haga falta.
-- Ejecutar en el SQL Editor de Supabase (SQL puro, sin metacomandos).
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) Tablas
-- ---------------------------------------------------------------------------
create table if not exists public.pollas (
  id              uuid primary key default gen_random_uuid(),
  nombre          text not null,
  fecha           date not null default current_date,
  hipodromo_id    uuid references public.hipodromos(id),
  grupo_id        uuid references public.grupos_venta(id),

  -- Las carreras de la Polla, en ORDEN. El orden importa: el grupo 1 del texto
  -- del jugador es la primera carrera de esta lista, y el 2 la segunda. Guardar
  -- solo el conjunto haría imposible reconstruir qué carrera eligió el jugador.
  --
  -- Cada elemento: {"clave","hipodromo","carrera"}. La `clave` es la de la
  -- matriz central (`fecha|hipodromo|carrera`) y es lo que se guarda en cada
  -- combinación para leer el resultado de la fuente correcta.
  carreras        jsonb not null default '[]'::jsonb,

  -- Puntos por puesto. Configurables; por defecto 5 / 3 / 1.
  puntos_1o       integer not null default 5,
  puntos_2o       integer not null default 3,
  puntos_3o       integer not null default 1,

  -- Lo que paga el jugador por cada combinación.
  precio_unitario numeric not null default 0,

  -- % de la venta que es ingreso de la casa, y % que se aparta al acumulado.
  comision_pct    numeric not null default 0,
  acumulado_pct   numeric not null default 0,
  meta_puntos     integer not null default 30,

  -- Premios por puesto. NULL = ese puesto no paga. El texto libre `premio_*_txt`
  -- es para cuando el premio no es dinero ("una caja de ron"), y aparece en el
  -- reporte tal cual lo escribió la casa.
  premio_1o       numeric,
  premio_2o       numeric,
  premio_3o       numeric,
  premio_1o_txt   text,
  premio_2o_txt   text,
  premio_3o_txt   text,

  estado          text not null default 'Abierta',
  notas           text,
  fecha_registro  timestamptz default now(),

  constraint pollas_porcentajes_validos check (
    comision_pct >= 0 and comision_pct <= 100
    and acumulado_pct >= 0 and acumulado_pct <= 100
  ),
  constraint pollas_meta_no_negativa check (meta_puntos >= 0)
);

create table if not exists public.polla_ventas (
  id               uuid primary key default gen_random_uuid(),
  polla_id         uuid not null references public.pollas(id) on delete cascade,
  cliente_id       uuid references public.clientes(id),
  -- N° de ticket. La Polla se cobra como cualquier otra venta.
  numero_ticket    text,
  -- Cuántas combinaciones compró y qué pagó. El precio unitario se congela acá:
  -- si la casa sube el precio mañana, las ventas de ayer tienen que seguir
  -- cuadrando con lo que realmente se cobró.
  combinaciones     integer not null default 0,
  precio_unitario   numeric not null default 0,
  pagado             numeric not null default 0,
  -- El texto tal como lo escribió el jugador. Se guarda para poder explicar un
  -- cobro months después: sin esto, una combinación mal expandida es
  -- indefendible porque nadie puede ver qué pidió.
  texto_original     text,
  estado             text not null default 'Pagada',
  fecha_registro     timestamptz default now(),
  constraint polla_ventas_combinaciones_positivas check (combinaciones >= 0)
);

-- Una fila por combinación comprada. `posiciones` es un array con un objeto por
-- carrera, EN EL ORDEN de `pollas.carreras`:
--
--   [{"clave":"2026-10-05|RINCONADA|1","numero":"1"}, ...]
--
-- Se guarda el array completo y no una fila por carrera porque la combinación es
-- la unidad atómica: o se cobraron las 6, o no se cobró ninguna. Partirla en
-- filas sueltas permitiría que una liquidación encontrara la mitad y la otra no.
create table if not exists public.polla_combinaciones (
  id           uuid primary key default gen_random_uuid(),
  venta_id     uuid not null references public.polla_ventas(id) on delete cascade,
  polla_id     uuid not null references public.pollas(id) on delete cascade,
  posiciones   jsonb not null default '[]'::jsonb,
  -- Puntos que sacaron, y si la combinación quedó anulada por un ejemplar que se
  -- invalidó DESPUÉS de la venta. `anulada` es lo que impide que puntúe: sin
  -- esta marca, un ejemplar retirado después de la venta seguía sumando.
  puntos       integer,
  anulada      boolean not null default false,
  motivo_anula text,
  created_at   timestamptz default now()
);

-- El acumulado. Una fila por Polla (o por jornada, según se use) con el saldo
-- que se está acumulando. El saldo se actualiza con la RPC de aporte, no a
-- pelo: dos cierres simultáneos sobre el mismo saldo se pisarían.
create table if not exists public.polla_acumulado (
  id           uuid primary key default gen_random_uuid(),
  -- NOT NULL a propósito: con `polla_id` en NULL, PostgreSQL no considera
  -- duplicados a las filas y el ON CONFLICT del aporte no deduplicaba nada.
  polla_id     uuid not null references public.pollas(id) on delete cascade,
  fecha        date not null default current_date,
  disponible   numeric not null default 0,
  meta_puntos  integer not null default 30,
  -- Quién cobró el acumulado y cuándo, para que no se pague dos veces.
  pagado_a     uuid references public.clientes(id),
  pagado_at    timestamptz,
  observaciones text,
  created_at   timestamptz default now(),
  registrado_por text,
  constraint polla_acumulado_no_negativo check (disponible >= 0)
);

-- ---------------------------------------------------------------------------
-- 1bis) Columna de inválidos de Pollas en la matriz de carreras
--
-- `carreras.invalidados` / `invalidado_remate` es SOLO de Remates: el botón de
-- la interfaz lo dice ("Invalidar un ejemplar solo para Remates"). Reusarlo
-- para Pollas haría que un INV de Remates sacara al ejemplar de las Pollas, y
-- son juegos distintos.
--
-- Lo que bloquea en TODOS los módulos es el RETIRO (`carreras.retirados`), que
-- ya existe y no se toca acá.
-- ---------------------------------------------------------------------------
alter table public.carreras
  add column if not exists invalidado_polla text;

comment on column public.carreras.invalidado_polla is
  'Números invalidados SOLO para Pollas. Separado de invalidado_remate a propósito: son juegos distintos.';

-- ---------------------------------------------------------------------------
-- 2) Completar el esquema vivo (por si la tabla ya existe a medias)
-- ---------------------------------------------------------------------------
alter table public.pollas
  add column if not exists carreras        jsonb not null default '[]'::jsonb,
  add column if not exists puntos_1o       integer not null default 5,
  add column if not exists puntos_2o       integer not null default 3,
  add column if not exists puntos_3o       integer not null default 1,
  add column if not exists precio_unitario numeric not null default 0,
  add column if not exists comision_pct    numeric not null default 0,
  add column if not exists acumulado_pct   numeric not null default 0,
  add column if not exists meta_puntos     integer not null default 30,
  add column if not exists premio_1o       numeric,
  add column if not exists premio_2o       numeric,
  add column if not exists premio_3o       numeric,
  add column if not exists premio_1o_txt   text,
  add column if not exists premio_2o_txt   text,
  add column if not exists premio_3o_txt   text,
  add column if not exists estado          text not null default 'Abierta',
  add column if not exists fecha_registro  timestamptz default now();

alter table public.polla_ventas
  add column if not exists combinaciones   integer not null default 0,
  add column if not exists precio_unitario numeric not null default 0,
  add column if not exists pagado           numeric not null default 0,
  add column if not exists texto_original   text,
  add column if not exists estado           text not null default 'Pagada',
  add column if not exists fecha_registro  timestamptz default now();

alter table public.polla_combinaciones
  add column if not exists posiciones   jsonb not null default '[]'::jsonb,
  add column if not exists puntos       integer,
  add column if not exists anulada      boolean not null default false,
  add column if not exists motivo_anula text;

alter table public.polla_acumulado
  add column if not exists meta_puntos integer not null default 30,
  add column if not exists observaciones text,
  add column if not exists registrado_por text;

-- Un acumulado por Polla y fecha. Es la condición de `conflicto` que usa
-- `club_aportar_acumulado_polla`, así que sin este índice el ON CONFLICT falla y
-- cada aporte al acumulado termina en su propia fila.
create unique index if not exists polla_acumulado_unico
  on public.polla_acumulado (polla_id, fecha);

-- ---------------------------------------------------------------------------
-- 3) Índices
-- ---------------------------------------------------------------------------
-- El módulo lista por Polla y por fecha; liquidar lee las combinaciones de una
-- Polla entera. Sin estos índices, liquidar una Polla con muchas ventas hace un
-- secuencial sobre toda la tabla.
create index if not exists pollas_fecha_idx            on public.pollas (fecha desc);
create index if not exists pollas_estado_idx          on public.pollas (estado);
create index if not exists polla_ventas_polla_idx     on public.polla_ventas (polla_id);
create index if not exists polla_ventas_cliente_idx   on public.polla_ventas (cliente_id);
create index if not exists polla_ventas_fecha_idx     on public.polla_ventas (fecha_registro desc);
create index if not exists polla_combinaciones_venta_idx on public.polla_combinaciones (venta_id);
create index if not exists polla_combinaciones_polla_idx on public.polla_combinaciones (polla_id);

-- Una Polla no puede tener dos ventas con el mismo cliente y ticket.
create unique index if not exists polla_ventas_ticket_unico
  on public.polla_ventas (polla_id, coalesce(numero_ticket, id::text));

-- ---------------------------------------------------------------------------
-- 4) RLS + grants
--
-- LECTURA para `authenticated`; la escritura va por RPC. Es el mismo criterio
-- de Remates: sin esta separación, la llave anon del navegador alcanza para
-- cambiar el premio de la Polla o borrar una venta ya cobrada.
-- ---------------------------------------------------------------------------
alter table public.pollas             enable row level security;
alter table public.polla_ventas       enable row level security;
alter table public.polla_combinaciones enable row level security;
alter table public.polla_acumulado    enable row level security;

grant usage on schema public to anon, authenticated;

drop policy if exists pollas_publico on public.pollas;
drop policy if exists pollas_lectura on public.pollas;
create policy pollas_lectura on public.pollas
  for select to authenticated
  using (true);

drop policy if exists polla_ventas_publico on public.polla_ventas;
drop policy if exists polla_ventas_lectura on public.polla_ventas;
create policy polla_ventas_lectura on public.polla_ventas
  for select to authenticated
  using (true);

drop policy if exists polla_combinaciones_publico on public.polla_combinaciones;
drop policy if exists polla_combinaciones_lectura on public.polla_combinaciones;
create policy polla_combinaciones_lectura on public.polla_combinaciones
  for select to authenticated
  using (true);

drop policy if exists polla_acumulado_publico on public.polla_acumulado;
drop policy if exists polla_acumulado_lectura on public.polla_acumulado;
create policy polla_acumulado_lectura on public.polla_acumulado
  for select to authenticated
  using (true);

grant select on public.pollas, public.polla_ventas, public.polla_combinaciones, public.polla_acumulado
  to authenticated, service_role;

-- La escritura se revoca explícitamente a `authenticated`, no se deja en manos de
-- RLS. Las RPC son la única puerta, y sus guards (el acumulado no se paga dos
-- veces, la venta cuadra con el precio vigente) son justamente lo que se pierde
-- si alguien puede escribir directo a la tabla.
revoke insert, update, delete
  on public.pollas, public.polla_ventas, public.polla_combinaciones, public.polla_acumulado
  from public, anon, authenticated;
grant insert, update, delete
  on public.pollas, public.polla_ventas, public.polla_combinaciones, public.polla_acumulado
  to service_role;

-- A `anon` ni lectura: la Polla muestra premios, comisiones y saldos del
-- acumulado, que es información de la casa.
revoke select on public.pollas, public.polla_ventas, public.polla_combinaciones, public.polla_acumulado from anon;

-- ---------------------------------------------------------------------------
-- 5) Escrituras por RPC `security definer`
--
-- Sin esto, la parte de arriba deja la tabla sin escritura para el navegador y
-- el módulo no guarda nada. Las funciones hacen de puente y, sobre todo, son el
-- lugar donde se valida lo que la base tiene que garantizar sí o sí: que el
-- cobro cuadre con el precio vigente y que el acumulado no se pague dos veces.
-- ---------------------------------------------------------------------------

-- Guardar o editar la Polla.
--
-- El orden importa: en PL/pgSQL un parámetro con DEFAULT tiene que ir AL FINAL,
-- porque los que van después heredan ese default y PostgreSQL los rechaza
-- ("input parameters after one with a default value must also have defaults",
-- el mismo error que ya está documentado en contabilidad.sql). Por eso `p_id`,
-- que es opcional, va último y `p_datos`, que es obligatorio, va primero.
create or replace function public.club_guardar_polla(
  p_datos     jsonb,
  p_id        uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not coalesce(public.tiene_capacidad(auth.uid(), 'pollas:fn_guardar_polla'), false) then
    raise exception 'Sin permiso para guardar la Polla.'
      using errcode = '42501';
  end if;

  if p_datos is null then
    raise exception 'Faltan los datos de la Polla.'
      using errcode = '22004';
  end if;

  v_id := p_id;

  if v_id is null then
    insert into public.pollas (nombre, fecha, hipodromo_id, grupo_id, carreras,
                               puntos_1o, puntos_2o, puntos_3o, precio_unitario,
                               comision_pct, acumulado_pct, meta_puntos,
                               premio_1o, premio_2o, premio_3o,
                               premio_1o_txt, premio_2o_txt, premio_3o_txt,
                               estado, notas)
    values (
      coalesce(p_datos->>'nombre', 'Polla'),
      coalesce((p_datos->>'fecha')::date, current_date),
      nullif(p_datos->>'hipodromo_id', '')::uuid,
      nullif(p_datos->>'grupo_id', '')::uuid,
      coalesce(p_datos->'carreras', '[]'::jsonb),
      coalesce((p_datos->>'puntos_1o')::integer, 5),
      coalesce((p_datos->>'puntos_2o')::integer, 3),
      coalesce((p_datos->>'puntos_3o')::integer, 1),
      coalesce((p_datos->>'precio_unitario')::numeric, 0),
      coalesce((p_datos->>'comision_pct')::numeric, 0),
      coalesce((p_datos->>'acumulado_pct')::numeric, 0),
      coalesce((p_datos->>'meta_puntos')::integer, 30),
      nullif(p_datos->>'premio_1o', '')::numeric,
      nullif(p_datos->>'premio_2o', '')::numeric,
      nullif(p_datos->>'premio_3o', '')::numeric,
      nullif(p_datos->>'premio_1o_txt', ''),
      nullif(p_datos->>'premio_2o_txt', ''),
      nullif(p_datos->>'premio_3o_txt', ''),
      coalesce(p_datos->>'estado', 'Abierta'),
      nullif(p_datos->>'notas', '')
    )
    returning id into v_id;
  else
    -- Se actualiza campo por campo y no con un `||` del jsonb: un `||` con
    -- `coalesce(...)` sin paréntesis mete el `null` de una clave ausente y
    -- BORRA el valor que ya estaba. Un premio cargado a mano se perdía al
    -- editar la Polla sin tocarlo.
    --
    -- OJO con el `coalesce(x, columna)`: no distingue "la clave no vino" de
    -- "la vino en null". `p_datos->>'premio_1o'` devuelve SQL NULL en los dos
    -- casos, así que ese coalesce devolvía SIEMPRE el premio viejo y era
    -- imposible borrar uno: la casa seguía pagando un premio que el operador
    -- había puesto en "No paga", sin error ni aviso. Por eso los campos
    -- limpiables usan `p_datos ? 'clave'`, que sí pregunta por la EXISTENCIA
    -- de la clave: si vino, se respeta (aunque sea null y haya que borrar); si
    -- no vino, se conserva lo que había.
    --
    -- `coalesce` sí se usa en puntos/precio/porcentajes porque ahí el cliente
    -- siempre manda un número y un 0 es un 0 legítimo, no un campo vacío.
    update public.pollas set
      nombre            = coalesce(nullif(p_datos->>'nombre', ''), nombre),
      fecha             = coalesce(nullif(p_datos->>'fecha', '')::date, fecha),
      hipodromo_id      = case when p_datos ? 'hipodromo_id'
                               then nullif(p_datos->>'hipodromo_id', '')::uuid
                               else hipodromo_id end,
      grupo_id          = case when p_datos ? 'grupo_id'
                               then nullif(p_datos->>'grupo_id', '')::uuid
                               else grupo_id end,
      carreras          = coalesce(p_datos->'carreras', carreras),
      puntos_1o         = coalesce((p_datos->>'puntos_1o')::integer, puntos_1o),
      puntos_2o         = coalesce((p_datos->>'puntos_2o')::integer, puntos_2o),
      puntos_3o         = coalesce((p_datos->>'puntos_3o')::integer, puntos_3o),
      precio_unitario   = coalesce((p_datos->>'precio_unitario')::numeric, precio_unitario),
      comision_pct      = coalesce((p_datos->>'comision_pct')::numeric, comision_pct),
      acumulado_pct     = coalesce((p_datos->>'acumulado_pct')::numeric, acumulado_pct),
      meta_puntos       = coalesce((p_datos->>'meta_puntos')::integer, meta_puntos),
      premio_1o         = case when p_datos ? 'premio_1o'
                               then nullif(p_datos->>'premio_1o', '')::numeric
                               else premio_1o end,
      premio_2o         = case when p_datos ? 'premio_2o'
                               then nullif(p_datos->>'premio_2o', '')::numeric
                               else premio_2o end,
      premio_3o         = case when p_datos ? 'premio_3o'
                               then nullif(p_datos->>'premio_3o', '')::numeric
                               else premio_3o end,
      premio_1o_txt     = case when p_datos ? 'premio_1o_txt'
                               then nullif(p_datos->>'premio_1o_txt', '')
                               else premio_1o_txt end,
      premio_2o_txt     = case when p_datos ? 'premio_2o_txt'
                               then nullif(p_datos->>'premio_2o_txt', '')
                               else premio_2o_txt end,
      premio_3o_txt     = case when p_datos ? 'premio_3o_txt'
                               then nullif(p_datos->>'premio_3o_txt', '')
                               else premio_3o_txt end,
      estado            = coalesce(nullif(p_datos->>'estado', ''), estado),
      notas             = case when p_datos ? 'notas'
                               then nullif(p_datos->>'notas', '')
                               else notas end
    where id = v_id
    returning id into v_id;

    if v_id is null then
      raise exception 'La Polla % no existe.', p_id using errcode = 'P0002';
    end if;
  end if;

  return v_id;
end;
$$;

comment on function public.club_guardar_polla(jsonb, uuid) is
  'Crea o edita una Polla. Solo con capacidad polla:fn_guardar_polla.';

-- Registrar una venta con todas sus combinaciones, en una sola transacción.
--
-- Que sea UNA llamada y no dos (venta + combinaciones) importa por el cobro: si
-- se inserta la venta y falla el detalle, queda una venta de 40 combinaciones
-- pagadas que no existen. Con una transacción, o entra todo o no entra nada.
--
-- `p_combinaciones` va antes que los opcionales por la misma razón del DEFAULT
-- en PL/pgSQL que se explica en club_guardar_polla: los parámetros con default
-- tienen que cerrar la lista.
create or replace function public.club_registrar_venta_polla(
  p_polla_id      uuid,
  p_combinaciones jsonb,
  p_cliente_id    uuid default null,
  p_numero_ticket text default null,
  p_texto_original text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_venta_id uuid;
  v_precio  numeric;
  v_estado  text;
  v_combos  integer;
  v_total   numeric;
begin
  if not coalesce(public.tiene_capacidad(auth.uid(), 'pollas:fn_registrar_venta'), false) then
    raise exception 'Sin permiso para registrar la venta de la Polla.'
      using errcode = '42501';
  end if;

  if p_polla_id is null then
    raise exception 'Falta la Polla.'
      using errcode = '22004';
  end if;

  if p_combinaciones is null
     or jsonb_typeof(p_combinaciones) <> 'array'
     or jsonb_array_length(p_combinaciones) = 0 then
    raise exception 'La venta no tiene combinaciones.'
      using errcode = '22004';
  end if;

  -- La Polla tiene que existir y estar abierta. Cobrar sobre una Polla cerrada
  -- deja ventas fuera del ranking que ya se liquidó, y nadie sabe si cuentan.
  --
  -- La existencia se prueba con `v_precio is null`: `precio_unitario` es NOT
  -- NULL, así que si el SELECT no encontró fila queda NULL y entra por acá. Probar
  -- con `v_estado is null` no serviría, porque coalesce(default,'Abierta') en el
  -- SELECT de abajo vuelve a poner 'Abierta' en una Polla que no existe.
  select precio_unitario, coalesce(estado, 'Abierta')
    into v_precio, v_estado
  from public.pollas
  where id = p_polla_id;

  if v_precio is null then
    raise exception 'La Polla % no existe.', p_polla_id using errcode = 'P0002';
  end if;

  if v_estado <> 'Abierta' then
    raise exception 'La Polla está % y no admite ventas nuevas.', v_estado
      using errcode = '22000';
  end if;

  v_combos := jsonb_array_length(p_combinaciones);
  v_total  := v_combos * v_precio;

  insert into public.polla_ventas (polla_id, cliente_id, numero_ticket,
                                   combinaciones, precio_unitario, pagado,
                                   texto_original, estado)
  values (p_polla_id, p_cliente_id, p_numero_ticket,
          v_combos, v_precio, v_total, p_texto_original, 'Pagada')
  returning id into v_venta_id;

  insert into public.polla_combinaciones (venta_id, polla_id, posiciones)
  select v_venta_id, p_polla_id, c.combinacion
  from jsonb_array_elements(p_combinaciones) as c(combinacion);

  return v_venta_id;
end;
$$;

comment on function public.club_registrar_venta_polla(uuid, jsonb, uuid, text, text) is
  'Registra una venta de Polla con sus combinaciones, en una sola transacción.';

-- Apartar el aporte al acumulado.
--
-- Se hace con `disponible = disponible + p_monto` y NO con un read-modify-write
-- desde el cliente: dosliquidaciones simultáneas leen el mismo saldo y la segunda
-- sobrescribe a la primera, perdiendo el acumulado.
create or replace function public.club_aportar_acumulado_polla(
  p_polla_id uuid,
  p_monto    numeric,
  p_fecha    date default null
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_saldo numeric;
begin
  if not coalesce(public.tiene_capacidad(auth.uid(), 'pollas:fn_liquidar_polla'), false) then
    raise exception 'Sin permiso para mover el acumulado de la Polla.'
      using errcode = '42501';
  end if;

  if coalesce(p_monto, 0) <= 0 then
    raise exception 'El aporte al acumulado tiene que ser mayor que cero.'
      using errcode = '22023';
  end if;

  -- Un solo acumulado por Polla y fecha. Esta clave única es lo que permite el
  -- `on conflict` de abajo: sin ella, cada aporte insertaba una fila nueva y el
  -- saldo se repartía en pedazos que ninguna pantalla muestra.
  insert into public.polla_acumulado (polla_id, fecha, disponible, registrado_por)
  values (p_polla_id, coalesce(p_fecha, current_date), p_monto, auth.uid()::text)
  on conflict (polla_id, fecha) do update
    set disponible = public.polla_acumulado.disponible + excluded.disponible
    where public.polla_acumulado.pagado_at is null
  returning disponible into v_saldo;

  -- `v_saldo` queda NULL cuando el ON CONFLICT no actualizó nada, o sea cuando la
  -- fila ya estaba pagada: el `where` del DO UPDATE es lo que impide reponer
  -- plata en un acumulado que ya se liquidó.
  if v_saldo is null then
    raise exception 'El acumulado ya se pagó o no existe para esa fecha.'
      using errcode = '22000';
  end if;

  return v_saldo;
end;
$$;

comment on function public.club_aportar_acumulado_polla(uuid, numeric, date) is
  'Suma un aporte al acumulado de la Polla y devuelve el saldo resultante.';

-- Pagar el acumulado. La guarda `pagado_at is null` es lo que impide que se
-- pague dos veces: dos personas aprietan el botón a la vez y solo una gana.
create or replace function public.club_pagar_acumulado_polla(
  p_polla_id   uuid,
  p_cliente_id uuid,
  p_fecha      date default null
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_saldo numeric;
begin
  if not coalesce(public.tiene_capacidad(auth.uid(), 'pollas:fn_liquidar_polla'), false) then
    raise exception 'Sin permiso para pagar el acumulado de la Polla.'
      using errcode = '42501';
  end if;

  if p_cliente_id is null then
    raise exception 'Falta el cliente que cobra el acumulado.'
      using errcode = '22004';
  end if;

  -- `fecha = coalesce(p_fecha, current_date)`, no una comparación consigo misma: la
  -- condición tautológica dejó pasar cualquier fecha y alcanzó a pagar el
  -- acumulado de un día que ya estaba liquidado.
  update public.polla_acumulado
     set pagado_a = p_cliente_id,
         pagado_at = now()
   where polla_id = p_polla_id
     and fecha = coalesce(p_fecha, current_date)
     and pagado_at is null
  returning disponible into v_saldo;

  if v_saldo is null then
    raise exception 'El acumulado de esa fecha ya se pagó o no existe.'
      using errcode = '22000';
  end if;

  return v_saldo;
end;
$$;

comment on function public.club_pagar_acumulado_polla(uuid, uuid, date) is
  'Marca el acumulado como pagado a un cliente y devuelve el monto pagado. Solo una vez.';

-- Marcar una combinación anulada por un ejemplar invalidado después de la venta.
create or replace function public.club_anular_combinacion_polla(
  p_combinacion_id uuid,
  p_motivo         text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not coalesce(public.tiene_capacidad(auth.uid(), 'pollas:fn_liquidar_polla'), false) then
    raise exception 'Sin permiso para anular combinaciones de la Polla.'
      using errcode = '42501';
  end if;

  update public.polla_combinaciones
     set anulada = true,
         puntos = 0,
         motivo_anula = coalesce(nullif(p_motivo, ''), 'Ejemplar invalidado')
   where id = p_combinacion_id;

  if not found then
    raise exception 'La combinación % no existe.', p_combinacion_id using errcode = 'P0002';
  end if;

  return true;
end;
$$;

comment on function public.club_anular_combinacion_polla(uuid, text) is
  'Anula una combinación porque su ejemplar se invalidó después de la venta.';

-- Cambiar el estado de la Polla (Abierta / Liquidada / Cerrada).
create or replace function public.club_cambiar_estado_polla(
  p_id     uuid,
  p_estado text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not coalesce(public.tiene_capacidad(auth.uid(), 'pollas:fn_guardar_polla'), false) then
    raise exception 'Sin permiso para cambiar el estado de la Polla.'
      using errcode = '42501';
  end if;

  if p_estado is null or p_estado not in ('Abierta', 'Cerrada', 'Liquidada') then
    raise exception 'Estado inválido: %', p_estado using errcode = '22023';
  end if;

  update public.pollas set estado = p_estado where id = p_id;

  if not found then
    raise exception 'La Polla % no existe.', p_id using errcode = 'P0002';
  end if;

  return true;
end;
$$;

comment on function public.club_cambiar_estado_polla(uuid, text) is
  'Cambia el estado de la Polla: Abierta, Cerrada o Liquidada.';

-- ---------------------------------------------------------------------------
-- 6) Permisos de ejecución
--
-- `authenticated` sí ejecuta: la app corre con sesión. `anon` NO, porque la
-- llave pública del navegador alcanza para todo lo que estas funciones hacen.
-- ---------------------------------------------------------------------------
revoke execute on function public.club_guardar_polla(jsonb, uuid) from public, anon;
revoke execute on function public.club_registrar_venta_polla(uuid, jsonb, uuid, text, text) from public, anon;
revoke execute on function public.club_aportar_acumulado_polla(uuid, numeric, date) from public, anon;
revoke execute on function public.club_pagar_acumulado_polla(uuid, uuid, date) from public, anon;
revoke execute on function public.club_anular_combinacion_polla(uuid, text) from public, anon;
revoke execute on function public.club_cambiar_estado_polla(uuid, text) from public, anon;

grant execute on function public.club_guardar_polla(jsonb, uuid) to authenticated;
grant execute on function public.club_registrar_venta_polla(uuid, jsonb, uuid, text, text) to authenticated;
grant execute on function public.club_aportar_acumulado_polla(uuid, numeric, date) to authenticated;
grant execute on function public.club_pagar_acumulado_polla(uuid, uuid, date) to authenticated;
grant execute on function public.club_anular_combinacion_polla(uuid, text) to authenticated;
grant execute on function public.club_cambiar_estado_polla(uuid, text) to authenticated;

commit;