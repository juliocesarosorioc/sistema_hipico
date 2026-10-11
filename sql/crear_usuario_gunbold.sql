-- ============================================================================
-- ALTA DEL USUARIO / GRUPO DE VENTA "GUN BOLD"
-- ============================================================================
-- Crear en UN solo paso, desde el SQL Editor de Supabase:
--
--   1. El GRUPO DE VENTA "Gun Bold" (grupos_venta).
--   2. Un TIPO DE USUARIO "banquero" con permisos ACOTADOS:
--        · Gestión de Jugadas (módulo completo)
--        · Contabilidad      (módulo completo + Liquidación/Saldos)
--        · Clientes/Socios   (módulo completo)
--        · Solo DAR DE ALTA usuarios en Seguridad (fn_asignar_tipo;
--          NO puede editar la matriz ni crear/editar tipos)
--   3. La CUENTA de Supabase Auth  gunbold@sistemahipico.local
--      con la contraseña indicada abajo (email ya confirmado).
--   4. La fila en usuario_sistema, atada al auth_id de esa cuenta.
--
-- Es IDEMPOTENTE: se puede correr varias veces. Si el usuario ya existe,
-- solo re-escribe la matriz y la contraseña.
--
-- OJO: en cada corrida la matriz del tipo "banquero" se REESCRIBE (se borra y
-- se vuelve a armar con la lista de abajo). Si después alguien la edita a mano
-- desde /seguridad, volver a correr esto la pisa. Es a propósito: deja a este
-- archivo como la definición única de lo que puede el banquero.
--
-- REQUISITO: tener aplicados src/db/seguridad_maestro.sql y src/db/maestro_seed.sql
-- (el catálogo de capacidades). El script avisa si falta alguna capacidad.
-- ============================================================================

begin;

do $alta$
declare
  -- --- Credenciales que se van a entregar -------------------------------
  v_usuario text := 'gunbold';
  v_correo  text := 'gunbold@sistemahipico.local';
  v_clave   text := 'GunBold#2026';

  -- --- Permisos: lista exacta de capacidades del tipo "banquero" --------
  v_claves text[] := array[
    -- Home (para que tenga una pantalla de aterrizaje)
    'general:ruta_inicio',

    -- Gestión de Jugadas (módulo completo)
    'gestion_jugadas:ruta_gestion',
    'gestion_jugadas:btn_cargar',
    'gestion_jugadas:btn_editar_jugada',
    'gestion_jugadas:btn_quitar_jugada',
    'gestion_jugadas:btn_retirar_ejemplar',
    'gestion_jugadas:btn_aplicar_retiros',
    'gestion_jugadas:btn_modo_manual',
    'gestion_jugadas:btn_cargar_resultados',
    'gestion_jugadas:btn_liquidar',
    'gestion_jugadas:btn_poblar',
    'gestion_jugadas:modal_finalizar',
    'gestion_jugadas:celda_monto',
    'gestion_jugadas:celda_cliente',
    'gestion_jugadas:fn_liquidar_carrera',
    'gestion_jugadas:fn_aplicar_retiros',

    -- Contabilidad (sección completa)
    'contabilidad:ruta_contabilidad',
    'contabilidad:ruta_ingresos',
    'contabilidad:ruta_caja',
    'contabilidad:ruta_bancos',
    'contabilidad:ruta_monedas',
    'contabilidad:btn_registrar_ingreso',
    'contabilidad:btn_registrar_traslado',
    'contabilidad:btn_registrar_retiro',
    'contabilidad:btn_crear_banco',
    'contabilidad:btn_editar_banco',
    'contabilidad:btn_eliminar_banco',
    'contabilidad:btn_registrar_tasa',
    'contabilidad:btn_crear_moneda',
    'contabilidad:celda_movimientos',
    'contabilidad:fn_registrar_movimiento',
    'contabilidad:fn_registrar_tasa',
    'contabilidad:fn_eliminar_banco',
    -- Liquidación / Saldos y Reportes (vive en el menú Contabilidad)
    'general:ruta_saldos',

    -- Clientes / Socios (módulo completo)
    'clientes:ruta_clientes',
    'clientes:btn_crear',
    'clientes:btn_editar',
    'clientes:btn_eliminar',
    'clientes:btn_ver_ventas',
    'clientes:modal_editar',
    'clientes:modal_reclamos',
    'clientes:celda_saldo',
    'clientes:celda_acciones',
    'clientes:fn_guardar_cliente',
    'clientes:fn_eliminar_cliente',

    -- Registrar usuarios: SOLO dar de alta (asignar tipo).
    -- No incluye fn_editar_matriz / fn_crear_tipo / fn_editar_tipo.
    'seguridad:ruta_seguridad',
    'seguridad:fn_asignar_tipo'
  ];

  v_tipo_id  integer;
  v_grupo_id uuid;
  v_uid      uuid;
  v_faltan   text;
  v_seq      text;
begin
  -- -------------------------------------------------------------------------
  -- 1) Grupo de venta "Gun Bold"
  -- -------------------------------------------------------------------------
  insert into public.grupos_venta (nombre, moneda, es_principal, cupo_tabla, activo)
  select 'Gun Bold', 'USD', false, 100, true
  where not exists (select 1 from public.grupos_venta where upper(nombre) = 'GUN BOLD');

  select id into v_grupo_id from public.grupos_venta where upper(nombre) = 'GUN BOLD' limit 1;

  -- -------------------------------------------------------------------------
  -- 2) Tipo de usuario "banquero"
  -- -------------------------------------------------------------------------
  -- La identidad de `id` puede estar atrasada (el catálogo se sembró con ids
  -- fijos: 1..4). Sin adelantarla, el alta de un tipo nuevo —acá o desde la
  -- app— pide el id 1 y choca con "duplicate key ... id 1 ya existe". Se lleva
  -- siempre al máximo actual, sea o no la primera corrida.
  v_seq := pg_get_serial_sequence('public.tipo_usuario', 'id');
  if v_seq is not null then
    perform setval(v_seq, (select coalesce(max(id), 1) from public.tipo_usuario));
  end if;

  select id into v_tipo_id from public.tipo_usuario where lower(nombre) = 'banquero';
  if v_tipo_id is null then
    insert into public.tipo_usuario (nombre, descripcion, activo)
    values (
      'banquero',
      'Banquero / grupo de venta que ingresa al sistema: Gestión de Jugadas, Contabilidad, Clientes/Socios y alta de usuarios.',
      true
    )
    returning id into v_tipo_id;
  end if;

  -- -------------------------------------------------------------------------
  -- 3) Matriz del tipo: borrar y reescribir desde la lista de arriba
  -- -------------------------------------------------------------------------
  delete from public.tipo_usuario_capacidad where tipo_usuario_id = v_tipo_id;

  insert into public.tipo_usuario_capacidad (tipo_usuario_id, capacidad_id, decision)
  select v_tipo_id, c.id, 'permitido'
  from public.capacidad c
  where c.clave = any (v_claves)
  on conflict (tipo_usuario_id, capacidad_id) do update set decision = 'permitido';

  -- ¿Alguna capacidad de la lista no existe en el catálogo? Se avisa y sigue.
  select string_agg(k, ', ') into v_faltan
  from unnest(v_claves) as k
  where not exists (select 1 from public.capacidad c where c.clave = k);
  if v_faltan is not null then
    raise warning 'ATENCION: estas capacidades no existen en public.capacidad y NO se otorgaron: %', v_faltan;
    raise warning 'Aplicá src/db/maestro_seed.sql y volvé a correr este script.';
  end if;

  -- -------------------------------------------------------------------------
  -- 4) Cuenta de Supabase Auth
  --
  -- Se escribe directo sobre auth.users/auth.identities porque la anon key NO
  -- puede crear usuarios (hace falta la service role). Si preferís el camino
  -- soportado: Authentication -> Users -> Add user, correo
  -- gunbold@sistemahipico.local con "Auto Confirm", y después corré igual este
  -- script (detecta la cuenta y solo la enlaza).
  -- -------------------------------------------------------------------------
  select id into v_uid from auth.users where lower(email) = lower(v_correo);

  if v_uid is null then
    v_uid := gen_random_uuid();

    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at,
      confirmation_token, email_change, email_change_token_new, recovery_token
    ) values (
      '00000000-0000-0000-0000-000000000000',
      v_uid,
      'authenticated',
      'authenticated',
      v_correo,
      crypt(v_clave, gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('username', v_usuario, 'perfil', 'Banquero'),
      now(),
      now(),
      '', '', '', ''
    );

    insert into auth.identities (
      id, user_id, identity_data, provider, provider_id,
      last_sign_in_at, created_at, updated_at
    ) values (
      gen_random_uuid(),
      v_uid,
      jsonb_build_object('sub', v_uid::text, 'email', v_correo, 'email_verified', true),
      'email',
      v_uid::text,
      now(), now(), now()
    );
  else
    -- La cuenta ya existía: se le fija la contraseña y se confirma el correo.
    update auth.users
       set encrypted_password = crypt(v_clave, gen_salt('bf')),
           email_confirmed_at = coalesce(email_confirmed_at, now()),
           updated_at = now()
     where id = v_uid;
  end if;

  -- -------------------------------------------------------------------------
  -- 5) usuario_sistema, atado a la cuenta de Auth
  -- -------------------------------------------------------------------------
  insert into public.usuario_sistema (id, nombre, tipo_usuario_id, activo, es_principal, auth_id)
  values (v_usuario, 'Gun Bold', v_tipo_id, true, false, v_uid)
  on conflict (id) do update
     set nombre          = excluded.nombre,
         tipo_usuario_id = excluded.tipo_usuario_id,
         activo          = true,
         es_principal    = false,
         auth_id         = excluded.auth_id;

  raise notice 'OK -> usuario "%" (%) | tipo "banquero" (id %) | grupo de venta "Gun Bold" (id %) | auth_id %',
    v_usuario, v_correo, v_tipo_id, v_grupo_id, v_uid;
end
$alta$;

commit;

-- ============================================================================
-- VERIFICACIÓN (opcional): el login debe mostrar estas filas.
-- ============================================================================
-- select id, nombre, tipo_usuario_id, activo, es_principal, auth_id
--   from public.usuario_sistema where id = 'gunbold';
--
-- select count(*) as capacidades_del_banquero
--   from public.tipo_usuario_capacidad tc
--   join public.tipo_usuario t on t.id = tc.tipo_usuario_id
--  where t.nombre = 'banquero';
--
-- select id, email, email_confirmed_at from auth.users
--  where lower(email) = 'gunbold@sistemahipico.local';
