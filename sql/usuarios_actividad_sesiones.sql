-- ============================================================================
-- CLUB DEL DINERO - CONTROL DE SESIÓN ÚNICA, IP ÚNICA Y ACTIVIDAD DE USUARIOS
-- ============================================================================
-- [Módulo 1: Blindaje de Seguridad, Sesión Única, IP Única y Anti-Brute Force]
--   1. Una sola conexión activa por usuario en tiempo real.
--   2. Vinculación estricta a la dirección IP de origen.
--   3. Detección y bloqueo automático de sesiones clonadas.
--   4. Control de 3 intentos fallidos consecutivos con bloqueo temporal de 30 minutos.
--   5. Limpieza automática de registros antiguos cada 10 días.
-- ============================================================================

-- 1. TABLA DE SESIONES Y PRESENCIA (USUARIOS CONECTADOS Y CONTROL DE IP ÚNICA)
create table if not exists public.usuario_sesion (
    id text primary key,
    usuario_id text not null,
    nombre text,
    rol text,
    grupo_id text,
    inicio_sesion timestamptz not null default now(),
    ultimo_latido timestamptz not null default now(),
    activo boolean not null default true,
    ip text not null default '127.0.0.1',
    dispositivo text,
    navegador text,
    pagina_actual text
);

create index if not exists idx_usuario_sesion_usuario on public.usuario_sesion (usuario_id);
create index if not exists idx_usuario_sesion_latido on public.usuario_sesion (ultimo_latido desc);
create index if not exists idx_usuario_sesion_ip on public.usuario_sesion (ip);
create index if not exists idx_usuario_sesion_activo on public.usuario_sesion (activo);

-- 2. TABLA DE INTENTOS FALLIDOS DE ACCESO (ANTI-BRUTE FORCE)
create table if not exists public.usuario_intentos_login (
    id bigint generated always as identity primary key,
    identificador text not null,
    ip text not null,
    intentos integer not null default 1,
    primer_intento timestamptz not null default now(),
    ultimo_intento timestamptz not null default now(),
    bloqueado_hasta timestamptz
);

create index if not exists idx_intentos_login_identificador on public.usuario_intentos_login (identificador);
create index if not exists idx_intentos_login_ip on public.usuario_intentos_login (ip);
create index if not exists idx_intentos_login_bloqueo on public.usuario_intentos_login (bloqueado_hasta);

-- 3. TABLA DE ACTIVIDAD (PÁGINAS VISITADAS Y ACCIONES EJECUTADAS)
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

-- 4. FUNCIÓN DE LIMPIEZA AUTOMÁTICA CADA 10 DÍAS
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

    -- Eliminar registros de intentos de login de más de 2 días
    delete from public.usuario_intentos_login
    where ultimo_intento < now() - interval '2 days';

    return v_borrados;
end;
$$;

-- 5. RPC PARA REGISTRAR LATIDO / PRESENCIA EN VIVO Y VALIDAR IP ÚNICA
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
declare
    v_sesion record;
    v_ip_limpia text;
begin
    -- Purgar periódicamente registros antiguos de más de 10 días
    perform public.club_purgar_actividad_10_dias();

    v_ip_limpia := coalesce(nullif(trim(p_ip), ''), '127.0.0.1');

    -- Verificar si existe la sesión actual
    select * into v_sesion from public.usuario_sesion where id = p_sesion_id;

    if v_sesion is not null then
        -- Si la sesión fue marcada como inactiva (ej. por otra sesión iniciada)
        if v_sesion.activo is false then
            return jsonb_build_object(
                'ok', false,
                'codigo', 'SESION_INVALIDADA',
                'error', 'Tu sesión ha sido cerrada porque se inició sesión desde otro dispositivo o navegador.'
            );
        end if;

        -- Regla de IP Única: Si la IP cambió y no es localhost, bloquear
        if v_sesion.ip is not null and v_sesion.ip <> 'IP_LOCAL' and v_sesion.ip <> '127.0.0.1' 
           and v_ip_limpia <> 'IP_LOCAL' and v_ip_limpia <> '127.0.0.1' and v_sesion.ip <> v_ip_limpia then
            -- Invalidar sesión por cambio de IP no autorizado
            update public.usuario_sesion set activo = false where id = p_sesion_id;

            -- Registrar evento en auditoría
            insert into public.usuario_actividad (sesion_id, usuario_id, tipo, ruta, accion, detalle, ip)
            values (
                p_sesion_id, p_usuario_id, 'ACCION', p_pagina,
                '⚠️ ALERTA: CAMBIO DE IP NO AUTORIZADO',
                format('Sesión invalidada de inmediato. IP autorizada: %s, Nueva IP detectada: %s', v_sesion.ip, v_ip_limpia),
                v_ip_limpia
            );

            return jsonb_build_object(
                'ok', false,
                'codigo', 'CAMBIO_IP_DETECTADO',
                'error', format('Cambio de IP detectado. La sesión fue creada desde %s y ahora reporta %s. Por seguridad se cerró la sesión.', v_sesion.ip, v_ip_limpia)
            );
        end if;
    end if;

    insert into public.usuario_sesion (
        id, usuario_id, nombre, rol, grupo_id,
        inicio_sesion, ultimo_latido, activo,
        ip, dispositivo, navegador, pagina_actual
    )
    values (
        p_sesion_id, p_usuario_id, p_nombre, p_rol, p_grupo_id,
        now(), now(), true,
        v_ip_limpia, p_dispositivo, p_navegador, p_pagina
    )
    on conflict (id) do update set
        ultimo_latido = now(),
        activo = true,
        pagina_actual = coalesce(p_pagina, public.usuario_sesion.pagina_actual),
        nombre = coalesce(p_nombre, public.usuario_sesion.nombre),
        rol = coalesce(p_rol, public.usuario_sesion.rol),
        grupo_id = coalesce(p_grupo_id, public.usuario_sesion.grupo_id),
        ip = coalesce(nullif(v_ip_limpia, '127.0.0.1'), public.usuario_sesion.ip),
        dispositivo = coalesce(p_dispositivo, public.usuario_sesion.dispositivo),
        navegador = coalesce(p_navegador, public.usuario_sesion.navegador);

    return jsonb_build_object('ok', true);
end;
$$;

-- 6. RPC PARA CONTROL DE SESIÓN ÚNICA: INVALIDA SESIONES ANTERIORES Y CREA LA NUEVA
create or replace function public.club_iniciar_sesion_segura(
    p_sesion_id text,
    p_usuario_id text,
    p_ip text,
    p_nombre text default null,
    p_rol text default null,
    p_grupo_id text default null,
    p_dispositivo text default null,
    p_navegador text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_ip_limpia text;
    v_sesiones_cerradas integer := 0;
begin
    v_ip_limpia := coalesce(nullif(trim(p_ip), ''), '127.0.0.1');

    -- REGLA DE SESIÓN ÚNICA: Invalida cualquier sesión previa activa del mismo usuario
    update public.usuario_sesion
    set activo = false,
        ultimo_latido = now()
    where usuario_id = p_usuario_id
      and id <> p_sesion_id
      and activo = true;

    get diagnostics v_sesiones_cerradas = row_count;

    -- Si cerró sesiones previas, registrar evento de auditoría
    if v_sesiones_cerradas > 0 then
        insert into public.usuario_actividad (usuario_id, tipo, accion, detalle, ip)
        values (
            p_usuario_id, 'ACCION',
            'REGLA SESIÓN ÚNICA: Cierre forzado de sesión previa',
            format('Se cerraron %s sesiones anteriores al ingresar desde la nueva IP %s', v_sesiones_cerradas, v_ip_limpia),
            v_ip_limpia
        );
    end if;

    -- Insertar o activar la nueva sesión única vinculada a la IP
    insert into public.usuario_sesion (
        id, usuario_id, nombre, rol, grupo_id,
        inicio_sesion, ultimo_latido, activo,
        ip, dispositivo, navegador, pagina_actual
    )
    values (
        p_sesion_id, p_usuario_id, p_nombre, p_rol, p_grupo_id,
        now(), now(), true,
        v_ip_limpia, p_dispositivo, p_navegador, '/inicio'
    )
    on conflict (id) do update set
        ultimo_latido = now(),
        activo = true,
        ip = v_ip_limpia,
        dispositivo = coalesce(p_dispositivo, public.usuario_sesion.dispositivo),
        navegador = coalesce(p_navegador, public.usuario_sesion.navegador);

    return jsonb_build_object(
        'ok', true,
        'sesionId', p_sesion_id,
        'sesionesPreviasInvalidadas', v_sesiones_cerradas,
        'ipVinculada', v_ip_limpia
    );
end;
$$;

-- 7. RPC PARA CONTROL DE INTENTOS FALLIDOS (ANTI-BRUTE FORCE)
create or replace function public.club_registrar_intento_fallido(
    p_identificador text,
    p_ip text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_id_limpio text;
    v_ip_limpia text;
    v_registro record;
    v_bloqueado boolean := false;
    v_bloqueado_hasta timestamptz := null;
    v_segundos_restantes integer := 0;
begin
    v_id_limpio := lower(trim(p_identificador));
    v_ip_limpia := coalesce(nullif(trim(p_ip), ''), '127.0.0.1');

    -- Verificar si ya está bloqueado
    select * into v_registro
    from public.usuario_intentos_login
    where (identificador = v_id_limpio or ip = v_ip_limpia)
      and bloqueado_hasta is not null
      and bloqueado_hasta > now()
    order by bloqueado_hasta desc
    limit 1;

    if v_registro is not null then
        v_segundos_restantes := extract(epoch from (v_registro.bloqueado_hasta - now()))::integer;
        return jsonb_build_object(
            'bloqueado', true,
            'segundosRestantes', v_segundos_restantes,
            'mensaje', format('Acceso bloqueado por intentos fallidos. Intenta de nuevo en %s segundos.', v_segundos_restantes)
        );
    end if;

    -- Buscar registro activo en los últimos 30 minutos
    select * into v_registro
    from public.usuario_intentos_login
    where (identificador = v_id_limpio or ip = v_ip_limpia)
      and ultimo_intento > now() - interval '30 minutes'
    order by ultimo_intento desc
    limit 1;

    if v_registro is null then
        insert into public.usuario_intentos_login (identificador, ip, intentos, primer_intento, ultimo_intento)
        values (v_id_limpio, v_ip_limpia, 1, now(), now());
    else
        -- Incrementar contador de intentos fallidos
        if v_registro.intentos + 1 >= 3 then
            v_bloqueado := true;
            v_bloqueado_hasta := now() + interval '30 minutes';
            update public.usuario_intentos_login
            set intentos = intentos + 1,
                ultimo_intento = now(),
                bloqueado_hasta = v_bloqueado_hasta
            where id = v_registro.id;

            -- Registrar alerta de seguridad en auditoría
            insert into public.usuario_actividad (usuario_id, tipo, accion, detalle, ip)
            values (
                v_id_limpio, 'ACCION',
                '🚨 BLOQUEO ANTI-BRUTE FORCE (3 Intentos Fallidos)',
                format('Usuario e IP bloqueados por 30 minutos hasta %s', v_bloqueado_hasta),
                v_ip_limpia
            );
        else
            update public.usuario_intentos_login
            set intentos = intentos + 1,
                ultimo_intento = now()
            where id = v_registro.id;
        end if;
    end if;

    return jsonb_build_object(
        'bloqueado', v_bloqueado,
        'bloqueadoHasta', v_bloqueado_hasta,
        'intentos', coalesce(v_registro.intentos + 1, 1)
    );
end;
$$;

-- 8. RPC PARA LIMPIAR INTENTOS TRAS LOGIN EXITOSO
create or replace function public.club_limpiar_intentos_login(
    p_identificador text,
    p_ip text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    delete from public.usuario_intentos_login
    where identificador = lower(trim(p_identificador))
       or ip = trim(p_ip);
end;
$$;

-- 9. RPC PARA REGISTRAR ACTIVIDAD (PÁGINA O ACCIÓN)
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
grant execute on function public.club_iniciar_sesion_segura(text, text, text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.club_registrar_intento_fallido(text, text) to anon, authenticated;
grant execute on function public.club_limpiar_intentos_login(text, text) to anon, authenticated;
grant execute on function public.club_registrar_actividad_usuario(text, text, text, text, text, text, text) to anon, authenticated;
