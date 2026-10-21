-- ============================================================================
-- JUGADOR DE PRUEBA DEL PORTAL — "jugador_prueba1"
-- ============================================================================
-- Crea (o restaura) UN cliente de prueba para entrar al Portal del Cliente
-- (`/portal`) y probar de punta a punta el PROMPT #6 (jugadas, reclamos,
-- jugada no relacionada) sin tocar clientes reales.
--
-- QUÉ CREA
--   · Una fila en `public.clientes` con:
--       seudonimo        = 'JUGADOR_PRUEBA1'   (lo que se escribe en "Usuario")
--       portal_token     = 'PRB001'            (código de enlace / token)
--       portal_clave     = 'JUGADOR123'        (lo que se escribe en "Clave")
--       portal_habilitado= true
--       grupo_id         = grupo de venta ARGENTINA
--       saldo_actual     = 1000, aval = 500, modo_juego = 'aval'
--     Con eso el cliente PUEDE vender (la RPC valida saldo+aval) y reclamar.
--
-- CÓMO ENTRAR AL PORTAL
--   1) Abrí  <tu-dominio>/portal
--   2) Usuario:  jugador_prueba1
--      Token:    PRB001
--      Clave:    JUGADOR123
--   (o el enlace directo:  /portal?c=<id>&k=PRB001 )
--
-- OJO CON LAS MAYÚSCULAS
--   El login del portal busca el seudónimo con `ilike '%...%'` pero compara
--   token y clave EN MÁSCULAS exactas (ver supabase/functions/portal-auth).
--   Por eso la clave se guarda como 'JUGADOR123'. Si escribís 'jugador123' en
--   minúsculas, el login te va a rechazar.
--
-- ES IDEMPOTENTE: se puede correr varias veces. No borra nada; si el cliente
-- ya existe (por seudónimo), solo le repone token/clave/saldo/grupo.
--
-- REQUISITOS: haber aplicado sql/portal_cuadre.sql (columnas del portal) y que
-- exista el grupo de venta "ARGENTINA".
--
-- Ejecutar en Supabase -> SQL Editor.
-- ============================================================================

begin;

do $prueba$
declare
  v_grupo_id uuid;

  -- --- Credenciales de prueba (editables) ------------------------------
  v_nombre   text := 'JUGADOR PRUEBA 1';
  v_seudonimo text := 'JUGADOR_PRUEBA1';
  v_token    text := 'PRB001';
  v_clave    text := 'JUGADOR123';
  v_saldo    numeric := 1000;
  v_aval     numeric := 500;

  v_existe   int;
begin
  -- -------------------------------------------------------------------------
  -- 1) El grupo ARGENTINA tiene que existir. Si no, se aborta con un mensaje
  --    claro en vez de dejar al cliente sin grupo (sin grupo = ve todo).
  -- -------------------------------------------------------------------------
  select id into v_grupo_id
    from public.grupos_venta
   where upper(nombre) = 'ARGENTINA'
   limit 1;

  if v_grupo_id is null then
    raise exception 'No existe el grupo de venta ARGENTINA. Creá o restaurá el grupo antes de correr este script.';
  end if;

  -- -------------------------------------------------------------------------
  -- 2) Alta o reposición del cliente de prueba.
  --    La identidad se busca por `seudonimo` (es lo que usa el login del
  --    portal). No se toca ningún otro cliente.
  -- -------------------------------------------------------------------------
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
    );
    raise notice 'Alta: cliente de prueba "%" creado en el grupo ARGENTINA.', v_seudonimo;
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
     where upper(seudonimo) = upper(v_seudonimo);
    raise notice 'Reposición: cliente de prueba "%" actualizado (saldo %, aval %).', v_seudonimo, v_saldo, v_aval;
  end if;
end
$prueba$;

commit;

-- ============================================================================
-- VERIFICACIÓN (debería devolver 1 fila con el token/clave de prueba)
-- ============================================================================
-- select c.id, c.nombre, c.seudonimo, c.portal_habilitado,
--        c.portal_token, c.portal_clave, c.saldo_actual, c.aval, c.modo_juego,
--        g.nombre as grupo
--   from public.clientes c
--   left join public.grupos_venta g on g.id = c.grupo_id
--  where upper(c.seudonimo) = 'JUGADOR_PRUEBA1';
