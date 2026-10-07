-- ===========================================================================
--  MIGRACION DE LAS JUGADAS W/P/S DEL LEGACY  →  SISTEMA PRINCIPAL
-- ===========================================================================
--  QUE HACE ESTO
--
--  El legacy de W/P/S (html/wps.html + js/wps.js) llevaba las jugadas en una
--  tabla APARTE, `wps_tickets`, con su propio saldo y su propio pago. Eso era
--  una segunda contabilidad: esos premios no pasaban por el motor de la casa,
--  ni por `aplicarLiquidacionSaldos`, ni aparecian en los reportes.
--
--  Con W/P/S ya migrado al motor oficial (src/lib/motores/wps.ts), cada jugada
--  es un ticket normal en `tickets_apuestas` con `nombre_jugada` = 'W'/'P'/'S',
--  y se liquida contra la matriz de dividendos `wps_*` de `resultados_carreras`.
--  Este script convierte las jugadas heredadas que quedaron colgadas.
--
--  POR QUE NO SE TOCA EL SALDO
--
--  `js/wps.js` ya descontó el monto de `clientes.saldo_actual` al registrar la
--  jugada (linea 133 del legacy). Acá NO se vuelve a debitar: solo se crea el
--  ticket para que la Liquidación Universal lo pueda decidir y pagar el premio
--  cuando se cargue el resultado. Debitar de nuevo seria cobrarle dos veces al
--  mismo cliente.
--
--  IDEMPOTENCIA
--
--  Cada ticket creado queda sellado con `nota_auditoria::jsonb ->>
--  'wps_ticket_id'` (`nota_auditoria` es TEXT, asi que el cast es
--  obligatorio), y la migracion se guia solo por esa marca. Volver a correr el
--  script no duplica nada.
--
--  `wps_tickets` NO se toca. Ponerle 'MIGRADO' suena lógico, pero si esa columna
--  tuviera un CHECK de estados la sentencia abortaría y, al estar todo dentro de
--  una transacción, se perdería también la migración. Las filas heredadas se
--  dejan intactas y, si querés sellarlas a mano, está la sentencia opcional al
--  final del bloque 3.
--
--  COMO CORRERLO
--
--  En el SQL Editor de Supabase (no hay service_role/psql en el proyecto).
--  Todo va dentro de una transacción: si algo falla, no se migra nada.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) QUE SE VA A MIGRAR (revisión antes de escribir)
-- ---------------------------------------------------------------------------
select
  w.id                                   as wps_ticket_id,
  w.tipo                                 as tipo,
  w.caballo                              as ejemplar,
  w.monto_usd,
  w.carrera,
  h.nombre                               as hipodromo,
  c.nombre                               as cliente,
  w.fecha_registro
from public.wps_tickets w
left join public.hipodromos h on h.id = w.hipodromo_id
left join public.clientes  c on c.id = w.cliente_id
where w.estado = 'Pendiente'
  and upper(btrim(w.tipo)) in ('W', 'P', 'S')
order by w.fecha_registro, w.tipo;

-- ---------------------------------------------------------------------------
-- 2) MIGRACION
-- ---------------------------------------------------------------------------
with candidatas as (
  select
    w.id                 as wps_id,
    upper(btrim(w.tipo))  as tipo,
    btrim(w.caballo)::int as ejemplar,
    btrim(w.caballo)      as ejemplar_txt,
    w.monto_usd,
    w.carrera::int        as carrera,
    w.cliente_id,
    w.fecha_registro,
    upper(btrim(h.nombre)) as hipodromo,
    c.nombre               as cliente_nombre
  from public.wps_tickets w
  join public.hipodromos h on h.id = w.hipodromo_id
  join public.clientes  c on c.id = w.cliente_id
  where w.estado = 'Pendiente'
    and upper(btrim(w.tipo)) in ('W', 'P', 'S')
    -- `caballo` y `ejemplar_numero` son enteros en tickets_apuestas: solo pasan
    -- las filas cuyo ejemplar es puramente numérico, para que un dato raro no
    -- aborte toda la transacción.
    and btrim(coalesce(w.caballo, '')) ~ '^[0-9]+$'
    and w.monto_usd is not null
    and w.monto_usd > 0
    -- ya migrada: se saltea
    --
    -- `nota_auditoria` es TEXT, no jsonb: sin el cast el `->>` reventaba con
    --   ERROR 42883: operator does not exist: text ->> unknown
    -- Y como esto mira TODOS los tickets (no solo los de Marcas), puede haber
    -- texto libre de otras modulos. El CASE se usa porque Postgres SI garantiza
    -- que un CASE no evalua la rama que no toca; un `and` con el cast no lo
    -- garantiza, el planner puede reordenar las condiciones y blowing up igual.
    and not exists (
      select 1
      from public.tickets_apuestas t
      where case
              when t.nota_auditoria ~ '^\s*[\{\[]' then t.nota_auditoria::jsonb ->> 'wps_ticket_id'
            end = w.id::text
    )
),
insertadas as (
  insert into public.tickets_apuestas (
    fecha_registro,
    hipodromo,
    carrera,
    nombre_jugada,
    caballo,
    ejemplar_numero,
    monto_jugado,
    monto_decidido,
    premio_pagar,
    premio_por_tabla,
    cliente_juega_id,
    cliente_juega_nombre,
    estado,
    nota_auditoria
  )
  select
    -- `wps_tickets.fecha_registro` es timestamp sin zona; el ticket es timestamptz.
    -- El cast usa la zona de la sesión (UTC en Supabase), que es la misma con la
    -- que el legacy restaba el saldo, así el ticket cae en el mismo día que la
    -- jugada original y aparece en el reporte de ese día.
    k.fecha_registro::timestamptz,
    k.hipodromo,
    k.carrera,
    k.tipo,
    k.ejemplar_txt,
    k.ejemplar,
    k.monto_usd,
    0,
    0,
    null,
    k.cliente_id,
    k.cliente_nombre,
    'Pendiente',
    -- `nota_auditoria` es TEXT. El `::text` es explicito a proposito: dejarlo
    -- implicito depende del cast de asignacion jsonb->text y si ese dia no esta,
    -- el INSERT entero aborta y se pierde la migracion.
    jsonb_build_object(
      'origen', 'WPS_LEGACY',
      'wps_ticket_id', k.wps_id::text,
      'migrado_en', now(),
      'nota', 'Saldo ya descontado por el legacy: NO se debito de nuevo. El premio se liquida con la matriz wps_* de resultados_carreras.'
    )::text
  from candidatas k
  returning id, nombre_jugada, caballo, monto_jugado, hipodromo, carrera
)
select * from insertadas;

-- ---------------------------------------------------------------------------
-- 3) QUE FALTO Y POR QUE
-- ---------------------------------------------------------------------------
-- Las que NO entraron son las que no tienen ticket: hipodromo o cliente que ya
-- no existen, ejemplar no numérico, o monto inválido. Se listan para que la casa
-- las resuelva a mano en vez de perderse en silencio.
select
  w.id                as wps_ticket_sin_migrar,
  w.tipo,
  w.caballo,
  w.monto_usd,
  w.estado,
  case
    when h.id is null then 'hipodromo_id no existe'
    when c.id is null then 'cliente_id no existe'
    when btrim(coalesce(w.caballo, '')) !~ '^[0-9]+$' then 'ejemplar no numerico'
    else 'monto invalido'
  end as motivo
from public.wps_tickets w
left join public.hipodromos h on h.id = w.hipodromo_id
left join public.clientes  c on c.id = w.cliente_id
where w.estado = 'Pendiente'
  and upper(btrim(w.tipo)) in ('W', 'P', 'S')
  and not exists (
    select 1
    from public.tickets_apuestas t
    where case
            when t.nota_auditoria ~ '^\s*[\{\[]' then t.nota_auditoria::jsonb ->> 'wps_ticket_id'
          end = w.id::text
  );

-- Opcional, SOLO si se quiere marcar las filas heredadas. Descomentar y correr
-- por separado (fuera de la transacción) para no arriesgar el bloque anterior:
--
--   update public.wps_tickets set estado = 'MIGRADO'
--    where estado = 'Pendiente' and upper(btrim(tipo)) in ('W','P','S');

commit;

-- ===========================================================================
--  DESPUES DE MIGRAR: la liquidacion
-- ===========================================================================
--
--  Los tickets quedan 'Pendiente'. Para pagarlos hay que:
--
--    1. Cargar el resultado de esa carrera en Taquilla → Pagar Carrera →
--       "Cargar Resultados", marcando la casilla "Cargar matriz americana W/P/S"
--       y anotando las 6 celdas tal como las publica el tablero (por $2).
--       Eso escribe `wps_WW`...`wps_SS` en resultados_carreras.dividendos.
--
--    2. Volver a liquidar la carrera. Los tickets W/P/S se pagan solos.
--
--  Si se liquida SIN la matriz cargada, los tickets NO se marcan como perdidos:
--  el motor los devuelve como indeterminado y quedan pendientes con un aviso
--  que dice qué dividendo falta. No se cobra $0 por un dato no cargado.
-- ===========================================================================
