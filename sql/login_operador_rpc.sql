-- ============================================================================
-- RPC DE AUTENTICACIÓN RÁPIDA DE OPERADORES Y COLUMNAS DE TELÉFONO / GRUPO
-- ============================================================================
-- Permite el inicio de sesión de operadores desde teléfonos celulares mediante:
--   1. Nombre de usuario (ej. 'ricardogunbold', 'yes')
--   2. Número de teléfono celular completo con código de país (ej. '+584149327337')
--   3. Número de teléfono solo dígitos (ej. '584149327337' o '04149327337')
--
-- Vincula estrictamente al operador a su grupo asignado (ej. Gun Bold, Argentina).
-- ============================================================================

-- 1. Asegurar columnas de grupo, teléfono y clave en usuario_sistema
alter table public.usuario_sistema
  add column if not exists grupo_id uuid references public.grupos_venta(id) on delete set null;

alter table public.usuario_sistema
  add column if not exists telefono text;

alter table public.usuario_sistema
  add column if not exists codigo_pais text default '+58';

alter table public.usuario_sistema
  add column if not exists clave_acceso text;

create index if not exists usuario_sistema_grupo_idx
  on public.usuario_sistema (grupo_id);

create index if not exists usuario_sistema_telefono_idx
  on public.usuario_sistema (telefono);

-- 2. Función RPC para validar credenciales de operador y retornar su grupo exclusivo
create or replace function public.club_login_operador(
  p_identificador text,
  p_clave text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_usuario record;
  v_id_limpio text;
  v_tel_limpio text;
  v_tel_sin_cero text;
begin
  if p_identificador is null or trim(p_identificador) = '' or p_clave is null or trim(p_clave) = '' then
    return jsonb_build_object('ok', false, 'error', 'Identificador y clave son requeridos.');
  end if;

  v_id_limpio := lower(trim(p_identificador));
  -- Quitar posibles dominios de correo
  v_id_limpio := split_part(v_id_limpio, '@', 1);
  -- Versión solo dígitos para teléfonos
  v_tel_limpio := regexp_replace(p_identificador, '\D', '', 'g');
  -- Quitar cero nacional inicial si viene por ej 0414... -> 414...
  if length(v_tel_limpio) = 11 and left(v_tel_limpio, 1) = '0' then
    v_tel_sin_cero := substring(v_tel_limpio from 2);
  else
    v_tel_sin_cero := v_tel_limpio;
  end if;

  -- Buscar por id, teléfono completo, o coincidencia de dígitos telefónicos
  select u.*, g.nombre as grupo_nombre
  into v_usuario
  from public.usuario_sistema u
  left join public.grupos_venta g on g.id = u.grupo_id
  where u.activo is not false
    and (
      lower(u.id) = v_id_limpio
      or (u.telefono is not null and (
            lower(trim(u.telefono)) = v_id_limpio
            or (length(v_tel_limpio) >= 7 and regexp_replace(u.telefono, '\D', '', 'g') like '%' || v_tel_sin_cero || '%')
         ))
    )
  limit 1;

  if v_usuario is null then
    return jsonb_build_object('ok', false, 'error', 'Usuario o número de teléfono no encontrado.');
  end if;

  -- Validar clave de acceso asignada
  if v_usuario.clave_acceso is null or trim(v_usuario.clave_acceso) <> trim(p_clave) then
    return jsonb_build_object('ok', false, 'error', 'Contraseña incorrecta.');
  end if;

  return jsonb_build_object(
    'ok', true,
    'id', v_usuario.id,
    'nombre', coalesce(v_usuario.nombre, v_usuario.id),
    'grupoId', coalesce(v_usuario.grupo_id::text, ''),
    'grupoNombre', coalesce(v_usuario.grupo_nombre, 'Grupo Asignado'),
    'telefono', coalesce(v_usuario.telefono, ''),
    'codigoPais', coalesce(v_usuario.codigo_pais, '+58')
  );
end;
$$;

-- Permitir ejecución anónima y autenticada
grant execute on function public.club_login_operador(text, text) to anon, authenticated;

-- 2B. Función RPC para guardar o reasignar operador de grupo con bypass total de RLS
create or replace function public.club_guardar_operador(
  p_usuario text,
  p_nombre text,
  p_clave text,
  p_grupo_id uuid,
  p_telefono text default null,
  p_codigo_pais text default '+58',
  p_activo boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tipo_id bigint;
  v_id_limpio text;
  v_grupo_nombre text;
begin
  if p_usuario is null or trim(p_usuario) = '' then
    return jsonb_build_object('ok', false, 'error', 'El nombre de usuario es requerido.');
  end if;

  v_id_limpio := lower(trim(p_usuario));

  select id into v_tipo_id from public.tipo_usuario where lower(nombre) = 'operador' limit 1;
  if v_tipo_id is null then
    v_tipo_id := 2;
  end if;

  select nombre into v_grupo_nombre from public.grupos_venta where id = p_grupo_id limit 1;

  insert into public.usuario_sistema (
    id, nombre, tipo_usuario_id, grupo_id, activo, es_principal, clave_acceso, telefono, codigo_pais
  )
  values (
    v_id_limpio,
    coalesce(nullif(trim(p_nombre), ''), v_id_limpio),
    v_tipo_id,
    p_grupo_id,
    coalesce(p_activo, true),
    false,
    trim(p_clave),
    nullif(trim(p_telefono), ''),
    coalesce(trim(p_codigo_pais), '+58')
  )
  on conflict (id) do update set
    nombre = coalesce(nullif(trim(p_nombre), ''), excluded.nombre),
    tipo_usuario_id = v_tipo_id,
    grupo_id = p_grupo_id,
    activo = coalesce(p_activo, true),
    es_principal = false,
    clave_acceso = coalesce(nullif(trim(p_clave), ''), usuario_sistema.clave_acceso),
    telefono = coalesce(nullif(trim(p_telefono), ''), usuario_sistema.telefono),
    codigo_pais = coalesce(nullif(trim(p_codigo_pais), ''), usuario_sistema.codigo_pais);

  return jsonb_build_object(
    'ok', true,
    'usuario', v_id_limpio,
    'grupoId', p_grupo_id::text,
    'grupoNombre', coalesce(v_grupo_nombre, 'Grupo Asignado')
  );
end;
$$;

grant execute on function public.club_guardar_operador(text, text, text, uuid, text, text, boolean) to anon, authenticated;

-- 2C. Función RPC para eliminar operador de grupo con bypass total de RLS
create or replace function public.club_eliminar_operador(
  p_usuario text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id_limpio text;
begin
  if p_usuario is null or trim(p_usuario) = '' then
    return jsonb_build_object('ok', false, 'error', 'Usuario requerido.');
  end if;

  v_id_limpio := lower(trim(p_usuario));

  delete from public.usuario_sistema where lower(id) = v_id_limpio;
  delete from public.usuario_capacidad where lower(usuario_id) = v_id_limpio;
  delete from public.usuario_atributo where lower(usuario_id) = v_id_limpio;

  return jsonb_build_object('ok', true, 'usuario', v_id_limpio);
end;
$$;

grant execute on function public.club_eliminar_operador(text) to anon, authenticated;

-- 3. Vincular operadora YES estrictamente al grupo ARGENTINA
do $$
declare
  v_gid uuid;
begin
  select id into v_gid from public.grupos_venta where upper(trim(nombre)) like '%ARGENTINA%' limit 1;
  if v_gid is not null then
    insert into public.usuario_sistema (id, nombre, tipo_usuario_id, grupo_id, activo, telefono, codigo_pais, clave_acceso)
    values ('yes', 'YES', 2, v_gid, true, '+584149327337', '+58', 'Yes#2026')
    on conflict (id) do update set
      telefono = excluded.telefono,
      codigo_pais = excluded.codigo_pais,
      clave_acceso = excluded.clave_acceso,
      grupo_id = excluded.grupo_id,
      activo = excluded.activo;
  end if;
end;
$$;

-- 4. Vincular operador ricardogunbold estrictamente al grupo GUN BOLD con clave Ricardo123*
do $$
declare
  v_gid uuid;
begin
  select id into v_gid from public.grupos_venta 
  where upper(regexp_replace(nombre, '\s+', '', 'g')) like '%GUNBOLD%'
     or upper(nombre) like '%GUN%'
  limit 1;

  if v_gid is not null then
    insert into public.usuario_sistema (id, nombre, tipo_usuario_id, grupo_id, activo, es_principal, clave_acceso)
    values ('ricardogunbold', 'Ricardo Gun Bold', 2, v_gid, true, false, 'Ricardo123*')
    on conflict (id) do update set
      grupo_id = v_gid,
      activo = true,
      es_principal = false,
      clave_acceso = 'Ricardo123*';
  end if;
end;
$$;

-- 5. Asegurar credenciales y privilegios del Administrador Principal (josorio y josorioc)
do $$
begin
  insert into public.usuario_sistema (id, nombre, tipo_usuario_id, activo, es_principal, clave_acceso)
  values 
    ('josorioc', 'Julio Osorio', 1, true, true, 'Maxi1912'),
    ('josorio', 'Julio Osorio', 1, true, true, 'Maxi1912')
  on conflict (id) do update set
    es_principal = true,
    activo = true,
    clave_acceso = 'Maxi1912';
end;
$$;
