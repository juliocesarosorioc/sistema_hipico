-- ============================================================
-- RPC SEGURAS: ASIGNACIÓN MULTI-GRUPO DE CLIENTES
--      Permiten a la app (anon key) agregar/quitar/mover pertenencias
--      de clientes a grupos aunque el RLS bloquee la escritura directa
--      en `clientes_grupos` / `clientes`.
--
--      Patrón idéntico al resto del paquete: funciones `security definer`
--      que corren como dueñas de la tabla y se conceden a `anon`.
--      Idempotentes y seguras: nunca tocan un grupo_id PRINCIPAL salvo
--      en el caso explícito de mover (que es su propósito).
--
--      EJECUTAR EN EL SQL EDITOR DE SUPABASE (una sola vez).
-- ============================================================

-- ------------------------------------------------------------
-- (A) AGREGAR pertenencias ADICIONALES
--      Regla del legacy (src/lib/grupos.ts agregarClientesGrupo):
--      no duplica a los principales del destino ni a adicionales
--      existentes. Devuelve cuántos se agregaron.
-- ------------------------------------------------------------
create or replace function public.club_agregar_clientes_grupo(p_cliente_ids uuid[], p_grupo_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_agregados int;
begin
    if p_grupo_id is null then
        raise exception 'Indique el grupo destino';
    end if;
    if p_cliente_ids is null or cardinality(p_cliente_ids) = 0 then
        return jsonb_build_object('agregados', 0);
    end if;

    insert into public.clientes_grupos (grupo_id, cliente_id, es_principal, activo)
    select p_grupo_id, c.id, false, true
    from public.clientes c
    where c.id = any(p_cliente_ids)
      -- no duplicar al principal del destino
      and coalesce(c.grupo_id, '00000000-0000-0000-0000-000000000000'::uuid) <> p_grupo_id
      -- no duplicar una pertenencia adicional existente
      and not exists (
        select 1 from public.clientes_grupos cg
        where cg.grupo_id = p_grupo_id and cg.cliente_id = c.id
      )
    on conflict do nothing;

    get diagnostics v_agregados = row_count;
    return jsonb_build_object('agregados', v_agregados);
end;
$$;

revoke all on function public.club_agregar_clientes_grupo(uuid[], uuid) from anon;
grant execute on function public.club_agregar_clientes_grupo(uuid[], uuid) to anon;

-- ------------------------------------------------------------
-- (B) QUITAR pertenencias ADICIONALES
--      Nunca toca el grupo_id PRINCIPAL del cliente: si el cliente
--      tiene `clientes.grupo_id = p_grupo_id`, su pertenencia no se
--      borra. Es la misma garantía del legacy (quitarClientesGrupo).
-- ------------------------------------------------------------
create or replace function public.club_quitar_clientes_grupo(p_cliente_ids uuid[], p_grupo_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_quitados int;
begin
    if p_grupo_id is null then
        raise exception 'Indique el grupo origen';
    end if;
    if p_cliente_ids is null or cardinality(p_cliente_ids) = 0 then
        return jsonb_build_object('quitados', 0);
    end if;

    delete from public.clientes_grupos cg
    using public.clientes c
    where cg.grupo_id = p_grupo_id
      and cg.cliente_id = any(p_cliente_ids)
      and cg.cliente_id = c.id
      and coalesce(c.grupo_id, '00000000-0000-0000-0000-000000000000'::uuid) <> p_grupo_id;

    get diagnostics v_quitados = row_count;
    return jsonb_build_object('quitados', v_quitados);
end;
$$;

revoke all on function public.club_quitar_clientes_grupo(uuid[], uuid) from anon;
grant execute on function public.club_quitar_clientes_grupo(uuid[], uuid) to anon;

-- ------------------------------------------------------------
-- (C) MOVER clientes a un grupo (cambia el grupo_id PRINCIPAL)
--      Fallback para esquemas donde la app solo puede mover el
--      grupo principal del cliente (sin multi-grupo real).
-- ------------------------------------------------------------
create or replace function public.club_mover_clientes_grupo(p_cliente_ids uuid[], p_grupo_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_movidos int;
begin
    if p_grupo_id is null then
        raise exception 'Indique el grupo destino';
    end if;
    if p_cliente_ids is null or cardinality(p_cliente_ids) = 0 then
        return jsonb_build_object('movidos', 0);
    end if;

    update public.clientes
    set grupo_id = p_grupo_id
    where id = any(p_cliente_ids);

    get diagnostics v_movidos = row_count;
    return jsonb_build_object('movidos', v_movidos);
end;
$$;

revoke all on function public.club_mover_clientes_grupo(uuid[], uuid) from anon;
grant execute on function public.club_mover_clientes_grupo(uuid[], uuid) to anon;