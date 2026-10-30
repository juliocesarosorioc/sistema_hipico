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

-- 3. Vincular operadora YES estrictamente al grupo ARGENTINA
do $actualizar_yes$
declare
  v_gid uuid;
begin
  select id into v_gid from public.grupos_venta where upper(trim(nombre)) like '%ARGENTINA%' limit 1;
  if v_gid is not null then
    update public.usuario_sistema
    set telefono = '+584149327337',
        codigo_pais = '+58',
        clave_acceso = 'Yes#2026',
        grupo_id = v_gid,
        activo = true
    where lower(id) = 'yes';

    if not found then
      insert into public.usuario_sistema (id, nombre, tipo_usuario_id, grupo_id, activo, telefono, codigo_pais, clave_acceso)
      values ('yes', 'YES', 2, v_gid, true, '+584149327337', '+58', 'Yes#2026')
      on conflict (id) do update set
        telefono = excluded.telefono,
        codigo_pais = excluded.codigo_pais,
        clave_acceso = excluded.clave_acceso,
        grupo_id = excluded.grupo_id,
        activo = excluded.activo;
    end if;
  end if;
end;
$actualizar_yes$;

-- 4. Vincular operador ricardogunbold estrictamente al grupo GUN BOLD
do $actualizar_ricardo$
declare
  v_gid uuid;
begin
  select id into v_gid from public.grupos_venta where upper(trim(nombre)) like '%GUN%BOLD%' limit 1;
  if v_gid is not null then
    update public.usuario_sistema
    set grupo_id = v_gid,
        activo = true
    where lower(id) = 'ricardogunbold';
  end if;
end;
$actualizar_ricardo$;
