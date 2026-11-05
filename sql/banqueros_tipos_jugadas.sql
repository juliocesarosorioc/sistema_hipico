-- =============================================================================
-- BANQUERO POR GRUPO x TIPOS DE JUGADAS Y MODALIDADES
-- =============================================================================
-- Extiende el soporte de banqueros para aceptar tanto las 6 modalidades fijas
-- (TABLAS, MARCAS, DUPLETA, REMATES, WPS, POLLAS) como TODOS los tipos de jugada
-- de la base de datos (GANADOR, PLACE, SHOW, EXACTA, TRIFECTA, CUATRIFECTA, DOBLE, etc.).
--
-- Idempotente: se puede correr tantas veces como sea necesario.
-- =============================================================================

-- 1) Normalizar modalidad / tipo de jugada
create or replace function public.club_modalidad_ticket(p_origen text)
returns text
language sql
immutable
as $$
    select case upper(btrim(coalesce(p_origen, '')))
        when ''              then null
        when 'MARCAS'        then 'MARCAS'
        when 'TABLAS'        then 'TABLAS'
        when 'TABLAS_FIJAS'  then 'TABLAS'
        when 'DUPLETA'       then 'DUPLETA'
        when 'DUPLETAS'      then 'DUPLETA'
        when 'REMATE'        then 'REMATES'
        when 'REMATES'       then 'REMATES'
        when 'WPS'           then 'WPS'
        when 'WPS_LEGACY'    then 'WPS'
        when 'POLLA'         then 'POLLAS'
        when 'POLLAS'        then 'POLLAS'
        else upper(btrim(p_origen))
    end;
$$;

-- 2) Congelar banquero en tickets_apuestas al vender (aplica para cualquier tipo de jugada)
create or replace function public.club_fijar_banquero_ticket()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_origen    text;
    v_modalidad text;
    v_conv      public.banquero_convenio%rowtype;
begin
    if new.banquero_cliente_id is not null then
        return new;
    end if;
    if new.grupo_cobro_id is null then
        return new;
    end if;

    begin
        v_origen := new.nota_auditoria::jsonb ->> 'origen';
    exception when others then
        v_origen := null;
    end;

    v_modalidad := public.club_modalidad_ticket(v_origen);

    -- Taquilla / Tipos de jugadas: el `origen` puede ser 'TAQUILLA'; la
    -- modalidad o tipo de jugada que negocia el banquero viaja en:
    --   1) `nota_auditoria.modalidad`
    --   2) `nota_auditoria.jugada`
    --   3) `nombre_jugada` (ej: 'GANADOR', 'EXACTA', 'TRIFECTA', etc.)
    if v_modalidad is null or v_modalidad = 'TAQUILLA' then
        begin
            v_modalidad := public.club_modalidad_ticket(new.nota_auditoria::jsonb ->> 'modalidad');
        exception when others then
            v_modalidad := null;
        end;
    end if;

    if v_modalidad is null or v_modalidad = 'TAQUILLA' then
        begin
            v_modalidad := public.club_modalidad_ticket(new.nota_auditoria::jsonb ->> 'jugada');
        exception when others then
            v_modalidad := null;
        end;
    end if;

    if v_modalidad is null or v_modalidad = 'TAQUILLA' then
        v_modalidad := public.club_modalidad_ticket(new.nombre_jugada);
    end if;

    if v_modalidad is null then
        return new;
    end if;

    -- 1) Buscar convenio específico para la modalidad / tipo de jugada
    select * into v_conv
      from public.banquero_convenio
     where grupo_id  = new.grupo_cobro_id
       and modalidad = v_modalidad
       and coalesce(activo, true)
     limit 1;

    -- 2) Si no hay convenio específico y es de taquilla, buscar banquero general 'TAQUILLA'
    if not found and v_modalidad <> 'TAQUILLA' then
        select * into v_conv
          from public.banquero_convenio
         where grupo_id  = new.grupo_cobro_id
           and modalidad = 'TAQUILLA'
           and coalesce(activo, true)
         limit 1;
    end if;

    if not found then
        return new;
    end if;

    new.banquero_cliente_id          := v_conv.banquero_cliente_id;
    new.banquero_nombre              := coalesce(
                                            v_conv.banquero_nombre,
                                            (select nombre from public.clientes where id = v_conv.banquero_cliente_id)
                                        );
    new.banquero_cobra_comision      := coalesce(v_conv.cobra_comision, false);
    new.banquero_comision_porcentaje := coalesce(v_conv.comision_porcentaje, 0);
    new.banquero_comision_base       := coalesce(v_conv.comision_base, 'MONTO_DECIDIDO');
    return new;
end;
$$;

drop trigger if exists trg_fijar_banquero_ticket on public.tickets_apuestas;
create trigger trg_fijar_banquero_ticket
    before insert on public.tickets_apuestas
    for each row execute function public.club_fijar_banquero_ticket();
