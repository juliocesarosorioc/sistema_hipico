-- ============================================================================
-- FIX: RPC DE OPERADORES DE GRUPO Y RESOLUCIÓN DE LOGIN POSTGREST
-- ============================================================================
-- 1. Elimina la sobrecarga de 2 parámetros de club_login_operador que causa
--    el error PGRST203 (HTTP 300 Multiple Choices).
-- 2. Asegura la versión unificada de 3 parámetros con IP por defecto.
-- 3. Crea club_listar_operadores(p_grupo_id text) con SECURITY DEFINER para que
--    la interfaz web pueda consultar los operadores asignados al grupo sin ser
--    bloqueada por el Row Level Security (RLS) de usuario_sistema.
-- 4. Crea club_alternar_operador(p_usuario text, p_activo boolean) con SECURITY DEFINER.
-- ============================================================================

-- 1. Eliminar la sobrecarga vieja de 2 parámetros si existe
drop function if exists public.club_login_operador(text, text);

-- 2. Asegurar columnas en usuario_sistema
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

-- 3. Función unificada de login de operador (3 parámetros con valor por defecto)
create or replace function public.club_login_operador(
  p_identificador text,
  p_clave text,
  p_ip text default '127.0.0.1'
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
  v_bloqueo record;
  v_ip_limpia text;
begin
  if p_identificador is null or trim(p_identificador) = '' or p_clave is null or trim(p_clave) = '' then
    return jsonb_build_object('ok', false, 'error', 'Identificador y clave son requeridos.');
  end if;

  v_id_limpio := lower(trim(p_identificador));
  v_id_limpio := split_part(v_id_limpio, '@', 1);
  v_ip_limpia := coalesce(nullif(trim(p_ip), ''), '127.0.0.1');

  -- 1. Control Anti-Fuerza Bruta
  if to_regclass('public.usuario_intentos_login') is not null then
    select * into v_bloqueo
    from public.usuario_intentos_login
    where (identificador = v_id_limpio or ip = v_ip_limpia)
      and bloqueado_hasta is not null
      and bloqueado_hasta > now()
    order by bloqueado_hasta desc
    limit 1;

    if v_bloqueo is not null then
      return jsonb_build_object(
        'ok', false,
        'bloqueado', true,
        'error', format('Acceso bloqueado temporalmente por intentos fallidos. Vuelve a intentarlo a las %s.', to_char(v_bloqueo.bloqueado_hasta, 'HH24:MI:SS'))
      );
    end if;
  end if;

  -- Versión solo dígitos para teléfonos
  v_tel_limpio := regexp_replace(p_identificador, '\D', '', 'g');
  if length(v_tel_limpio) = 11 and left(v_tel_limpio, 1) = '0' then
    v_tel_sin_cero := substring(v_tel_limpio from 2);
  else
    v_tel_sin_cero := v_tel_limpio;
  end if;

  -- Buscar por id, teléfono completo, o dígitos de teléfono
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
    if to_regclass('public.usuario_intentos_login') is not null then
      perform public.club_registrar_intento_fallido(v_id_limpio, v_ip_limpia);
    end if;
    return jsonb_build_object('ok', false, 'error', 'Usuario o número de teléfono no encontrado.');
  end if;

  -- Validar clave de acceso asignada
  if v_usuario.clave_acceso is null or trim(v_usuario.clave_acceso) <> trim(p_clave) then
    if to_regclass('public.usuario_intentos_login') is not null then
      perform public.club_registrar_intento_fallido(v_id_limpio, v_ip_limpia);
    end if;
    return jsonb_build_object('ok', false, 'error', 'Contraseña incorrecta.');
  end if;

  -- Login exitoso
  if to_regclass('public.usuario_intentos_login') is not null then
    perform public.club_limpiar_intentos_login(v_id_limpio, v_ip_limpia);
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

grant execute on function public.club_login_operador(text, text, text) to anon, authenticated;

-- 4. RPC SECURITY DEFINER para listar operadores de un grupo sin bloqueo de RLS
create or replace function public.club_listar_operadores(
  p_grupo_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_res jsonb;
begin
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', u.id,
      'nombre', coalesce(u.nombre, u.id),
      'grupoId', coalesce(u.grupo_id::text, ''),
      'grupoNombre', coalesce(g.nombre, 'Grupo Asignado'),
      'clave', coalesce(u.clave_acceso, ''),
      'telefono', coalesce(u.telefono, ''),
      'codigoPais', coalesce(u.codigo_pais, '+58'),
      'activo', coalesce(u.activo, true),
      'creadoEn', u.creado_en
    )
    order by u.creado_en desc nulls last, u.nombre asc
  ), '[]'::jsonb)
  into v_res
  from public.usuario_sistema u
  left join public.grupos_venta g on g.id = u.grupo_id
  where (p_grupo_id is null or p_grupo_id = '' or u.grupo_id::text = p_grupo_id)
    and u.es_principal is not true;

  return v_res;
end;
$$;

grant execute on function public.club_listar_operadores(text) to anon, authenticated;

-- 5. RPC SECURITY DEFINER para alternar estado activo/inactivo
create or replace function public.club_alternar_operador(
  p_usuario text,
  p_activo boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_usuario is null or trim(p_usuario) = '' then
    return jsonb_build_object('ok', false, 'error', 'Usuario requerido.');
  end if;

  update public.usuario_sistema
  set activo = coalesce(p_activo, true)
  where lower(id) = lower(trim(p_usuario));

  return jsonb_build_object('ok', true, 'usuario', lower(trim(p_usuario)), 'activo', coalesce(p_activo, true));
end;
$$;

grant execute on function public.club_alternar_operador(text, boolean) to anon, authenticated;
