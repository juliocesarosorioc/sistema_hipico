-- ============================================================================
-- CLUB DEL DINERO - USUARIOS CONECTADOS, SESIONES Y ACTIVIDAD
-- ============================================================================
-- Permite visualizar en la Matriz de Seguridad:
--   1. Usuarios conectados en tiempo real.
--   2. Tiempo de conexión (duración activa, hora de inicio y último latido).
--   3. Páginas que visita el usuario.
--   4. Acciones que ejecuta en el sistema.
--   5. Limpieza automática de registros cada 10 días.
-- ============================================================================

-- 1. TABLA DE SESIONES Y PRESENCIA (USUARIOS CONECTADOS)
create table if not exists public.usuario_sesion (
    id text primary key,
    usuario_id text not null,
    nombre text,
    rol text,
    grupo_id text,
    inicio_sesion timestamptz not null default now(),
    ultimo_latido timestamptz not null default now(),
    activo boolean not null default true,
    ip text,
    dispositivo text,
    navegador text,
    pagina_actual text
);

create index if not exists idx_usuario_sesion_usuario on public.usuario_sesion (usuario_id);
create index if not exists idx_usuario_sesion_latido on public.usuario_sesion (ultimo_latido desc);

-- 2. TABLA DE ACTIVIDAD (PÁGINAS VISITADAS Y ACCIONES EJECUTADAS)
create table if not exists public.usuario_actividad (
    id bigint generated always as identity primary key,
    sesion_id text,
    usuario_id text not null,
    tipo text not null check (tipo in ('PAGINA', 'ACCION')),
    ruta text,
    accion text,
    detalle text,
    fecha timestamptz not null default now(),
    ip text
);

create index if not exists idx_usuario_actividad_usuario_fecha on public.usuario_actividad (usuario_id, fecha desc);
create index if not exists idx_usuario_actividad_fecha on public.usuario_actividad (fecha desc);
create index if not exists idx_usuario_actividad_tipo on public.usuario_actividad (tipo);

-- 3. FUNCIÓN DE LIMPIEZA AUTOMÁTICA CADA 10 DÍAS
create or replace function public.club_purgar_actividad_10_dias()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_borrados integer := 0;
begin
    -- Eliminar actividad de más de 10 días
    delete from public.usuario_actividad
    where fecha < now() - interval '10 days';
    
    get diagnostics v_borrados = row_count;

    -- Eliminar sesiones inactivas con más de 10 días sin latido
    delete from public.usuario_sesion
    where ultimo_latido < now() - interval '10 days';

    return v_borrados;
end;
$$;

-- 4. RPC PARA REGISTRAR LATIDO / PRESENCIA EN VIVO
create or replace function public.club_registrar_latido_sesion(
    p_sesion_id text,
    p_usuario_id text,
    p_nombre text default null,
    p_rol text default null,
    p_grupo_id text default null,
    p_pagina text default null,
    p_ip text default null,
    p_navegador text default null,
    p_dispositivo text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
    -- Purgar periódicamente registros antiguos de más de 10 días
    perform public.club_purgar_actividad_10_dias();

    insert into public.usuario_sesion (
        id, usuario_id, nombre, rol, grupo_id,
        inicio_sesion, ultimo_latido, activo,
        ip, dispositivo, navegador, pagina_actual
    )
    values (
        p_sesion_id, p_usuario_id, p_nombre, p_rol, p_grupo_id,
        now(), now(), true,
        p_ip, p_dispositivo, p_navegador, p_pagina
    )
    on conflict (id) do update set
        ultimo_latido = now(),
        activo = true,
        pagina_actual = coalesce(p_pagina, public.usuario_sesion.pagina_actual),
        nombre = coalesce(p_nombre, public.usuario_sesion.nombre),
        rol = coalesce(p_rol, public.usuario_sesion.rol),
        grupo_id = coalesce(p_grupo_id, public.usuario_sesion.grupo_id),
        ip = coalesce(p_ip, public.usuario_sesion.ip),
        dispositivo = coalesce(p_dispositivo, public.usuario_sesion.dispositivo),
        navegador = coalesce(p_navegador, public.usuario_sesion.navegador);

    return jsonb_build_object('ok', true);
end;
$$;

-- 5. RPC PARA REGISTRAR ACTIVIDAD (PÁGINA O ACCIÓN)
create or replace function public.club_registrar_actividad_usuario(
    p_sesion_id text,
    p_usuario_id text,
    p_tipo text,
    p_ruta text default null,
    p_accion text default null,
    p_detalle text default null,
    p_ip text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.usuario_actividad (
        sesion_id, usuario_id, tipo, ruta, accion, detalle, fecha, ip
    )
    values (
        p_sesion_id,
        left(p_usuario_id, 80),
        p_tipo,
        left(p_ruta, 200),
        left(p_accion, 250),
        left(p_detalle, 2000),
        now(),
        left(p_ip, 45)
    );

    return jsonb_build_object('ok', true);
end;
$$;

-- Permisos para invocación segura
grant execute on function public.club_purgar_actividad_10_dias() to anon, authenticated;
grant execute on function public.club_registrar_latido_sesion(text, text, text, text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.club_registrar_actividad_usuario(text, text, text, text, text, text, text) to anon, authenticated;
