-- ============================================================
--  LIMPIEZA DE AUDITORIA — CLUB DEL DINERO (Supabase SQL Editor)
-- ============================================================
--  Ejecutar en Supabase -> SQL Editor (una sola vez).
--  Crea una funcion segura (SECURITY DEFINER) que borra los
--  registros de auditoria MÁS ANTIGUOS que N dias. Asi la tabla
--  de auditoria se mantiene limpia y acotada sin perder los
--  eventos recientes.
-- ============================================================

create or replace function public.club_limpiar_auditoria(p_dias integer default 30)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_borrados integer;
begin
    -- Solo acepta dias positivos
    if p_dias is null or p_dias < 1 then
        return 0;
    end if;

    delete from public.auditoria
    where fecha < now() - (p_dias || ' days')::interval;

    get diagnostics v_borrados = row_count;
    return v_borrados;
end;
$$;

-- Permitir que la app (key anon) llame a la limpieza sin tocar la tabla
revoke all on function public.club_limpiar_auditoria(integer) from anon;
grant execute on function public.club_limpiar_auditoria(integer) to anon;

-- VERIFICACION -------------------------------------------------
-- Para borrar lo de los ultimos comentarios, la app llama:
--   select public.club_limpiar_auditoria(30);   -- borra lo > 30 dias