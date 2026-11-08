-- =============================================================================
-- FIX RLS Y RPCs PARA BANQUERO_CONVENIO
-- Resuelve: "new row violates row-level security policy for table banquero_convenio"
-- =============================================================================

-- 1. Políticas RLS permisivas y permisos para banquero_convenio
alter table if exists public.banquero_convenio enable row level security;

drop policy if exists banquero_convenio_lectura on public.banquero_convenio;
create policy banquero_convenio_lectura on public.banquero_convenio
    for select using (true);

drop policy if exists banquero_convenio_escritura on public.banquero_convenio;
create policy banquero_convenio_escritura on public.banquero_convenio
    for all using (true) with check (true);

grant all on public.banquero_convenio to anon, authenticated, service_role;

-- 2. RPC SECURITY DEFINER para guardar/actualizar convenio de banquero
create or replace function public.club_guardar_banquero_convenio(
    p_grupo_id uuid,
    p_modalidad text,
    p_banquero_cliente_id uuid,
    p_banquero_nombre text default null,
    p_cobra_comision boolean default false,
    p_comision_porcentaje numeric default 2.5,
    p_comision_base text default 'MONTO_DECIDIDO',
    p_activo boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_nombre text := p_banquero_nombre;
    v_base text := upper(trim(coalesce(p_comision_base, 'MONTO_DECIDIDO')));
begin
    if v_base not in ('MONTO_DECIDIDO', 'MONTO_JUGADO', 'GANANCIA') then
        v_base := 'MONTO_DECIDIDO';
    end if;

    if v_nombre is null or trim(v_nombre) = '' then
        select coalesce(nullif(trim(seudonimo), ''), trim(nombre))
          into v_nombre
          from public.clientes
         where id = p_banquero_cliente_id;
    end if;

    insert into public.banquero_convenio (
        grupo_id,
        modalidad,
        banquero_cliente_id,
        banquero_nombre,
        cobra_comision,
        comision_porcentaje,
        comision_base,
        activo,
        updated_at
    )
    values (
        p_grupo_id,
        upper(trim(p_modalidad)),
        p_banquero_cliente_id,
        v_nombre,
        coalesce(p_cobra_comision, false),
        coalesce(p_comision_porcentaje, 2.5),
        v_base,
        coalesce(p_activo, true),
        now()
    )
    on conflict (grupo_id, modalidad) do update
    set banquero_cliente_id = excluded.banquero_cliente_id,
        banquero_nombre     = coalesce(excluded.banquero_nombre, banquero_convenio.banquero_nombre),
        cobra_comision      = excluded.cobra_comision,
        comision_porcentaje = excluded.comision_porcentaje,
        comision_base       = excluded.comision_base,
        activo              = excluded.activo,
        updated_at          = now();

    return jsonb_build_object('ok', true);
exception
    when others then
        return jsonb_build_object('ok', false, 'error', SQLERRM);
end;
$$;

grant execute on function public.club_guardar_banquero_convenio(
    uuid, text, uuid, text, boolean, numeric, text, boolean
) to anon, authenticated, service_role;

-- 3. RPC SECURITY DEFINER para eliminar convenio de banquero
create or replace function public.club_eliminar_banquero_convenio(
    p_grupo_id uuid,
    p_modalidad text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
    delete from public.banquero_convenio
     where grupo_id = p_grupo_id
       and upper(trim(modalidad)) = upper(trim(p_modalidad));

    return jsonb_build_object('ok', true);
exception
    when others then
        return jsonb_build_object('ok', false, 'error', SQLERRM);
end;
$$;

grant execute on function public.club_eliminar_banquero_convenio(
    uuid, text
) to anon, authenticated, service_role;
