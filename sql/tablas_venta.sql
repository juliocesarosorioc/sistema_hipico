-- =============================================================================
--  VENTA DE TABLA FIJA  (una RPC = ticket + saldo + contador, todo o nada)
-- =============================================================================
--  Por que una RPC y no varios writes desde el navegador:
--  la venta toca tres cosas que no pueden quedar a medias. Si se inserta el
--  ticket y falla el descuento, el jugador tiene apuesta sin pagar. Si se
--  descuenta y falla el ticket, se perdio plata. Por eso va en una sola
--  transaccion: es el mismo criterio de sql/contabilidad.sql.
--
--  REGLA DE COMISION (definida por el negocio):
--    la tabla fija NO cobra ni paga comision al jugador. Lo que el jugador
--    juega es lo que se le descuenta, sin restar nada. La comision se calcula
--    sobre el MONTO DECIDIDO y se le acredita al GRUPO.
--    Por eso el ticket congela comision_porcentaje = la tasa del grupo, y el
--    descuento al cliente es p_monto exacto. Quien cobre por debajo es el
--    liquidador, al llenar monto_decidido.
--
--  CONGELAMIENTO (esto es lo que hace segura la edicion de tablas):
--    premio_por_tabla y pts_ejemplar se copian del momento de la venta. Si
--    manana se corrige la tabla o entra un retiro, los tickets ya vendidos
--    siguen liquidando contra los valores con los que se compro. La tabla
--    editada solo afecta a las ventas futuras.
--
--  INSTALACION: pegar en el SQL Editor de Supabase y ejecutar. Es aditiva
--  (no toca datos). Verificar con:
--    select proname from pg_proc where proname = 'club_vender_tabla_fija';
-- =============================================================================

create or replace function public.club_vender_tabla_fija(
  p_tabla_id            bigint,
  p_cliente_id          uuid,
  p_grupo_id            uuid,
  p_monto               numeric,
  p_cantidad            int     default 1,
  p_ejemplar_numero     text    default null,   -- null = TABLA COMPLETA (todos los caballos)
  p_comision_porcentaje numeric default null,   -- null = usar la del grupo
  p_tasa                numeric default null,
  p_usuario             text    default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tabla      public.tablas_fijas%rowtype;
  v_cliente    public.clientes%rowtype;
  v_grupo      public.grupos_venta%rowtype;
  v_caballos   jsonb;
  v_uno        jsonb;
  v_num        text;
  v_pts        numeric;
  v_premio     numeric;
  v_comision   numeric;
  v_moneda     text;
  v_tasa       numeric;
  v_saldo      numeric;
  v_aval       numeric;
  v_limite     numeric;
  v_cant       int;
  v_vendidos   int;
  v_cupos      int;
  v_ins        int := 0;
  v_fecha      date;
  v_caballo    text;
begin
  -- ------------------------------------------------------------------
  -- Validaciones de entrada
  -- ------------------------------------------------------------------
  if p_monto is null or p_monto <= 0 then
    raise exception 'El monto debe ser un numero mayor a cero.';
  end if;

  v_cant := greatest(coalesce(p_cantidad, 1), 1);

  -- for update: dos cajas vendiendo la misma tabla a la vez se serializan y
  -- el contador no se pierde. Sin esto, el leer-modificar-escribir del
  -- cantidad_vendida puede pisar una venta concurrente.
  select * into v_tabla
    from public.tablas_fijas
   where id = p_tabla_id
   for update;

  if not found then
    raise exception 'La tabla fija % no existe.', p_tabla_id;
  end if;

  if upper(coalesce(v_tabla.estado, '')) <> 'ABIERTA' then
    raise exception 'La tabla fija no esta abierta para venta (estado: %).', v_tabla.estado;
  end if;

  -- for update: dos cajas vendiendo al MISMO cliente a la vez se serializan.
  -- Sin esto las dos leen el mismo saldo, ambas lo ven suficiente y la segunda
  -- UPDATE se lo pisa a la primera: el cliente juega el doble de lo autorizado.
  -- (club_vender_marca ya lo hacia; esta RPC se quedaba sin el cerrojo.)
  select * into v_cliente from public.clientes where id = p_cliente_id for update;
  if not found then
    raise exception 'Cliente no encontrado.';
  end if;
  if v_cliente.estado is not null and v_cliente.estado <> 'Activo' then
    raise exception 'El cliente % esta % y no puede jugar.', v_cliente.nombre, v_cliente.estado;
  end if;

  select * into v_grupo from public.grupos_venta where id = p_grupo_id;
  if not found then
    raise exception 'Grupo no encontrado.';
  end if;

  if coalesce(v_grupo.activo, true) = false then
    raise exception 'El grupo % esta inactivo.', v_grupo.nombre;
  end if;

  -- Cupo del grupo para esta tabla, si se.configuro. 0 = sin tope.
  select tg.cupos into v_cupos
    from public.tabla_grupos tg
   where tg.tabla_id = p_tabla_id and tg.grupo_id = p_grupo_id
   limit 1;

  if v_cupos is not null and v_cupos > 0 then
    v_vendidos := coalesce(v_tabla.cantidad_vendida, 0);
    if v_vendidos + v_cant > v_cupos then
      raise exception 'Cupo del grupo % agotado en esta tabla (cupo %, vendido %).',
        v_grupo.nombre, v_cupos, v_vendidos;
    end if;
  end if;

  -- ------------------------------------------------------------------
  -- Valores congelados + moneda del grupo
  -- ------------------------------------------------------------------
  v_premio := coalesce(v_tabla.premio_recalculado, v_tabla.premio_original, v_tabla.monto_tabla, 0);

  -- La moneda la estipula el grupo; la tabla solo ofrece un default.
  v_moneda := coalesce(v_grupo.moneda, v_tabla.moneda, 'USD');

  if upper(v_moneda) = 'VES' then
    v_tasa := coalesce(p_tasa, v_tabla.tasa_cambio);
    if v_tasa is null or v_tasa <= 0 then
      raise exception 'Indique la tasa: la venta es en Bs.';
    end if;
  else
    v_tasa := coalesce(p_tasa, 1);
  end if;

  -- Tasa del grupo (convenio). En tabla fija NO se descuenta del jugador:
  -- queda congelada en el ticket para que la comision se calcule despues
  -- sobre el monto decidido, a nombre del grupo.
  v_comision := coalesce(p_comision_porcentaje, v_grupo.comision_default, 0);

  v_fecha := coalesce(v_tabla.fecha, (v_tabla.fecha_creacion)::date, current_date);

  v_caballos := coalesce(v_tabla.caballos, '[]'::jsonb);

  -- Un solo ejemplar (N3) o la tabla completa (todos los caballos).
  if p_ejemplar_numero is not null and btrim(p_ejemplar_numero) <> '' then
    v_num := btrim(p_ejemplar_numero);
    v_uno := null;
    for v_uno in select * from jsonb_array_elements(v_caballos) loop
      exit when btrim(coalesce(v_uno ->> 'numero', '')) = v_num;
    end loop;
    if v_uno is null then
      raise exception 'El ejemplar % no pertenece a la tabla.', v_num;
    end if;
    if (v_uno ->> 'retirado') = 'true' then
      raise exception 'El ejemplar % esta retirado y no se puede vender.', v_num;
    end if;
    v_caballo := v_uno ->> 'nombre';
    v_pts     := nullif(v_uno ->> 'valor_ejemplar', '')::numeric;
  else
    v_caballo := 'TABLA COMPLETA';
  end if;

  -- ------------------------------------------------------------------
  -- Un ticket por ejemplar (requisito del negocio)
  -- ------------------------------------------------------------------
  if p_ejemplar_numero is not null and btrim(p_ejemplar_numero) <> '' then
    insert into public.tickets_apuestas (
      fecha_registro, hipodromo, carrera, nombre_jugada, caballo, ejemplar_numero,
      cantidad_tablas, monto_jugado, monto_decidido, premio_pagar,
      premio_por_tabla, pts_ejemplar,
      cliente_juega_id, cliente_juega_nombre,
      grupo, grupo_cobro_id, grupo_cobro_nombre, grupo_comision_id, grupo_comision_nombre,
      comision_porcentaje, comision_pagada,
      estado, moneda, tasa_cambio, nota_auditoria
    )
    values (
      now(), upper(v_tabla.hipodromo), v_tabla.carrera,
      format('TABLA FIJA (%s C%s)', upper(v_tabla.hipodromo), v_tabla.carrera),
      v_caballo, nullif(v_num, '')::int,
      v_cant, p_monto, 0, 0,
      v_premio, v_pts,
      v_cliente.id, v_cliente.nombre,
      v_grupo.nombre, v_grupo.id, v_grupo.nombre, v_grupo.id, v_grupo.nombre,
      v_comision, 0,
      'Pendiente', v_moneda, v_tasa,
      jsonb_build_object(
        'tabla_id', p_tabla_id,
        'fecha_carrera', v_fecha,
        'origen', 'TABLAS_FIJAS',
        'usuario', p_usuario,
        'premio_congelado', v_premio,
        'pts_congelado', v_pts
      )
    );
    v_ins := 1;

  else
    -- Tabla completa: un ticket por cada ejemplar vigente.
    for v_uno in select * from jsonb_array_elements(v_caballos) loop
      v_num     := btrim(coalesce(v_uno ->> 'numero', ''));
      if v_num = '' or (v_uno ->> 'retirado') = 'true' then
        continue;
      end if;
      v_caballo := v_uno ->> 'nombre';
      v_pts     := nullif(v_uno ->> 'valor_ejemplar', '')::numeric;

      insert into public.tickets_apuestas (
        fecha_registro, hipodromo, carrera, nombre_jugada, caballo, ejemplar_numero,
        cantidad_tablas, monto_jugado, monto_decidido, premio_pagar,
        premio_por_tabla, pts_ejemplar,
        cliente_juega_id, cliente_juega_nombre,
        grupo, grupo_cobro_id, grupo_cobro_nombre, grupo_comision_id, grupo_comision_nombre,
        comision_porcentaje, comision_pagada,
        estado, moneda, tasa_cambio, nota_auditoria
      )
      values (
        now(), upper(v_tabla.hipodromo), v_tabla.carrera,
        format('TABLA FIJA (%s C%s)', upper(v_tabla.hipodromo), v_tabla.carrera),
        v_caballo, nullif(v_num, '')::int,
        v_cant, p_monto, 0, 0,
        v_premio, v_pts,
        v_cliente.id, v_cliente.nombre,
        v_grupo.nombre, v_grupo.id, v_grupo.nombre, v_grupo.id, v_grupo.nombre,
        v_comision, 0,
        'Pendiente', v_moneda, v_tasa,
        jsonb_build_object(
          'tabla_id', p_tabla_id,
          'fecha_carrera', v_fecha,
          'origen', 'TABLAS_FIJAS',
          'usuario', p_usuario,
          'premio_congelado', v_premio,
          'pts_congelado', v_pts
        )
      );
      v_ins := v_ins + 1;
    end loop;
  end if;

  if v_ins = 0 then
    raise exception 'La tabla no tiene ejemplares disponibles para vender.';
  end if;

  -- ------------------------------------------------------------------
  -- Saldo del cliente: se debita el monto EXACTO. Sin comision encima,
  -- porque la tabla fija no le cobra comision al jugador.
  --
  -- TOPE = saldo + aval (misma regla que club_vender_marca): el aval es
  -- credito negado, no efectivo, asi que autoriza a jugar por encima del
  -- saldo pero el saldo queda debitado en negativo y esa deuda se cobra. Un
  -- cliente "libre" juega sin tope.
  --
  -- Antes esta RPC NO validaba nada: cualquier monto, y el cliente podia
  -- quedar en negativo sin limite. El navegador recortaba por saldo, pero la
  -- RPC es la que cobra y se puede llamar sin pasar por el navegador.
  -- ------------------------------------------------------------------
  v_aval   := coalesce(v_cliente.aval, 0);
  v_limite := coalesce(v_cliente.saldo_actual, 0) + v_aval;

  if lower(btrim(coalesce(v_cliente.modo_juego, 'aval'))) <> 'libre' and v_limite < p_monto then
    raise exception
      'Saldo insuficiente. % tiene % de saldo mas % de aval (disponible %) y la tabla es de %.',
      v_cliente.nombre,
      to_char(coalesce(v_cliente.saldo_actual, 0), 'FM999999999990.00'),
      to_char(v_aval, 'FM999999999990.00'),
      to_char(v_limite, 'FM999999999990.00'),
      to_char(p_monto, 'FM999999999990.00');
  end if;

  v_saldo := coalesce(v_cliente.saldo_actual, 0) - p_monto;

  update public.clientes
     set saldo_actual = v_saldo
   where id = p_cliente_id;

  -- ------------------------------------------------------------------
  -- Contador de tablas vendidas (cantidad de tablas, no el monto)
  -- ------------------------------------------------------------------
  update public.tablas_fijas
     set cantidad_vendida = coalesce(cantidad_vendida, 0) + v_cant
   where id = p_tabla_id;

  if v_cupos is not null then
    update public.tabla_grupos
       set cantidad_vendida = coalesce(cantidad_vendida, 0) + v_cant
     where tabla_id = p_tabla_id and grupo_id = p_grupo_id;
  end if;

  -- La traza de auditoria es un extra, no un requisito de la venta: si
  -- club_log_accion todavia no esta instalada, la venta NO debe caer.
  if exists (
    select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'club_log_accion'
  ) then
    perform public.club_log_accion(
      coalesce(p_usuario, 'anon'),   -- p_usuario
      'TABLAS_FIJAS',                -- p_modulo
      format('VENDER tabla %s: %s(es) x %s a %s. Premio congelado %s. Saldo %s.',
             p_tabla_id, v_cant, p_monto, v_cliente.nombre, v_premio, v_saldo)
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'tickets', v_ins,
    'cantidad', v_cant,
    'saldo_nuevo', v_saldo,
    'premio_por_tabla', v_premio,
    'comision_grupo_porcentaje', v_comision,
    'moneda', v_moneda
  );
end;
$$;

revoke all on function public.club_vender_tabla_fija(bigint, uuid, uuid, numeric, int, text, numeric, numeric, text) from anon;
grant execute on function public.club_vender_tabla_fija(bigint, uuid, uuid, numeric, int, text, numeric, numeric, text) to anon, authenticated;

-- =============================================================================
--  LIQUIDACION DE TABLA FIJA
-- =============================================================================
--  Al cerrar la tabla se resuelve cada ticket pendiente de sus ejemplares y se
--  escribe monto_decidido (lo que recibe el jugador) y comision_pagada (lo que
--  se lleva el grupo).
--
--  REGLA DE COMISION, tomada de js/saldos.js:144-165:
--
--      TABLA FIJA, gana  -> comision = max(0, premio - monto_jugado) * pct/100
--      TABLA FIJA, pierde -> comision = 0
--      OTRAS JUGADAS     -> gana: premio * pct/100   |   pierde: monto_jugado * pct/100
--
--  O sea: la comision de tabla fija se cobra sobre la GANANCIA y solo si gana.
--  El jugador no pierde nada de su premio: monto_decidido es el premio entero.
--  Lo que se descuenta es la comision del grupo, que sale de la ganancia.
--
--  PAGO: el premio sale del PTS CONGELADO del ejemplar, no del valor actual de
--  la tabla. Si la tabla se edito o entro un retiro despues de la venta, el
--  ticket ya vendido sigue liquidando con el premio con el que se compro. Esa
--  es toda la razon de congelar en la venta.
--
--  Se usan las MISMAS etiquetas de estado que ya consulta el resto del codigo:
--  'Pendiente', 'Ganador', 'Perdedor' y 'Retirado', en mixed case. Postgres
--  compara texteualmente, asi que escribir 'GANADOR' en mayusculas haria que el
--  chequeo idempotente de src/lib/liquidacion/saldos.ts no los encontrara, y
--  la pantalla de liquidacion no veria los tickets ya pagados.
-- =============================================================================

create or replace function public.club_liquidar_tabla_fija(
  p_tabla_id bigint,
  p_ganadores text default null,   -- '1,3,4' o null si hay dead heat
  p_usuario   text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tabla    public.tablas_fijas%rowtype;
  v_tk       record;
  v_gan      text[];
  v_num      text;
  v_pts      numeric;
  v_premio   numeric;
  v_jugado   numeric;
  v_base     numeric;
  v_pago     numeric;
  v_gana     boolean;
  v_com      numeric;
  v_pct      numeric;
  v_saldo    numeric;
  v_resueltos int := 0;
  v_ganadores int := 0;
  v_deudores  int := 0;
begin
  select * into v_tabla from public.tablas_fijas where id = p_tabla_id for update;
  if not found then
    raise exception 'La tabla fija % no existe.', p_tabla_id;
  end if;

  -- Sin ganadores no se decide nada: los tickets quedan pendientes.
  if p_ganadores is null or btrim(p_ganadores) = '' then
    return jsonb_build_object(
      'ok', false,
      'error', 'Indique los ganadores. Con dead heat la tabla no se liquida sola.'
    );
  end if;

  v_gan := string_to_array(btrim(p_ganadores), ',');
  select count(*) into v_ganadores from unnest(v_gan) g where btrim(g) <> '';
  if v_ganadores = 0 then
    raise exception 'No se indico ningun ganador.';
  end if;

  v_base := greatest(coalesce(v_tabla.suma_base_tabla, 0), 0);

  for v_tk in
    select * from public.tickets_apuestas
     where estado = 'Pendiente'
       -- `nota_auditoria` es TEXT: sin el cast, `->>` reventaba con
       --   ERROR 42883: operator does not exist: text ->> unknown
       -- El CASE evita además que una nota que no sea JSON (texto libre de otro
       -- modulo) tumbe la liquidacion entera; Postgres si garantiza que un CASE
       -- no evalua la rama que no toca.
       and case
             when nota_auditoria ~ '^\s*[\{\[]' then nota_auditoria::jsonb ->> 'tabla_id'
           end = p_tabla_id::text
     for update
  loop
    v_num    := btrim(coalesce(v_tk.ejemplar_numero, ''));
    v_pts    := coalesce(v_tk.pts_ejemplar, 0);
    v_premio := coalesce(v_tk.premio_por_tabla, v_tabla.premio_recalculado, v_tabla.premio_original, 0);
    v_jugado := coalesce(v_tk.monto_jugado, 0);
    v_pct    := coalesce(v_tk.comision_porcentaje, 0);

    v_gana := v_num <> '' and v_num = any (v_gan);

    -- El premio sale del PTS congelado. Si la tabla no trae base (puntos sin
    -- asignar) se cae al premio completo, que es el caso de la tabla simple.
    if v_pts > 0 and v_base > 0 then
      v_pago := round((v_premio * v_pts / v_base)::numeric, 2);
    else
      v_pago := v_premio;
    end if;

    if not v_gana then
      v_pago := 0;
      v_com  := 0;
    else
      -- Sobre la ganancia, y solo si gana. Nunca por debajo de cero.
      v_com := greatest(0, v_pago - v_jugado) * v_pct / 100;
    end if;

    update public.tickets_apuestas
       set estado            = case when v_gana then 'Ganador' else 'Perdedor' end,
           premio_pagar      = v_pago,
           monto_decidido    = v_pago,      -- el jugador recibe el premio entero
           comision_pagada   = round(v_com::numeric, 2)
     where id = v_tk.id;

    v_resueltos := v_resueltos + 1;

    -- El premio entra al saldo del jugador.
    if v_pago > 0 and v_tk.cliente_juega_id is not null then
      select saldo_actual into v_saldo from public.clientes where id = v_tk.cliente_juega_id;
      update public.clientes
         set saldo_actual = coalesce(v_saldo, 0) + v_pago
       where id = v_tk.cliente_juega_id;
      v_deudores := v_deudores + 1;
    end if;
  end loop;

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'club_log_accion'
  ) then
    perform public.club_log_accion(
      coalesce(p_usuario, 'anon'), 'TABLAS_FIJAS',
      format('LIQUIDAR tabla %s: ganadores [%s], %s ticket(s) resueltos.',
             p_tabla_id, p_ganadores, v_resueltos)
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'tickets_resueltos', v_resueltos,
    'pagos', v_deudores,
    'ganadores', v_ganadores
  );
end;
$$;

revoke all on function public.club_liquidar_tabla_fija(bigint, text, text) from anon;
grant execute on function public.club_liquidar_tabla_fija(bigint, text, text) to anon, authenticated;

-- =============================================================================
--  REEMBOLSO POR EJEMPLAR RETIRADO
-- =============================================================================
--  El legacy (js/tablas.js:1301) hacia esto a mano y estaba roto por dos cosas:
--
--    1) Filtraba por `.eq("fecha", ...)`. tickets_apuestas no tiene columna
--       `fecha`; se llama fecha_registro. El filtro no aplicaba y el reembolso
--       salia en cero.
--    2) Escribia `accion_aplicada` y `monto_resuelto`, que tampoco existen. El
--       UPDATE fallaba, pero el abono al cliente ya se habia hecho antes. Al
--       reintentar, el ticket seguia Pendiente y el cliente cobraba dos veces.
--
--  Ademas el read-modify-write de saldo_actual se pisa si dos cajas reembolsan
--  a la vez. Aqui va en una sola transaccion, y el filtro por fecha_registro
--  usa el dia de la carrera, no el del ticket.
--
--  REGLA: se reembolsa el monto_jugado INTEGRO al cliente. En tabla fija no hay
--  comision para el jugador, asi que no hay nada que descontar del reembolso.
-- =============================================================================

create or replace function public.club_reembolsar_retirados(
  p_fecha     date,
  p_hipodromo text,
  p_carrera   int,
  p_numeros   text,      -- '3,7' lista de ejemplares retirados
  p_usuario   text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_num      text;
  v_tk       record;
  v_saldo    numeric;
  v_monto    numeric;
  v_reemb    int := 0;
  v_dinero   numeric := 0;
  v_avisos   text[] := '{}';
begin
  if p_fecha is null or p_hipodromo is null or p_carrera is null then
    raise exception 'Falta fecha, hipodromo o carrera.';
  end if;
  if p_numeros is null or btrim(p_numeros) = '' then
    return jsonb_build_object('ok', true, 'reembolsados', 0, 'dinero', 0);
  end if;

  for v_num in select btrim(g) from unnest(string_to_array(p_numeros, ',')) g loop
    if v_num = '' then
      continue;
    end if;

    -- La fecha de carrera va en la nota del ticket (fecha_registro es el
    -- momento de la venta, que puede ser otro dia).
    for v_tk in
      select * from public.tickets_apuestas
       where estado = 'Pendiente'
         and upper(hipodromo) = upper(btrim(p_hipodromo))
         and carrera = p_carrera
         and ejemplar_numero = nullif(v_num, '')::int
         and coalesce(
          case
            when nota_auditoria ~ '^\s*[\{\[]' then nota_auditoria::jsonb ->> 'fecha_carrera'
          end,
          fecha_registro::date::text
        ) = p_fecha::text
       for update
    loop
      v_monto := coalesce(v_tk.monto_jugado, 0);

      if v_monto > 0 and v_tk.cliente_juega_id is not null then
        select coalesce(saldo_actual, 0) into v_saldo
          from public.clientes where id = v_tk.cliente_juega_id for update;
        if v_saldo is null then
          v_avisos := array_append(v_avisos, format('cliente %s no encontrado', v_tk.cliente_juega_id));
          continue;
        end if;
        update public.clientes
           set saldo_actual = v_saldo + v_monto
         where id = v_tk.cliente_juega_id;
        v_dinero := v_dinero + v_monto;
      end if;

      -- Solo se marca despues de acreditado, y en la misma transaccion: si
      -- algo falla arriba, el UPDATE tampoco corre y el reintento no duplica.
      update public.tickets_apuestas
         set estado         = 'Retirado',
             premio_pagar   = 0,
             monto_decidido = 0,
             comision_pagada = 0
       where id = v_tk.id;

      v_reemb := v_reemb + 1;
    end loop;
  end loop;

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'club_log_accion'
  ) then
    perform public.club_log_accion(
      coalesce(p_usuario, 'anon'), 'TABLAS_FIJAS',
      format('REEMBOLSO retiro %s C%s [%s]: %s ticket(s), %s devuelto.',
             upper(p_hipodromo), p_carrera, p_numeros, v_reemb, v_dinero)
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'reembolsados', v_reemb,
    'dinero', v_dinero,
    'avisos', to_jsonb(v_avisos)
  );
end;
$$;

revoke all on function public.club_reembolsar_retirados(date, text, int, text, text) from anon;
grant execute on function public.club_reembolsar_retirados(date, text, int, text, text) to anon, authenticated;

-- -----------------------------------------------------------------------------
--  Ajuste de compatibility: dos consultas del Next order-by created_at, columna
--  que esta tabla NO tiene. El timestamp real es fecha_registro.
--  (En el codigo se cambia la consulta; aqui queda la nota para el que migra.)
-- -----------------------------------------------------------------------------
