-- ============================================================================
-- REMATES — ESCRITURAS DE PUJAS VIA RPC (security definer)
-- ============================================================================
-- Que arregla
-- -----------
-- Hasta ahora el navegador escribia DIRECTO contra `remate_caballos` y
-- `remate_pujas` (insert/update/delete de PostgREST). Con la policy permisiva
-- `for all to anon, authenticated using(true) with check(true)` de
-- `sql/remates.sql` y `sql/remate_pujas.sql`, cualquiera con la anon key podia
-- crear, cambiar o borrar pujas sin sesion ni permiso.
--
-- Este script mueve TODAS las escrituras de pujas a funciones `security definer`
-- que exigen capacidad en el SERVIDOR. Junto con la policy de solo-lectura que se
-- aplica en `sql/remates.sql` y `sql/remate_pujas.sql`, el navegador ya no puede
-- escribir esas tablas aunque invoque PostgREST a mano.
--
-- Funciones
-- ---------
--   club_asignar_pujas_remate(remate, jsonb, usuario)
--       Asigna ejemplares nuevos al remate (pujas de apertura), registra el
--       historial de cada una y recalcula las probabilidades de TODO el remate.
--       Capacidad: remates:fn_asignar_caballos.
--
--   club_pujar_caballo_remate(caballo, monto, cliente, usuario)
--       Sube/cambia el monto y el comprador de una puja ya asignada, deja la fila
--       de historial y recalcula las probabilidades. Rechaza si el remate esta
--       Cerrado. Capacidad: remates:fn_asignar_caballos.
--
--   club_eliminar_caballo_remate(caballo, usuario)
--       Quita la puja del remate (el historial cae por FK `on delete cascade`) y
--       recalcula las probabilidades que quedan. Capacidad: remates:fn_eliminar_caballo.
--
--   club_recalcular_probs_remate(remate)  [auxiliar, NO se expone]
--       Escribe `prob_porcentaje`/`prob_implicita` de cada fila a partir de su
--       monto sobre el pozo. Es la misma cuenta que `probabilidades()` de
--       src/lib/remates/core.ts: pct = monto/subtotal*100, cuota = subtotal/monto.
--
-- Permisos
-- --------
-- Las tres RPC publicas se conceden SOLO a `authenticated` (no a anon) y cada una
-- verifica `tiene_capacidad(auth.uid(), '...')`. La auxiliar se revoca de PUBLIC
-- para que nadie la invoque suelta.
--
-- Depende de: sql/remates.sql, sql/remate_pujas.sql y sql/remate_cierre.sql
-- (por `tiene_capacidad` y el patron de RPC con guard).
--
-- Idempotente: se puede correr las veces que haga falta.
-- Ejecutar en el SQL Editor de Supabase (SQL puro, sin metacomandos).
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) Auxiliar: recalcular probabilidades de todo el remate
-- ---------------------------------------------------------------------------
create or replace function public.club_recalcular_probs_remate(p_remate_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_subtotal numeric;
begin
  select coalesce(sum(coalesce(monto_usd, 0)), 0)
    into v_subtotal
    from public.remate_caballos
   where remate_id = p_remate_id;

  update public.remate_caballos
     set prob_porcentaje = case
           when v_subtotal > 0 and coalesce(monto_usd, 0) > 0
             then round((coalesce(monto_usd, 0) / v_subtotal) * 100, 2)
           else 0
         end,
         prob_implicita  = case
           when v_subtotal > 0 and coalesce(monto_usd, 0) > 0
             then round(v_subtotal / coalesce(monto_usd, 0), 2)
           else 0
         end
   where remate_id = p_remate_id;
end;
$$;

-- No se expone: solo la llaman las RPC de abajo (que corren como definer).
revoke all on function public.club_recalcular_probs_remate(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1b) Tope de compra del cliente, validado en el SERVIDOR
--
-- Por qué: `autorizarPujaRemate` (src/lib/remates/core.ts) ya impedía en el
-- navegador comprar sin saldo, sin aval o en modo Libre, pero el navegador no es
-- una frontera: un operador con la capacidad `remates:fn_asignar_caballos` podía
-- llamar la RPC directo (PostgREST) y saltarse el tope. Las reglas son las
-- MISMAS del cliente, no una versión más laxa:
--
--   1. Sin comprador o monto <= 0 no hay nada que autorizar (la UI permite
--      dejar el campo vacío para devolver el ejemplar).
--   2. El comprador tiene que existir en la cartera.
--   3. Modo Libre no compra en remates.
--   4. monto <= (saldo + aval) - bloqueado, donde "bloqueado" es la suma de las
--      pujas VIVAS del cliente en remates abiertos. Se excluye el ejemplar que se
--      está reasignando: su monto viejo se libera antes de topar, o el cliente
--      pagaría dos veces por el mismo ejemplar.
--
-- El bloqueo se DERIVA de `remate_caballos` (no es una columna que alguien
-- mantiene a mano), igual que `listarSaldosBloqueados`: se mantiene solo.
-- ---------------------------------------------------------------------------
create or replace function public.club_validar_tope_compra_remate(
  p_cliente_id     uuid,
  p_monto          numeric,
  p_excluir_caballo uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cliente  public.clientes%rowtype;
  v_monto    numeric := round(coalesce(p_monto, 0), 2);
  v_bloqueo  numeric := 0;
  v_bruto    numeric := 0;
  v_disp     numeric := 0;
  v_nombre   text;
begin
  if p_cliente_id is null or v_monto <= 0 then
    return;
  end if;

  select * into v_cliente from public.clientes where id = p_cliente_id;
  if not found then
    raise exception 'El comprador no existe en la cartera.';
  end if;

  v_nombre := btrim(coalesce(v_cliente.nombre, ''));
  if v_nombre = '' then
    v_nombre := 'El cliente';
  end if;

  if v_cliente.libre is true or lower(btrim(coalesce(v_cliente.modo_juego, ''))) = 'libre' then
    raise exception '% esta en modo Libre: en Remates no puede comprar.', v_nombre;
  end if;

  select coalesce(sum(rc.monto_usd), 0) into v_bloqueo
    from public.remate_caballos rc
    join public.remates r on r.id = rc.remate_id
   where rc.cliente_id = p_cliente_id
     and lower(btrim(coalesce(r.estado, 'Abierto'))) <> 'cerrado'
     and (p_excluir_caballo is null or rc.id <> p_excluir_caballo);

  v_bruto := round(coalesce(v_cliente.saldo_actual, 0) + coalesce(v_cliente.aval, 0), 2);
  v_disp  := round(v_bruto - coalesce(v_bloqueo, 0), 2);

  if v_monto > v_disp + 0.001 then
    if v_disp <= 0 then
      raise exception '% no tiene saldo ni aval para comprar: disponible %.2f.', v_nombre, v_disp;
    end if;
    raise exception '% tiene %.2f disponibles (saldo + aval - bloqueado) y la puja es de %.2f.',
      v_nombre, v_disp, v_monto;
  end if;
end;
$$;

revoke all on function public.club_validar_tope_compra_remate(uuid, numeric, uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2) Asignar ejemplares (pujas de apertura)
-- ---------------------------------------------------------------------------
create or replace function public.club_asignar_pujas_remate(
  p_remate_id uuid,
  p_pujas     jsonb,
  p_usuario   text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_estado text;
  v_puja   jsonb;
  v_id     uuid;
  v_monto  numeric;
  v_cli    uuid;
  v_count  integer := 0;
  v_tope   record;
begin
  if not coalesce(public.tiene_capacidad(auth.uid(), 'remates:fn_asignar_caballos'), false) then
    raise exception 'Sin permiso para asignar pujas' using errcode = '42501';
  end if;

  if p_remate_id is null then
    raise exception 'Remate requerido';
  end if;
  if p_pujas is null or jsonb_typeof(p_pujas) <> 'array' or jsonb_array_length(p_pujas) = 0 then
    raise exception 'No hay ejemplares para asignar.';
  end if;

  -- El lock serializa a dos operadores asignando a la vez sobre el mismo remate.
  select estado into v_estado
    from public.remates
   where id = p_remate_id
     for update;
  if not found then
    raise exception 'El remate no existe.';
  end if;
  if lower(btrim(coalesce(v_estado, 'Abierto'))) = 'cerrado' then
    raise exception 'El remate esta cerrado: no admite pujas nuevas.';
  end if;

  -- Tope por COMPRADOR, no por puja: si el mismo cliente compra dos ejemplares en
  -- este lote, cada puja por separado pasaría y el total no. Se acumulan primero.
  for v_tope in
    select
      nullif(v ->> 'cliente_id', '')::uuid as cli,
      sum(coalesce((v ->> 'monto_usd')::numeric, 0)) as total
      from jsonb_array_elements(p_pujas) v
     where nullif(v ->> 'cliente_id', '') is not null
       and coalesce((v ->> 'monto_usd')::numeric, 0) > 0
     group by 1
  loop
    perform public.club_validar_tope_compra_remate(v_tope.cli, v_tope.total, null);
  end loop;

  for v_puja in select * from jsonb_array_elements(p_pujas)
  loop
    v_monto := coalesce((v_puja ->> 'monto_usd')::numeric, 0);
    v_cli   := nullif(v_puja ->> 'cliente_id', '')::uuid;

    insert into public.remate_caballos (
      remate_id, numero, nombre, monto_usd, cliente_id, ejemplar_numero
    ) values (
      p_remate_id,
      coalesce((v_puja ->> 'numero')::integer, 0),
      upper(btrim(coalesce(v_puja ->> 'nombre', ''))),
      v_monto,
      v_cli,
      nullif(v_puja ->> 'ejemplar_numero', '')
    )
    returning id into v_id;

    insert into public.remate_pujas (remate_id, caballo_id, monto_usd, cliente_id)
    values (p_remate_id, v_id, v_monto, v_cli);

    v_count := v_count + 1;
  end loop;

  perform public.club_recalcular_probs_remate(p_remate_id);
  return jsonb_build_object('ok', true, 'insertados', v_count);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3) Subir / cambiar una puja
-- ---------------------------------------------------------------------------
create or replace function public.club_pujar_caballo_remate(
  p_caballo_id uuid,
  p_monto_usd  numeric,
  p_cliente_id uuid,
  p_usuario    text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_remate_id uuid;
  v_estado    text;
  v_monto     numeric := coalesce(p_monto_usd, 0);
  v_previo_cli uuid;
  v_previo_monto numeric := 0;
begin
  if not coalesce(public.tiene_capacidad(auth.uid(), 'remates:fn_asignar_caballos'), false) then
    raise exception 'Sin permiso para subir pujas' using errcode = '42501';
  end if;

  select remate_id into v_remate_id
    from public.remate_caballos
   where id = p_caballo_id
     for update;
  if not found then
    raise exception 'La puja no existe.';
  end if;

  select estado into v_estado
    from public.remates
   where id = v_remate_id
     for update;
  if lower(btrim(coalesce(v_estado, 'Abierto'))) = 'cerrado' then
    raise exception 'El remate esta cerrado: no se pueden subir pujas.';
  end if;

  -- Tope de compra en el servidor. El ejemplar que se esta reasignando se
  -- excluye del calculo: su monto viejo queda liberado (si no, el mismo cliente
  -- pagaria dos veces por el mismo ejemplar al subirse la puja).
  select cliente_id, coalesce(monto_usd, 0)
    into v_previo_cli, v_previo_monto
    from public.remate_caballos
   where id = p_caballo_id;
  if v_previo_cli is not distinct from p_cliente_id then
    perform public.club_validar_tope_compra_remate(p_cliente_id, v_monto, p_caballo_id);
  else
    perform public.club_validar_tope_compra_remate(p_cliente_id, v_monto, null);
  end if;

  update public.remate_caballos
     set monto_usd  = v_monto,
         cliente_id = p_cliente_id
   where id = p_caballo_id;

  insert into public.remate_pujas (remate_id, caballo_id, monto_usd, cliente_id)
  values (v_remate_id, p_caballo_id, v_monto, p_cliente_id);

  perform public.club_recalcular_probs_remate(v_remate_id);
  return jsonb_build_object('ok', true, 'remate_id', v_remate_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4) Quitar una puja
-- ---------------------------------------------------------------------------
create or replace function public.club_eliminar_caballo_remate(
  p_caballo_id uuid,
  p_usuario    text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_remate_id uuid;
begin
  if not coalesce(public.tiene_capacidad(auth.uid(), 'remates:fn_eliminar_caballo'), false) then
    raise exception 'Sin permiso para quitar pujas' using errcode = '42501';
  end if;

  select remate_id into v_remate_id
    from public.remate_caballos
   where id = p_caballo_id;
  if not found then
    raise exception 'La puja no existe.';
  end if;

  -- El historial de esta puja cae por la FK on delete cascade de remate_pujas.
  delete from public.remate_caballos where id = p_caballo_id;

  perform public.club_recalcular_probs_remate(v_remate_id);
  return jsonb_build_object('ok', true, 'remate_id', v_remate_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5) Grants: solo authenticated (anon queda afuera)
--    Por defecto Postgres da EXECUTE a PUBLIC al crear una funcion, asi que
--    hay que revocarlo explicitamente: el `grant to authenticated` no lo quita.
-- ---------------------------------------------------------------------------
revoke all on function public.club_asignar_pujas_remate(uuid, jsonb, text)      from public, anon;
revoke all on function public.club_pujar_caballo_remate(uuid, numeric, uuid, text) from public, anon;
revoke all on function public.club_eliminar_caballo_remate(uuid, text)          from public, anon;
grant execute on function public.club_asignar_pujas_remate(uuid, jsonb, text)      to authenticated;
grant execute on function public.club_pujar_caballo_remate(uuid, numeric, uuid, text) to authenticated;
grant execute on function public.club_eliminar_caballo_remate(uuid, text)          to authenticated;

commit;
