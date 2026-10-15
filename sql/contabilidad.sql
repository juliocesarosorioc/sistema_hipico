-- ============================================================
--  CONTABILIDAD: RPC TRANSACCIONALES
--  Ejecutar en Supabase -> SQL Editor (una sola vez, es idempotente).
--
-- POR QUE ESTO EXISTE
--  El legacy (js/caja.js, js/depositos.js) movia dinero con una secuencia de
--  `await` sin rollback: si fallaba el UPDATE del cliente DESPUES de haber
--  acreditado el banco, los saldos quedaban descuadrados para siempre y no
--  habia forma de rehacerlos. Estas funciones hacen cada movimiento completo
--  dentro de UNA transaccion: o se aplica todo (cliente + banco + asiento) o no
--  se aplica nada.
--
-- CONVENCION MONETARIA (la del legacy, js/depositos.js:187)
--  'VES' = bolivares, 'USD' = dolares. La tasa es Bs por 1 USD, por eso se
--  DIVIDE:  montoUsd = esVES ? monto / tasa : monto
-- ============================================================

-- ------------------------------------------------------------------
-- 0) COLUMNAS QUE EL CODIGO ESPERA (idempotente)
--    El legacy filtraba en memoria las columnas existentes para no fallar si
--    faltaba el SQL; aqui se agregan todas para que el asiento sea completo.
-- ------------------------------------------------------------------
alter table public.depositos
    add column if not exists cliente_id        uuid,
    add column if not exists cliente_nombre    text,
    add column if not exists tipo_operacion    text,
    add column if not exists monto             numeric,
    add column if not exists monto_usd         numeric,
    add column if not exists nota              text,
    add column if not exists modalidad         text,
    add column if not exists banco_id          uuid,
    add column if not exists banco_nombre      text,
    add column if not exists banco_codigo      text,
    add column if not exists referencia        text,
    add column if not exists moneda            text not null default 'USD',
    add column if not exists tasa_cambio       numeric not null default 1,
    add column if not exists fecha              timestamptz not null default now();

alter table public.transacciones_financieras
    add column if not exists cliente_origen_id      uuid,
    add column if not exists cliente_origen_nombre  text,
    add column if not exists cliente_destino_id     uuid,
    add column if not exists cliente_destino_nombre text,
    add column if not exists tipo_operacion         text,
    add column if not exists monto                  numeric,
    add column if not exists monto_usd              numeric,
    add column if not exists nota                   text,
    add column if not exists modalidad              text,
    add column if not exists banco_id               uuid,
    add column if not exists banco_nombre           text,
    add column if not exists banco_codigo           text,
    add column if not exists referencia             text,
    add column if not exists moneda                 text not null default 'USD',
    add column if not exists tasa_cambio            numeric not null default 1,
    add column if not exists fecha                   timestamptz not null default now(),
    add column if not exists numero_cuenta          text,
    add column if not exists tipo_cuenta            text,
    add column if not exists cedula_rif             text,
    add column if not exists nombre_beneficiario    text;

alter table public.bancos
    add column if not exists moneda_codigo text,
    add column if not exists saldo_local    numeric not null default 0;

comment on column public.bancos.saldo_local is
  'Saldo de la cuenta en su MONEDA propia (no en USD)';

-- NOTA: la tabla `tasas_referencia` que usa `club_tasa_vigente()` esta creada
-- en sql/tasas_referencia.sql (mismo esquema: tipo, tasa, fecha_aplicar). Este
-- archivo no la duplica para no crear un segundo indice identical.

-- ------------------------------------------------------------------
-- 1) TIPOS DE OPERACION
-- ------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'club_tipo_deposito') then
    create type public.club_tipo_deposito as enum ('Normal', 'Otorgar Aval', 'Pagar Aval');
  end if;
  if not exists (select 1 from pg_type where typname = 'club_tipo_transaccion') then
    create type public.club_tipo_transaccion as enum ('TRANSFERENCIA', 'RETIRO');
  end if;
end
$$;

-- ------------------------------------------------------------------
-- 2) DEPOSITO / INGRESO / AVAL   (js/depositos.js:205-239)
--
--    Normal        -> saldo del cliente + monto, banco + monto
--    Otorgar Aval  -> saldo + monto, aval + monto   (no mueve banco: es garantia)
--    Pagar Aval    -> saldo + monto, aval - monto (topa en 0), banco + monto
--
--    Validacion de la tasa replicada del legacy: en VES la tasa debe ser > 0.
-- ------------------------------------------------------------------
create or replace function public.club_registrar_deposito(
  p_cliente_id       uuid,
  p_tipo             public.club_tipo_deposito,
  p_monto            numeric,
  p_moneda           text default 'USD',
  p_tasa             numeric default 1,
  p_modalidad        text default null,
  p_banco_id         uuid default null,
  p_referencia       text default null,
  p_nota             text default null,
  p_creditar_banco   boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cliente   public.clientes%rowtype;
  v_banco     public.bancos%rowtype;
  v_monto_usd numeric;
  v_saldo     numeric;
  v_aval      numeric;
  v_deuda     numeric;
  v_a_deuda   numeric;
  v_a_aval    numeric;
  v_exceso    numeric;
  v_credito   numeric;
  v_es_ves    boolean;
  v_es_banco_ves boolean;
begin
  if p_monto is null or p_monto <= 0 then
    raise exception 'El monto debe ser un numero mayor a cero.';
  end if;

  select * into v_cliente from public.clientes where id = p_cliente_id;
  if not found then
    raise exception 'Cliente no encontrado.';
  end if;

  v_es_ves := upper(coalesce(p_moneda, 'USD')) = 'VES';

  -- Tasa obligatoria y positiva cuando el movimiento es en bolivares.
  if v_es_ves and (p_tasa is null or p_tasa <= 0) then
    raise exception 'Indique la tasa aplicada al ingreso en Bs.';
  end if;

  -- El banco se lee siempre que se informe, aunque luego no se acredite
  -- (Otorgar Aval): si no, el asiento queda sin nombre de banco.
  if p_banco_id is not null then
    select * into v_banco from public.bancos where id = p_banco_id;
    if not found then
      raise exception 'Banco receptor no encontrado.';
    end if;
  end if;

  -- VES = Bs, tasa = Bs por 1 USD -> se DIVIDE para llevar a dolares.
  v_monto_usd := case when v_es_ves then p_monto / p_tasa else p_monto end;

  v_saldo := coalesce(v_cliente.saldo_actual, 0);
  v_aval  := coalesce(v_cliente.aval, 0);

  -- ------------------------------------------------------------------
  -- AVAL = CREDITO NEGADO, NO EFECTIVO.
  --
  -- El aval NO entra a la cuenta y NO se retira: por eso el retiro de abajo
  -- prohibe dejar el saldo en negativo aunque tenga aval, y por eso el banco
  -- no se acredita en 'Otorgar Aval'.
  --
  -- Jugar con aval deja el saldo en negativo hasta -aval: esa deuda es real y se
  -- cobra con un deposito normal.
  --
  -- ANTES (mal): 'Otorgar Aval' sumaba a `saldo_actual` Y a `aval`, y 'Pagar
  -- Aval' tambien abonaba el saldo. Eso hacia tres cosas malas: el aval
  -- contaba DOS veces como poder de compra, dar $500 de aval concedia $1000 de
  -- poder, y el cliente podia RETIRAR esos $500 como si fueran efectivo
  -- (justo lo que el propio retiro de mas abajo impide). 'Pagar Aval', que se
  -- supone que el cliente devuelve la plata, le CREABA saldo.
  -- ------------------------------------------------------------------
  v_saldo := coalesce(v_cliente.saldo_actual, 0);
  v_aval  := coalesce(v_cliente.aval, 0);

  if p_tipo = 'Otorgar Aval' then
    v_aval := v_aval + p_monto;            -- solo la linea de credito
  elsif p_tipo = 'Pagar Aval' then
    -- El cliente devuelve la plata del credito. Cascada en tres tramos:
    --   1) cancela la deuda que dejo al jugar (saldo en negativo),
    --   2) reduce la linea de aval,
    --   3) lo que sobrepase deuda+aval entra al saldo: es plata real que YA
    --      se acredito al banco, asi que no puede desaparecer (antes el
    --      excedente se perdia: el banco cobraba y el cliente no lo veia).
    -- Ej: saldo -300, aval 300, paga 200 -> saldo -100, aval 300 (aun debe 100).
    -- Ej: saldo -300, aval 300, paga 450 -> saldo 0, aval 150.
    -- Ej: saldo    0, aval 300, paga 450 -> saldo 150, aval 0.
    v_deuda   := greatest(-v_saldo, 0);
    v_a_deuda := least(p_monto, v_deuda);
    v_saldo   := v_saldo + v_a_deuda;          -- tramo 1
    v_exceso  := p_monto - v_a_deuda;
    v_a_aval  := least(v_exceso, v_aval);
    v_aval    := v_aval - v_a_aval;            -- tramo 2
    v_saldo   := v_saldo + (v_exceso - v_a_aval); -- tramo 3 (excedente real)
  else
    v_saldo := v_saldo + p_monto;
  end if;

  update public.clientes
     set saldo_actual = v_saldo,
         aval         = case when p_tipo <> 'Normal' then v_aval else v_cliente.aval end
   where id = p_cliente_id;

  -- Credito al banco receptor (saldo en la MONEDA de la cuenta).
  if p_creditar_banco and p_tipo <> 'Otorgar Aval' and p_banco_id is not null then
    v_es_banco_ves := upper(coalesce(v_banco.moneda_codigo, 'USD')) = 'VES';
    -- Si la cuenta es en Bs se suma el monto crudo; si es USD, su equivalente.
    v_credito := case when v_es_banco_ves then p_monto else v_monto_usd end;
    update public.bancos set saldo_local = coalesce(saldo_local, 0) + v_credito
     where id = p_banco_id;
  end if;

  insert into public.depositos (
    cliente_id, cliente_nombre, tipo_operacion, monto, monto_usd, nota,
    modalidad, banco_id, banco_nombre, banco_codigo, referencia, moneda, tasa_cambio
  )
  values (
    p_cliente_id, v_cliente.nombre, p_tipo::text, p_monto, v_monto_usd, p_nota,
    p_modalidad, p_banco_id, v_banco.nombre, v_banco.nombre,
    p_referencia, coalesce(p_moneda, 'USD'), coalesce(p_tasa, 1)
  );

  return jsonb_build_object(
    'ok', true,
    'saldo_nuevo', v_saldo,
    'aval_nuevo',   case when p_tipo <> 'Normal' then v_aval else coalesce(v_cliente.aval, 0) end,
    'monto_usd',    v_monto_usd
  );
end;
$$;

revoke all on function public.club_registrar_deposito(uuid, public.club_tipo_deposito, numeric, text, numeric, text, uuid, text, text, boolean) from anon;
grant execute on function public.club_registrar_deposito(uuid, public.club_tipo_deposito, numeric, text, numeric, text, uuid, text, text, boolean) to anon, authenticated;

-- ------------------------------------------------------------------
-- 3) TRASLADO ENTRE CLIENTES   (js/caja.js:212-225)
--    El saldo viaja de un cliente a otro y la tesoreria no se toca.
-- ------------------------------------------------------------------
create or replace function public.club_registrar_traslado(
  p_origen_id  uuid,
  p_destino_id uuid,
  p_monto      numeric,
  p_nota       text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_origen  public.clientes%rowtype;
  v_destino public.clientes%rowtype;
begin
  if p_monto is null or p_monto <= 0 then
    raise exception 'El monto debe ser un numero mayor a cero.';
  end if;
  if p_origen_id is null then
    raise exception 'Debe seleccionar un cliente origen.';
  end if;
  if p_destino_id is null then
    raise exception 'Debe seleccionar un cliente destino.';
  end if;
  if p_origen_id = p_destino_id then
    raise exception 'No puede transferir a si mismo.';
  end if;

  select * into v_origen  from public.clientes where id = p_origen_id;
  if not found then raise exception 'Cliente origen no encontrado.'; end if;
  select * into v_destino from public.clientes where id = p_destino_id;
  if not found then raise exception 'Cliente destino no encontrado.'; end if;

  -- Un traslado es una salida de saldo: no puede dejar al origen en negativo.
  if coalesce(v_origen.saldo_actual, 0) < p_monto then
    raise exception 'Saldo insuficiente en el origen: tiene % y traslada %.',
      to_char(coalesce(v_origen.saldo_actual, 0), 'FM999999999990.00'),
      to_char(p_monto, 'FM999999999990.00');
  end if;

  update public.clientes set saldo_actual = coalesce(saldo_actual, 0) - p_monto
   where id = p_origen_id;
  update public.clientes set saldo_actual = coalesce(saldo_actual, 0) + p_monto
   where id = p_destino_id;

  insert into public.transacciones_financieras (
    cliente_origen_id, cliente_origen_nombre,
    cliente_destino_id, cliente_destino_nombre,
    tipo_operacion, monto, monto_usd, tasa_cambio, moneda, nota
  )
  values (
    p_origen_id, v_origen.nombre,
    p_destino_id, v_destino.nombre,
    'TRANSFERENCIA', p_monto, p_monto, 1, 'USD', p_nota
  );

  return jsonb_build_object(
    'ok', true,
    'origen_nuevo',  coalesce(v_origen.saldo_actual, 0) - p_monto,
    'destino_nuevo', coalesce(v_destino.saldo_actual, 0) + p_monto
  );
end;
$$;

revoke all on function public.club_registrar_traslado(uuid, uuid, numeric, text) from anon;
grant execute on function public.club_registrar_traslado(uuid, uuid, numeric, text) to anon, authenticated;

-- ------------------------------------------------------------------
-- 4) RETIRO A LA TESORERIA   (js/caja.js:246-273)
--    Sale dinero de la casa: descuenta al cliente Y al banco receptor.
-- ------------------------------------------------------------------
create or replace function public.club_registrar_retiro(
  p_origen_id     uuid,
  p_monto         numeric,
  p_moneda        text default 'USD',
  p_tasa          numeric default 1,
  p_modalidad     text default null,
  p_banco_id      uuid default null,
  p_referencia    text default null,
  p_numero_cuenta text default null,
  p_tipo_cuenta   text default null,
  p_cedula_rif    text default null,
  p_beneficiario  text default null,
  p_nota          text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cliente       public.clientes%rowtype;
  v_banco         public.bancos%rowtype;
  v_monto_usd     numeric;
  v_saldo         numeric;
  v_debito_banco  numeric;
  v_es_ves        boolean;
  v_es_banco_ves  boolean;
begin
  if p_monto is null or p_monto <= 0 then
    raise exception 'El monto debe ser un numero mayor a cero.';
  end if;
  if p_modalidad is null or btrim(p_modalidad) = '' then
    raise exception 'Debe indicar la modalidad del retiro.';
  end if;

  select * into v_cliente from public.clientes where id = p_origen_id;
  if not found then raise exception 'Cliente origen no encontrado.'; end if;

  v_es_ves := upper(coalesce(p_moneda, 'USD')) = 'VES';
  if v_es_ves and (p_tasa is null or p_tasa <= 0) then
    raise exception 'Indique la tasa aplicada al egreso en Bs.';
  end if;

  v_monto_usd := case when v_es_ves then p_monto / p_tasa else p_monto end;

  v_saldo := coalesce(v_cliente.saldo_actual, 0) - p_monto;
  -- No se permite dejar el saldo en negativo: el retiro es salida de dinero
  -- real y la diferencia quedaria descuadrada sin explicacion.
  if v_saldo < 0 then
    raise exception 'Saldo insuficiente: el cliente tiene % y el retiro es de %.',
      to_char(coalesce(v_cliente.saldo_actual, 0), 'FM999999999990.00'),
      to_char(p_monto, 'FM999999999990.00');
  end if;
  update public.clientes set saldo_actual = v_saldo where id = p_origen_id;

  if p_banco_id is not null then
    select * into v_banco from public.bancos where id = p_banco_id;
    if not found then raise exception 'Banco no encontrado.'; end if;
    v_es_banco_ves := upper(coalesce(v_banco.moneda_codigo, 'USD')) = 'VES';
    -- El banco se debita en SU moneda: Bs si la cuenta es Bs, dolares si es USD.
    v_debito_banco := case when v_es_banco_ves then p_monto else v_monto_usd end;
    update public.bancos set saldo_local = coalesce(saldo_local, 0) - v_debito_banco
     where id = p_banco_id;
  end if;

  insert into public.transacciones_financieras (
    cliente_origen_id, cliente_origen_nombre, tipo_operacion,
    monto, monto_usd, tasa_cambio, moneda, modalidad, nota,
    banco_id, banco_nombre, banco_codigo, referencia,
    numero_cuenta, tipo_cuenta, cedula_rif, nombre_beneficiario
  )
  values (
    p_origen_id, v_cliente.nombre, 'RETIRO',
    p_monto, v_monto_usd, coalesce(p_tasa, 1), coalesce(p_moneda, 'USD'),
    p_modalidad, p_nota,
    p_banco_id, v_banco.nombre, v_banco.nombre,
    p_referencia,
    p_numero_cuenta, p_tipo_cuenta, p_cedula_rif, p_beneficiario
  );

  return jsonb_build_object('ok', true, 'saldo_nuevo', v_saldo, 'monto_usd', v_monto_usd);
end;
$$;

revoke all on function public.club_registrar_retiro(uuid, numeric, text, numeric, text, uuid, text, text, text, text, text, text) from anon;
grant execute on function public.club_registrar_retiro(uuid, numeric, text, numeric, text, uuid, text, text, text, text, text, text) to anon, authenticated;

-- ------------------------------------------------------------------
-- 5) BANCOS   (js/bancos.js:80-93, 129, 142)
--    OJO: en PostgreSQL un parametro con DEFAULT no puede ir seguido de otro
--    sin default ("input parameters after one with a default value must also
--    have default values"), por eso `p_id` va de ultimo. El cliente llama con
--    argumentos con nombre, asi que el orden no le afecta.
--    Se borra la firma vieja para que no queden dos overloads (PostgREST
--    responderia "function club_guardar_banco is not unique").
-- ------------------------------------------------------------------
drop function if exists public.club_guardar_banco(uuid, text, text, numeric);

create or replace function public.club_guardar_banco(
  p_nombre        text,
  p_moneda_codigo text,
  p_saldo_local   numeric,
  p_id            uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_nombre is null or btrim(p_nombre) = '' then
    raise exception 'El nombre del banco es obligatorio.';
  end if;
  if p_moneda_codigo is null or btrim(p_moneda_codigo) = '' then
    raise exception 'La moneda del banco es obligatoria.';
  end if;
  if p_saldo_local is null then
    raise exception 'El saldo es obligatorio.';
  end if;

  if p_id is null then
    insert into public.bancos (nombre, moneda_codigo, saldo_local)
    values (upper(btrim(p_nombre)), upper(btrim(p_moneda_codigo)), p_saldo_local)
    returning id into v_id;
  else
    v_id := p_id;
    update public.bancos
       set nombre = upper(btrim(p_nombre)),
           moneda_codigo = upper(btrim(p_moneda_codigo)),
           saldo_local = p_saldo_local
     where id = p_id;
    if not found then raise exception 'Banco no encontrado.'; end if;
  end if;

  return v_id;
end;
$$;

revoke all on function public.club_guardar_banco(text, text, numeric, uuid) from anon;
grant execute on function public.club_guardar_banco(text, text, numeric, uuid) to anon, authenticated;

-- ------------------------------------------------------------------
-- 6) TASAS   (js/monedas.js:341-348)
--    `tasas_cambio` es APPEND-ONLY: cada cambio es una fila nueva y la
--    vigente es la ultima por fecha. Nunca se actualiza una tasa vieja.
-- ------------------------------------------------------------------
create or replace function public.club_registrar_tasa(p_moneda_id uuid, p_tasa numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_tasa is null or p_tasa <= 0 then
    raise exception 'La tasa debe ser un numero mayor a cero.';
  end if;
  if not exists (select 1 from public.monedas where id = p_moneda_id) then
    raise exception 'Moneda no encontrada.';
  end if;
  insert into public.tasas_cambio (moneda_id, tasa) values (p_moneda_id, p_tasa);
end;
$$;

revoke all on function public.club_registrar_tasa(uuid, numeric) from anon;
grant execute on function public.club_registrar_tasa(uuid, numeric) to anon, authenticated;

-- ------------------------------------------------------------------
-- 7) TASA DE REFERENCIA VIGENTE (BCV / BINANCE / EURO)
--    Devuelve la tasa aplicable a una fecha: la ultima cuyo fecha_aplicar
--    ya haya llegado. Es la que usa el legacy via window.clubTareas.vigente().
-- ------------------------------------------------------------------
create or replace function public.club_tasa_vigente(p_tipo text, p_fecha date default current_date)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tasa numeric;
begin
  select tasa into v_tasa
    from public.tasas_referencia
   where tipo = upper(p_tipo)
     and fecha_aplicar <= p_fecha
   order by fecha_aplicar desc
   limit 1;
  return v_tasa;
end;
$$;

revoke all on function public.club_tasa_vigente(text, date) from anon;
grant execute on function public.club_tasa_vigente(text, date) to anon, authenticated;

-- ------------------------------------------------------------------
-- 8) PERMISOS
--    ATENCION - DEUDA DE SEGURIDAD CONOCIDA:
--    estas RPC son `security definer` y se conceden a `anon` porque la
--    aplicacion todavia NO usa Supabase Auth (el RBAC es local: zustand +
--    localStorage + cookies, ver src/store/useAuthStore.ts). La anon key
--    viaja incrustada en el export estatico, asi que cualquiera que abra la
--    pagina puede mover saldos. `RutaProtegida` NO protege nada: es UI.
--    Se mantiene `anon` para no romper el sistema actual (igual que el resto
--    de sql/*.sql). Cuando se migre a Supabase Auth hay que:
--      1) quitar `anon` de estos grants,
--      2) verificar `auth.uid()` contra el perfil DENTRO de la funcion,
--      3) activar RLS en depositos / transacciones_financieras / bancos.
-- ------------------------------------------------------------------

-- ------------------------------------------------------------------
-- VERIFICACION -----------------------------------------------------
-- select public.club_tasa_vigente('BCV');
-- select * from public.depositos order by fecha desc limit 5;
-- select * from public.transacciones_financieras order by fecha desc limit 5;
