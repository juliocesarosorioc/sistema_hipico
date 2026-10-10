-- ============================================================================
-- WHATSAPP CLOUD API — conexión al grupo y envío de cálculos
-- ============================================================================
-- Qué hace
-- --------
-- Tablas para la integración oficial de WhatsApp Business (Cloud API):
--
--   whatsapp_grupos          → grupos DETECTADOS por el webhook; uno a la vez
--                              puede estar marcado como "vinculado", y es a ese
--                              grupo al que van los reportes y pizarras.
--   whatsapp_envios          → bitácora de cada llamada a la API (aceptada o no).
--   whatsapp_automatizaciones→ toggles por módulo para el ENVÍO AUTOMÁTICO
--                              (remate_cierre, tablas_publicar, marcas_cierre,
--                              jornada_cierre).
--
-- Dependencias (aplicar DESPUÉS de):
--   1. src/db/seguridad_maestro.sql   (provee public.tiene_capacidad y
--                                      public.soy_principal para las policies)
--   2. src/db/maestro_seed.sql        (declara whatsapp:vincular_grupo y
--                                      whatsapp:enviar_grupo en la matriz)
--
-- Las Edge Functions (supabase/functions/whatsapp-*) escriben con service role,
-- así que no dependen de estas policies; las policies cierran el acceso para
-- cualquiera que entre por el cliente SPA con su sesión.
--
-- Idempotente: se puede volver a ejecutar sin romper nada.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) whatsapp_grupos — los grupos que el webhook detecta
-- ----------------------------------------------------------------------------
create table if not exists public.whatsapp_grupos (
  group_id          text primary key,
  nombre            text,
  phone_number_id   text,
  vinculado         boolean not null default false,
  primera_deteccion timestamptz not null default now(),
  ultimo_evento     timestamptz not null default now(),
  created_at        timestamptz not null default now()
);

comment on table public.whatsapp_grupos is
  'Grupos de WhatsApp detectados por el webhook (Cloud API). Uno solo puede estar vinculado.';

comment on column public.whatsapp_grupos.vinculado is
  'true solo en el grupo al que se envían los reportes y pizarras.';

-- A lo sumo UN grupo vinculado: el índice único sobre la constante true en las
-- filas con vinculado=true impide que dos grupos queden marcados a la vez.
create unique index if not exists whatsapp_grupos_unico_vinculado
  on public.whatsapp_grupos ((true)) where vinculado;

-- ----------------------------------------------------------------------------
-- 2) whatsapp_envios — bitácora de llamadas a la API
-- ----------------------------------------------------------------------------
create table if not exists public.whatsapp_envios (
  id              uuid primary key default gen_random_uuid(),
  destino_tipo    text not null check (destino_tipo in ('group', 'individual')),
  destino         text not null,
  destino_nombre  text,
  modulo          text not null default 'whatsapp',
  mensaje         text not null,
  ok              boolean not null default false,
  api_mensaje_id  text,
  api_error       text,
  creado_por      text,
  created_at      timestamptz not null default now()
);

comment on table public.whatsapp_envios is
  'Cada envío que pasa por la Edge Function whatsapp-enviar, aceptado o rechazado por la API.';

-- ----------------------------------------------------------------------------
-- 3) whatsapp_automatizaciones — envío automático por módulo
-- ----------------------------------------------------------------------------
create table if not exists public.whatsapp_automatizaciones (
  modulo     text primary key,
  activo     boolean not null default false,
  updated_at timestamptz not null default now()
);

comment on table public.whatsapp_automatizaciones is
  'Toggles por módulo: si activo, el evento correspondiente manda su mensaje al grupo vinculado sin intervención.';

insert into public.whatsapp_automatizaciones (modulo, activo)
values ('remate_cierre', false),
       ('tablas_publicar', false),
       ('marcas_cierre', false),
       ('jornada_cierre', false)
on conflict (modulo) do nothing;

-- ----------------------------------------------------------------------------
-- 4) RLS — solo el staff con la capacidad del maestro puede ver/operar
-- ----------------------------------------------------------------------------
alter table public.whatsapp_grupos enable row level security;
alter table public.whatsapp_envios enable row level security;
alter table public.whatsapp_automatizaciones enable row level security;

drop policy if exists "grupo gestiona quien vincula" on public.whatsapp_grupos;
create policy "grupo gestiona quien vincula" on public.whatsapp_grupos
  for all to authenticated
  using (
    public.soy_principal(auth.uid())
    or public.tiene_capacidad(auth.uid(), 'whatsapp:vincular_grupo')
  )
  with check (
    public.soy_principal(auth.uid())
    or public.tiene_capacidad(auth.uid(), 'whatsapp:vincular_grupo')
  );

drop policy if exists "envios lee quien envia" on public.whatsapp_envios;
create policy "envios lee quien envia" on public.whatsapp_envios
  for select to authenticated
  using (
    public.soy_principal(auth.uid())
    or public.tiene_capacidad(auth.uid(), 'whatsapp:enviar_grupo')
  );

drop policy if exists "automatizacion gestiona quien vincula" on public.whatsapp_automatizaciones;
create policy "automatizacion gestiona quien vincula" on public.whatsapp_automatizaciones
  for all to authenticated
  using (
    public.soy_principal(auth.uid())
    or public.tiene_capacidad(auth.uid(), 'whatsapp:vincular_grupo')
  )
  with check (
    public.soy_principal(auth.uid())
    or public.tiene_capacidad(auth.uid(), 'whatsapp:vincular_grupo')
  );

-- ----------------------------------------------------------------------------
-- 5) Grants — anon no recibe nada (misma postura que rls-negocio.sql)
-- ----------------------------------------------------------------------------
grant select, insert, update, delete on public.whatsapp_grupos to authenticated;
grant select on public.whatsapp_envios to authenticated;
grant select, insert, update, delete on public.whatsapp_automatizaciones to authenticated;