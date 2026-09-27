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

  select * into v_cliente from public.clientes where id = p_cliente_id;
  if not found then
    raise exception 'Cliente no encontrado.';
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
      v_caballo, v_num,
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
        v_caballo, v_num,
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
  -- ------------------------------------------------------------------
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

-- -----------------------------------------------------------------------------
--  Ajuste de compatibility: dos consultas del Next order-by created_at, columna
--  que esta tabla NO tiene. El timestamp real es fecha_registro.
--  (En el codigo se cambia la consulta; aqui queda la nota para el que migra.)
-- -----------------------------------------------------------------------------
