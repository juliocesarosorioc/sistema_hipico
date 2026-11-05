-- =============================================================================
-- FUNCION: club_reactivar_retirados
-- Reactiva jugadas de ejemplares que habian sido retirados por error.
--
-- Restaura el estado a 'Pendiente' y descuenta del saldo del cliente el importe
-- que se le habia reembolsado previamente al retirarlo.
-- =============================================================================

create or replace function public.club_reactivar_retirados(
  p_fecha              date,
  p_hipodromo          text,
  p_carrera            int,
  p_numeros            text,                  -- Ej: '3,7' lista de ejemplares des-retirados
  p_retirados_vigentes text default '',       -- Ej: '5' ejemplares que aún siguen retirados
  p_usuario            text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_num       text;
  v_tk        record;
  v_saldo     numeric;
  v_monto     numeric;
  v_react     int := 0;
  v_dinero    numeric := 0;
  v_avisos    text[] := '{}';
  v_vigentes  text[];
begin
  if p_fecha is null or p_hipodromo is null or p_carrera is null then
    raise exception 'Falta fecha, hipodromo o carrera.';
  end if;
  if p_numeros is null or btrim(p_numeros) = '' then
    return jsonb_build_object('ok', true, 'reactivados', 0, 'dinero', 0);
  end if;

  v_vigentes := string_to_array(coalesce(btrim(p_retirados_vigentes), ''), ',');

  for v_num in select btrim(g) from unnest(string_to_array(p_numeros, ',')) g loop
    if v_num = '' then
      continue;
    end if;

    for v_tk in
      select * from public.tickets_apuestas
       where estado = 'Retirado'
         and coalesce(anulada, false) = false
         and upper(hipodromo) = upper(btrim(p_hipodromo))
         and carrera = p_carrera
         and ejemplar_numero = nullif(v_num, '')::int
         and coalesce(
          case
            when nota_auditoria ~ '^\s*[\{\[]' then nota_auditoria::jsonb ->> 'fecha_carrera'
          end,
          fecha_carrera::date::text,
          fecha_registro::date::text
        ) = p_fecha::text
       for update
    loop
      v_monto := coalesce(v_tk.monto_jugado, 0);

      -- Descontar al saldo del cliente el monto devuelto previamente
      if v_monto > 0 and v_tk.cliente_juega_id is not null then
        select coalesce(saldo_actual, 0) into v_saldo
          from public.clientes where id = v_tk.cliente_juega_id for update;
        if v_saldo is not null then
          update public.clientes
             set saldo_actual = v_saldo - v_monto
           where id = v_tk.cliente_juega_id;
          v_dinero := v_dinero + v_monto;
        end if;
      end if;

      -- Reactivar el ticket a Pendiente
      update public.tickets_apuestas
         set estado          = 'Pendiente',
             anulada         = false,
             premio_pagar    = 0,
             monto_decidido  = 0,
             comision_pagada = 0
       where id = v_tk.id;

      v_react := v_react + 1;
    end loop;
  end loop;

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'club_log_accion'
  ) then
    perform public.club_log_accion(
      coalesce(p_usuario, 'anon'), 'REACTIVACION_RETIROS',
      format('REACTIVACION retiro %s C%s [%s]: %s ticket(s) reactivado(s), %s cargado.',
             upper(p_hipodromo), p_carrera, p_numeros, v_react, v_dinero)
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'reactivados', v_react,
    'dinero', v_dinero,
    'avisos', to_jsonb(v_avisos)
  );
end;
$$;

revoke all on function public.club_reactivar_retirados(date, text, int, text, text, text) from anon;
grant execute on function public.club_reactivar_retirados(date, text, int, text, text, text) to anon, authenticated;
