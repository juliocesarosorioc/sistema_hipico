-- ============================================================================
-- COMISIÓN POR CONVENIO DE PRODUCTO (por grupo) — columnas + RPCs
-- ============================================================================
-- El grupo PRINCIPAL coloca la jugada habilitada para los jugadores de TODOS los
-- grupos y le PAGA al grupo cuyo cliente compró el % pactado sobre el MONTO
-- DECIDIDO. Cada grupo negocia ese % por producto:
--
--   entre tercios · marcas · tablas fijas · remates · polla · wps · dupletas
--
-- `entre_tercios` reutiliza la columna histórica `comision_default`. Los demás
-- conceptos son NUEVAS columnas; en NULL HEREDAN de `comision_default` (así un
-- grupo que no negoció nada usa la comisión general y no una tasa inventada).
--
-- `grupos_venta` queda con RLS de solo lectura: la app NO escribe directo, cae a
-- las RPC `security definer` `club_guardar_grupo` / `club_actualizar_grupo`.
-- Por eso este archivo también las redefine con las columnas nuevas (si no, el
-- % por producto llegaba al formulario pero NUNCA se guardaba).
--
-- IDEMPOTENTE: se puede correr varias veces sin efecto lateral.
-- Aplicar a mano en el SQL Editor de Supabase.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Columnas nuevas (numeric(5,2): hasta 999.99 %)
-- ----------------------------------------------------------------------------
alter table public.grupos_venta
    add column if not exists comision_marcas   numeric(5,2),
    add column if not exists comision_tablas   numeric(5,2),
    add column if not exists comision_remates  numeric(5,2),
    add column if not exists comision_polla    numeric(5,2),
    add column if not exists comision_wps      numeric(5,2),
    add column if not exists comision_dupletas numeric(5,2);

comment on column public.grupos_venta.comision_default  is 'Comisión (%) de las jugadas ENTRE TERCIOS. Es también el respaldo de los demás productos cuando su campo está en NULL.';
comment on column public.grupos_venta.comision_marcas   is 'Comisión por convenio de MARCAS (% sobre el monto decidido). NULL = hereda comision_default.';
comment on column public.grupos_venta.comision_tablas   is 'Comisión por convenio de TABLAS FIJAS (% sobre el monto decidido). NULL = hereda comision_default.';
comment on column public.grupos_venta.comision_remates  is 'Comisión por convenio de REMATES (% sobre el monto decidido). NULL = hereda comision_default.';
comment on column public.grupos_venta.comision_polla    is 'Comisión por convenio de POLLA (% sobre el monto decidido). NULL = hereda comision_default.';
comment on column public.grupos_venta.comision_wps      is 'Comisión por convenio de WPS (% sobre el monto decidido). NULL = hereda comision_default.';
comment on column public.grupos_venta.comision_dupletas is 'Comisión por convenio de DUPLETAS (% sobre el monto decidido). NULL = hereda comision_default.';

-- ============================================================
-- club_listar_grupos() — se le agregan los 6 % por producto para que el
-- formulario de grupos los vea AUNQUE el SELECT directo caiga al RPC (RLS).
-- ============================================================
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
            'created_at', g.created_at
        )
        order by g.es_principal desc, g.nombre asc
    ), '[]'::jsonb)
    into v_out
    from public.grupos_venta g;

    return v_out;
end;
$$;

revoke all on function public.club_listar_grupos() from anon;
grant execute on function public.club_listar_grupos() to anon;

-- ============================================================
-- club_guardar_grupo(jsonb) — alta/actualización por nombre.
-- Los % por producto: si la clave VIENE en p_datos se usa (vacío = NULL =
-- hereda); si NO viene, en el update se conserva el valor previo.
-- ============================================================
create or replace function public.club_guardar_grupo(p_datos jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_id uuid;
    v_nombre text := upper(trim(coalesce(p_datos->>'nombre', '')));
    v_moneda text := coalesce(p_datos->>'moneda', 'USD');
    v_moneda_cuadre text := coalesce(p_datos->>'moneda_cuadre', 'USD');
    v_principal boolean := coalesce((p_datos->>'es_principal')::boolean, false);
    v_cupo integer := coalesce((p_datos->>'cupo_tabla')::integer, 100);
    v_comision numeric := coalesce((p_datos->>'comision_default')::numeric, 2.5);
    v_responsable text := nullif(upper(trim(coalesce(p_datos->>'responsable', ''))), '');
    v_cuenta text := nullif(trim(coalesce(p_datos->>'cuenta_bancaria', '')), '');
    v_marcas numeric := nullif(p_datos->>'comision_marcas', '')::numeric;
    v_tablas numeric := nullif(p_datos->>'comision_tablas', '')::numeric;
    v_remates numeric := nullif(p_datos->>'comision_remates', '')::numeric;
    v_polla numeric := nullif(p_datos->>'comision_polla', '')::numeric;
    v_wps numeric := nullif(p_datos->>'comision_wps', '')::numeric;
    v_dupletas numeric := nullif(p_datos->>'comision_dupletas', '')::numeric;
begin
    if v_nombre = '' then
        raise exception 'Indique el nombre del grupo';
    end if;
    if v_cuenta is not null and not public.club_cuenta_bancaria_valida(v_cuenta) then
        raise exception 'Número de cuenta inválido. Use el formato XXXX-XX-XXXX-XXXX-XX (solo números).';
    end if;

    -- Un solo PRINCIPAL: limpia el flag antes de asignarlo
    if v_principal then
        update public.grupos_venta set es_principal = false where es_principal = true;
    end if;

    -- Reutiliza por nombre normalizado (no depende de un unique constraint real)
    select id into v_id
    from public.grupos_venta
    where lower(trim(nombre)) = lower(v_nombre)
    limit 1;

    if v_id is null then
        insert into public.grupos_venta
            (nombre, moneda, moneda_cuadre, es_principal, cupo_tabla, comision_default,
             comision_marcas, comision_tablas, comision_remates, comision_polla, comision_wps, comision_dupletas,
             responsable, cuenta_bancaria, activo)
        values
            (v_nombre, v_moneda, v_moneda_cuadre, v_principal, v_cupo, v_comision,
             v_marcas, v_tablas, v_remates, v_polla, v_wps, v_dupletas,
             v_responsable, v_cuenta, true)
        returning id into v_id;
    else
        update public.grupos_venta set
            moneda = v_moneda,
            moneda_cuadre = v_moneda_cuadre,
            es_principal = v_principal,
            cupo_tabla = v_cupo,
            comision_default = v_comision,
            comision_marcas   = case when p_datos ? 'comision_marcas'   then v_marcas   else comision_marcas   end,
            comision_tablas   = case when p_datos ? 'comision_tablas'   then v_tablas   else comision_tablas   end,
            comision_remates  = case when p_datos ? 'comision_remates'  then v_remates  else comision_remates  end,
            comision_polla    = case when p_datos ? 'comision_polla'    then v_polla    else comision_polla    end,
            comision_wps      = case when p_datos ? 'comision_wps'      then v_wps      else comision_wps      end,
            comision_dupletas = case when p_datos ? 'comision_dupletas' then v_dupletas else comision_dupletas end,
            responsable = v_responsable,
            cuenta_bancaria = v_cuenta,
            activo = true
        where id = v_id;
    end if;

    return v_id;
end;
$$;

revoke all on function public.club_guardar_grupo(jsonb) from anon;
grant execute on function public.club_guardar_grupo(jsonb) to anon;

-- ============================================================
-- club_actualizar_grupo(uuid, jsonb) — los % por producto solo se tocan si la
-- clave viene en p_datos (así no se borran desde pantallas que no los editan).
-- ============================================================
create or replace function public.club_actualizar_grupo(p_id uuid, p_datos jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_nombre text := upper(trim(coalesce(p_datos->>'nombre', '')));
    v_moneda text := coalesce(p_datos->>'moneda', 'USD');
    v_moneda_cuadre text := coalesce(p_datos->>'moneda_cuadre', 'USD');
    v_principal boolean := coalesce((p_datos->>'es_principal')::boolean, false);
    v_cupo integer := coalesce((p_datos->>'cupo_tabla')::integer, 100);
    v_comision numeric := coalesce((p_datos->>'comision_default')::numeric, 2.5);
    v_responsable text := nullif(upper(trim(coalesce(p_datos->>'responsable', ''))), '');
    v_cuenta text := nullif(trim(coalesce(p_datos->>'cuenta_bancaria', '')), '');
    v_marcas numeric := nullif(p_datos->>'comision_marcas', '')::numeric;
    v_tablas numeric := nullif(p_datos->>'comision_tablas', '')::numeric;
    v_remates numeric := nullif(p_datos->>'comision_remates', '')::numeric;
    v_polla numeric := nullif(p_datos->>'comision_polla', '')::numeric;
    v_wps numeric := nullif(p_datos->>'comision_wps', '')::numeric;
    v_dupletas numeric := nullif(p_datos->>'comision_dupletas', '')::numeric;
begin
    if v_nombre = '' then
        raise exception 'Indique el nombre del grupo';
    end if;
    if v_cuenta is not null and not public.club_cuenta_bancaria_valida(v_cuenta) then
        raise exception 'Número de cuenta inválido. Use el formato XXXX-XX-XXXX-XXXX-XX (solo números).';
    end if;

    if v_principal then
        update public.grupos_venta set es_principal = false where es_principal = true and id <> p_id;
    end if;

    update public.grupos_venta set
        nombre = v_nombre,
        moneda = v_moneda,
        moneda_cuadre = v_moneda_cuadre,
        es_principal = v_principal,
        cupo_tabla = v_cupo,
        comision_default = v_comision,
        comision_marcas   = case when p_datos ? 'comision_marcas'   then v_marcas   else comision_marcas   end,
        comision_tablas   = case when p_datos ? 'comision_tablas'   then v_tablas   else comision_tablas   end,
        comision_remates  = case when p_datos ? 'comision_remates'  then v_remates  else comision_remates  end,
        comision_polla    = case when p_datos ? 'comision_polla'    then v_polla    else comision_polla    end,
        comision_wps      = case when p_datos ? 'comision_wps'      then v_wps      else comision_wps      end,
        comision_dupletas = case when p_datos ? 'comision_dupletas' then v_dupletas else comision_dupletas end,
        responsable = v_responsable,
        cuenta_bancaria = v_cuenta
    where id = p_id;
end;
$$;

revoke all on function public.club_actualizar_grupo(uuid, jsonb) from anon;
grant execute on function public.club_actualizar_grupo(uuid, jsonb) to anon;
