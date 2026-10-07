-- =============================================================================
-- MODULO MARCAS (matchups dinamicos) - VENTA, RESULTADO Y LIQUIDACION
-- =============================================================================
-- A diferencia del motor eliminado en el commit 608444d, esto NO es un modulo
-- local: la venta descuenta el saldo y crea el ticket dentro de UNA
-- TRANSACCION, y la liquidacion se hace con otra.
--
-- Jerarquia posicional (el orden de `marcas` es de izquierda a derecha):
--   - Si el caballo esta en `nv`                      -> JUGADA BLOQUEADA
--   - Si NO esta en `marcas` ni en `nv`               -> rival: una marca, de una en una
--   - Si es la PRIMERA marca (indice 1)               -> JUGADA BLOQUEADA
--   - Si esta en `marcas`, indice i>1                 -> rival: marcas[1 .. i-1], de una en una
--
-- LA JUGADA ES UN MATCH DE A UNO. Elegir un caballo NO lo pone a pelear contra
-- todos los demas: el operador elige CUAL de los que tiene legal a su izquierda
-- (`p_rival`), y ese es el unico rival del ticket. La norma de derecha a
-- izquierda es la que acota la lista, asi que un caballo de la izquierda nunca
-- puede jugarse contra uno de la derecha: ese cruce ni siquiera se ofrece.
-- `p_rival` se revalida aqui contra esa misma lista; no se acepta lo que mande
-- el navegador.
--
-- Matematica 120/100 (juega 120 para ganar 100):
--   ganancia neta = monto * 100/120
--   pago bruto    = monto + ganancia neta = monto * 220/120
--
-- El snapshot de rivales va en tickets_apuestas.nota_auditoria (con UN solo
-- elemento), asi que editar la configuracion de la carrera despues NO altera
-- los tickets ya vendidos: la liquidacion lee el snapshot, nunca `marcas` de la
-- tabla. Por eso cambiar la regla NO obliga a tocar `club_liquidar_marca`: los
-- tickets viejos siguen teniendo su lista y se liquidan como se vendieron.
--
-- -----------------------------------------------------------------------------
-- REQUISITO QUE IMPONE EL ESQUEMA REAL (verificado contra la produccion):
-- `resultados_carreras` NO tiene orden de llegada persistido. El flujo de
-- resultados historico solo guarda `ganadores text[]` y `retirados text`
-- (texto libre: "4" o "NO HUBO RETIROS"). "Gana si llega por delante del rival"
-- NO es computable con eso: si el jugado y el rival estan ambos en `ganadores`,
-- no se sabe cual llego primero.
-- Por eso este archivo agrega `club_registrar_orden_llegada`: sin orden de
-- llegada, `club_liquidar_marca` ABORTA sin mover un centavo.
-- -----------------------------------------------------------------------------
--
-- Ejecutar en el SQL Editor de Supabase. Es idempotente.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1) CONFIGURACION POR CARRERA (CRUD desde el panel administrativo)
-- -----------------------------------------------------------------------------
-- Una fila por carrera. `marcas` y `nv` son texto con los numeros separados por
-- "/": "1/2/3/4/5" y "6/7/8". El orden de `marcas` ES la jerarquia.
create table if not exists public.marcas_carrera (
    id                  bigint generated always as identity primary key,
    hipodromo           text not null,
    fecha               date not null,
    carrera             int  not null,
    marcas              text not null default '',
    nv                  text not null default '',
    -- Debutantes: caballos que aun no han efectiva su primera carrera. Van en
    -- "1/4/7" con el mismo separador "/" que marcas y nv.
    debutantes          text not null default '',
    -- Switch por carrera. true  = el debutante cuenta como cualquier caballo.
    -- false = se comporta EXACTAMENTE como un NV: no se puede jugar y no es
    -- rival valido.
    --
    -- El default es true a proposito: una carrera que no tiene el switch a la
    -- vista tiene que comportarse como antes de que existiera la columna, no
    -- bloquear Debutantes en silencio.
    debutantes_valen    boolean not null default true,
    estado              text not null default 'Abierta',
    updated_at          timestamptz not null default now(),
    constraint marcas_carrera_unica unique (hipodromo, fecha, carrera)
);

comment on table public.marcas_carrera is
    'Marcas, NV y debutantes por carrera. El orden de marcas es la jerarquia: cada caballo se mide contra UN solo rival, y solo contra los que tiene a su izquierda (nunca uno de la izquierda contra uno de la derecha).';

-- La tabla ya existe en la base (este archivo se aplico antes de que existiera
-- la columna debutantes), asi que el CREATE de arriba no agrega nada. Sin esto
-- la columna no se crearia nunca en una base que ya tiene la tabla.
alter table public.marcas_carrera add column if not exists debutantes       text    not null default '';
alter table public.marcas_carrera add column if not exists debutantes_valen boolean not null default true;

  -- El hipodromo se normaliza a upper(trim) ANTES de escribir, tanto en la app
  -- (guardarConfigMarcas) como en las RPC, asi que la restriccion unica textual
  -- basta: "la rinconada" y "LA RINCONADA" nunca llegan a coexistir por la via
  -- de la aplicacion. Un INSERT suelto a mano con minusculas crearia una fila
  -- que leerConfigMarcas si encuentra (usa ilike) pero que la venta no encontraria
  -- (usa upper(btrim(...)) = ...): por eso leer y escribir normalizan distinto.
  alter table public.marcas_carrera enable row level security;

  -- RLS permisivo, y esto es DELIBERADO, no una omision.
  --
  -- La convencion del proyecto NO es uniformemente permisiva: se comprobo contra
  -- la base real que `grupos_venta` y `clientes_grupos` BLOQUEAN el insert de
  -- `anon` (42501) mientras que `clientes` y `resultados_carreras` lo permiten.
  -- Cada tabla tiene su politica.
  --
  -- `marcas_carrera` no puede seguir esa linea restrictiva porque la app la
  -- escribe desde el navegador: guardarConfigMarcas() hace un upsert por
  -- hipodromo+fecha+carrera. Cerrarle el insert seria romper la configuracion
  -- de marcas sin ganar nada, porque aqui no hay dinero: no hay saldo, no hay
  -- comision y no se mueven clientes. Todo el dinero de Marcas pasa por las RPC
  -- security definer de abajo, que si validan grupo, cliente, saldo y la
  -- jerarquia.
  drop policy if exists marcas_carrera_publico on public.marcas_carrera;
  create policy marcas_carrera_publico on public.marcas_carrera
      for all using (true) with check (true);

  grant select, insert, update, delete on public.marcas_carrera to anon, authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 2) VENTA
-- -----------------------------------------------------------------------------
-- La jerarquia se recalcula AQUI, no se recibe del navegador. El modal calcula
-- lo mismo para previsualizar, pero la verdad es esta funcion: si el cliente
-- mandara una lista de rivales manipulada, quedaria registrada igual.
  create or replace function public.club_vender_marca(
      p_hipodromo  text,
      p_carrera    int,
      p_fecha      date,
      p_caballo    text,     -- numero del caballo a jugar
      p_monto      numeric,
      p_cliente_id uuid,
      p_grupo_id   uuid,
      p_usuario    text default null,
      p_idem       text default null,  -- clave de idempotencia (ver abajo)
      -- Rival del match: UN solo numero. Va al final porque todos los que le
      -- siguen necesitan default, y Postgres exige eso en cuanto uno lo tiene.
      -- `default null` a proposito: si falta, se usa el primer legal (ver la
      -- validacion mas abajo) en vez de rechazar la venta.
      p_rival      text default null
  )
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
  declare
      v_cfg       public.marcas_carrera%rowtype;
      v_cliente   public.clientes%rowtype;
      v_grupo     public.grupos_venta%rowtype;
      v_sel       text;
      v_hipo      text;
      v_idem      text;
      v_marcas    text[] := '{}';
      v_nv        text[] := '{}';
    v_debutantes text[] := '{}';
    v_debutantes_valen boolean := true;
      v_rivales   text[] := '{}';
    v_candidatos text[] := '{}';
    v_rival      text;
      v_participantes text[] := '{}';
      v_caballos  jsonb;
      v_idx       int;
      v_tipo      text;
      v_ganancia  numeric;
      v_bruto     numeric;
      v_saldo     numeric;
      v_aval      numeric;
      v_limite    numeric;
      v_modo      text;
      v_ins       public.tickets_apuestas%rowtype;
  begin
      -- ------------------------------------------------------------------
      -- IDEMPOTENCIA (primer control, antes de tocar nada)
      --
      -- El boton deshabilitado evita el doble clic, pero no el reintento: un
      -- timeout de la red hace que PostgREST reintente y el cliente se paga dos
      -- veces por la misma jugada. `p_idem` es una clave que genera la caja
      -- (uuid). Si ya hay un ticket con esa clave, se devuelve ESE ticket sin
      -- debitar nada: repetir la llamada es seguro.
      --
      -- El indice unico parcial de mas abajo (tickets_marcas_idem_unico) es la
      -- garantia real: si dos cajas envian la misma clave a la vez, la segunda
      -- choca contra el indice y la transaccion entera se revierte, con el
      -- descuento incluido. Ahi la excepcion se traduce a mensaje en vez de
      -- dejar un error crudo de unicidad.
      -- ------------------------------------------------------------------
      v_idem := nullif(btrim(coalesce(p_idem, '')), '');
      if v_idem is not null then
          select * into v_ins
            from public.tickets_apuestas
           where nota_auditoria::jsonb ->> 'idempotencia' = v_idem;

          if found then
              return jsonb_build_object(
                  'ok',            true,
                  'ya_existia',    true,
                  'ticket_id',     v_ins.id,
                  'estado',        v_ins.estado,
                  'saldo_restante', (select coalesce(saldo_actual, 0) from public.clientes where id = v_ins.cliente_juega_id)
              );
          end if;
      end if;

    -- ------------------------------------------------------------------
    -- Entrada
    -- ------------------------------------------------------------------
    if p_monto is null or p_monto <= 0 then
        raise exception 'El monto debe ser un numero mayor a cero.';
    end if;
    if p_cliente_id is null then
        raise exception 'Debe seleccionar el cliente que juega.';
    end if;
    -- El grupo no es opcional: la venta es always Grupo -> Cliente (ver
    -- VentaMarcasModal). Dejarlo null permitia tickets sin grupo cobrable, que
    -- rompen el reporte de comisiones.
    if p_grupo_id is null then
        raise exception 'Debe seleccionar el grupo de venta.';
    end if;

    v_hipo := upper(btrim(coalesce(p_hipodromo, '')));
    if v_hipo = '' then
        raise exception 'Debe indicar el hipodromo.';
    end if;

    v_sel := btrim(coalesce(p_caballo, ''));
    if v_sel = '' then
        raise exception 'Debe seleccionar el caballo a jugar.';
    end if;

    -- ------------------------------------------------------------------
    -- Configuracion de la carrera (for update: dos cajas vendiendo la misma
    -- carrera a la vez se serializan y no leen marcas a medio editar)
    -- ------------------------------------------------------------------
    select * into v_cfg
      from public.marcas_carrera
     where upper(btrim(hipodromo)) = v_hipo
       and fecha = p_fecha
       and carrera = p_carrera
     for update;

    if not found then
        raise exception 'La carrera % % N%s no tiene configuracion de marcas. Publiquela primero en el panel de Marcas.', v_hipo, p_fecha, p_carrera;
    end if;
    -- coalesce: si `estado` quedara null, la comparacion daria NULL, el IF no
    -- se tomaria y la carrera se venderia SIN estar abierta. Null se trata como
    -- 'Abierta', que es el default de la columna y lo que quiere decir "lista".
    if coalesce(v_cfg.estado, 'Abierta') <> 'Abierta' then
        raise exception 'La carrera % % N%s tiene las marcas % (no se aceptan jugadas).', v_hipo, p_fecha, p_carrera, lower(v_cfg.estado);
    end if;

    -- Participantes reales de la carrera registrada: de aqui sale la validacion
    -- de que marcas y NV correspondan a caballos que corren.
    select coalesce(caballos, '[]'::jsonb) into v_caballos
      from public.resultados_carreras
     where upper(btrim(hipodromo)) = v_hipo
       and fecha = p_fecha
       and carrera = p_carrera;

    -- "1/2/3/4/5" -> {1,2,3,4,5}. Se descartan los segmentos vacios ("1//2" no
    -- debe inventar un rival en blanco).
    select coalesce(array_agg(btrim(x)), '{}'::text[])
      into v_marcas
      from unnest(string_to_array(coalesce(v_cfg.marcas, ''), '/')) as x
     where btrim(x) <> '';

    select coalesce(array_agg(btrim(x)), '{}'::text[])
      into v_nv
      from unnest(string_to_array(coalesce(v_cfg.nv, ''), '/')) as x
     where btrim(x) <> '';

    -- ------------------------------------------------------------------
    -- Debutantes.
    --
    -- El switch decide si valen. Cuando NO valen se suman al NV efectivo en vez
    -- de abrir una rama nueva de logica: todo lo que hay mas abajo (validar
    -- participantes, bloquear la jugada, excluir rivales) ya sabe tratar a un
    -- NV, y asi el debutante se comporta IGUAL que un NV por construccion y no
    -- por Parecer. El unicoorro es que el error le dice al caja que era
    -- debutante y no un NV, que es info que hace falta para arreglarlo.
    -- ------------------------------------------------------------------
    select coalesce(array_agg(btrim(x)), '{}'::text[])
      into v_debutantes
      from unnest(string_to_array(coalesce(v_cfg.debutantes, ''), '/')) as x
     where btrim(x) <> '';

    -- Un caballo no puede ser marca y debutante a la vez: son contradictorios y
    -- el que gana dependeria del orden en que se leyeran los dos campos.
    if exists (select 1 from unnest(v_debutantes) d where d = any(v_marcas)) then
        raise exception 'El caballo % esta como marca y como debutante en la carrera % N%s. Un caballo no puede ser las dos cosas.', (select d from unnest(v_debutantes) d where d = any(v_marcas) limit 1), v_hipo, p_carrera;
    end if;

    -- El switch se lee con coalesce y no con "<> true": si la columna llegara
    -- null (no deberia, es not null, pero una fila vieja o un UPDATE manual
    -- podrian dejarla asi) un null no debe interpretarse como "no valen" y
    -- bloquear Debutantes en silencio. null = vale.
    v_debutantes_valen := coalesce(v_cfg.debutantes_valen, true);

    -- El FOLD de debutantes al NV efectivo va MAS ABAJO, despues de validar
    -- participantes, a proposito: si se hiciera aqui, un debutante mal escrito
    -- reventaria en la validacion de NV con el mensaje "Algun NV no corresponde
    -- a un caballo registrado", que manda a corregir el NV cuando el error esta
    -- en la columna de debutantes.

    -- Un numero repetido en la configuracion haria que un caballo se facinga
    -- contra si mismo. Se valida aqui y no en la UI, porque la UI no es la
    -- frontera de confianza.
    if array_length(v_marcas, 1) <> (select count(distinct x) from unnest(v_marcas) as x) then
        raise exception 'La configuracion de marcas de la carrera % N%s tiene numeros repetidos. Corrigela antes de vender.', v_hipo, p_carrera;
    end if;

    -- ------------------------------------------------------------------
    -- Las marcas y los NV tienen que ser caballos QUE CORREN. La informacion
    -- sale de la carrera registrada (`resultados_carreras.caballos`), que es la
    -- lista real de participantes. Se valida en el servidor y no solo en el
    -- panel: una caja con la pantalla abierta de antes de laInscripcion
    -- intentaria vender contra un rival que no participate, y el ticket quedaria
    -- con un snapshot imposible de liquidar.
    -- ------------------------------------------------------------------
    select coalesce(array_agg(btrim(c ->> 'numero')), '{}'::text[])
      into v_participantes
      from jsonb_array_elements(coalesce(v_caballos, '[]'::jsonb)) c
     where btrim(coalesce(c ->> 'numero', '')) <> '';

    if array_length(v_participantes, 1) is null then
        raise exception 'La carrera % % N%s no tiene caballos registrados. No se puede vender Marcas sobre una carrera sin participantes.', v_hipo, p_fecha, p_carrera;
    end if;

    if exists (select 1 from unnest(v_marcas) m where not (m = any(v_participantes))) then
        raise exception 'Alguna marca de la carrera % N%s no corresponde a un caballo registrado. Corrige las marcas antes de vender.', v_hipo, p_carrera;
    end if;

    if exists (select 1 from unnest(v_nv) n where not (n = any(v_participantes))) then
        raise exception 'Algun NV de la carrera % N%s no corresponde a un caballo registrado. Corrige el NV antes de vender.', v_hipo, p_carrera;
    end if;

    -- Los debutantes se validan SIEMPRE, con el switch en true o en false: un
    -- numero mal escrito es un error de tipeo ahora, y si solo se validara con
    -- el switch apagado pasaria desapercibido hasta el dia que lo apaguen.
    if exists (select 1 from unnest(v_debutantes) d where not (d = any(v_participantes))) then
        raise exception 'Algun debutante de la carrera % N%s no corresponde a un caballo registrado. Corrige la lista de debutantes antes de vender.', v_hipo, p_carrera;
    end if;

    -- FOLD: con el switch en "no valen", los debutantes entran al NV efectivo.
    -- A partir de aqui el debutante es indistinguible de un NV para toda la
    -- logica que sigue (bloqueo, exclusion de rivales, snapshot).
    if not v_debutantes_valen then
        v_nv := (
            select coalesce(array_agg(distinct t), '{}'::text[])
              from unnest(v_nv || v_debutantes) as t
        );
    end if;

    -- El caballo que se juega tambien tiene que correr. Antes faltaba esta
    -- Comprobacion: se validaban las marcas y los NV, pero no `v_sel`, asi que
    -- la RPC aceptaba vender el caballo 9 en una carrera con los caballos 1-4.
    -- El ticket quedaba con un caballo inexistente y reventaba mas tarde, en la
    -- liquidacion, con "el caballo 9 no aparece en el orden de llegada".
    if not (v_sel = any(v_participantes)) then
        raise exception 'El caballo % no corre en la carrera % % N%s. No se puede vender Marcas sobre un caballo que no participa.', v_sel, v_hipo, p_fecha, p_carrera;
    end if;

    -- ------------------------------------------------------------------
    -- Jerarquia posicional. Mismas reglas del spec, validadas en el servidor.
    --
    -- LA JUGADA ES DE A UNO. Elegir un caballo NO lo pone a pelear contra todos
    -- los demas: el operador elige CUAL de los que tiene legal a su izquierda,
    -- y ese es el unico rival del ticket. La norma de derecha a izquierda acota
    -- la lista, asi que un caballo de la izquierda nunca puede jugarse contra
    -- uno de la derecha: ese cruce ni siquiera llega aqui como candidato.
    -- ------------------------------------------------------------------
    -- El debutante se reporta ANTES que el NV. Los dos dan el mismo resultado
    -- (bloqueado) pero el mensaje tiene que decir cual de los dos es, porque
    -- el arreglo es en columnas distintas del panel.
    if not v_debutantes_valen and v_sel = any(v_debutantes) then
        raise exception 'El caballo % es debutante y la carrera % N%s tiene "debutantes no valen". JUGADA BLOQUEADA.', v_sel, v_hipo, p_carrera;
    end if;

    if v_sel = any(v_nv) then
        raise exception 'El caballo % es NV (No Vale). JUGADA BLOQUEADA.', v_sel;
    end if;

    v_idx := array_position(v_marcas, v_sel);

    if v_idx is null then
        -- Fuera de la marca: todas las marcas quedan a su izquierda.
        if array_length(v_marcas, 1) is null then
            raise exception 'No hay marcas definidas para enfrentar en esta carrera.';
        end if;
        v_candidatos := v_marcas;
    else
        if v_idx = 1 then
            raise exception 'El caballo % es el primer favorito. No tiene rivales a su izquierda.', v_sel;
        end if;
        -- Postgres arrays son 1-based: marcas[1 .. v_idx-1] es todo lo que esta
        -- a su izquierda, en el mismo orden jerarquico.
        v_candidatos := v_marcas[1 : v_idx - 1];
    end if;

    -- Un caballo nunca puede ser su propio rival, ni aunque la configuracion
    -- venga con numeros repetidos: `revisarConfig` lo marca y aqui se evita
    -- que un ticket nazca medido contra si mismo.
    if array_length(v_candidatos, 1) is not null then
        select coalesce(array_agg(c), '{}'::text[])
          into v_candidatos
          from (select unnest(v_candidatos) as c) t
         where c <> v_sel;
    end if;

    if array_length(v_candidatos, 1) is null then
        raise exception 'El caballo % no tiene ningun rival legal a su izquierda.', v_sel;
    end if;

    -- El rival que pidio el navegador NO se acepta sin comprobar: si no esta en
    -- la lista legal, la venta se rechaza en vez de guardar un matchup que el
    -- operador nunca vio. Si no vino ninguno (cliente viejo), se usa el primero.
    v_rival := nullif(btrim(coalesce(p_rival, '')), '');

    if v_rival is null then
        v_rival := v_candidatos[1];
    elsif not (v_rival = any(v_candidatos)) then
        raise exception
            'El caballo % no se puede medir contra el %: solo tiene legales a su izquierda (%).',
            v_sel, v_rival, array_to_string(v_candidatos, ', ');
    end if;

    -- El snapshot queda con UN elemento. `club_liquidar_marca` lee esta misma
    -- lista, asi que la liquidacion no necesita ningun cambio: gana si llega
    -- por delante de ese rival y por nada mas.
    v_rivales := array[v_rival];
    v_tipo    := 'CONTRA_UNO';

    -- ------------------------------------------------------------------
    -- Grupo
    -- ------------------------------------------------------------------
    select * into v_grupo
      from public.grupos_venta
     where id = p_grupo_id;

    if not found then
        raise exception 'El grupo de venta no existe.';
    end if;
    if v_grupo.activo is not null and v_grupo.activo = false then
        raise exception 'El grupo % esta inactivo.', coalesce(v_grupo.nombre, '?');
    end if;

    -- Marcas opera solo en USD. No hay tasa de cambio definida para este
    -- modulo, asi que cualquier otra moneda se rechaza en vez de inventar una
    -- tasa de 1 y registrar un ticket con la moneda equivocada.
    if upper(coalesce(v_grupo.moneda, 'USD')) <> 'USD' then
        raise exception 'Marcas solo opera en USD. El grupo % esta en %.', coalesce(v_grupo.nombre, '?'), coalesce(v_grupo.moneda, 'USD');
    end if;

    -- ------------------------------------------------------------------
    -- Cliente (for update: dos cajas descontandole al mismo tiempo
    -- no pueden leer el mismo saldo y sobrescribirse)
    -- ------------------------------------------------------------------
    select * into v_cliente
      from public.clientes
     where id = p_cliente_id
     for update;

    if not found then
        raise exception 'El cliente no existe.';
    end if;
    if v_cliente.estado is not null and v_cliente.estado <> 'Activo' then
        raise exception 'El cliente % esta % y no puede jugar.', v_cliente.nombre, v_cliente.estado;
    end if;

    -- Pertenencia al grupo con la MISMA regla que la app (listarClientesVenta):
    -- grupos_venta.clientes = clientes_grupo_id U clientes_grupos. Aceptar solo
    -- uno de los dos dejaria clientes que el modal no muestra pero que la RPC
    -- si cobraria.
    if coalesce(v_cliente.grupo_id::text, '') <> p_grupo_id::text
       and not exists (
            select 1 from public.clientes_grupos cg
             where cg.cliente_id = p_cliente_id and cg.grupo_id = p_grupo_id
       ) then
        raise exception 'El cliente % no pertenece al grupo %.', v_cliente.nombre, coalesce(v_grupo.nombre, '?');
    end if;

    -- ------------------------------------------------------------------
    -- TOPE DE JUEGO: saldo + aval.
    --
    -- El aval es credito propio que el banco le garantizo al cliente, asi que
    -- amplia su poder de compra: un cliente con saldo NEGATIVO puede seguir
    -- jugando hasta donde se lo da el aval. Comprado $100 y con $300 de aval
    -- → disponible $400; al jugarlos los $400 el saldo queda en -$300, que es
    -- justo su aval, y ahi vuelve a topar.
    --
    -- El aval NO se descuenta aqui: topa contra `saldo + aval` y es el saldo el
    -- que baja. Rebajar `aval` en cada ticket exigiria tocarlo en cada venta y
    -- se desincronizaria con el limite.
    --
    -- Modo "libre": el cliente juega por encima de su saldo y no topa. Este
    -- chequeo vivia solo en el navegador, asi que un cliente libre no podia
    -- comprar ni una marca y el modo era inutilizable.
    -- ------------------------------------------------------------------
    v_saldo    := coalesce(v_cliente.saldo_actual, 0);
    v_aval     := coalesce(v_cliente.aval, 0);
    v_limite   := v_saldo + v_aval;
    v_modo     := lower(btrim(coalesce(v_cliente.modo_juego, 'aval')));

    if v_modo <> 'libre' and v_limite < p_monto then
        if v_saldo < 0 and v_aval > 0 then
            raise exception
                'Saldo insuficiente. % tiene % de saldo (en mora) y % de aval: alcanza % pero la jugada es de %.',
                v_cliente.nombre,
                to_char(v_saldo, 'FM999999999990.00'),
                to_char(v_aval, 'FM999999999990.00'),
                to_char(v_limite, 'FM999999999990.00'),
                to_char(p_monto, 'FM999999999990.00');
        elsif v_aval > 0 then
            raise exception
                'Saldo insuficiente. % tiene % de saldo mas % de aval (disponible %) y la jugada es de %.',
                v_cliente.nombre,
                to_char(v_saldo, 'FM999999999990.00'),
                to_char(v_aval, 'FM999999999990.00'),
                to_char(v_limite, 'FM999999999990.00'),
                to_char(p_monto, 'FM999999999990.00');
        else
            raise exception
                'Saldo insuficiente. % tiene % y la jugada es de %.',
                v_cliente.nombre,
                to_char(v_saldo, 'FM999999999990.00'),
                to_char(p_monto, 'FM999999999990.00');
        end if;
    end if;

    -- ------------------------------------------------------------------
    -- Matematica 120/100
    -- ------------------------------------------------------------------
    v_ganancia := round(p_monto * 100 / 120, 2);
    v_bruto    := round(p_monto + v_ganancia, 2);

    -- ------------------------------------------------------------------
    -- El riesgo se descuenta ANTES de crear el ticket, y en la misma
    -- transaccion: si el INSERT fallara, el raise revierte el descuento. Al
    -- reves (cobrar y luego fallar el insert) el saldo queda debitado sin
    -- ticket, que es plata de la banca sin respaldo.
    -- ------------------------------------------------------------------
    update public.clientes
       set saldo_actual = v_saldo - p_monto
     where id = p_cliente_id;

    insert into public.tickets_apuestas (
        fecha_registro, hipodromo, carrera, nombre_jugada, caballo, ejemplar_numero,
        cantidad_tablas, monto_jugado, monto_decidido, premio_pagar,
        cliente_juega_id, cliente_juega_nombre,
        grupo, grupo_cobro_id, grupo_cobro_nombre, grupo_comision_id, grupo_comision_nombre,
        comision_porcentaje, comision_pagada,
        estado, moneda, tasa_cambio, nota_auditoria
    )
    values (
        now(), v_hipo, p_carrera,
        -- `caballo` es texto pero `ejemplar_numero` es integer: sin el cast el
        -- INSERT reventaba con
        --   ERROR 42804: column "ejemplar_numero" is of type integer but
        --   expression is of type text
        format('MARCA %s', v_sel), v_sel, nullif(v_sel, '')::int,
        1, p_monto, 0, 0,
        v_cliente.id, v_cliente.nombre,
        v_grupo.nombre, v_grupo.id, v_grupo.nombre, v_grupo.id, v_grupo.nombre,
        0, 0,
        'Pendiente', 'USD', 1,
        jsonb_build_object(
            'origen',            'MARCAS',
            'fecha_carrera',     p_fecha,
            'marcas_snapshot',   v_cfg.marcas,
            'nv_snapshot',       v_cfg.nv,
            -- El debutante va con su propio snapshot ademas de quedar dentro del
            -- NV efectivo: el ticket tiene que poder explicar POR QUE se bloqueo
            -- una jugada, y "estaba en el NV" no alcanza para explicarlo.
            'debutantes_snapshot', v_cfg.debutantes,
            'debutantes_valen_snapshot', v_debutantes_valen,
            'rivales_snapshot',  to_jsonb(v_rivales),
            'tipo_matchup',      v_tipo,
            'proporcion',        '120/100',
            'ganancia_neta',     v_ganancia,
            'pago_bruto',        v_bruto,
            'usuario',           p_usuario,
            'idempotencia',      v_idem
        )
      )
    returning * into v_ins;

    -- Auditoria best-effort: si la funcion de log no esta, la venta igual vale.
    if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname = 'club_log_accion') then
        perform public.club_log_accion(
            p_usuario, 'MARCAS', format('VENDA %s contra %s', v_sel, array_to_string(v_rivales, ', ')),
            null, null, format('%s %s N%s', v_hipo, p_fecha, p_carrera)
        );
    end if;

    return jsonb_build_object(
        'ok',        true,
        'ticket_id', v_ins.id,
        'caballo',   v_sel,
        'rivales',   to_jsonb(v_rivales),
        'tipo',      v_tipo,
        'monto',     p_monto,
        'ganancia',  v_ganancia,
        'pago_bruto',v_bruto,
          'saldo_restante', v_saldo - p_monto
      );

      -- Choque de clave de idempotencia: dos cajas mandaron la misma clave a la
      -- vez. PL/pgSQL convierte el bloque en subtransaccion, asi que al entrar
      -- aqui el UPDATE del saldo ya esta deshecho. Se relanza como excepcion
      -- normal para que la caja lea un mensaje y no un error de unicidad.
      exception
          when unique_violation then
              raise exception 'Esa jugada ya fue registrada (reintento con la misma clave). No se desconto nada.';
  end;
  $$;

  -- El indice es la garantia de verdad, no el SELECT del principio: sin el, dos
  -- llamadas concurrentes con la misma clave podrian pasar el filtro a la vez.
  -- Unico y PARCIAL, porque la mayoria de los tickets vienen sin clave.
  --
  -- OJO con los DOBLES PARENTESIS: en `create index` la columna puede ser una
  -- expresion, pero la expresion tiene que ir envuelta en su propio parentesis.
  -- Sin ellos el parser toma `nota_auditoria` como la columna del indice, se
  -- topa con el `->>` y falla con:
  --     ERROR 42601: syntax error at or near "->>"
  -- El WHERE del indice parcial no lleva parentesis: ahi si se permite cualquier
  -- expresion.
  create unique index if not exists tickets_marcas_idem_unico
      on public.tickets_apuestas ((nota_auditoria::jsonb ->> 'idempotencia'))
   where nota_auditoria::jsonb ->> 'idempotencia' is not null
     and coalesce(nota_auditoria::jsonb ->> 'origen', '') = 'MARCAS';

  -- OJO: la firma incluye p_idem y p_rival, asi que el grant de abajo cambia
  -- respecto a la version anterior. Si ya habias aplicado este archivo, correlo
  -- de nuevo. El `drop` de la firma VIEJA (sin p_rival) es lo que deja libre el
  -- nombre para que el `create or replace` de arriba no choque por sobrecarga:
  -- Postgres admite dos funciones con el mismo nombre y distinto numero de
  -- argumentos, y el grant tiene que nombrar una sola.
  drop function if exists public.club_vender_marca(text, int, date, text, numeric, uuid, uuid, text, text);
  grant execute on function public.club_vender_marca(text, int, date, text, numeric, uuid, uuid, text, text, text) to anon, authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 3) ORDEN DE LLEGADA
-- -----------------------------------------------------------------------------
-- La columna `resultados_carreras.orden_llegada` YA existe (jsonb) pero nada
-- la escribia: sin ella la liquidacion no puede decidir quien llego delante de
-- quien. Esta RPC es la que la llena.
--
-- Acepta las tres formas que un operador puede capturar desde la UI:
--   ["5","3","1"]                  -> el puesto es la posicion (1,2,3)
--   [5,3,1]                        -> idem, numeros sueltos
--   [{"numero":"5","puesto":1},..]  -> puesto explicito
-- Se normaliza SIEMPRE a la tercera forma, que es la que lee la liquidacion.
--
-- `p_retirados` es texto libre igual que resultados_carreras.retirados
-- ("NO HUBO RETIROS", "4", "4,7"). Se normaliza a un array de numeros.
create or replace function public.club_registrar_orden_llegada(
    p_hipodromo  text,
    p_carrera    int,
    p_fecha      date,
    p_orden      jsonb,
    p_retirados  text default null,
    p_usuario    text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_hipo    text := upper(btrim(coalesce(p_hipodromo, '')));
    v_items   jsonb;
    v_norm    jsonb;
    v_primero text;
    v_retiros text[] := '{}';
    v_tok     text;
begin
    if v_hipo = '' then
        raise exception 'Debe indicar el hipodromo.';
    end if;
    if p_orden is null or jsonb_typeof(p_orden) <> 'array' or jsonb_array_length(p_orden) = 0 then
        raise exception 'El orden de llegada no puede estar vacio.';
    end if;

    -- Forma "puesto explicito": el puesto viene en cada elemento.
    if jsonb_typeof(p_orden -> 0) = 'object' and (p_orden -> 0) ? 'puesto' then
        v_items := p_orden;
    else
        -- Formas "solo numeros": la posicion en el array ES el puesto.
        -- Con `with ordinality as x(e, ord)`, `x` es un RECORD de dos campos:
        -- el elemento es `x.e` y el puesto `x.ord`. Pedirle `->>` a `x` a pelo
        -- reventaba con `operator does not exist: record ->> unknown`.
        select coalesce(jsonb_agg(jsonb_build_object('numero', btrim(x.e ->> 'numero'), 'puesto', (x.ord)::int)), '[]'::jsonb)
          into v_items
          from jsonb_array_elements(p_orden) with ordinality as x(e, ord);
    end if;

    -- Normalizar a [{numero, puesto}] y descartar numeros vacios.
    select coalesce(jsonb_agg(jsonb_build_object('numero', btrim(e ->> 'numero'), 'puesto', (e ->> 'puesto')::int)), '[]'::jsonb)
      into v_norm
      from jsonb_array_elements(v_items) e
     where btrim(coalesce(e ->> 'numero', '')) <> ''
       and nullif(e ->> 'puesto', '') is not null;

    if jsonb_array_length(v_norm) = 0 then
        raise exception 'El orden de llegada no contiene ningun caballo con puesto.';
    end if;

    -- Retirados: texto libre -> array de numeros. "NO HUBO RETIROS" -> vacio,
    -- "4" -> {4}, "4, 7" -> {4,7}. Tokens exactos, para que el 4 no coincida
    -- con el 14.
    for v_tok in
        select btrim(m[1])
          from regexp_matches(coalesce(p_retirados, ''), '[0-9]+', 'g') as m
    loop
        v_retiros := array_append(v_retiros, v_tok);
    end loop;

    -- Ganador = puesto 1, para marcar el flag ganador en la carrera registrada.
    select btrim(e ->> 'numero') into v_primero
      from jsonb_array_elements(v_norm) e
     order by (e ->> 'puesto')::int
     limit 1;

    -- ------------------------------------------------------------------
    -- El resultado se escribe en la carrera REGISTRADA, que es la fuente de
    -- verdad del modulo: `orden_llegada` con el puesto de cada caballo, y los
    -- flags por caballo (`ganador` para el puesto 1, `retirado` para los que
    -- no corrieron). Se actualiza tambien el texto `retirados` porque el
    -- legacy y los reportes lo leen, pero los flags son los que usa la
    -- liquidacion.
    --
    -- El retiro es ADITIVO, nunca se borra solo: `coalesce(retirado,false) or
    -- el nuevo` mantiene el flag que ya venia de la inscripcion. Si se
    -- pisara con false, recargar el resultado de una carrera que ya tenia
    -- retirado al 4 lo daria por sano, y una marca jugada contra el 4 pasaria
    -- de "anulada y devuelta" a "perdida" sin que nadie lo decidiera. Un retiro
    -- se quita editando la carrera registrada, no reenviando el resultado.
    --
    -- El texto `retirados` solo se reemplaza si el operador mando AL MENOS un
    -- numero. Texto vacio o "NO HUBO RETIROS" no borra lo anterior.
    -- ------------------------------------------------------------------
    update public.resultados_carreras r
       set orden_llegada = v_norm,
           retirados     = case
                              when array_length(v_retiros, 1) is not null
                                then (select string_agg(x, ', ' order by x) from unnest(v_retiros) as x)
                              else r.retirados
                            end,
           cargado_por   = coalesce(p_usuario, r.cargado_por),
           updated_at    = now(),
           caballos      = coalesce((
                                select jsonb_agg(
                                         c
                                         || jsonb_build_object(
                                                'ganador',  btrim(c ->> 'numero') = v_primero,
                                                'retirado', coalesce((c ->> 'retirado')::boolean, false)
                                                             or (btrim(c ->> 'numero') = any(v_retiros))
                                            )
                                         order by ord
                                       )
                                  from jsonb_array_elements(coalesce(r.caballos, '[]'::jsonb))
                                       with ordinality as x(c, ord)
                           ), r.caballos)
     where upper(btrim(r.hipodromo)) = v_hipo
       and r.fecha = p_fecha
       and r.carrera = p_carrera;

    if not found then
        raise exception 'La carrera % % N%s no esta registrada en el programa. Registrala antes de cargar el resultado.', v_hipo, p_fecha, p_carrera;
    end if;

    return jsonb_build_object(
        'ok',       true,
        'hipodromo', v_hipo,
        'carrera',  p_carrera,
        'orden',    v_norm,
        'retirados', to_jsonb(v_retiros)
    );
end;
$$;

grant execute on function public.club_registrar_orden_llegada(text, int, date, jsonb, text, text) to anon, authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 4) LIQUIDACION
-- -----------------------------------------------------------------------------
-- Gana si el caballo jugado llega por DELANTE de TODOS los rivales del snapshot.
-- Pierde si alguno de los rivales llega por delante. El snapshot manda, no la
-- configuracion actual: por eso editar `marcas` despues de vender no altera
-- los tickets viejos.
--
-- Retiro: si el caballo JUGADO se retiro, la jugada ANULA. El stake vuelve al
-- cliente, pero el ticket queda SOLO COMO REGISTRO INFORMATICO: estado
-- 'Retirado', premio_pagar 0, monto_decidido 0 y comision_pagada 0, igual que
-- hace club_reembolsar_retirados en Tablas Fijas. El dinero que se movio vive en
-- el saldo del cliente y en la auditoria, nunca en el ticket, para que un
-- reporte pueda separar "anulado por retiro" de "perdido".
-- Si se retiro un RIVAL, el matchup ya no es evaluable (no se puede comparar
-- contra un caballo que no corrio), asi que tambien anula: nunca se pierde una
-- jugada por un retiro ajeno, y el ajuste manual queda disponible.
--
-- Todo o nada: si un solo ticket no se puede decidir, la funcion ABORTA y no
-- mueve saldo de nadie. Es preferible a liquidar 9 de 10 y dejar el 10mo para
-- un operador que no sabe por que quedo pendiente.
--
-- Se liquida por separado del motor oficial a proposito: liquidarPuestos()
-- pagaria una marca como si fuera un puesto normal. Por eso los liquidadores
-- GENERALES (saldos.ts y pagarYCerrar.ts) deben saltar las MARCAS.
create or replace function public.club_liquidar_marca(
    p_hipodromo text,
    p_carrera   int,
    p_fecha     date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_hipo       text := upper(btrim(coalesce(p_hipodromo, '')));
    v_orden      jsonb;
    v_retiros    text;
    v_caballos   jsonb;
    -- `record`, no `jsonb`: los bucles de abajo la recorren por sus campos
    -- (`v_fila.num`, `v_fila.tok`). Con un escalar, `v_fila.num` lo
    -- interpreta Postgres como tabla+columna y la liquidacion revienta con:
    --   ERROR 42P01: missing FROM-clause entry for table "v_fila"
    v_fila       record;
    v_tick       record;
    v_puesto_sel int;
    v_prival     int;
    v_rival      text;
    v_gana       boolean;
    v_bruto      numeric;
    v_puestos    jsonb;   -- {"5":1,"3":2,...} para buscar en O(1)
    v_retirados  text[];
    v_dinero     numeric := 0;
    v_reintegrados int := 0;
    v_liquidados   int := 0;
    v_ganadores    int := 0;
    v_perdedores   int := 0;
    v_anulado      boolean := false;  -- rival retirado: ya se reintegró
begin
    -- ------------------------------------------------------------------
    -- Resultado oficial. Sin orden de llegada NO se decide nada.
    -- ------------------------------------------------------------------
    select orden_llegada, retirados, caballos into v_orden, v_retiros, v_caballos
      from public.resultados_carreras
     where upper(btrim(hipodromo)) = v_hipo
       and fecha = p_fecha
       and carrera = p_carrera;

    if not found then
        raise exception 'La carrera % % N%s no tiene resultado cargado. No se puede liquidar.', v_hipo, p_fecha, p_carrera;
    end if;
    if v_orden is null or jsonb_typeof(v_orden) <> 'array' or jsonb_array_length(v_orden) = 0 then
        raise exception 'La carrera % % N%s no tiene ORDEN DE LLEGADA. Cargalo con club_registrar_orden_llegada antes de liquidar: sin el no se puede saber si el caballo jugado llego antes que sus rivales.', v_hipo, p_fecha, p_carrera;
    end if;

    -- Indice puesto por caballo: {"5":1,"3":2}. Evita el O(n^2) de releer el
    -- array por cada rival.
    select coalesce(jsonb_object_agg(btrim(e ->> 'numero'), (e ->> 'puesto')::int), '{}'::jsonb)
      into v_puestos
      from jsonb_array_elements(v_orden) e
     where btrim(coalesce(e ->> 'numero', '')) <> '';

    -- ------------------------------------------------------------------
    -- Retirados: DOS fuentes, en union.
    --
    -- 1) `caballos[].retirado` de la carrera REGISTRADA: es la verdad, un flag
    --    por caballo. Se lee primero.
    -- 2) `retirados`, el texto libre de la misma tabla: respaldo para las
    --    carreras migradas de antes. "NO HUBO RETIROS" -> vacio, "4" -> {4},
    --    "4, 7" -> {4,7}. Se comparan como TOKENS EXACTOS para que el 4 no
    --    coincida con el 14.
    -- ------------------------------------------------------------------
    v_retirados := '{}';
    for v_fila in
        select btrim(c ->> 'numero') as num
          from jsonb_array_elements(coalesce(v_caballos, '[]'::jsonb)) c
         where coalesce((c ->> 'retirado')::boolean, false)
           and btrim(coalesce(c ->> 'numero', '')) <> ''
    loop
        v_retirados := array_append(v_retirados, v_fila.num);
    end loop;

    for v_fila in
        select btrim(m[1]) as tok
          from regexp_matches(coalesce(v_retiros, ''), '[0-9]+', 'g') as m
    loop
        v_retirados := array_append(v_retirados, v_fila.tok);
    end loop;

    -- ------------------------------------------------------------------
    for v_tick in
        select t.*
          from public.tickets_apuestas t
         where t.estado = 'Pendiente'
           and upper(btrim(t.hipodromo)) = v_hipo
           and t.carrera = p_carrera
           and t.nombre_jugada like 'MARCA %'
           -- La fecha de la CARRERA va en la nota del ticket (fecha_registro es
           -- el momento de la venta, que puede ser otro dia). Mismo criterio que
           -- club_reembolsar_retirados, con el respaldo de fecha_registro para
           -- los tickets mas viejos que no traigan la nota.
           and coalesce(t.nota_auditoria::jsonb ->> 'fecha_carrera', t.fecha_registro::date::text) = p_fecha::text
         for update
    loop
        v_liquidados := v_liquidados + 1;

        -- Snapshot: si no esta, el ticket no es de este modulo (o es viejo).
        -- El filtro de arriba ya lo restringe a MARCA con fecha_carrera.

        -- ------------------------------------------------------------------
        -- 1) El caballo jugado se retiro -> la jugada ANULA.
        --
        -- El stake vuelve al cliente, pero el ticket queda SOLO COMO REGISTRO
        -- INFORMATICO: estado 'Retirado', premio_pagar 0 y monto_decidido 0, igual
        -- que hace club_reembolsar_retirados en Tablas Fijas. El movimiento de
        -- dinero vive en el saldo del cliente y en la auditoria, nunca en el
        -- ticket: un ticket anulado con monto_decidido en 0 es distinguible de
        -- uno liquidado, que es lo que un reporte necesita poder separar.
        --
        -- Se marca DESPUES de acreditado y en la misma transaccion: si algo
        -- falla arriba, el UPDATE tampoco corre y el reintento no duplica.
        -- ------------------------------------------------------------------
        if btrim(v_tick.caballo) = any(v_retirados) then
            update public.clientes
               set saldo_actual = coalesce(saldo_actual, 0) + coalesce(v_tick.monto_jugado, 0)
             where id = v_tick.cliente_juega_id;

            update public.tickets_apuestas
               set estado         = 'Retirado',
                   premio_pagar   = 0,
                   monto_decidido = 0,
                   comision_pagada = 0
             where id = v_tick.id;

            v_dinero      := v_dinero + coalesce(v_tick.monto_jugado, 0);
            v_reintegrados := v_reintegrados + 1;
            continue;
        end if;

        -- ------------------------------------------------------------------
        -- 2) Puesto del caballo jugado.
        -- ------------------------------------------------------------------
        v_puesto_sel := nullif(v_puestos ->> btrim(v_tick.caballo), '')::int;
        if v_puesto_sel is null then
            raise exception 'El caballo % del ticket % no aparece en el orden de llegada de la carrera % N%s. Revisa el resultado antes de liquidar: no se movio saldo de nadie.', v_tick.caballo, v_tick.id, v_hipo, p_carrera;
        end if;

        -- ------------------------------------------------------------------
        -- 3) Rivales del snapshot. Gana solo si va por delante de TODOS.
        --
        -- El snapshot es la VERDAD del matchup y esta funcion no lo recalcula:
        -- los tickets vendidos antes del cambio de regla.traen la lista que
        -- tenia cuando se vendieron, y se liquidan como se vendieron. Con la
        -- regla de a UNO la lista tiene un elemento, asi que este loop recorre
        -- el rival y nada mas; con los tickets viejos recorre la lista entera.
        -- El `for` queda igual a proposito para no tener dos liquidadores.
        -- ------------------------------------------------------------------
        v_gana := true;
        v_anulado := false;
        for v_rival in
            select jsonb_array_elements_text(coalesce(v_tick.nota_auditoria::jsonb -> 'rivales_snapshot', '[]'::jsonb))
        loop
            v_rival := btrim(v_rival);

            -- Un rival retirado deja el matchup sin comparar: se devuelve.
            -- El flag evita que el `continue` de abajo (que es del loop
            -- exterior) se confunda con un `exit` de este loop.
            if v_rival = any(v_retirados) then
                v_gana    := false;
                v_anulado := true;

                update public.clientes
                   set saldo_actual = coalesce(saldo_actual, 0) + coalesce(v_tick.monto_jugado, 0)
                 where id = v_tick.cliente_juega_id;

                update public.tickets_apuestas
                   set estado         = 'Retirado',
                       premio_pagar   = 0,
                       monto_decidido = 0,
                       comision_pagada = 0
                 where id = v_tick.id;

                v_dinero      := v_dinero + coalesce(v_tick.monto_jugado, 0);
                v_reintegrados := v_reintegrados + 1;
                exit;
            end if;

            v_prival := nullif(v_puestos ->> v_rival, '')::int;
            if v_prival is null then
                -- El rival no llego a figurar: no se puede afirmar nada.
                raise exception 'El rival % (contra el que juega el ticket %) no aparece en el orden de llegada. Revisa el resultado: no se movio saldo de nadie.', v_rival, v_tick.id;
            end if;

            if v_prival < v_puesto_sel then
                v_gana := false;
            end if;
        end loop;

        -- El rival retirado ya reintegro y marco el ticket: no se cuenta como
        -- perdedor ni se toca de nuevo.
        if v_anulado then
            continue;
        end if;

        if v_gana then
            -- ------------------------------------------------------------------
            -- 4) Gana: se acredita el BRUTO. El stake ya se desconto al vender,
            --    asi que acreditar el bruto (no el neto) es lo correcto: es
            --    exactamente "recuperar lo jugado + la ganancia".
            -- ------------------------------------------------------------------
            v_bruto := round(coalesce(v_tick.monto_jugado, 0) * 220 / 120, 2);

            update public.clientes
               set saldo_actual = coalesce(saldo_actual, 0) + v_bruto
             where id = v_tick.cliente_juega_id;

            update public.tickets_apuestas
               set estado = 'Ganador',
                   premio_pagar = v_bruto,
                   monto_decidido = v_bruto
             where id = v_tick.id;

            v_dinero   := v_dinero + v_bruto;
            v_ganadores := v_ganadores + 1;
        else
            -- Perdio: el monto ya se desconto al vender, no hay nada que
            -- devolver. Solo queda registrado.
            update public.tickets_apuestas
               set estado = 'Perdedor',
                   premio_pagar = 0,
                   monto_decidido = 0
             where id = v_tick.id;

            v_perdedores := v_perdedores + 1;
        end if;
    end loop;

    if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname = 'club_log_accion') then
        perform public.club_log_accion(
            'sistema', 'MARCAS',
            format('LIQUIDACION C%s %s N%s: %s ticket(s), %s ganador(es), %s perdedor(es), %s anulado(s) por retiro, %s devuelto.',
                   v_hipo, p_fecha, p_carrera, v_liquidados, v_ganadores, v_perdedores, v_reintegrados, v_dinero)
        );
    end if;

    return jsonb_build_object(
        'ok',          true,
        'liquidados',  v_liquidados,
        'ganadores',   v_ganadores,
        'perdedores',  v_perdedores,
        'reintegrados',v_reintegrados,
        'dinero',      v_dinero
    );
end;
$$;

grant execute on function public.club_liquidar_marca(text, int, date) to anon, authenticated, service_role;
