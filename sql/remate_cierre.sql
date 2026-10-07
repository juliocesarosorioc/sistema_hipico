-- ===========================================================================
-- REMATES · CIERRE ECONOMICO (ticket de venta + descuento de saldo)
-- ===========================================================================
--
-- QUE HACE
--
-- `club_cerrar_remate` cierra la subasta en UNA sola transaccion y, por cada
-- ejemplar que tenga comprador:
--
--   1. descuenta el monto de la puja de `clientes.saldo_actual`, y
--   2. deja un ticket de VENTA en `tickets_apuestas` (el mismo destino que
--      usan las ventas de Marcas y de Tablas Fijas).
--
-- Los ejemplares SIN comprador (CASA) no generan ticket ni descuento: la casa
-- se queda el caballo.
--
-- POR QUE UNA FUNCION Y NO VARIAS LLAMADAS DESDE EL FRONT
--
-- Si el front cerrara el remate con un UPDATE y despues bajara los saldos fila
-- por fila, un corte de luz a mitad de camino deja remate cerrado y saldos sin
-- descontar (o al reves: saldo descontado y ticket que nunca existio). Ademas
-- dos operadores pulsando "Cerrar" a la vez DOBLAN EL COBRO. Con la funcion:
-- todo es una transaccion, el `for update` serializa a los dos operadores y la
-- segunda llamada ve el remate ya cerrado y no cobra nada.
--
-- FORMA DEL TICKET
--
-- El ticket de venta va a `tickets_apuestas` con la MISMA forma que usan Marcas
-- y Tablas Fijas. Ojo con dos tipos que ya causaron ERROR 42804 en otros modulos:
--   - `caballo`          es TEXT   -> guarda el NUMERO del ejemplar (texto).
--   - `ejemplar_numero`  es INTEGER-> se castea con guard de solo-digitos.
--   - `nota_auditoria`   es TEXT   -> jsonb_build_object(...)::text explicito.
-- El ticket queda `estado = 'Pendiente'`, `nombre_jugada = 'REMATE ...'`,
-- `grupo = 'REMATE'`. Como comparte hipodromo y carrera con la carrera del dia,
-- la relacion de jugadas (reportGenerator.cargarJugadasDeCarrera) excluye las
-- filas cuyo `nombre_jugada` empieza con 'REMATE ': una venta no es una apuesta.
--
-- BANQUERO DE REMATES: si el remate tiene `grupo_id` y ese grupo tiene banquero
-- configurado para la modalidad REMATES, el trigger `trg_fijar_banquero_ticket`
-- congela al banquero en el INSERT. Como la venta es final (no hay resultado que
-- espere), aqui mismo se pasa el ticket a 'Perdedor' para que
-- `trg_aplicar_banquero_ticket` mueva el saldo espejo (+monto de la venta al
-- banquero) y cobre la comision que recibe el grupo. Sin grupo/banquero el ticket
-- queda 'Pendiente' como antes.
--
-- PERMISOS
--
-- Las tres funciones son `security definer` y verifican en el SERVIDOR
-- `public.tiene_capacidad(auth.uid(), 'remates:fn_guardar_remate')`. Sin sesion de
-- Supabase `auth.uid()` es null y la funcion rechaza: no alcanza con esconder el
-- boton en el navegador. Si se vuelve a correr este archivo, el `create or replace`
-- aplica el guard a las funciones ya instaladas.
--
-- IDEMPOTENCIA
--
-- Cada ticket queda sellado en `nota_auditoria::jsonb` con
-- `origen = 'REMATE'` y `remate_caballo_id`. Al volver a cerrar (o al
-- reintentar por error de red) las filas que ya tienen ticket se saltan: no se
-- cobra dos veces el mismo ejemplar. `nota_auditoria` es TEXT en la base, asi
-- que el cast a jsonb es obligatorio.
--
-- SALDO INSUFICIENTE
--
-- La pizarra deriva el saldo bloqueado de las pujas vivas, pero entre una puja y
-- el cierre el saldo puede caer por otra jugada. Si al cerrar un comprador no
-- alcanza (saldo + aval), la funcion ABORTA: no se descuenta nada de nadie y el
-- remate sigue abierto. Se revisa la puja y se vuelve a cerrar.
--
-- COMO CORRERLO
--
-- Pegar en el SQL Editor de Supabase. Es idempotente: se puede correr dos veces.
-- Despues, el boton "Cerrar" del modulo Remates usa esta funcion en vez del
-- UPDATE directo.
-- ===========================================================================

-- ------------------------------------------------------------------ columnas
alter table public.remates add column if not exists cerrado_at    timestamptz;
alter table public.remates add column if not exists liquidado_at  timestamptz;

comment on column public.remates.cerrado_at is
  'Momento en que se cerro la subasta (boton Cerrar).';
comment on column public.remates.liquidado_at is
  'Momento en que se generaron los tickets de venta y se descontaron los saldos. Si esta puesto y el remate se reabre, los ejemplares ya vendidos quedan bloqueados.';

-- ------------------------------------------------------------------- indice
-- El cierre busca los tickets por ejemplar del remate: este indice evita
-- recorrer toda la tabla de tickets.
do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'tickets_apuestas_nota_auditoria_idx'
  ) then
    create index if not exists tickets_apuestas_nota_auditoria_idx
      on public.tickets_apuestas ((nota_auditoria::jsonb ->> 'remate_caballo_id'));
  end if;
end $$;

-- ============================================================== CIERRE
create or replace function public.club_cerrar_remate(
  p_remate_id uuid,
  p_usuario   text default null,
  p_modo      text default 'aval'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_remate   public.remates%rowtype;
  v_grupo_id uuid;
  v_grupo_nombre text;
  v_ticket_id uuid;
  v_fila     record;
  v_cliente  public.clientes%rowtype;
  v_monto    numeric;
  v_total    numeric := 0;
  v_tickets  integer := 0;
  v_casa     integer := 0;
  v_ya       integer := 0;
begin
  if p_remate_id is null then
    raise exception 'No se indico que remate cerrar.';
  end if;

  -- Permiso del lado del SERVIDOR, no solo del boton. Sin sesion de Supabase
  -- `auth.uid()` es null y `tiene_capacidad` devuelve false: cierra en falso.
  if not coalesce(public.tiene_capacidad(auth.uid(), 'remates:fn_guardar_remate'), false) then
    raise exception 'Sin permiso para cerrar remates' using errcode = '42501';
  end if;

  -- El lock de fila serializa a dos operadores que pulsan "Cerrar" juntos.
  select * into v_remate
    from public.remates
   where id = p_remate_id
     for update;

  if not found then
    raise exception 'El remate no existe.';
  end if;

  if lower(btrim(coalesce(v_remate.estado, 'Abierto'))) = 'cerrado' then
    raise exception 'Este remate ya esta cerrado.';
  end if;

  -- Grupo de venta del remate (opcional). Si esta, cada ticket sale con
  -- `grupo_cobro_id` para que el trigger de banquero congele al banquero de la
  -- modalidad REMATES. Sin grupo, el ticket queda como antes ('REMATE').
  if v_remate.grupo_id is not null then
    select id, nombre into v_grupo_id, v_grupo_nombre
      from public.grupos_venta
     where id = v_remate.grupo_id;
  end if;

  for v_fila in
    select
      c.id,
      c.numero,
      c.nombre,
      c.ejemplar_numero,
      c.monto_usd,
      c.cliente_id,
      exists (
        select 1
          from public.tickets_apuestas t
         where t.nota_auditoria::jsonb ->> 'origen' = 'REMATE'
           and t.nota_auditoria::jsonb ->> 'remate_caballo_id' = c.id::text
      ) as ya_ticket
    from public.remate_caballos c
   where c.remate_id = p_remate_id
     and coalesce(c.monto_usd, 0) > 0
     for update of c
  loop
    -- Ya cobrado en un cierre anterior: no se toca ni el saldo ni el ticket.
    if v_fila.ya_ticket then
      v_ya := v_ya + 1;
      continue;
    end if;

    -- Sin comprador: el ejemplar se queda en la casa (CASA). Sin ticket,
    -- sin descuento. El monto sigue escribiendo el total a pagar.
    if v_fila.cliente_id is null then
      v_casa := v_casa + 1;
      continue;
    end if;

    select * into v_cliente
      from public.clientes
     where id = v_fila.cliente_id
     for update;

    if not found then
      raise exception
        'El comprador del ejemplar % ya no existe en la lista de clientes. No se desconto nada: corregi la puja antes de cerrar.',
        coalesce(v_fila.nombre, v_fila.ejemplar_numero, v_fila.numero::text);
    end if;

    v_monto := round(coalesce(v_fila.monto_usd, 0), 2);

    -- El bloqueo de saldo se deriva de las pujas vivas, pero el saldo pudo caer
    -- por otra jugada entre la puja y el cierre. Se revalida aqui.
    if lower(coalesce(v_cliente.modo_juego, 'aval')) <> 'libre'
       and coalesce(v_cliente.saldo_actual, 0) + coalesce(v_cliente.aval, 0) < v_monto then
      raise exception
        'Saldo insuficiente de %: necesita % y tiene % de saldo + % de aval. No se desconto nada: revisa la puja antes de cerrar.',
        coalesce(v_cliente.nombre, 'el comprador'),
        v_monto,
        coalesce(v_cliente.saldo_actual, 0),
        coalesce(v_cliente.aval, 0);
    end if;

    update public.clientes
       set saldo_actual = coalesce(saldo_actual, 0) - v_monto
     where id = v_cliente.id;

    insert into public.tickets_apuestas (
      fecha_registro,
      hipodromo,
      carrera,
      nombre_jugada,
      caballo,
      ejemplar_numero,
      cantidad_tablas,
      monto_jugado,
      monto_decidido,
      premio_pagar,
      premio_por_tabla,
      cliente_juega_id,
      cliente_juega_nombre,
      grupo,
      grupo_cobro_id,
      grupo_cobro_nombre,
      grupo_comision_id,
      grupo_comision_nombre,
      comision_porcentaje,
      comision_pagada,
      estado,
      moneda,
      tasa_cambio,
      nota_auditoria
    )
    values (
      now(),
      upper(coalesce(v_remate.hipodromo, '')),
      v_remate.carrera,
      format('REMATE %s (C%s)', upper(coalesce(v_remate.hipodromo, '')), coalesce(v_remate.carrera::text, '-')),
      -- `caballo` es texto y en el resto de modulos guarda el NUMERO del
      -- ejemplar; si el numero venia vacio, cae al nombre.
      coalesce(nullif(btrim(coalesce(v_fila.ejemplar_numero, '')), ''), v_fila.nombre),
      -- `ejemplar_numero` es integer en tickets_apuestas: sin el cast (y sin el
      -- guard de solo-digitos) el INSERT aborta con
      --   ERROR 42804: column "ejemplar_numero" is of type integer but expression is of type text
      case
        when btrim(coalesce(v_fila.ejemplar_numero, '')) ~ '^[0-9]+$'
          then btrim(v_fila.ejemplar_numero)::int
        else v_fila.numero
      end,
      1,
      v_monto,
      -- `monto_decidido` = monto de la venta: es la base por defecto de la
      -- comision del banquero (MONTO_DECIDIDO) y queda registrado en el ticket.
      v_monto,
      0,
      null,
      v_cliente.id,
      v_cliente.nombre,
      coalesce(v_grupo_nombre, 'REMATE'),
      v_grupo_id,
      coalesce(v_grupo_nombre, 'REMATE'),
      v_grupo_id,
      v_grupo_nombre,
      round(coalesce(v_remate.comision_pct, 0), 2),
      0,
      'Pendiente',
      'USD',
      1,
      -- `nota_auditoria` es TEXT: el `::text` explicito evita depender del cast
      -- de asignacion jsonb->text (si ese dia no esta, el INSERT entero aborta).
      jsonb_build_object(
        'origen', 'REMATE',
        'remate_id', p_remate_id,
        'remate_caballo_id', v_fila.id,
        'remate_nombre', v_remate.nombre,
        'fecha_carrera', v_remate.fecha,
        'hora_cierre', v_remate.hora_cierre,
        'comision_pct', v_remate.comision_pct,
        'modo', p_modo,
        'usuario', p_usuario,
        'idempotencia', 'remate:' || p_remate_id::text || ':' || v_fila.id::text
      )::text
    )
    returning id into v_ticket_id;

    -- La venta de un remate es final. Si el grupo tiene banquero configurado para
    -- la modalidad REMATES, el trigger ya lo congeló en el INSERT; lo pasamos a
    -- decidido para que `trg_aplicar_banquero_ticket` mueva el saldo espejo y
    -- cobre la comisión en esta misma transacción. Sin banquero queda 'Pendiente'
    -- como siempre (no cambia el comportamiento previo).
    if v_ticket_id is not null and exists (
      select 1 from public.tickets_apuestas t
       where t.id = v_ticket_id and t.banquero_cliente_id is not null
    ) then
      update public.tickets_apuestas set estado = 'Perdedor' where id = v_ticket_id;
    end if;

    v_total   := v_total + v_monto;
    v_tickets := v_tickets + 1;
  end loop;

  update public.remates
     set estado         = 'Cerrado',
         cerrado_at     = now(),
         liquidado_at   = coalesce(liquidado_at, now())
   where id = p_remate_id;

  return jsonb_build_object(
    'ok', true,
    'tickets', v_tickets,
    'casa', v_casa,
    'ya_cobrados', v_ya,
    'total_descontado', v_total
  );
end;
$$;

-- ============================================================== REAPERTURA
-- Reabrir NO borra tickets ni devuelve saldos: solo deja volver a ASIGNAR un
-- comprador a los ejemplares que siguen sin comprador (CASA). El `liquidado_at`
-- queda puesto, y el modulo Remates usa esa marca para dejar bloqueados los
-- ejemplares que ya se vendieron en el cierre.
create or replace function public.club_reabrir_remate(
  p_remate_id uuid,
  p_usuario   text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_remate public.remates%rowtype;
  v_vendidos integer;
begin
  if not coalesce(public.tiene_capacidad(auth.uid(), 'remates:fn_guardar_remate'), false) then
    raise exception 'Sin permiso para reabrir remates' using errcode = '42501';
  end if;

  select * into v_remate
    from public.remates
   where id = p_remate_id
     for update;

  if not found then
    raise exception 'El remate no existe.';
  end if;

  select count(*) into v_vendidos
    from public.tickets_apuestas t
   where t.nota_auditoria::jsonb ->> 'origen' = 'REMATE'
     and t.nota_auditoria::jsonb ->> 'remate_id' = p_remate_id::text;

  update public.remates
     set estado = 'Abierto'
   where id = p_remate_id;

  return jsonb_build_object(
    'ok', true,
    'vendidos', v_vendidos,
    'nota', 'Los ejemplares ya vendidos quedan bloqueados: solo se puede asignar comprador a los que siguen en CASA.'
  );
end;
$$;

grant execute on function public.club_cerrar_remate(uuid, text, text) to anon, authenticated;
grant execute on function public.club_reabrir_remate(uuid, text) to anon, authenticated;

-- ==================================================== VENTA DE UN EJEMPLAR SUELTO
-- Se usa al REABRIR un remate ya liquidado: el ejemplar que estaba en CASA recibe
-- un comprador, asi que es una venta mas y tiene que hacer exactamente lo mismo
-- que hacia el cierre (ticket + descuento), con la misma idempotencia.
--
-- No cambia el estado del remate ni el monto: solo el comprador del renglon. Si
-- el ejemplar ya tenia ticket (o sea, ya se vendio), no cobra de nuevo.
create or replace function public.club_vender_caballo_remate(
  p_caballo_id uuid,
  p_cliente_id  uuid,
  p_usuario     text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caballo  public.remate_caballos%rowtype;
  v_remate   public.remates%rowtype;
  v_grupo_id uuid;
  v_grupo_nombre text;
  v_cliente  public.clientes%rowtype;
  v_monto    numeric;
  v_ticket_id uuid;
begin
  if p_caballo_id is null or p_cliente_id is null then
    raise exception 'Falta el ejemplar o el comprador.';
  end if;

  if not coalesce(public.tiene_capacidad(auth.uid(), 'remates:fn_guardar_remate'), false) then
    raise exception 'Sin permiso para vender ejemplares de un remate' using errcode = '42501';
  end if;

  select * into v_caballo from public.remate_caballos where id = p_caballo_id for update;
  if not found then
    raise exception 'El ejemplar no existe en este remate.';
  end if;

  if exists (
    select 1 from public.tickets_apuestas t
     where t.nota_auditoria::jsonb ->> 'origen' = 'REMATE'
       and t.nota_auditoria::jsonb ->> 'remate_caballo_id' = p_caballo_id::text
  ) then
    raise exception 'Este ejemplar ya fue vendido y cobrado: no se puede volver a cobrar.';
  end if;

  select * into v_remate from public.remates where id = v_caballo.remate_id;
  if v_remate.grupo_id is not null then
    select id, nombre into v_grupo_id, v_grupo_nombre
      from public.grupos_venta where id = v_remate.grupo_id;
  end if;
  select * into v_cliente from public.clientes where id = p_cliente_id for update;
  if not found then
    raise exception 'El comprador no existe en la lista de clientes.';
  end if;

  v_monto := round(coalesce(v_caballo.monto_usd, 0), 2);
  if v_monto <= 0 then
    raise exception 'El ejemplar no tiene monto de puja: asignale un valor antes de venderlo.';
  end if;

  if lower(coalesce(v_cliente.modo_juego, 'aval')) <> 'libre'
     and coalesce(v_cliente.saldo_actual, 0) + coalesce(v_cliente.aval, 0) < v_monto then
    raise exception
      'Saldo insuficiente de %: necesita % y tiene % de saldo + % de aval. No se desconto nada.',
      coalesce(v_cliente.nombre, 'el comprador'),
      v_monto,
      coalesce(v_cliente.saldo_actual, 0),
      coalesce(v_cliente.aval, 0);
  end if;

  update public.clientes
     set saldo_actual = coalesce(saldo_actual, 0) - v_monto
   where id = v_cliente.id;

  insert into public.tickets_apuestas (
    fecha_registro, hipodromo, carrera, nombre_jugada, caballo, ejemplar_numero,
    cantidad_tablas, monto_jugado, monto_decidido, premio_pagar, premio_por_tabla,
    cliente_juega_id, cliente_juega_nombre, grupo, grupo_cobro_id, grupo_cobro_nombre,
    grupo_comision_id, grupo_comision_nombre,
    comision_porcentaje, comision_pagada, estado, moneda, tasa_cambio, nota_auditoria
  )
  values (
    now(),
    upper(coalesce(v_remate.hipodromo, '')),
    v_remate.carrera,
    format('REMATE %s (C%s)', upper(coalesce(v_remate.hipodromo, '')), coalesce(v_remate.carrera::text, '-')),
    coalesce(nullif(btrim(coalesce(v_caballo.ejemplar_numero, '')), ''), v_caballo.nombre),
    case
      when btrim(coalesce(v_caballo.ejemplar_numero, '')) ~ '^[0-9]+$'
        then btrim(v_caballo.ejemplar_numero)::int
      else v_caballo.numero
    end,
    1, v_monto, v_monto, 0, null,
    v_cliente.id, v_cliente.nombre,
    coalesce(v_grupo_nombre, 'REMATE'), v_grupo_id, coalesce(v_grupo_nombre, 'REMATE'),
    v_grupo_id, v_grupo_nombre,
    round(coalesce(v_remate.comision_pct, 0), 2),
    0, 'Pendiente', 'USD', 1,
    jsonb_build_object(
      'origen', 'REMATE',
      'remate_id', v_remate.id,
      'remate_caballo_id', v_caballo.id,
      'remate_nombre', v_remate.nombre,
      'fecha_carrera', v_remate.fecha,
      'usuario', p_usuario,
      'asignacion_posterior', true,
      'idempotencia', 'remate:' || v_remate.id::text || ':' || v_caballo.id::text
    )::text
  )
  returning id into v_ticket_id;

  -- Venta final al reabrir: mismo criterio que el cierre. Con banquero en la
  -- modalidad REMATES se pasa a decidido para disparar el espejo + comisión.
  if v_ticket_id is not null and exists (
    select 1 from public.tickets_apuestas t
     where t.id = v_ticket_id and t.banquero_cliente_id is not null
  ) then
    update public.tickets_apuestas set estado = 'Perdedor' where id = v_ticket_id;
  end if;

  update public.remate_caballos set cliente_id = p_cliente_id where id = v_caballo.id;

  return jsonb_build_object('ok', true, 'monto', v_monto, 'cliente', v_cliente.nombre);
end;
$$;

grant execute on function public.club_vender_caballo_remate(uuid, uuid, text) to anon, authenticated;
