-- ============================================================================
-- LOGOS DE HIPÓDROMOS Y GRUPOS — columna `logo_url`
-- ============================================================================
-- Qué agrega
-- ----------
-- 1) `hipodromos.logo_url`: logo PNG del hipódromo (Data URL base64,
--    optimizado en el cliente por `LogoUploader`). Se muestra en la cabecera
--    azul del Reporte de Liquidación y en la lista del módulo Hipódromos.
--
-- 2) `grupos_venta.logo_url`: logo PNG del grupo hípico, junto al nombre del
--    grupo en la cabecera del reporte, en la lista de Grupos y en el alta.
--
-- 3) Recrea las RPC del legacy `club_guardar_grupo` / `club_actualizar_grupo`
--    para que GUARDEN `logo_url`. Sin esto el UPDATE directo queda bloqueado
--    por el RLS de solo lectura de `grupos_venta` y el fallback por RPC
--    descartaría el logo en silencio.
--
-- Es idempotente: se puede correr varias veces sin perder datos.
-- ============================================================================

-- 1) HIPÓDROMOS ---------------------------------------------------------------
alter table public.hipodromos
  add column if not exists logo_url text;

comment on column public.hipodromos.logo_url is
  'Logo del hipódromo en PNG (Data URL base64, máx. 256 px). Se usa en la cabecera del Reporte de Liquidación.';

-- 2) GRUPOS -------------------------------------------------------------------
alter table public.grupos_venta
  add column if not exists logo_url text;

comment on column public.grupos_venta.logo_url is
  'Logo del grupo en PNG (Data URL base64, máx. 256 px). Se usa junto al nombre del grupo en el Reporte de Liquidación.';

-- Compatibilidad: instalaciones viejas que todavía tengan `public.grupos`.
do $$
begin
  if to_regclass('public.grupos') is not null then
    execute 'alter table public.grupos add column if not exists logo_url text';
  end if;
end $$;

-- 3) RPC club_guardar_grupo ---------------------------------------------------
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
    v_logo text := nullif(trim(coalesce(p_datos->>'logo_url', '')), '');
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
             responsable, cuenta_bancaria, logo_url, activo)
        values
            (v_nombre, v_moneda, v_moneda_cuadre, v_principal, v_cupo, v_comision,
             v_marcas, v_tablas, v_remates, v_polla, v_wps, v_dupletas,
             v_responsable, v_cuenta, v_logo, true)
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
            logo_url = case when p_datos ? 'logo_url' then v_logo else logo_url end,
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

-- 4) RPC club_actualizar_grupo ------------------------------------------------
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
    v_logo text := nullif(trim(coalesce(p_datos->>'logo_url', '')), '');
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
        logo_url = case when p_datos ? 'logo_url' then v_logo else logo_url end,
        responsable = v_responsable,
        cuenta_bancaria = v_cuenta
    where id = p_id;
end;
$$;

revoke all on function public.club_actualizar_grupo(uuid, jsonb) from anon;
grant execute on function public.club_actualizar_grupo(uuid, jsonb) to anon;
