-- ============================================================================
-- RLS DE LAS TABLAS DE NEGOCIO — lo que hoy NO tiene ninguna protección.
--
-- Ejecutar DESPUÉS de src/db/seguridad_maestro.sql. Idempotente.
--
-- ----------------------------------------------------------------------------
-- EL PROBLEMA
-- ----------------------------------------------------------------------------
-- Las cinco tablas del maestro ya deciden en Postgres. Las de negocio no: no
-- tienen RLS, así que la llave ANON —que va incrustada en el bundle de
-- JavaScript y lee cualquiera que abra devtools— lee y escribe todo.
--
-- No es teórico. Se comprobó con la llave anon, sin credenciales:
--   clientes            16 filas, con portal_token y portal_clave incluidos
--                       (token y clave de acceso del portal del cliente)
--   tickets_apuestas    12 filas
--   resultados_carreras 131 filas
--   hipodromos          81 filas
--   tablas_fijas        130 filas
-- Y en `clientes` además: nombre, cédula, teléfono, correo, dirección, saldo y
-- forma de pago. Es un dump de clientes con sus credenciales de acceso.
--
-- `operadores` está aparte, en src/db/retirar-legacy-operadores.sql.
--
-- ----------------------------------------------------------------------------
-- EL MODELO QUE SE APLICA
-- ----------------------------------------------------------------------------
--   Personal  → sesión de Supabase Auth (rol `authenticated`). Es el único que
--               entra a la aplicación con credenciales, así que es el único que
--               lee y escribe estas tablas.
--   Portal    → NO tiene sesión de Auth. Entra con el token del cliente y va
--               contra la Edge Function `portal-auth`, que corre con
--               service_role. Por eso acá no hay ninguna policy para `anon`:
--               si la hubiera, volvería a ser un `select *` para cualquiera.
--
-- La consequence importante: con este archivo aplicado, el PORTAL DEJA DE
-- FUNCIONAR hasta que la Edge Function esté desplegada. Es al revés de lo
-- cómodo y es lo correcto: hoy el portal "funciona" porque todos pueden leer
-- la tabla `clientes`. Que no funcione es preferible a que funcione filtrando
-- los datos de todos los clientes.
--
-- ----------------------------------------------------------------------------
-- ANTES DE APLICAR
-- ----------------------------------------------------------------------------
--   1. Desplegar la Edge Function:
--        npx supabase functions deploy portal-auth
--      (necesita el CLI; no está en el repo)
--   2. Verificar que el portal entra y ve SUS apuestas.
--   3. Recién entonces aplicar este archivo.
--
-- Si se aplica antes, el portal deja de poder leer y escribir, y el personal
-- sigue entrando bien (va por `authenticated`).
-- ============================================================================

-- ------------------------------------------------------------------ RLS
-- Encendido en todo. Con RLS y sin policy para `anon`, el rol no autenticado
-- no lee ni escribe: deny por omisión. No hace falta escribir una policy que
-- diga "denegar".
alter table public.clientes            enable row level security;
alter table public.tickets_apuestas    enable row level security;
alter table public.notificaciones      enable row level security;
alter table public.tickets_jugadas     enable row level security;
alter table public.solicitudes_tablas  enable row level security;
alter table public.dupletas            enable row level security;
alter table public.transacciones_financieras enable row level security;

-- ------------------------------------------------------------------ personal
-- El personal autenticado trabaja estas tablas con el mismo criterio que el
-- maestro usa para su propia matriz: primero el principal, después la
-- capacidad. Las dos funciones de seguridad_maestro.sql son `security definer`
-- y no están sujetas a estas policies, así que no hay recursión.
--
-- `authenticated` alcanza para el día a día. Lo que sería ideal —que un
-- operador no pueda borrar el historial— se resuelve con capacidades, no con
-- policies por rol: RLS no sabe qué tipo tiene la persona sin repetir toda la
-- matriz del maestro en cada tabla.

-- Clientes: incluye PII y las dos credenciales del portal. Lectura para el
-- personal, porque la banca, la Liquidación y el módulo de Clientes la
-- necesitan. Escritura también: es el módulo que la mantiene.

-- ============================================================================
-- EL ABAC EN LA BASE (no solo en el navegador)
-- ============================================================================
-- Hasta ahora todo era `for all using (true)`: cualquier persona autenticada
-- podia tocar cualquier fila de estas tablas. El guard de JavaScript
-- (exigirCapacidad / exigirPermiso) es una cortesia, no una frontera: la llave
-- anon es publica y las llamadas van a PostgREST, no a nuestro codigo.
--
-- Por eso las policies de escritura no repiten la matriz del maestro: preguntan
-- al maestro. public.tiene_capacidad mira la matriz que ya existe, y
-- public.puede_contexto corre las reglas ABAC con el CONTEXTO DE LA FILA que se
-- esta por escribir. Con eso, el operador que no tiene asignado un hipodromo
-- recibe el error de Postgres, no un mensaje en la UI tres capas mas abajo.
--
-- La lectura se deja abierta al personal (`using (true)`) a proposito. El
-- ABAC protege ESCRITURAS: el dinero, el estado de un ticket, la pertenencia de
-- un hipodromo. Filtrar la lectura por fila obligaria a que cada policy supiera
-- a que otras tablas unir, y un error ahi es una fuga silenciosa de datos de
-- clientes. Lo que si se cierra es `anon`, que es el que no deberia ver nada.
--
-- El orden importa: primero la capacidad (permiso), despues el contexto
-- (condicion). Al reves, el mensaje insinua que el problema es la fila cuando
-- en realidad es que a esa persona no le corresponde tocarla.
-- ============================================================================

-- --------------------------------------------------------------- clientes
-- Contiene PII y las DOS credenciales del portal. El personal la mantiene
-- entera; el cliente nunca llega aca (su sesion va por la Edge Function con
-- service_role, que no esta sujeto a RLS).
drop policy if exists "personal opera clientes" on public.clientes;
create policy "personal opera clientes" on public.clientes
  for all to authenticated
  using (true)
  with check (public.tiene_capacidad(auth.uid(), 'clientes:fn_guardar_cliente'));

-- --------------------------------------------------------------- tickets
-- Un ticket SOLUCIONADO no vuelve a tocarse. Esa regla la evalua Postgres, con
-- el estado real de la fila, no el que mande el navegador.
--
-- La regla vive en `tickets_jugadas` (la cola de tickets), no en
-- `tickets_apuestas` (las jugadas del cliente). Aca solo se protege que la
-- escritura exija la capacidad; el invariante del estado se aplica mas abajo,
-- sobre la tabla que si lo tiene.
drop policy if exists "personal opera apuestas" on public.tickets_apuestas;
create policy "personal lee apuestas" on public.tickets_apuestas
  for select to authenticated using (true);
create policy "personal actualiza apuesta" on public.tickets_apuestas
  for update to authenticated
  using (true)
  with check (public.tiene_capacidad(auth.uid(), 'clientes:fn_guardar_cliente')
           or public.tiene_capacidad(auth.uid(), 'tickets:fn_anular_ticket'));

drop policy if exists "personal opera notificaciones" on public.notificaciones;
create policy "personal opera notificaciones" on public.notificaciones
  for all to authenticated
  using (true)
  with check (public.tiene_capacidad(auth.uid(), 'clientes:modal_reclamos')
           or public.tiene_capacidad(auth.uid(), 'tickets:fn_anular_ticket'));

-- La cola de tickets. El estado es la fila, asi que el invariante "un ticket
-- SOLUCIONADO no se vuelve a tocar" se puede comprobar en la base, y no depende
-- de que el navegador mande el estado correcto.
--
-- Lo que NO se comprueba aca es `ticket:anular:accion_valida`, porque la accion
-- es lo que el operador eligio y no hay columna que la guarde. Esa parte
-- depende de resolverTicket() en src/lib/tickets.ts. Es una limitacion honesta:
-- una regla de ABAC solo se vuelve frontera de la base si el dato que necesita
-- esta en la fila.
drop policy if exists "personal opera tickets de jugada" on public.tickets_jugadas;
create policy "personal lee tickets de jugada" on public.tickets_jugadas
  for select to authenticated using (true);
create policy "personal escribe tickets de jugada" on public.tickets_jugadas
  for insert to authenticated
  with check (public.tiene_capacidad(auth.uid(), 'tickets:fn_anular_ticket'));
create policy "personal actualiza ticket de jugada" on public.tickets_jugadas
  for update to authenticated
  using (public.tiene_capacidad(auth.uid(), 'tickets:fn_anular_ticket'))
  with check (public.puede_contexto(
    auth.uid(), 'tickets:fn_anular_ticket',
    jsonb_build_object('estado', coalesce(estado, ''))
  ));

drop policy if exists "personal opera solicitudes de tabla" on public.solicitudes_tablas;
create policy "personal opera solicitudes de tabla" on public.solicitudes_tablas
  for all to authenticated
  using (true)
  with check (public.tiene_capacidad(auth.uid(), 'tablas:fn_publicar')
           or public.soy_principal(auth.uid()));

drop policy if exists "personal opera dupletas" on public.dupletas;
create policy "personal opera dupletas" on public.dupletas
  for all to authenticated
  using (true)
  with check (public.tiene_capacidad(auth.uid(), 'dupleta:fn_armar_dupleta'));

-- --------------------------------------------------------------- contabilidad
-- El metodo de pago tiene que existir y el monto tiene que estar en rango. La
-- regla corre contra los valores de la fila, asi que un INSERT directo por
-- PostgREST con un metodo inventado rebota en la base.
-- La tabla que la app escribe es `transacciones_financieras`, con columnas
-- `monto` y `modalidad` (TransaccionRow en src/lib/contabilidad.ts). El atributo
-- ABAC se llama `metodo_pago` porque asi lo declara el catalogo, pero el valor
-- sale de la columna `modalidad`: son la misma modalidad, vista desde dos
-- lugares. Los INSERT del personal llegan por RPC (club_registrar_deposito y
-- familia), asi que esta policy es la red para el INSERT directo por
-- PostgREST, que es el camino que un atacante escolheria.
-- `contabilidad_movimientos` NO existe en el esquema productivo: ningun script
-- del repo la crea y la app no la escribe (los movimientos van por RPC a
-- `transacciones_financieras`). Sin guarda, el `alter table` de arriba revienta
-- con 42P01 y tumba el archivo entero. Se blinda solo si algun dia existe.
do $$
begin
  if to_regclass('public.contabilidad_movimientos') is not null then
    alter table public.contabilidad_movimientos enable row level security;
    drop policy if exists "personal escribe movimientos" on public.contabilidad_movimientos;
    revoke all on public.contabilidad_movimientos from anon;
    grant all on public.contabilidad_movimientos to authenticated;
  end if;
end
$$;
drop policy if exists "personal lee movimientos" on public.transacciones_financieras;
drop policy if exists "personal escribe movimientos" on public.transacciones_financieras;
create policy "personal lee movimientos" on public.transacciones_financieras
  for select to authenticated using (true);
create policy "personal escribe movimientos" on public.transacciones_financieras
  for insert to authenticated
  with check (public.puede_contexto(
    auth.uid(), 'contabilidad:fn_registrar_movimiento',
    jsonb_build_object(
      'monto', to_jsonb(coalesce(monto, 0)),
      'metodo_pago', to_jsonb(coalesce(modalidad, ''))
    )
  ));

-- ============================================================================
-- PERMISOS (GRANT)
-- ============================================================================
-- RLS decide quien lee; el GRANT decide si el rol tiene el derecho siquiera.
-- Los dos hacen falta: una policy correcta sobre una tabla a la que `anon`
-- conserva el GRANT sigue dejando pasar a quien llame por PostgREST sin sesion.
-- Por eso el revoke va explicito y no se da por supuesto que "apagar RLS
-- alcanza".
revoke all on public.clientes            from anon;
revoke all on public.tickets_apuestas    from anon;
revoke all on public.notificaciones      from anon;
revoke all on public.tickets_jugadas     from anon;
revoke all on public.solicitudes_tablas  from anon;
revoke all on public.dupletas            from anon;
revoke all on public.transacciones_financieras  from anon;

-- `authenticated` si los necesita: es el rol del personal. Se concede
-- explicitamente para que el revoke de arriba no lo deje por fuera.
grant all on public.clientes            to authenticated;
grant all on public.tickets_apuestas    to authenticated;
grant all on public.notificaciones      to authenticated;
grant all on public.tickets_jugadas     to authenticated;
grant all on public.solicitudes_tablas  to authenticated;
grant all on public.dupletas            to authenticated;
grant all on public.transacciones_financieras  to authenticated;

-- El service_role (la Edge Function) no esta sujeto a RLS ni a estos GRANT: es
-- el dueno de la tabla para efectos de la sesion. Por eso la comparacion de
-- credenciales del portal se puede hacer alla adentro y no en el navegador.

-- ============================================================================
-- LO QUE ESTE ARCHIVO NO CUBRE
-- ============================================================================
-- Hay mas tablas de negocio (hipodromos, ejemplares, carreras, marcas, tasas,
-- bancos, monedas...) que tambien responden a la llave anon. No se listan aca a
-- proposito: antes de cerrarlas hay que saber que las lee el personal y en que
-- momento, y metirlas todas de una con `for all using (true)` repite el mismo
-- patron. El orden que corresponde es: cerrar las que tienen PII o
-- credenciales (este archivo), y despues seguir con el resto tabla por tabla.
--
-- Para las que si tengan reglas ABAC, la policy se escribe con
-- public.puede_contexto() contra la capacidad que declare la regla, como se
-- hace arriba con contabilidad. El maestro dice cual es: src/lib/seguridad/abac.ts
-- ============================================================================
