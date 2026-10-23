-- ============================================================================
--  CONTABILIDAD NIIF — PARTIDA DOBLE, NIC 21 (MULTIMONEDA) Y PRECISIÓN DECIMAL
--  Ejecutar en Supabase -> SQL Editor (una sola vez, es idempotente).
--
--  ---------------------------------------------------------------------
--  POR QUÉ ESTO EXISTE
--
--  La contabilidad que había en el sistema era "un saldo por cliente": un
--  número que sube y baja. Sirve para la caja, pero NO es una contabilidad
--  NIIF. Faltan tres cosas:
--
--    1. PARTIDA DOBLE: cada hecho económico deja DOS huellas (debe y haber) y
--       el total de ambas tiene que ser EXACTAMENTE el mismo. Si no cuadra,
--       el asiento no se registra. Acá el cuadre se valida EN EL SERVIDOR,
--       que es la única frontera de confianza real: la validación del
--       navegador es una cortesía para avisarle rápido al operador.
--
--    2. MULTIMONEDA (NIC 21): la operación ocurre en una moneda (la de
--       OPERACIÓN: la del banco, la del cliente) y la casa presenta en otra
--       (la de PRESENTACIÓN). El importe original NO se pierde: se guarda
--       JUNTO al importe de presentación, con la tasa de cambio HISTÓRICA
--       (NIC 21.39: la del día del hecho económico, no la de hoy ni la del
--       cierre). Si mañana cambia la tasa, el libro de ayer sigue diciendo
--       la verdad de ayer.
--
--    3. PRECISIÓN DECIMAL: los importes se guardan en `numeric` (decimal
--       EXACTO de PostgreSQL: 0.1 + 0.2 = 0.3, sin sorpresas de coma
--       flotante) y el redondeo a dos decimales se hace UNA vez, al guardar.
--
--  ---------------------------------------------------------------------
--  LOS REVERSOS NO BORRAN NADA
--
--  Un asiento registrado es INMUTABLE. Corregirlo no es borrarlo: es
--  registrar un CONTRA-ASIENTO (el inverso: lo que estaba en el debe pasa al
--  haber y viceversa, con la misma tasa histórica) que queda al lado del
--  original. Por eso:
--
--    · no hay permiso de INSERT/UPDATE/DELETE para el navegador,
--    · no hay policy de escritura: se escribe SOLO por la RPC,
--    · hay un TRIGGER que rechaza cualquier DELETE,
--    · y la clave foránea va con `on delete restrict`.
--
--  Borrar un asiento dejaría el balance descuadrado y sin rastro de por qué.
--
--  ---------------------------------------------------------------------
--  IDEMPOTENCIA
--
--  `clave` es la clave de idempotencia (mismo criterio que `p_idem` en
--  sql/marcas_venta.sql): si ya hay un asiento con esa clave, se devuelve el
--  que está, sin escribir nada. El índice ÚNICO de `clave` es la garantía
--  real contra dos llamadas simultáneas con la misma clave: la segunda
--  choca contra el índice y se traduce a "ya existía".
--
--  ---------------------------------------------------------------------
--  REQUISITOS
--
--  · src/core/db/seguridad_maestro.sql instalado (la guarda de capacidad usa
--    `public.tiene_capacidad`, igual que sql/pollas.sql y sql/remate_cierre.sql).
--  · La capacidad que se exige es `contabilidad:fn_registrar_movimiento`: un
--    asiento contable ES un movimiento de dinero, y así no hay una puerta
--    trasera que esquive el RBAC que ya gobierna depósitos, retiros y
--    traslados.
--  · La LECTURA del balance exige `contabilidad:celda_movimientos`.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) CABECERA DEL ASIENTO
--
--    `total_debe` y `total_haber` están DENORMALIZADOS a propósito: son la
--    suma de las líneas y se validan con un CHECK, así que la base se niega
--    sola a guardar un asiento descuadrado aunque alguien escriba por
--    debajo de la RPC. Con ellos, listar el libro es una consulta sola.
-- ---------------------------------------------------------------------------
create table if not exists public.asientos_niif (
  id                  uuid primary key default gen_random_uuid(),
  clave               text not null,
  fecha               date not null default current_date,
  concepto            text not null,
  -- Moneda en la que se CONTABILIZA (NIC 21.11).
  moneda_operacion    text not null default 'USD',
  -- Moneda en la que se PRESENTA el balance (NIC 21.11).
  moneda_presentacion text not null default 'USD',
  -- Tasa HISTÓRICA: 1 unidad de `moneda_operacion` = N de `moneda_presentacion`.
  tasa_cambio         numeric not null default 1,
  total_debe          numeric not null default 0,
  total_haber         numeric not null default 0,
  -- true si este asiento es el contra-asiento que revierte otro.
  es_contra_asiento   boolean not null default false,
  -- Clave del asiento que este contra-asiento revierte.
  asiento_origen      text,
  usuario             text,
  creado_at           timestamptz not null default now(),
  constraint asientos_niif_clave_unica  unique (clave),
  constraint asientos_niif_tasa_chk    check (tasa_cambio > 0),
  constraint asientos_niif_cuadrado_chk check (total_debe = total_haber),
  constraint asientos_niif_montos_chk  check (total_debe >= 0 and total_haber >= 0)
);

comment on table public.asientos_niif is
  'Cabecera de los asientos contables NIIF (partida doble). INMUTABLE: un error se corrige con un contra-asiento, nunca borrando.';
comment on column public.asientos_niif.clave is
  'Clave de idempotencia: registrar dos veces el mismo asiento NO lo duplica.';
comment on column public.asientos_niif.moneda_operacion is
  'Moneda en la que ocurrió el hecho económico (NIC 21.11).';
comment on column public.asientos_niif.moneda_presentacion is
  'Moneda en la que se presenta el balance (NIC 21.11).';
comment on column public.asientos_niif.tasa_cambio is
  'Tasa de cambio HISTÓRICA del hecho económico (NIC 21.39): 1 de moneda_operacion = N de moneda_presentacion.';
comment on column public.asientos_niif.es_contra_asiento is
  'true si este asiento revierte a otro (contra-asiento).';

-- ---------------------------------------------------------------------------
-- 2) LÍNEAS DEL ASIENTO
--
--    Cada línea es una cuenta del plan y su importe. Se guarda el importe
--    en la MONEDA DE OPERACIÓN y el importe en la MONEDA DE PRESENTACIÓN,
--    calculados con la tasa histórica del asiento: el libro tiene que poder
--    mostrar las dos cifras, y la conversión es reproducible porque la tasa
--    quedó congelada en la cabecera.
-- ---------------------------------------------------------------------------
create table if not exists public.asientos_niif_lineas (
  id                 uuid primary key default gen_random_uuid(),
  asiento_id         uuid not null references public.asientos_niif(id) on delete restrict,
  linea              integer not null default 1,
  cuenta             text not null,
  nombre_cuenta      text not null default '',
  -- Importes en la moneda de operación del asiento.
  debe               numeric not null default 0,
  haber              numeric not null default 0,
  -- Importes en la moneda de presentación (tasa histórica del asiento).
  debe_presentacion  numeric not null default 0,
  haber_presentacion numeric not null default 0,
  constraint asientos_niif_lineas_montos_chk
    check (debe >= 0 and haber >= 0 and not (debe > 0 and haber > 0))
);

comment on table public.asientos_niif_lineas is
  'Líneas de los asientos NIIF: una cuenta por línea, con su importe en debe o en haber.';
comment on column public.asientos_niif_lineas.debe_presentacion is
  'Importe en la moneda de presentación, con la tasa histórica de la cabecera (NIC 21.39).';

-- ---------------------------------------------------------------------------
-- 3) ÍNDICES
-- ---------------------------------------------------------------------------
create index if not exists asientos_niif_fecha_idx
  on public.asientos_niif (fecha);
create index if not exists asientos_niif_lineas_asiento_idx
  on public.asientos_niif_lineas (asiento_id);
create index if not exists asientos_niif_lineas_cuenta_idx
  on public.asientos_niif_lineas (cuenta);

-- ---------------------------------------------------------------------------
-- 4) INMUTABILIDAD: NO SE BORRA UN ASIENTO
--
--    Tres capas, porque una sola se puede desmontar por accidente:
--      a) no hay permiso de DELETE para el navegador,
--      b) no hay policy de escritura en el RLS (se escribe solo por la RPC),
--      c) este TRIGGER, que es la garantía final: aunque alguien tenga el
--         permiso, la base se niega.
--
--    Para un mantenimiento excepcional hay que `drop trigger` primero: es
--    preferible que el sistema se queje y que el técnico decida.
-- ---------------------------------------------------------------------------
create or replace function public.bloquear_borrado_asiento_niif()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'Los asientos contables NIIF son inmutables: no se borran. Registre un CONTRA-ASIENTO inverso para revertirlo (clave REVERSO:<clave>).'
    using errcode = '42501';
end;
$$;

drop trigger if exists trg_bloquear_borrado_asiento_niif on public.asientos_niif;
create trigger trg_bloquear_borrado_asiento_niif
  before delete on public.asientos_niif
  for each row execute function public.bloquear_borrado_asiento_niif();

drop trigger if exists trg_bloquear_borrado_linea_niif on public.asientos_niif_lineas;
create trigger trg_bloquear_borrado_linea_niif
  before delete on public.asientos_niif_lineas
  for each row execute function public.bloquear_borrado_asiento_niif();

-- ---------------------------------------------------------------------------
-- 5) RLS Y PERMISOS
--
--    LECTURA: la lleva el personal con `contabilidad:celda_movimientos`.
--    ESCRITURA: NO hay policy de insert/update/delete, así que el RLS las
--    nega para todos. La escritura pasa únicamente por la RPC
--    `rpc_registrar_asiento_niif`, que es `security definer` y por lo tanto
--    escribe como el dueño de la tabla.
-- ---------------------------------------------------------------------------
alter table public.asientos_niif enable row level security;
alter table public.asientos_niif_lineas enable row level security;

drop policy if exists "el personal lee los asientos" on public.asientos_niif;
create policy "el personal lee los asientos" on public.asientos_niif
  for select to authenticated
  using (public.tiene_capacidad(auth.uid(), 'contabilidad:celda_movimientos'));

drop policy if exists "el personal lee las lineas" on public.asientos_niif_lineas;
create policy "el personal lee las lineas" on public.asientos_niif_lineas
  for select to authenticated
  using (public.tiene_capacidad(auth.uid(), 'contabilidad:celda_movimientos'));

-- El navegador (anon) no lee ni escribe: el balance contable es información
-- de la casa. `anon` conserva el EXECUTE de la RPC porque es el rol con el
-- que viaja la llave del cliente, pero la guarda de capacidad de adentro lo
-- rechaza igual: sin sesión de Supabase no hay `auth.uid()` y no hay
-- capacidad que conceda.
revoke all on public.asientos_niif, public.asientos_niif_lineas from anon;
revoke insert, update, delete on public.asientos_niif, public.asientos_niif_lineas from anon, authenticated;
grant select on public.asientos_niif, public.asientos_niif_lineas to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6) RPC: REGISTRAR UN ASIENTO EN PARTIDA DOBLE
--
--    Qué garantiza:
--      · la capacidad (en el servidor, no en el navegador),
--      · que el asiento CUADRE (debe = haber) o no se registra nada,
--      · que sea idempotente por `clave`,
--      · que los importes en moneda de presentación los calcule EL SERVIDOR
--        con la tasa histórica (el cliente no decide la conversión),
--      · y que quede TODO en una sola transacción: cabecera y líneas, o nada.
--
--    OJO con el orden de los parámetros: en PL/pgSQL un parámetro con
--    DEFAULT tiene que ir AL FINAL, porque los que le siguen heredan ese
--    default y PostgreSQL los rechaza (mismo criterio que en
--    sql/contabilidad.sql y sql/pollas.sql).
-- ---------------------------------------------------------------------------
create or replace function public.rpc_registrar_asiento_niif(
  p_clave               text,
  p_fecha               date,
  p_concepto            text,
  p_moneda_operacion    text,
  p_moneda_presentacion text,
  p_tasa_cambio         numeric,
  p_lineas              jsonb,
  p_es_contra_asiento   boolean default false,
  p_asiento_origen      text default null,
  p_usuario             text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_clave       text;
  v_concepto    text;
  v_fecha       date;
  v_mon_oper    text;
  v_mon_pres    text;
  v_tasa        numeric;
  v_total_debe  numeric := 0;
  v_total_haber numeric := 0;
  v_debe        numeric;
  v_haber       numeric;
  v_cuenta      text;
  v_nombre      text;
  v_id          uuid;
  v_linea       integer := 0;
  v_item        jsonb;
  v_existente   record;
begin
  ------------------------------------------------------------------
  -- 1) PERMISO EN EL SERVIDOR
  --
  --    Escribir un asiento es escribir un movimiento de dinero: usa la misma
  --    capacidad que los depósitos, los retiros y los traslados. Sin sesión
  --    de Supabase `auth.uid()` es null y `tiene_capacidad` devuelve false:
  --    cierra en falso.
  ------------------------------------------------------------------
  if not coalesce(public.tiene_capacidad(auth.uid(), 'contabilidad:fn_registrar_movimiento'), false) then
    raise exception 'Sin permiso para registrar asientos contables.' using errcode = '42501';
  end if;

  ------------------------------------------------------------------
  -- 2) DATOS MÍNIMOS
  ------------------------------------------------------------------
  v_clave := nullif(btrim(coalesce(p_clave, '')), '');
  if v_clave is null then
    raise exception 'El asiento necesita una clave de idempotencia.';
  end if;

  v_concepto := nullif(btrim(coalesce(p_concepto, '')), '');
  if v_concepto is null then
    raise exception 'El asiento necesita un concepto.';
  end if;

  v_fecha    := coalesce(p_fecha, current_date);
  v_mon_oper := upper(btrim(coalesce(p_moneda_operacion, 'USD')));
  v_mon_pres := upper(btrim(coalesce(p_moneda_presentacion, 'USD')));
  v_tasa     := coalesce(p_tasa_cambio, 1);

  if v_tasa <= 0 then
    raise exception 'La tasa de cambio historica debe ser un numero mayor a cero.';
  end if;

  if p_lineas is null or jsonb_typeof(p_lineas) <> 'array' then
    raise exception 'Las lineas del asiento deben ser una lista.';
  end if;

  if jsonb_array_length(p_lineas) < 2 then
    raise exception 'Un asiento en partida doble necesita al menos dos lineas: un debe y un haber.';
  end if;

  ------------------------------------------------------------------
  -- 3) IDEMPOTENCIA
  --
  --    Si ya existe un asiento con esa clave, se devuelve ESE asiento y no
  --    se escribe nada. Repetir la llamada (por un reintento de red, por
  --    ejemplo) es seguro.
  ------------------------------------------------------------------
  select a.id, a.total_debe, a.total_haber, a.moneda_presentacion
    into v_existente
    from public.asientos_niif a
   where a.clave = v_clave;

  if found then
    return jsonb_build_object(
      'ok',                 true,
      'id',                 v_existente.id,
      'clave',              v_clave,
      'ya_existia',         true,
      'total_debe',         v_existente.total_debe,
      'total_haber',        v_existente.total_haber,
      'moneda_presentacion', v_existente.moneda_presentacion
    );
  end if;

  ------------------------------------------------------------------
  -- 4) PARTIDA DOBLE: PRIMERO SE VALIDA, DESPUÉS SE ESCRIBE
  --
  --    Se recorre la lista UNA vez para validar cada línea y acumular los
  --    totales, y solo después se inserta la cabecera. Si se insertara
  --    primero, el CHECK `total_debe = total_haber` de la tabla rechazaría
  --    el asiento descuadrado con un error de constraint (un mensaje técnico
  --    en vez de uno de negocio), y además quedaría una cabecera huérfana.
  --
  --    Los importes se leen con una máscara numérica: un texto que no sea
  --    número se trata como 0 en vez de reventar la función con un error de
  --    cast.
  ------------------------------------------------------------------
  for v_item in select * from jsonb_array_elements(p_lineas) loop
    v_cuenta := nullif(btrim(coalesce(v_item->>'cuenta', '')), '');
    if v_cuenta is null then
      raise exception 'Una linea del asiento no tiene cuenta.';
    end if;

    v_debe := case when (v_item->>'debe') ~ '^-?[0-9]+(\.[0-9]+)?$'
                   then round((v_item->>'debe')::numeric, 2) else 0 end;
    v_haber := case when (v_item->>'haber') ~ '^-?[0-9]+(\.[0-9]+)?$'
                    then round((v_item->>'haber')::numeric, 2) else 0 end;

    if v_debe < 0 or v_haber < 0 then
      raise exception 'La linea % no puede tener importes negativos: para revertir, registre un contra-asiento.', v_cuenta;
    end if;
    if v_debe > 0 and v_haber > 0 then
      raise exception 'La linea % no puede tener debe y haber a la vez.', v_cuenta;
    end if;
    if v_debe = 0 and v_haber = 0 then
      raise exception 'La linea % no tiene importe.', v_cuenta;
    end if;

    v_total_debe  := v_total_debe + v_debe;
    v_total_haber := v_total_haber + v_haber;
  end loop;

  -- EL CUADRE, EN EL SERVIDOR. Acá es donde se cae el asiento si no da.
  if v_total_debe <> v_total_haber then
    raise exception
      'El asiento no cuadra: debe % y haber % (diferencia %). No se registro nada.',
      to_char(v_total_debe, 'FM999999999990.00'),
      to_char(v_total_haber, 'FM999999999990.00'),
      to_char(v_total_debe - v_total_haber, 'FM999999999990.00');
  end if;

  ------------------------------------------------------------------
  -- 5) ESCRITURA (cabecera + líneas) EN LA MISMA TRANSACCIÓN
  --
  --    El bloque BEGIN/EXCEPTION es una subtransacción: si el índice único
  --    de `clave` revienta (dos cajas registrando el mismo asiento a la vez),
  --    PostgreSQL deshace TODO lo escrito y se entra al manejador con la
  --    base limpia. Ahí se devuelve el asiento que ganó la carrera, en vez
  --    de dejar un error crudo de unicidad.
  ------------------------------------------------------------------
  begin
    insert into public.asientos_niif (
      clave, fecha, concepto, moneda_operacion, moneda_presentacion,
      tasa_cambio, total_debe, total_haber, es_contra_asiento, asiento_origen, usuario
    )
    values (
      v_clave, v_fecha, v_concepto, v_mon_oper, v_mon_pres,
      v_tasa, v_total_debe, v_total_haber,
      coalesce(p_es_contra_asiento, false), p_asiento_origen, p_usuario
    )
    returning id into v_id;

    v_linea := 0;
    for v_item in select * from jsonb_array_elements(p_lineas) loop
      v_cuenta := nullif(btrim(coalesce(v_item->>'cuenta', '')), '');
      v_nombre := coalesce(nullif(btrim(coalesce(v_item->>'nombre_cuenta', '')), ''), v_cuenta);

      v_debe := case when (v_item->>'debe') ~ '^-?[0-9]+(\.[0-9]+)?$'
                     then round((v_item->>'debe')::numeric, 2) else 0 end;
      v_haber := case when (v_item->>'haber') ~ '^-?[0-9]+(\.[0-9]+)?$'
                      then round((v_item->>'haber')::numeric, 2) else 0 end;

      v_linea := v_linea + 1;

      insert into public.asientos_niif_lineas (
        asiento_id, linea, cuenta, nombre_cuenta,
        debe, haber, debe_presentacion, haber_presentacion
      )
      values (
        v_id, v_linea, v_cuenta, v_nombre,
        v_debe, v_haber,
        -- La conversión la hace el SERVIDOR con la tasa histórica: el
        -- cliente no decide cuánto vale el dinero.
        round(v_debe * v_tasa, 2), round(v_haber * v_tasa, 2)
      );
    end loop;

    return jsonb_build_object(
      'ok',                 true,
      'id',                 v_id,
      'clave',              v_clave,
      'ya_existia',         false,
      'total_debe',         v_total_debe,
      'total_haber',        v_total_haber,
      'moneda_presentacion', v_mon_pres,
      'tasa_cambio',        v_tasa
    );
  exception
    when unique_violation then
      select a.id, a.total_debe, a.total_haber, a.moneda_presentacion
        into v_existente
        from public.asientos_niif a
       where a.clave = v_clave;

      -- Si el choque no fue por la clave (no debería pasar: es el único
      -- UNIQUE de la tabla), el error REAL se vuelve a levantar. Devolver un
      -- "ya existía" falso escondería el problema de verdad.
      if not found then
        raise;
      end if;

      return jsonb_build_object(
        'ok',                 true,
        'id',                 v_existente.id,
        'clave',              v_clave,
        'ya_existia',         true,
        'total_debe',         v_existente.total_debe,
        'total_haber',        v_existente.total_haber,
        'moneda_presentacion', v_existente.moneda_presentacion
      );
  end;
end;
$$;

comment on function public.rpc_registrar_asiento_niif(text, date, text, text, text, numeric, jsonb, boolean, text, text) is
  'Registra un asiento NIIF en partida doble. Valida que debe = haber EN EL SERVIDOR, es idempotente por clave y NUNCA borra: para revertir se registra un contra-asiento.';

revoke all on function public.rpc_registrar_asiento_niif(text, date, text, text, text, numeric, jsonb, boolean, text, text) from public;
grant execute on function public.rpc_registrar_asiento_niif(text, date, text, text, text, numeric, jsonb, boolean, text, text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7) VISTA: BALANCE DE COMPROBACIÓN NIIF
--
--    Una fila por cuenta, con el total del debe, el total del haber y el
--    saldo (debe − haber) en la MONEDA DE PRESENTACIÓN.
--
--    `security_invoker = true` (PG15+): la vista se ejecuta con los
--    privilegios de quien consulta, así que RESPETA el RLS de las tablas
--    bases. Sin esto, la vista correría como su dueño y devolvería el
--    balance COMPLETO a cualquiera que tuviera un simple SELECT.
--
--    La agregación es sobre `numeric`, que es decimal EXACTO: la suma de las
--    líneas de una cuenta da el mismo número que la suma de los importes
--    redondeados, sin el error de coma flotante que arruinaria el cuadre en
--    el navegador.
-- ---------------------------------------------------------------------------
drop view if exists public.vw_balance_comprobacion_niif;

create view public.vw_balance_comprobacion_niif with (security_invoker = true) as
select
  l.cuenta,
  coalesce(nullif(btrim(l.nombre_cuenta), ''), l.cuenta) as nombre_cuenta,
  a.moneda_presentacion,
  coalesce(sum(l.debe_presentacion), 0)                     as total_debe,
  coalesce(sum(l.haber_presentacion), 0)                    as total_haber,
  coalesce(sum(l.debe_presentacion - l.haber_presentacion), 0) as saldo,
  count(*)                                                   as movimientos
from public.asientos_niif_lineas l
join public.asientos_niif a on a.id = l.asiento_id
group by
  l.cuenta,
  coalesce(nullif(btrim(l.nombre_cuenta), ''), l.cuenta),
  a.moneda_presentacion;

comment on view public.vw_balance_comprobacion_niif is
  'Balance de comprobación NIIF: total debe, total haber y saldo por cuenta, en la moneda de presentación.';

grant select on public.vw_balance_comprobacion_niif to anon, authenticated, service_role;

-- Forzar a PostgREST a recargar el esquema: sin esto, recién creada la vista
-- sigue respondiendo 404/PGRST205 hasta que Supabase refresque su caché.
notify pgrst, 'reload schema';

-- ============================================================================
--  VERIFICACIÓN
--
--    -- ¿El libro cuadra? (tiene que dar 0,00)
--    select sum(total_debe) - sum(total_haber) as diferencia
--      from public.vw_balance_comprobacion_niif;
--
--    -- El balance, cuenta por cuenta:
--    select * from public.vw_balance_comprobacion_niif order by cuenta;
--
--    -- Los asientos, con su clave de idempotencia:
--    select clave, fecha, concepto, moneda_operacion, moneda_presentacion,
--           tasa_cambio, total_debe, total_haber, es_contra_asiento
--      from public.asientos_niif order by fecha desc, creado_at desc;
--
--    -- Registrar un asiento (debe = haber = 100):
--    --   {"clave":"PRUEBA-1","fecha":"2026-01-31","concepto":"Prueba de cuadre",
--    --    "moneda_operacion":"VES","moneda_presentacion":"USD","tasa_cambio":36.5,
--    --    "lineas":[{"cuenta":"1.1.01","nombre_cuenta":"Caja","debe":100,"haber":0},
--    --              {"cuenta":"2.1.01","nombre_cuenta":"Clientes","debe":0,"haber":100}]}
--    select public.rpc_registrar_asiento_niif(
--      'PRUEBA-1', '2026-01-31', 'Prueba de cuadre', 'VES', 'USD', 36.5,
--      '[{"cuenta":"1.1.01","nombre_cuenta":"Caja","debe":100,"haber":0},
--        {"cuenta":"2.1.01","nombre_cuenta":"Clientes","debe":0,"haber":100}]'::jsonb);
--
--    -- Un asiento descuadrado tiene que RECHAZARSE (debe ≠ haber):
--    -- select public.rpc_registrar_asiento_niif('PRUEBA-2', current_date, 'Mal', 'USD', 'USD', 1,
--    --   '[{"cuenta":"1.1.01","debe":100,"haber":0},{"cuenta":"2.1.01","debe":0,"haber":90}]'::jsonb);
-- ============================================================================
