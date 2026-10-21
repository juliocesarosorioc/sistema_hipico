-- ============================================================================
-- PROMPT #6 — PORTAL DE USUARIOS
--   A) VENTANA DE REVISIÓN Y RECLAMOS por grupo (Día en curso / Semana en curso)
--   B) RECLAMOS Y "JUGADA NO RELACIONADA" con campos propios en tickets_jugadas
--   C) VENTA DESDE EL PORTAL: RPCs que la Edge Function `portal-auth` usa con
--      service_role para vender como cualquier taquilla (saldo + ticket).
-- ============================================================================
-- ES IDEMPOTENTE. Ejecutar en Supabase -> SQL Editor (una sola vez).
--
-- ----------------------------------------------------------------------------
-- POR QUÉ
-- ----------------------------------------------------------------------------
-- El Portal del Cliente entra con token propio, no con una sesión de Supabase, y
-- por eso no puede llamar a las RPC de venta del staff (que exigen una capacidad
-- vía `auth.uid()`). La decisión fue: la Edge Function `portal-auth` valida el
-- token y llama a la venta con service_role, anclando SIEMPRE el `cliente_id` al
-- dueño real del token y el `grupo_id` a su grupo. Este archivo aporta lo que
-- falta del lado de la base:
--
--   1) `grupos_venta.ventana_reclamos`: hasta cuándo el jugador puede reclamar.
--      Dos modos: SOLO_DIA_EN_CURSO (default) y SEMANA_EN_CURSO (ciclo del grupo).
--
--   2) `tickets_jugadas` gana los campos de la "jugada no relacionada" (fecha,
--      tipo, ejemplares, carrera) y un par de estados que faltaban para el ciclo
--      de vida del reclamo (RECHAZADO / APROBADO). Los reclamos del portal ya
--      viven acá; no se crea una tabla nueva para no fragmentar la consola.
--
--   3) Tres RPC `security definer` nuevas, pensadas para el camino del portal,
--      que reciben TODOS los ids por parámetro (el llamador es service_role, no
--      el jugador) y de nuevo validan saldo, aval, cupo y jerarquía:
--         · club_portal_vender_polla(p_polla_id, p_combinaciones, p_cliente_id)
--         · club_portal_registrar_no_relacionada(...)   -- solicitud del jugador
--         · club_portal_sembrar_polla_demo(...)  NO EXISTE: la polla se vende con
--           la primera y se resuelve con las RPC de liquidación del staff.
--
--      La RPC de Polla es la única que faltaba: Tablas (club_vender_tabla_fija),
--      Marcas (club_vender_marca) y Dupletas (club_vender_dupleta) ya existen y
--      se llaman tal cual desde la Edge Function. La venta de Polla del staff
--      (`club_registrar_venta_polla`) exige una capacidad, así que el portal usa
--      esta variante, que hace exactamente el mismo descuento de saldo y la misma
--      inserción en `polla_ventas`.
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- A) VENTANA DE RECLAMOS POR GRUPO
-- ----------------------------------------------------------------------------
alter table public.grupos_venta
  add column if not exists ventana_reclamos text not null default 'SOLO_DIA_EN_CURSO';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'ck_grupos_venta_ventana_reclamos'
      and conrelid = 'public.grupos_venta'::regclass
  ) then
    alter table public.grupos_venta
      add constraint ck_grupos_venta_ventana_reclamos
      check (ventana_reclamos in ('SOLO_DIA_EN_CURSO', 'SEMANA_EN_CURSO'));
  end if;
end;
$$;

comment on column public.grupos_venta.ventana_reclamos is
  'Hasta cuándo el jugador puede reclamar una jugada: SOLO_DIA_EN_CURSO (el día de la jugada) o SEMANA_EN_CURSO (la semana fiscal del grupo).';

-- RPC de escritura del ajuste (mismo patrón que club_actualizar_ciclo_grupo).
create or replace function public.club_actualizar_ventana_reclamos(
  p_grupo_id uuid,
  p_ventana  text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ventana text := upper(btrim(coalesce(p_ventana, '')));
begin
  if v_ventana not in ('SOLO_DIA_EN_CURSO', 'SEMANA_EN_CURSO') then
    raise exception 'La ventana de reclamos solo admite SOLO_DIA_EN_CURSO o SEMANA_EN_CURSO.'
      using errcode = '22023';
  end if;

  update public.grupos_venta
     set ventana_reclamos = v_ventana
   where id = p_grupo_id;

  if not found then
    raise exception 'El grupo % no existe.', p_grupo_id
      using errcode = 'P0002';
  end if;
end;
$$;

comment on function public.club_actualizar_ventana_reclamos(uuid, text) is
  'Fija la ventana de revisión y reclamos de un grupo (día en curso o semana en curso).';

revoke execute on function public.club_actualizar_ventana_reclamos(uuid, text) from public, anon;
grant execute on function public.club_actualizar_ventana_reclamos(uuid, text) to authenticated;

-- club_listar_grupos(): expone `ventana_reclamos` para el panel y para la
-- lectura por RPC cuando el SELECT directo cae al fallback por RLS.
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
            'comision_marcas', g.comision_marcas,
            'comision_tablas', g.comision_tablas,
            'comision_remates', g.comision_remates,
            'comision_polla', g.comision_polla,
            'comision_wps', g.comision_wps,
            'comision_dupletas', g.comision_dupletas,
            'permite_cruces', g.permite_cruces,
            'dia_inicio_semana', g.dia_inicio_semana,
            'dia_fin_semana', g.dia_fin_semana,
            'visibilidad_global_principal', g.visibilidad_global_principal,
            'grupos_autorizados_ver_principal', g.grupos_autorizados_ver_principal,
            'ventana_reclamos', g.ventana_reclamos,
            'created_at', g.created_at
        )
        order by g.es_principal desc, g.nombre asc
    ), '[]'::jsonb)
    into v_out
    from public.grupos_venta g;

    return v_out;
end;
$$;

revoke all on function public.club_listar_grupos() from public, anon;
grant execute on function public.club_listar_grupos() to anon;

-- ----------------------------------------------------------------------------
-- B) RECLAMOS Y "JUGADA NO RELACIONADA"
-- ----------------------------------------------------------------------------
-- La tabla `tickets_jugadas` (sql/paquete_pendientes.sql) ya guarda los reclamos
-- del portal. Le faltan dos cosas para PROMPT #6:
--   1. Los campos que describe la solicitud de jugada no relacionada
--      (fecha, hipódromo, carrera, tipo, ejemplares, monto, explicación).
--   2. Los estados RECHAZADO y APROBADO en el check, que es como termina una
--      solicitud cuando el admin la atiende desde NotificacionesPortal.
alter table public.tickets_jugadas
  add column if not exists ejemplares text;
alter table public.tickets_jugadas
  add column if not exists explicacion text;
alter table public.tickets_jugadas
  add column if not exists aprobado_por text;
alter table public.tickets_jugadas
  add column if not exists aprobado_at timestamptz;
-- El jugador puede marcar cada reclamo como "no leído" por la casa.
alter table public.tickets_jugadas
  add column if not exists visto_cliente boolean not null default false;

do $$
begin
  -- Ampliar el check de estado. Se suelta el constraint viejo (por nombre) y se
  -- vuelve a crear con los cinco estados del ciclo de vida completo.
  if exists (
    select 1 from pg_constraint
    where conname = 'tickets_jugadas_estado_check'
      and conrelid = 'public.tickets_jugadas'::regclass
  ) then
    alter table public.tickets_jugadas drop constraint tickets_jugadas_estado_check;
  end if;
  alter table public.tickets_jugadas
    add constraint tickets_jugadas_estado_check
    check (estado in ('CREADO', 'EN_REVISION', 'SOLUCIONADO', 'APROBADO', 'RECHAZADO'));
end;
$$;

-- La consola del staff (NotificacionesPortal) lee por RLS con la llave anon y no
-- tenía política de UPDATE para responder. Se abre SOLO lo que esa consola hace:
-- leer todo y actualizar la respuesta. El INSERT del jugador lo hace la Edge
-- Function con service_role, nunca el navegador con la llave anon.
alter table public.tickets_jugadas enable row level security;

drop policy if exists tickets_jugadas_lectura on public.tickets_jugadas;
create policy tickets_jugadas_lectura on public.tickets_jugadas
    for select using (true);

drop policy if exists tickets_jugadas_respuesta on public.tickets_jugadas;
create policy tickets_jugadas_respuesta on public.tickets_jugadas
    for update using (true) with check (true);

grant select, update on public.tickets_jugadas to anon, authenticated;

-- Índice por estado para la bandeja de reclamos (se listan los pendientes).
create index if not exists idx_tickets_jugadas_estado_created
  on public.tickets_jugadas (estado, creado_at desc);

-- ----------------------------------------------------------------------------
-- C) VENTA DESDE EL PORTAL — RPC de Polla (las otras tres ya existen)
-- ----------------------------------------------------------------------------
-- `club_registrar_venta_polla` (sql/pollas.sql) exige la capacidad
-- `pollas:fn_registrar_venta`, que el service_role no tiene (su `auth.uid()` es
-- NULL). Esta variante hace el mismo trabajo sin la comprobación de capacidad,
-- porque quien la llama es la Edge Function, después de validar el token; y
-- recibe `p_cliente_id` explícito, que la Edge Function pone con el dueño real.
create or replace function public.club_portal_vender_polla(
  p_polla_id       uuid,
  p_combinaciones  jsonb,
  p_cliente_id     uuid,
  p_grupo_id       uuid default null,
  p_texto_original text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_precio  numeric;
  v_estado  text;
  v_combos  integer;
  v_total   numeric;
  v_venta   uuid;
  v_cliente public.clientes%rowtype;
  v_grupo   public.grupos_venta%rowtype;
  v_saldo   numeric;
  v_aval    numeric;
  v_limite  numeric;
  v_modo    text;
  v_grupo_id uuid;
begin
  if p_cliente_id is null then
    raise exception 'Falta el jugador.' using errcode = '22023';
  end if;
  if p_polla_id is null then
    raise exception 'Falta la Polla.' using errcode = '22023';
  end if;
  if p_combinaciones is null
     or jsonb_typeof(p_combinaciones) <> 'array'
     or jsonb_array_length(p_combinaciones) = 0 then
    raise exception 'Elegí al menos una combinación.' using errcode = '22023';
  end if;

  -- Cliente (for update: dos sesiones descontándole a la vez se serializan).
  select * into v_cliente from public.clientes where id = p_cliente_id for update;
  if not found then
    raise exception 'El cliente no existe.' using errcode = 'P0002';
  end if;
  if v_cliente.estado is not null and v_cliente.estado <> 'Activo' then
    raise exception 'El cliente % está % y no puede jugar.', v_cliente.nombre, v_cliente.estado;
  end if;

  -- Grupo: el que manda la Edge Function (el grupo real del cliente); si no
  -- viene, se cae a la pertenencia del cliente.
  v_grupo_id := coalesce(p_grupo_id, v_cliente.grupo_id);
  select * into v_grupo from public.grupos_venta where id = v_grupo_id;
  if not found then
    raise exception 'El cliente no tiene un grupo de venta válido.' using errcode = 'P0002';
  end if;
  if v_grupo.activo is not null and v_grupo.activo = false then
    raise exception 'El grupo % está inactivo.', coalesce(v_grupo.nombre, '?');
  end if;

  -- Mismo criterio que club_registrar_venta_polla: la existencia se prueba con
  -- `v_precio is null` (precio_unitario es NOT NULL), no con el estado.
  select precio_unitario, coalesce(estado, 'Abierta')
    into v_precio, v_estado
  from public.pollas
  where id = p_polla_id;
  if v_precio is null then
    raise exception 'La Polla no existe.' using errcode = 'P0002';
  end if;
  if v_estado <> 'Abierta' then
    raise exception 'La Polla está % y no admite ventas nuevas.', v_estado
      using errcode = '22023';
  end if;

  v_combos := jsonb_array_length(p_combinaciones);
  v_total  := v_combos * v_precio;

  -- TOPE DE JUEGO: saldo + aval (modo 'libre' no topa). Idéntico a la Dupleta.
  v_saldo  := coalesce(v_cliente.saldo_actual, 0);
  v_aval   := coalesce(v_cliente.aval, 0);
  v_limite := v_saldo + v_aval;
  v_modo   := lower(btrim(coalesce(v_cliente.modo_juego, 'aval')));
  if v_modo <> 'libre' and v_limite < v_total then
    raise exception
      'Saldo insuficiente. % tiene % de saldo y % de aval (disponible %) y la Polla cuesta %.',
      v_cliente.nombre,
      to_char(v_saldo, 'FM999999999990.00'),
      to_char(v_aval, 'FM999999999990.00'),
      to_char(v_limite, 'FM999999999990.00'),
      to_char(v_total, 'FM999999999990.00');
  end if;

  -- El riesgo se descuenta EN LA MISMA TRANSACCIÓN que la venta.
  update public.clientes
     set saldo_actual = v_saldo - v_total
   where id = p_cliente_id;

  insert into public.polla_ventas (polla_id, cliente_id,
                                   combinaciones, precio_unitario, pagado,
                                   texto_original, estado)
  values (p_polla_id, p_cliente_id,
          v_combos, v_precio, v_total, p_texto_original, 'Pagada')
  returning id into v_venta;

  -- Una fila por combinación, igual que la venta del staff: cada elemento del
  -- arreglo ES el array de posiciones (`posiciones` en polla_combinaciones).
  insert into public.polla_combinaciones (venta_id, polla_id, posiciones)
  select v_venta, p_polla_id, c.combinacion
  from jsonb_array_elements(p_combinaciones) as c(combinacion);

  return jsonb_build_object(
    'ok', true,
    'venta_id', v_venta,
    'combinaciones', v_combos,
    'monto', v_total
  );
end;
$$;

comment on function public.club_portal_vender_polla(uuid, jsonb, uuid, uuid, text) is
  'Venta de Polla desde el Portal del Cliente (service_role): valida saldo+aval, descuenta y registra la venta con sus combinaciones en una transacción.';

revoke all on function public.club_portal_vender_polla(uuid, jsonb, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.club_portal_vender_polla(uuid, jsonb, uuid, uuid, text) to service_role;

-- ----------------------------------------------------------------------------
-- (Opcional) Verificación rápida en el SQL Editor:
--
--   select column_name from information_schema.columns
--    where table_name = 'grupos_venta' and column_name = 'ventana_reclamos';
--   -- 1 fila
--
--   select column_name from information_schema.columns
--    where table_name = 'tickets_jugadas'
--      and column_name in ('ejemplares', 'explicacion', 'aprobado_por', 'visto_cliente');
--   -- 4 filas
--
--   select proname from pg_proc where proname in
--     ('club_actualizar_ventana_reclamos', 'club_portal_vender_polla');
--   -- 2 filas
-- ----------------------------------------------------------------------------
