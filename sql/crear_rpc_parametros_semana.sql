-- ============================================================
--  RPCs SUPABASE: PARAMETROS SEMANA / GRUPO
--  ------------------------------------------------------------
--  Igual que club_guardar_grupo (paquete_pendientes.sql), estas
--  son SECURITY DEFINER + search_path + validaciones explA-citas,
--  de modo que el DASHBOARD pueda guardar los parA¡metros de la
--  semana por grupo sin romperse por RLS (el patrA3n que el resto
--  del site ya usa con window.supabase.rpc(...)).
--  ------------------------------------------------------------
--  Idempotente: se puede ejecutar muchas veces.
--  Requiere la tabla ya creada por:
--      sql/crear_parametros_semana_grupo.sql
--  Ejecutar en Supabase -> SQL Editor.
-- ============================================================

-- 1) GUARDAR (INSERT o UPDATE segAon venga 'id') ----------------
create or replace function public.club_guardar_parametros_semana(
    p_datos jsonb
) returns setof public.parametros_semana_grupo
language plpgsql
security definer
set search_path = public
as $$
declare
    v_id          uuid := (p_datos->>'id')::uuid;
    v_grupo_id    uuid := (p_datos->>'grupo_id')::uuid;
    v_fecha_desde date := (p_datos->>'fecha_desde')::date;
    v_fecha_hasta date := (p_datos->>'fecha_hasta')::date;
    v_dias        text := nullif(trim(coalesce(p_datos->>'dias_carreras','')),'');
    v_meta        numeric := coalesce((p_datos->>'meta_semanal')::numeric, 0);
    v_comision    numeric := coalesce((p_datos->>'comision_pct')::numeric, 0);
    v_nota        text := nullif(trim(coalesce(p_datos->>'nota','')),'');
begin
    if v_grupo_id is null then
        raise exception 'Indique el grupo de venta';
    end if;
    if not exists (select 1 from public.grupos_venta where id = v_grupo_id) then
        raise exception 'El grupo de venta indicado no existe';
    end if;
    if v_fecha_desde is null or v_fecha_hasta is null then
        raise exception 'Indique el rango de la semana (desde / hasta)';
    end if;
    if v_fecha_desde > v_fecha_hasta then
        raise exception 'La fecha inicial no puede ser posterior a la final';
    end if;
    if v_dias is null then
        raise exception 'Indique los dA-as/carreras habilitadas de la gaceta';
    end if;

    if v_id is null then
        insert into public.parametros_semana_grupo
            (grupo_id, fecha_desde, fecha_hasta, dias_carreras,
             meta_semanal, comision_pct, nota)
        values
            (v_grupo_id, v_fecha_desde, v_fecha_hasta, v_dias,
             v_meta, v_comision, v_nota);
        -- no se usa RETURNING: se retorna via query al final
    else
        update public.parametros_semana_grupo set
            grupo_id      = v_grupo_id,
            fecha_desde   = v_fecha_desde,
            fecha_hasta   = v_fecha_hasta,
            dias_carreras = v_dias,
            meta_semanal  = v_meta,
            comision_pct  = v_comision,
            nota          = v_nota,
            updated_at    = now()
        where id = v_id;
        if not found then
            raise exception 'El parA¡metro indicado ya no existe';
        end if;
        return;
    end if;

    return query
        select p.* from public.parametros_semana_grupo p
        where p.grupo_id = v_grupo_id and p.fecha_desde = v_fecha_desde;
end;
$$;

grant execute on function public.club_guardar_parametros_semana(jsonb) to anon;
grant execute on function public.club_guardar_parametros_semana(jsonb) to authenticated;

-- 2) LISTAR (opcional: filtrar por grupo) -----------------------
create or replace function public.club_listar_parametros_semana(
    p_grupo_id uuid default null
) returns setof public.parametros_semana_grupo
language plpgsql
security definer
set search_path = public
stable
as $$
begin
    return query
        select p.*
        from public.parametros_semana_grupo p
        where (p_grupo_id is null or p.grupo_id = p_grupo_id)
        order by p.fecha_desde desc;
end;
$$;

grant execute on function public.club_listar_parametros_semana(uuid) to anon;
grant execute on function public.club_listar_parametros_semana(uuid) to authenticated;

-- 3) BORRAR ------------------------------------------------------
create or replace function public.club_borrar_parametros_semana(
    p_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    delete from public.parametros_semana_grupo where id = p_id;
    if not found then
        raise exception 'El parA¡metro indicado ya no existe';
    end if;
end;
$$;

grant execute on function public.club_borrar_parametros_semana(uuid) to anon;
grant execute on function public.club_borrar_parametros_semana(uuid) to authenticated;

-- ============================================================
--  VERIFICACI�N (deseleccionar para correr como script):
--  select rolname from pg_roles
--  where rolname in ('anon','authenticated');
-- ============================================================
