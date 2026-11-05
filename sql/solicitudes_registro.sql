-- =============================================================================
-- SOLICITUDES DE REGISTRO PARA NUEVOS USUARIOS Y APROBACIÓN DE ACCESO
-- =============================================================================
-- Permite a nuevos usuarios (jugadores, banqueros, operadores, socios)
-- solicitar acceso a la plataforma. Quedan en estado PENDIENTE_APROBACION
-- y se genera notificación y mensaje directo al administrador para aprobar.
-- =============================================================================

create table if not exists public.solicitudes_registro (
    id                    uuid default gen_random_uuid() primary key,
    nombre                text not null,
    usuario               text not null,
    telefono              text,
    correo                text,
    rol_solicitado        text default 'JUGADOR',
    grupo_id              uuid references public.grupos_venta(id) on delete set null,
    grupo_nombre          text,
    prueba_gratuita       boolean default false,
    nombre_grupo_nuevo    text,
    mensaje               text,
    estado                text default 'PENDIENTE_APROBACION' 
                          check (estado in ('PENDIENTE_APROBACION', 'APROBADO', 'RECHAZADO')),
    revisado_por          text,
    fecha_revision        timestamptz,
    notas_admin           text,
    ip_origen             text,
    created_at            timestamptz default now(),
    updated_at            timestamptz default now()
);

-- Índices para búsqueda rápida
create index if not exists idx_solicitudes_registro_estado on public.solicitudes_registro (estado);
create index if not exists idx_solicitudes_registro_usuario on public.solicitudes_registro (usuario);
create index if not exists idx_solicitudes_registro_fecha on public.solicitudes_registro (created_at desc);

-- Seguridad RLS
alter table public.solicitudes_registro enable row level security;

-- Políticas de acceso
drop policy if exists "permitir registro publico" on public.solicitudes_registro;
create policy "permitir registro publico" on public.solicitudes_registro
    for insert
    with check (true);

drop policy if exists "lectura de solicitudes" on public.solicitudes_registro;
create policy "lectura de solicitudes" on public.solicitudes_registro
    for select
    using (true);

drop policy if exists "actualizacion por administradores" on public.solicitudes_registro;
create policy "actualizacion por administradores" on public.solicitudes_registro
    for update
    using (true);

grant all on table public.solicitudes_registro to anon, authenticated, service_role;
