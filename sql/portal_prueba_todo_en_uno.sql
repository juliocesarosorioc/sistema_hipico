-- ============================================================================
-- PORTAL — TODO EN UNO PARA DEJAR EL JUGADOR DE PRUEBA Y EL PORTAL FUNCIONANDO
-- ============================================================================
-- Un solo archivo para pegar en Supabase -> SQL Editor. Es IDEMPOTENTE: se puede
-- correr las veces que quieras sin romper nada ni duplicar filas.
--
-- POR QUÉ EXISTE
--   El cliente de prueba "JUGADOR_PRUEBA1" no aparecía en la base porque faltaba
--   correr los SQL del portal (columnas `portal_*` en `clientes`, `ventana_reclamos`
--   en `grupos_venta`, etc.). Este archivo junta lo mínimo imprescindible para
--   que el Portal del Cliente entre y cargue datos, en el orden correcto:
--
--     [1] Columnas del portal en `clientes`      (sql/portal_cuadre.sql)
--     [2] Columnas de la ventana de reclamos     (sql/portal_jugadas_reclamos.sql)
--     [3] GRANT de lectura a `anon`              (la Edge Function usa service_role,
--                                                 pero `anon` ya no puede leer `clientes`)
--     [4] Alta/reposición del jugador de prueba
--     [5] Verificación: imprime lo que quedó guardado
--
-- AL FINAL IMPRIME UNA TABLA con el cliente, su grupo y sus credenciales.
-- Si esa tabla sale con 1 fila y los valores esperados, el portal va a entrar.
--
-- Ejecutar en Supabase -> SQL Editor (una sola vez; repetible).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- [1] Columnas del portal en `clientes`
-- ---------------------------------------------------------------------------
-- Sin `portal_token`/`portal_clave`/`portal_habilitado` el login no tiene contra
-- qué comparar y el INSERT del jugador de prueba falla en silencio.
alter table public.clientes
    add column if not exists portal_habilitado boolean not null default false,
    add column if not exists portal_token      text,
    add column if not exists portal_clave      text;

create index if not exists idx_clientes_portal_token on public.clientes (portal_token);

-- ---------------------------------------------------------------------------
-- [2] Ventana de reclamos por grupo
-- ---------------------------------------------------------------------------
-- La acción `datos` de la Edge Function `portal-auth` lee estas columnas de
-- `grupos_venta`. Si no existen, la consulta revienta y el portal responde
-- "El servicio del portal no respondió" aunque el login haya pasado.
alter table public.grupos_venta
    add column if not exists ventana_reclamos   text not null default 'SOLO_DIA_EN_CURSO',
    add column if not exists dia_inicio_semana  int  not null default 1,
    add column if not exists dia_fin_semana     int  not null default 7;

-- ---------------------------------------------------------------------------
-- [3] Permisos de lectura para `anon`
-- ---------------------------------------------------------------------------
-- La Edge Function `portal-auth` corre con service_role y NO depende de esto.
-- Pero la app (y cualquier consulta desde el navegador) sí necesita poder leer
-- las tablas públicas; RLS sigue decidiendo QUÉ filas ve cada quien. Este GRANT
-- no abre datos: solo devuelve el privilegio de tabla que RLS ya filtra.
grant select on public.clientes      to anon, authenticated;
grant select on public.grupos_venta  to anon, authenticated;
grant select on public.hipodromos    to anon, authenticated;
grant select on public.tickets_jugadas to anon, authenticated;

-- ---------------------------------------------------------------------------
-- [4] Alta / reposición del JUGADOR DE PRUEBA
-- ---------------------------------------------------------------------------
do $prueba$
declare
  v_grupo_id  uuid;
  v_existe    int;
  v_id        uuid;

  -- --- Credenciales de prueba (editables) --------------------------------
  v_nombre    text := 'JUGADOR PRUEBA 1';
  v_seudonimo text := 'JUGADOR_PRUEBA1';
  v_token     text := 'PRB001';
  v_clave     text := 'JUGADOR123';
  v_saldo     numeric := 1000;
  v_aval      numeric := 500;
begin
  -- El grupo ARGENTINA tiene que existir: sin grupo el cliente vería todo.
  select id into v_grupo_id
    from public.grupos_venta
   where upper(nombre) = 'ARGENTINA'
   limit 1;

  -- Si no está ARGENTINA, se usa el PRINCIPAL para no abortar el script.
  if v_grupo_id is null then
    select id into v_grupo_id from public.grupos_venta order by nombre limit 1;
    raise notice 'No había grupo ARGENTINA: se usa el primer grupo disponible.';
  end if;

  if v_grupo_id is null then
    raise exception 'No hay NINGÚN grupo de venta. Creá un grupo antes de correr esto.';
  end if;

  select count(*) into v_existe
    from public.clientes
   where upper(seudonimo) = upper(v_seudonimo);

  if v_existe = 0 then
    insert into public.clientes (
      nombre, seudonimo, telefono, libre, comision,
      saldo_actual, aval, devolucion, created_at,
      mostrar_saldo_socio, es_socio, modo_juego,
      portal_habilitado, portal_token, portal_clave,
      grupo_id
    ) values (
      v_nombre, v_seudonimo, null, false, 0,
      v_saldo, v_aval, 0, now(),
      false, false, 'aval',
      true, v_token, v_clave,
      v_grupo_id
    )
    returning id into v_id;

    raise notice 'ALTA: cliente de prueba "%" creado (id %).', v_seudonimo, v_id;
  else
    update public.clientes
       set nombre            = v_nombre,
           saldo_actual      = v_saldo,
           aval              = v_aval,
           modo_juego        = 'aval',
           portal_habilitado = true,
           portal_token      = v_token,
           portal_clave      = v_clave,
           grupo_id          = v_grupo_id
     where upper(seudonimo) = upper(v_seudonimo)
    returning id into v_id;

    raise notice 'REPOSICIÓN: cliente de prueba "%" actualizado (id %).', v_seudonimo, v_id;
  end if;
end
$prueba$;

-- ---------------------------------------------------------------------------
-- [5] VERIFICACIÓN — esto es lo que tenés que mirar
-- ---------------------------------------------------------------------------
-- Debe salir UNA fila con:
--   seudonimo = JUGADOR_PRUEBA1 · portal_token = PRB001
--   portal_clave = JUGADOR123    · portal_habilitado = true
-- Si la tabla sale vacía, el paso [4] no llegó a insertar (mirá los mensajes
-- de NOTICE arriba, en la pestaña "Messages"/"Notices" del SQL Editor).
select c.id,
       c.nombre,
       c.seudonimo,
       c.portal_habilitado,
       c.portal_token,
       c.portal_clave,
       c.saldo_actual,
       c.aval,
       c.modo_juego,
       g.nombre as grupo
  from public.clientes c
  left join public.grupos_venta g on g.id = c.grupo_id
 where upper(c.seudonimo) = 'JUGADOR_PRUEBA1';
