-- ============================================================================
-- RPC ROBUSTA: ELIMINAR GRUPO DE VENTA (Hard Delete con fallback Soft Delete)
-- ============================================================================
-- ES IDEMPOTENTE. Ejecutar en el SQL Editor de Supabase.
--
-- Resuelve el problema: "eliminar grupo elimina y luego vuelve a aparecer"
-- Causa: grupos_venta tiene RLS solo lectura; los DELETE o UPDATE sueltos desde
-- cliente fallan o borran 0 filas sin avisar. Además, si el grupo tiene tickets
-- o asientos contables históricos vinculados por FK, el delete físico arroja
-- foreign_key_violation.
--
-- Esta RPC (security definer):
-- 1. Valida que el grupo no sea el PRINCIPAL.
-- 2. Reasigna los clientes y usuarios al grupo PRINCIPAL.
-- 3. Limpia pertenencias y tablas satélites (clientes_grupos, operadores, chat, etc.).
-- 4. Intenta BORRADO FÍSICO (delete from grupos_venta).
-- 5. Si existe historial contable que impide el borrado físico, desactiva el
--    grupo permanentemente con SOFT DELETE (activo = false, eliminado_en = now()).
-- ============================================================================

create or replace function public.club_eliminar_grupo(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_principal uuid;
    v_nombre text;
    v_es_principal boolean;
    v_borrado boolean := false;
begin
    -- 1. Validar que el grupo exista y no sea el principal
    select nombre, coalesce(es_principal, false) into v_nombre, v_es_principal
      from public.grupos_venta where id = p_id;
      
    if not found then
        return jsonb_build_object('ok', true, 'mensaje', 'El grupo ya no existe o fue eliminado previamente');
    end if;

    if v_es_principal then
        raise exception 'No se puede eliminar el grupo PRINCIPAL de la plataforma';
    end if;

    -- 2. Identificar el grupo PRINCIPAL para reasignación
    select id into v_principal from public.grupos_venta where es_principal = true and id <> p_id limit 1;
    if v_principal is null then
        select id into v_principal from public.grupos_venta where id <> p_id order by created_at asc limit 1;
    end if;

    -- 3. Reasignar clientes y usuarios al grupo principal
    if v_principal is not null then
        update public.clientes set grupo_id = v_principal where grupo_id = p_id;
        begin
            update public.usuarios set grupo_id = v_principal where grupo_id = p_id;
        exception when others then null;
        end;
    else
        update public.clientes set grupo_id = null where grupo_id = p_id;
        begin
            update public.usuarios set grupo_id = null where grupo_id = p_id;
        exception when others then null;
        end;
    end if;

    -- 4. Limpieza de tablas satélites y relaciones no críticas
    begin delete from public.clientes_grupos where grupo_id = p_id; exception when others then null; end;
    begin delete from public.operadores_grupos where grupo_id = p_id; exception when others then null; end;
    begin delete from public.chat_salas where grupo_id = p_id; exception when others then null; end;
    begin delete from public.chat_estado_grupo where grupo_id = p_id; exception when others then null; end;
    begin delete from public.chat_tickets_p2p where grupo_id = p_id; exception when others then null; end;
    begin delete from public.tabla_grupos where grupo_id = p_id; exception when others then null; end;
    begin delete from public.banqueros where grupo_id = p_id; exception when others then null; end;
    begin delete from public.grupos_comisiones_historico where grupo_id = p_id; exception when others then null; end;
    begin update public.solicitudes_registro set grupo_id = null where grupo_id = p_id; exception when others then null; end;
    begin update public.cuaderno_jugadas set grupo_id = null where grupo_id = p_id; exception when others then null; end;
    begin update public.cargas_rapidas_saldo set grupo_id = null where grupo_id = p_id; exception when others then null; end;
    begin update public.pollas set grupo_id = null where grupo_id = p_id; exception when others then null; end;
    begin update public.remates set grupo_id = null where grupo_id = p_id; exception when others then null; end;

    -- 5. Intentar borrado físico (Hard Delete)
    begin
        delete from public.grupos_venta where id = p_id;
        v_borrado := true;
    exception when foreign_key_violation then
        -- 6. Si hay historial contable/tickets que impide borrado físico, desactivar permanentemente (Soft Delete)
        update public.grupos_venta
           set activo = false,
               eliminado_en = now(),
               updated_at = now()
         where id = p_id;
        v_borrado := false;
    end;

    return jsonb_build_object('ok', true, 'fisico', v_borrado, 'grupo', v_nombre);
end;
$$;

-- Sobrecarga para aceptar texto si PostgREST pasa p_id como text
create or replace function public.club_eliminar_grupo(p_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
    return public.club_eliminar_grupo(p_id::uuid);
exception when others then
    return jsonb_build_object('ok', false, 'error', SQLERRM);
end;
$$;

revoke all on function public.club_eliminar_grupo(uuid) from public;
grant execute on function public.club_eliminar_grupo(uuid) to anon, authenticated;

revoke all on function public.club_eliminar_grupo(text) from public;
grant execute on function public.club_eliminar_grupo(text) to anon, authenticated;
