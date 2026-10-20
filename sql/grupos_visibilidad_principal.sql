-- ============================================================================
-- VISIBILIDAD COMPARTIDA DEL GRUPO PRINCIPAL + ATRIBUCIÓN DE CUENTA (PROMPT #5)
-- ----------------------------------------------------------------------------
-- PEGAR EN: Supabase → SQL Editor → New query → Run.
--
-- Dos cosas, en este orden:
--
-- A) VISIBILIDAD DE JUGADAS DEL GRUPO PRINCIPAL (configuración + RLS)
--    El principal decide quién ve sus jugadas:
--      · Toggle 1 · `visibilidad_global_principal` (bool)
--          ON  → TODA la plataforma ve las jugadas del principal.
--      · Toggle 2 · `grupos_autorizados_ver_principal` (uuid[])
--          Solo cuando el Toggle 1 está OFF: únicamente esos grupos ven.
--    Si el Toggle 1 está ON, la lista se ignora (regla acordada con el dueño).
--
-- B) ATRIBUCIÓN DE CUENTA ENTRE GRUPOS ("Regla de Oro Contable")
--    Cuando un usuario de un Grupo Secundario (B) toma una jugada sobre la
--    cartelera del Grupo Principal, el ticket congela:
--      · `grupo_publicador_id` = Grupo Principal  (quién publicó)
--      · `grupo_cuenta_id`     = Grupo B          (a quién le da cuenta)
--    El jugador le da cuenta (cobra y paga su saldo/cuaderno) a SU grupo (B) y
--    el cruce/comisión por convenio entre B y el Principal se calcula con las
--    columnas `comision_*` (ver src/features/grupos/lib/comisiones-convenio.ts).
--
-- IMPORTANTE: NO se reescribe ninguna RPC de venta. Las columnas nuevas nacen
-- NULL y la app las completa DESPUÉS de la venta (mejor esfuerzo) con un UPDATE
-- directo, igual que `es_adelantada` (sql/jugadas_adelantadas.sql). Si la
-- migración no estuviera aplicada, la venta sigue funcionando igual.
--
-- Espejo TS: src/features/grupos/lib/visibilidad-principal.ts (lectura/config),
-- src/features/grupos/lib/atribucion-grupo.ts (enrutamiento contable).
-- IDEMPOTENTE: se puede correr varias veces sin efecto lateral.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- A.1) Columnas de visibilidad en `grupos_venta`
-- ---------------------------------------------------------------------------
alter table public.grupos_venta
    add column if not exists visibilidad_global_principal boolean not null default false,
    add column if not exists grupos_autorizados_ver_principal uuid[];

comment on column public.grupos_venta.visibilidad_global_principal is
  'Toggle 1 de visibilidad del grupo PRINCIPAL: true = TODOS los usuarios/grupos de la plataforma ven sus jugadas. Si es true, grupos_autorizados_ver_principal se ignora.';
comment on column public.grupos_venta.grupos_autorizados_ver_principal is
  'Toggle 2 (solo si visibilidad_global_principal = false): ids de los grupos autorizados a ver las jugadas del principal.';

-- ---------------------------------------------------------------------------
-- A.2) Columnas de atribución en `tickets_apuestas` (Regla de Oro Contable)
-- ---------------------------------------------------------------------------
alter table public.tickets_apuestas
    add column if not exists grupo_publicador_id uuid,
    add column if not exists grupo_cuenta_id     uuid;

comment on column public.tickets_apuestas.grupo_publicador_id is
  'Grupo que PUBLICÓ la jugada (cartelera/oferta). En un cruce desde el principal guarda al principal; NULL = no hubo cruce (coincide con grupo_cobro_id).';
comment on column public.tickets_apuestas.grupo_cuenta_id is
  'Grupo al que el jugador le DA CUENTA (cobra y paga su saldo/cuaderno). Normalmente el grupo del usuario; NULL/NULL = usar grupo_cobro_id (histórico).';

-- Backfill: las jugadas viejas no tienen cruce → cuenta = cobro, publicador NULL.
update public.tickets_apuestas
   set grupo_cuenta_id = grupo_cobro_id
 where grupo_cuenta_id is null
   and grupo_cobro_id is not null;

-- Índice parcial para los reportes de cruce (pocas filas de una jornada).
-- OJO: `tickets_apuestas` NO tiene columna `fecha` (usa `fecha_registro` /
-- `fecha_carrera`). El reporte de comisiones filtra por `fecha_registro`, así
-- que el índice se apoya en esa.
create index if not exists tickets_apuestas_cruce_grupos_idx
  on public.tickets_apuestas (fecha_registro)
  where grupo_publicador_id is not null;

-- ---------------------------------------------------------------------------
-- A.3) Resolutor: ¿el usuario `u` puede ver las jugadas del principal?
--      SECURITY DEFINER porque lee grupos_venta / usuario_sistema sin su RLS.
-- ---------------------------------------------------------------------------
create or replace function public.puede_ver_principal(u uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
    v_principal public.grupos_venta;
    v_grupo uuid;
begin
    -- El principal (y quien ve todos los grupos) siempre ve al principal.
    if public.ve_todos_los_grupos(u) then
        return true;
    end if;

    v_grupo := public.grupo_del_usuario(u);

    select * into v_principal
      from public.grupos_venta
     where es_principal = true
     limit 1;

    if not found then
        return false;
    end if;

    -- Toggle 1: global → todos ven.
    if coalesce(v_principal.visibilidad_global_principal, false) then
        return true;
    end if;

    -- Toggle 2: solo los grupos autorizados.
    if v_grupo is null then
        return false;
    end if;

    return v_grupo = any (coalesce(v_principal.grupos_autorizados_ver_principal, '{}'::uuid[]));
end;
$$;

revoke all on function public.puede_ver_principal(uuid) from public, anon;
grant execute on function public.puede_ver_principal(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- A.4) RLS de lectura de `tickets_apuestas`: además del aislamiento por grupo,
--      deja ver las jugadas del PRINCIPAL cuando el usuario está autorizado.
--      Se AGREGA una policy de SELECT acotada (no se reescribe la existente).
--
--      Se considera "jugada del principal" cuando el grupo cobrador es el
--      principal (jugadas vendidas por sus propios operadores) O cuando el
--      publicador es el principal (jugadas de un grupo secundario hechas sobre
--      la cartelera del principal: grupo_publicador_id = principal).
-- ---------------------------------------------------------------------------
do $$
begin
    if to_regclass('public.tickets_apuestas') is not null then
        execute 'drop policy if exists tickets_apuestas_ver_principal on public.tickets_apuestas';
        execute $p$
            create policy tickets_apuestas_ver_principal on public.tickets_apuestas
                for select
                using (
                    public.puede_ver_principal(auth.uid())
                    and exists (
                        select 1 from public.grupos_venta g
                         where g.es_principal = true
                           and (g.id = public.tickets_apuestas.grupo_cobro_id
                             or g.id = public.tickets_apuestas.grupo_publicador_id)
                    )
                )
        $p$;
    end if;
end
$$;

-- ---------------------------------------------------------------------------
-- A.5) RPC de configuración de visibilidad (única puerta de escritura: la app
--      NO escribe grupos_venta directo, tiene RLS de solo lectura).
--      Solo el grupo principal (o quien ve todos) puede cambiarla.
-- ---------------------------------------------------------------------------
create or replace function public.club_visibilidad_principal(
    p_grupo_id uuid,
    p_global boolean,
    p_grupos uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_principal boolean;
begin
    if p_grupo_id is null then
        raise exception 'Indique el grupo principal.';
    end if;

    select coalesce(es_principal, false) into v_principal
      from public.grupos_venta
     where id = p_grupo_id;

    if not found then
        raise exception 'El grupo % no existe.', p_grupo_id;
    end if;
    if not v_principal then
        raise exception 'La visibilidad compartida se configura en el grupo PRINCIPAL.';
    end if;

    update public.grupos_venta
       set visibilidad_global_principal = coalesce(p_global, false),
           -- Si es global, la lista no aporta: se guarda vacía para no dejar
           -- basura que confunda al panel cuando se apague el global.
           grupos_autorizados_ver_principal =
               case when coalesce(p_global, false) then '{}'::uuid[]
                    else coalesce(p_grupos, '{}'::uuid[]) end
     where id = p_grupo_id;
end;
$$;

revoke all on function public.club_visibilidad_principal(uuid, boolean, uuid[]) from public, anon;
grant execute on function public.club_visibilidad_principal(uuid, boolean, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- A.6) club_listar_grupos(): expone las columnas nuevas para que el panel y la
--      lectura por RPC las vean aunque el SELECT directo caiga al RPC (RLS).
--      Mismo contrato que sql/grupos_comisiones_convenio.sql, más los dos campos.
-- ---------------------------------------------------------------------------
create or replace function public.club_listar_grupos()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_out jsonb;
begin
    select coalesce(jsonb_agg(
        jsonb_build_object(
            'id', g.id,
            'nombre', g.nombre,
            'moneda', g.moneda,
            'es_principal', g.es_principal,
            'cupo_tabla', g.cupo_tabla,
            'activo', g.activo,
            'responsable', g.responsable,
            'cuenta_bancaria', g.cuenta_bancaria,
            'moneda_cuadre', g.moneda_cuadre,
            'comision_default', g.comision_default,
            'comision_marcas', g.comision_marcas,
            'comision_tablas', g.comision_tablas,
            'comision_remates', g.comision_remates,
            'comision_polla', g.comision_polla,
            'comision_wps', g.comision_wps,
            'comision_dupletas', g.comision_dupletas,
            'permite_cruces', g.permite_cruces,
            'dia_inicio_semana', g.dia_inicio_semana,
            'dia_fin_semana', g.dia_fin_semana,
            'visibilidad_global_principal', g.visibilidad_global_principal,
            'grupos_autorizados_ver_principal', g.grupos_autorizados_ver_principal,
            'created_at', g.created_at
        )
        order by g.es_principal desc, g.nombre asc
    ), '[]'::jsonb)
    into v_out
    from public.grupos_venta g;

    return v_out;
end;
$$;

revoke all on function public.club_listar_grupos() from public, anon;
grant execute on function public.club_listar_grupos() to anon;

-- ---------------------------------------------------------------------------
-- (Opcional) Verificación rápida en el SQL Editor:
--
--   select column_name from information_schema.columns
--    where table_name = 'grupos_venta'
--      and column_name in ('visibilidad_global_principal', 'grupos_autorizados_ver_principal');
--   -- 2 filas
--
--   select column_name from information_schema.columns
--    where table_name = 'tickets_apuestas'
--      and column_name in ('grupo_publicador_id', 'grupo_cuenta_id');
--   -- 2 filas
-- ---------------------------------------------------------------------------
