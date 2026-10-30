-- ============================================================================
-- ALTA DE USUARIO OPERADOR: "YES" (+584149327337) — GRUPO ARGENTINA
-- ============================================================================
-- Ejecutar en el SQL Editor de Supabase.
--
-- Crea o actualiza en un solo paso:
--   1. El usuario en public.usuario_sistema asignado al grupo ARGENTINA
--      con rol "operador" (tipo_usuario_id = 2) y estado activo.
--   2. Permite el ingreso tanto por nombre de usuario ("yes") como por
--      número celular ("584149327337").
--   3. Crea / actualiza las cuentas correspondientes en auth.users y auth.identities
--      con correo confirmado automáticamente (@sistemahipico.local).
--   4. Guarda la contraseña de acceso en clave_acceso para visualización y
--      envío rápido por WhatsApp desde el panel de grupos.
--
-- Es IDEMPOTENTE: si se corre varias veces, actualiza la clave y reasigna
-- sin duplicar ni romper nada.
-- ============================================================================

begin;

-- Asegurar que la columna de clave rápida exista
alter table public.usuario_sistema
  add column if not exists clave_acceso text;

do $alta_operador$
declare
  v_grupo_id   uuid;
  v_tipo_id    integer;
  v_clave      text := 'Yes#2026';
  v_telefono   text := '+584149327337';
  
  -- Identificadores permitidos (usuario corto y número de teléfono)
  v_usuarios   text[] := array['yes', '584149327337'];
  v_usuario    text;
  v_correo     text;
  v_uid        uuid;
begin
  -- 1) Resolver Grupo ARGENTINA
  select id into v_grupo_id
  from public.grupos_venta
  where upper(trim(nombre)) = 'ARGENTINA'
  limit 1;

  if v_grupo_id is null then
    -- Si no existiera por mayúsculas/espacios, buscar por coincidencia parcial o crear
    select id into v_grupo_id
    from public.grupos_venta
    where upper(nombre) like '%ARGENTINA%'
    limit 1;
  end if;

  if v_grupo_id is null then
    raise exception 'No se encontró el grupo ARGENTINA en la tabla grupos_venta.';
  end if;

  -- 2) Resolver Tipo de Usuario "operador"
  select id into v_tipo_id
  from public.tipo_usuario
  where lower(trim(nombre)) = 'operador'
  limit 1;

  if v_tipo_id is null then
    v_tipo_id := 2; -- ID estándar del catálogo
  end if;

  -- 3) Crear/actualizar cuentas en Auth y usuario_sistema para cada identificador
  foreach v_usuario in array v_usuarios
  loop
    v_correo := lower(v_usuario) || '@sistemahipico.local';

    -- 3.1) auth.users
    select id into v_uid
    from auth.users
    where lower(email) = v_correo;

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
        jsonb_build_object('username', v_usuario, 'nombre', 'YES', 'telefono', v_telefono, 'perfil', 'Operador'),
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
      update auth.users
         set encrypted_password = crypt(v_clave, gen_salt('bf')),
             email_confirmed_at = coalesce(email_confirmed_at, now()),
             raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('nombre', 'YES', 'telefono', v_telefono),
             updated_at = now()
       where id = v_uid;
    end if;

    -- 3.2) public.usuario_sistema
    insert into public.usuario_sistema (
      id, nombre, tipo_usuario_id, activo, es_principal, auth_id, grupo_id, clave_acceso
    ) values (
      v_usuario, 'YES', v_tipo_id, true, false, v_uid, v_grupo_id, v_clave
    )
    on conflict (id) do update
       set nombre          = 'YES',
           tipo_usuario_id = v_tipo_id,
           activo          = true,
           es_principal    = false,
           auth_id         = excluded.auth_id,
           grupo_id        = v_grupo_id,
           clave_acceso    = v_clave;

    raise notice 'OK -> Usuario "%" habilitado en Auth (%) y en usuario_sistema para Grupo ARGENTINA (id: %).',
      v_usuario, v_correo, v_grupo_id;
  end loop;

end
$alta_operador$;

commit;

-- ============================================================================
-- VERIFICACIÓN:
-- ============================================================================
-- select id, nombre, tipo_usuario_id, grupo_id, activo, clave_acceso
--   from public.usuario_sistema
--  where id in ('yes', '584149327337');
