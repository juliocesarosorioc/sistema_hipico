-- ============================================================
--  PARAMETROS POR SEMANA / GRUPO DE VENTA
--  ------------------------------------------------------------
--  Permite a cada GRUPO definir, POR SEMANA (rango con fechas
--  desde->hasta / mas el dA-a de inicio de semana que la define):
--     - dias_carreras  : da-as/carreras habilitadas de la gaceta
--     - meta_semanal   : meta de ventas (en la moneda del grupo)
--     - comision_pct   : comisiA3n / porcentaje de la semana
--     - nota           : parA�metro libre por semana (texto libre)
--     - rango vigente  : fecha_desde / fecha_hasta sobre el que se
--                        calculan los saldos por grupo.
--
--  IDEMPOTENTE: se puede ejecutar todas las veces que haga falta.
--  Ejecutar en:  Supabase -> SQL Editor
-- ============================================================

create table if not exists public.parametros_semana_grupo (
    id            uuid primary key default gen_random_uuid(),
    grupo_id      uuid not null,
    semana_ini    date,
    semana_fin    date,
    fecha_desde   date,
    fecha_hasta   date,
    dias_carreras text,
    meta_semanal  numeric          not null default 0,
    comision_pct  numeric          not null default 0,
    nota          text,
    created_at    timestamptz      not null default now(),
    updated_at    timestamptz      not null default now()
);

-- Indices para el calculo de saldos por grupo en el rango
create index if not exists idx_parametros_semana_grupo_grupo
    on public.parametros_semana_grupo (grupo_id, fecha_desde, fecha_hasta desc);

-- Acceso sin bloqueos (mismo patron que las demas tablas del repo)
alter table public.parametros_semana_grupo disable row level security;
grant all privileges on table public.parametros_semana_grupo to anon;

-- trigger: actualizar updated_at al modificar
create or replace function public.pk_actualizar_updated_at()
returns trigger language plpgsql as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists trg_parametros_semana_grupo_updated
    on public.parametros_semana_grupo;
create trigger trg_parametros_semana_grupo_updated
    before update on public.parametros_semana_grupo
    for each row execute function public.pk_actualizar_updated_at();

-- ============================================================
--  VERIFICACI�N (deseleccionar para correr como script)
--  select count(*) as parametros from public.parametros_semana_grupo;
-- ============================================================
