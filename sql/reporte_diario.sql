-- ============================================================================
--  REPORTE DIARIO Y POR CARRERA — agregado en el servidor
--  club_reporte_diario(desde, hasta, hipodromo, grupo_id, cliente_id)
-- ============================================================================
--
--  Ejecutar DESPUÉS de:
--    1. src/core/db/seguridad_maestro.sql   (usuario_de, soy_principal)
--    2. src/core/db/rls-negocio.sql         (enciende RLS)
--    3. sql/grupos_usuarios.sql             (grupo_del_usuario, ve_todos_los_grupos,
--                                            usuario_en_grupo, usuario_en_cliente)
--    4. sql/jugadas_monitor.sql             (columna `anulada` en tickets_apuestas)
--    5. sql/fecha_carrera_tickets.sql       (columna `fecha_carrera`)
--
--  Idempotente: se puede correr las veces que haga falta.
--
--  --------------------------------------------------------------------------
--  POR QUÉ UNA RPC Y NO UNA CONSULTA DEL NAVEGADOR
--  --------------------------------------------------------------------------
--  El reporte suma con CASE WHEN sobre miles de tickets. Hacerlo en Postgres
--  baja los bytes que viajan y, sobre todo, deja el ALCANCE POR ROL en el
--  SERVIDOR: el navegador no es la última palabra.
--
--  La frontera de aislamiento es la MISMA sentencia que el RLS de
--  `tickets_apuestas` (sql/rls_por_grupo.sql):
--
--      usuario_en_grupo(uid, grupo_cobro_id) OR usuario_en_cliente(uid, cliente_juega_id)
--
--  Un usuario con grupo ve SOLO su grupo; el principal (o quien no tiene grupo)
--  ve todo. Encima de esa frontera van los filtros de la pantalla:
--
--      * p_grupo_id / p_cliente_id los usa el SUPER ADMINISTRADOR para mirar un
--        grupo o un cliente puntual. Para el resto llegan en NULL (la pantalla
--        no los manda) y, aunque alguien los inyecte a mano, la frontera de
--        arriba sigue aplicando en AND: no puede ver datos ajenos.
--
--  Nota: la función es SECURITY DEFINER para poder leer `clientes.devolucion`
--  (el % de incentivo por cliente) sin chocar con el RLS de `clientes`. Solo
--  lee la devolución de los clientes que ya quedaron dentro del rango permitido.
-- ============================================================================

create or replace function public.club_reporte_diario(
    p_desde      date,
    p_hasta      date,
    p_hipodromo  text default null,
    p_grupo_id   text default null,
    p_cliente_id text default null
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with base as (
    select
      upper(btrim(coalesce(t.hipodromo, '—')))                as hipodromo,
      coalesce(t.carrera, 0)::int                             as carrera,
      -- Una jugada anulada no cuenta como ticket ni como jugado.
      case when coalesce(t.anulada, false)
                or upper(coalesce(t.estado, '')) like '%ANUL%'
           then 0 else 1 end                                  as ticket,
      case when coalesce(t.anulada, false)
                or upper(coalesce(t.estado, '')) like '%ANUL%'
           then 0 else coalesce(t.monto_jugado, 0) end        as jugado,
      -- El premio tampoco cuenta en una anulada: su capital se devolvió y no se
      -- paga. Sin este corte, un `premio_pagar` heredado de antes de anular la
      -- inflaba en `total_premios` (y en el balance).
      case when coalesce(t.anulada, false)
                or upper(coalesce(t.estado, '')) like '%ANUL%'
           then 0
           else coalesce(t.premio_pagar, t.premio_por_tabla, 0)
      end                                                     as premio,
      -- Devolución / Incentivo: % del cliente sobre el monto DECIDIDO
      -- (mismo cálculo que el estado de cuenta: monto_decidido ?? monto_jugado).
      case when coalesce(t.anulada, false)
                or upper(coalesce(t.estado, '')) like '%ANUL%'
           then 0
           else coalesce(t.monto_decidido, t.monto_jugado, 0)
                * (coalesce(c.devolucion, 0) / 100.0)
      end                                                     as devolucion
    from public.tickets_apuestas t
    left join public.clientes c on c.id::text = t.cliente_juega_id::text
    where coalesce(t.fecha_carrera, t.fecha_registro::date) between p_desde and p_hasta
      and (p_hipodromo is null or btrim(p_hipodromo) = '' or t.hipodromo = p_hipodromo)
      -- FRONTERA: idéntica al RLS de tickets_apuestas.
      and (
        public.usuario_en_grupo(auth.uid(), t.grupo_cobro_id::text)
        or public.usuario_en_cliente(auth.uid(), t.cliente_juega_id::text)
      )
      -- Filtros de la pantalla (super administrador).
      and (p_grupo_id   is null or t.grupo_cobro_id::text  = p_grupo_id)
      and (p_cliente_id is null or t.cliente_juega_id::text = p_cliente_id)
  ),
  filas as (
    select
      hipodromo,
      carrera,
      sum(ticket)::int                                        as tickets,
      round(sum(jugado), 2)                                   as total_jugado,
      round(sum(premio), 2)                                   as total_premios,
      round(sum(devolucion), 2)                               as devolucion
    from base
    group by hipodromo, carrera
  )
  select jsonb_build_object(
    'filas', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'hipodromo',     hipodromo,
          'carrera',       carrera,
          'tickets',       tickets,
          'total_jugado',  total_jugado,
          'total_premios', total_premios,
          'devolucion',    devolucion,
          'balance',       round(total_jugado - total_premios - devolucion, 2)
        ) order by hipodromo, carrera
      )
      from filas
    ), '[]'::jsonb),
    'totales', (
      select jsonb_build_object(
        'tickets',       coalesce(sum(tickets), 0),
        'total_jugado',  round(coalesce(sum(total_jugado), 0), 2),
        'total_premios', round(coalesce(sum(total_premios), 0), 2),
        'devolucion',    round(coalesce(sum(devolucion), 0), 2),
        'balance',       round(
                           coalesce(sum(total_jugado), 0)
                           - coalesce(sum(total_premios), 0)
                           - coalesce(sum(devolucion), 0), 2)
      )
      from filas
    )
  );
$$;

revoke all on function public.club_reporte_diario(date, date, text, text, text) from public, anon;
grant execute on function public.club_reporte_diario(date, date, text, text, text) to authenticated;

-- Verificación rápida (debe devolver una fila con 'filas' y 'totales'):
--   select public.club_reporte_diario(current_date, current_date, null, null, null);
--
-- ---------------------------------------------------------------------------
-- GATEADO POR "general:ruta_saldos"
-- ---------------------------------------------------------------------------
-- La ruta `/reporte-diario` comparte la misma puerta que la barra de
-- "Saldos y Reportes" (`general:ruta_saldos`). No se declara una capacidad
-- dedicada para evitar crear una fila de `capacidad` que nadie tenga sembrada
-- desde el principio; el ALCANCE DE DATOS sigue estando FUERTEMENTE
-- RESTRINGIDO por la RPC + el RLS por grupo/cliente.
