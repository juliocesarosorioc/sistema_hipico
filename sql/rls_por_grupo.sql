-- ============================================================================
-- RLS POR GRUPO DE VENTA — la frontera real del aislamiento
-- ============================================================================
--
-- Ejecutar DESPUÉS de:
--   1. src/db/seguridad_maestro.sql   (tiene_capacidad, soy_principal, usuario_de)
--   2. src/db/rls-negocio.sql         (enciende RLS y deja las policies abiertas)
--   3. sql/grupos_usuarios.sql        (usuario_sistema.grupo_id + resolutores)
--
-- Idempotente. Reemplaza las policies "abiertas" de rls-negocio.sql por unas
-- que además exigen que la fila sea del GRUPO del usuario. El efecto:
--   * Usuario CON grupo  → ve y toca solo su grupo.
--   * Usuario SIN grupo  → ve todo (retrocompatible; ver grupos_usuarios.sql).
--   * Principal          → ve todo.
--
-- Es la frontera y no una cortesía: la llave anon es pública y las llamadas van
-- a PostgREST, no a nuestro código. El filtro del navegador (para el "ver todos"
-- del super administrador) es solo comodidad.
--
-- ----------------------------------------------------------------------------
-- SEGURIDAD DEL CAMBIO
-- ----------------------------------------------------------------------------
-- Mientras NADIE tenga grupo asignado, `ve_todos_los_grupos` es true para todos
-- y estas policies se comportan igual que las abiertas: aplicar este archivo NO
-- cambia nada hasta que se asigne el primer grupo. El aislamiento entra grupo
-- por grupo, cuando se corre el UPDATE de la sección de migración.
--
-- Rollback: volver a correr src/db/rls-negocio.sql (deja las policies abiertas).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- PREFLIGHT — no arrancar si falta un eslabón.
-- ---------------------------------------------------------------------------
-- Sin esto, correr este archivo antes de `sql/grupos_usuarios.sql` reventaba a
-- mitad de camino: cada `create policy` fallaba por la función faltante, pero
-- el `drop policy` previo ya había corrido. En un editor con autocommit eso
-- dejaba la tabla con RLS encendido y SIN policy (deniega todo). Mejor abortar
-- de entrada con un mensaje que diga qué hacer.
do $$
begin
  if to_regclass('public.usuario_sistema') is null then
    raise exception 'Falta src/db/seguridad_maestro.sql (no existe public.usuario_sistema).';
  end if;
  if to_regclass('public.tipo_usuario') is null then
    raise exception 'Falta src/db/seguridad_maestro.sql (no existe public.tipo_usuario).';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'usuario_sistema' and column_name = 'grupo_id'
  ) then
    raise exception 'Falta sql/grupos_usuarios.sql (usuario_sistema.grupo_id). Corré ESE script primero y volvé a correr este.';
  end if;
  if to_regprocedure('public.usuario_en_grupo(uuid,text)') is null
     or to_regprocedure('public.usuario_en_cliente(uuid,text)') is null
     or to_regprocedure('public.ve_todos_los_grupos(uuid)') is null
     or to_regprocedure('public.grupo_del_usuario(uuid)') is null then
    raise exception 'Faltan los resolutores de grupo. Corré sql/grupos_usuarios.sql primero y volvé a correr este.';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Helper interno: crea una policy SOLO si la tabla y las columnas que usa
-- existen. Sin esto, una columna faltante abortaba el archivo entero y dejaba
-- el RLS a medio aplicar (la peor situación posible).
-- ---------------------------------------------------------------------------
create or replace function public._aplicar_grupo(
  p_tabla   text,
  p_policy  text,
  p_cmd     text,        -- 'all' | 'select' | 'insert' | 'update' | 'delete'
  p_cols    text[],      -- columnas que la expresión necesita
  p_using   text,        -- expresión de USING (null = no aplica)
  p_check   text         -- expresión de WITH CHECK (null = no aplica)
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c text;
  v_sql text;
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = p_tabla
  ) then
    return format('OMITIDA: la tabla %s no existe', p_tabla);
  end if;

  foreach c in array coalesce(p_cols, '{}'::text[]) loop
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = p_tabla
        and column_name = c
    ) then
      return format('OMITIDA: %s.%s no existe', p_tabla, c);
    end if;
  end loop;

  execute format('alter table public.%I enable row level security', p_tabla);

  -- Se arma el SQL y se crea dentro de un subbloque con reintento: si por lo
  -- que sea quedó una policy con el mismo nombre (un intento anterior a medias),
  -- se la borra y se vuelve a crear. Así este archivo nunca deja una tabla con
  -- RLS encendido y sin policy.
  if p_cmd = 'select' then
    v_sql := format(
      'create policy %I on public.%I for select to authenticated using (%s)',
      p_policy, p_tabla, p_using
    );
  elsif p_cmd = 'insert' then
    v_sql := format(
      'create policy %I on public.%I for insert to authenticated with check (%s)',
      p_policy, p_tabla, p_check
    );
  elsif p_cmd = 'update' then
    v_sql := format(
      'create policy %I on public.%I for update to authenticated using (%s) with check (%s)',
      p_policy, p_tabla, p_using, coalesce(p_check, p_using)
    );
  elsif p_cmd = 'delete' then
    v_sql := format(
      'create policy %I on public.%I for delete to authenticated using (%s)',
      p_policy, p_tabla, p_using
    );
  else
    v_sql := format(
      'create policy %I on public.%I for all to authenticated using (%s) with check (%s)',
      p_policy, p_tabla, p_using, coalesce(p_check, p_using)
    );
  end if;

  begin
    execute format('drop policy if exists %I on public.%I', p_policy, p_tabla);
    execute v_sql;
  exception
    when duplicate_object then
      execute format('drop policy if exists %I on public.%I', p_policy, p_tabla);
      execute v_sql;
  end;

  return format('OK: %s [%s]', p_tabla, p_cmd);
end;
$$;

revoke all on function public._aplicar_grupo(text, text, text, text[], text, text)
  from public, anon, authenticated;

-- ============================================================================
-- CLIENTES — la tabla madre: PII + credenciales del portal
-- ============================================================================
-- Reemplaza "personal opera clientes" (using true). Un grupo solo ve/edita sus
-- clientes. El grupo de cada cliente es `clientes.grupo_id`.
select public._aplicar_grupo(
  'clientes', 'personal opera clientes', 'all', array['grupo_id'],
  'public.usuario_en_grupo(auth.uid(), grupo_id::text)',
  'public.tiene_capacidad(auth.uid(), ''clientes:fn_guardar_cliente'')
     and public.usuario_en_grupo(auth.uid(), grupo_id::text)'
);

-- ============================================================================
-- TICKETS_APUESTAS — las jugadas del cliente
-- ============================================================================
-- La policy amplia que creaba sql/jugadas_monitor.sql (`using (true)`) se suma
-- por OR a la de acá y ANULABA este aislamiento. Se borra primero: correr este
-- archivo alcanza para dejar solo la policy de grupo.
do $$
begin
  if to_regclass('public.tickets_apuestas') is not null then
    execute 'drop policy if exists tickets_apuestas_monitor_select on public.tickets_apuestas';
    execute 'drop policy if exists tickets_apuestas_monitor_update on public.tickets_apuestas';
  end if;
end
$$;

-- Se ve el ticket si es del grupo del usuario (por `grupo_cobro_id`) O si es de
-- un cliente suyo. El OR es a propósito: en un cruce, el ticket de un cliente
-- propio puede quedar cobrando en otro grupo, y esconderlo le sacaría al
-- operador una jugada que vendió él.
select public._aplicar_grupo(
  'tickets_apuestas', 'personal lee apuestas', 'select',
  array['grupo_cobro_id', 'cliente_juega_id'],
  '(public.usuario_en_grupo(auth.uid(), grupo_cobro_id::text)
    or public.usuario_en_cliente(auth.uid(), cliente_juega_id::text))',
  null
);
select public._aplicar_grupo(
  'tickets_apuestas', 'personal actualiza apuesta', 'update',
  array['grupo_cobro_id', 'cliente_juega_id'],
  '(public.usuario_en_grupo(auth.uid(), grupo_cobro_id::text)
    or public.usuario_en_cliente(auth.uid(), cliente_juega_id::text))',
  '(public.usuario_en_grupo(auth.uid(), grupo_cobro_id::text)
    or public.usuario_en_cliente(auth.uid(), cliente_juega_id::text))
    and (public.tiene_capacidad(auth.uid(), ''clientes:fn_guardar_cliente'')
      or public.tiene_capacidad(auth.uid(), ''tickets:fn_anular_ticket''))'
);

-- ============================================================================
-- TICKETS_JUGADAS — la cola de reclamos (grupo por el cliente)
-- ============================================================================
select public._aplicar_grupo(
  'tickets_jugadas', 'personal lee tickets de jugada', 'select',
  array['cliente_id'],
  'public.usuario_en_cliente(auth.uid(), cliente_id::text)', null
);
select public._aplicar_grupo(
  'tickets_jugadas', 'personal escribe tickets de jugada', 'insert',
  array['cliente_id'],
  null,
  'public.usuario_en_cliente(auth.uid(), cliente_id::text)
     and public.tiene_capacidad(auth.uid(), ''tickets:fn_anular_ticket'')'
);
select public._aplicar_grupo(
  'tickets_jugadas', 'personal actualiza ticket de jugada', 'update',
  array['cliente_id'],
  'public.usuario_en_cliente(auth.uid(), cliente_id::text)
     and public.tiene_capacidad(auth.uid(), ''tickets:fn_anular_ticket'')',
  'public.usuario_en_cliente(auth.uid(), cliente_id::text)
     and public.puede_contexto(auth.uid(), ''tickets:fn_anular_ticket'',
           jsonb_build_object(''estado'', coalesce(estado, '''')))'
);

-- ============================================================================
-- NOTIFICACIONES — avisos del portal (grupo por el cliente)
-- ============================================================================
select public._aplicar_grupo(
  'notificaciones', 'personal opera notificaciones', 'all', array['cliente_id'],
  'public.usuario_en_cliente(auth.uid(), cliente_id::text)',
  'public.usuario_en_cliente(auth.uid(), cliente_id::text)
     and (public.tiene_capacidad(auth.uid(), ''clientes:modal_reclamos'')
       or public.tiene_capacidad(auth.uid(), ''tickets:fn_anular_ticket''))'
);

-- ============================================================================
-- SOLICITUDES_TABLAS — compras del portal (grupo propio en la fila)
-- ============================================================================
select public._aplicar_grupo(
  'solicitudes_tablas', 'personal opera solicitudes de tabla', 'all', array['grupo_id'],
  'public.usuario_en_grupo(auth.uid(), grupo_id::text)',
  'public.usuario_en_grupo(auth.uid(), grupo_id::text)
     and (public.tiene_capacidad(auth.uid(), ''tablas:fn_publicar'')
       or public.soy_principal(auth.uid()))'
);

-- ============================================================================
-- DUPLETAS — si la tabla trae grupo propio
-- ============================================================================
select public._aplicar_grupo(
  'dupletas', 'personal opera dupletas', 'all', array['grupo_id'],
  'public.usuario_en_grupo(auth.uid(), grupo_id::text)',
  'public.usuario_en_grupo(auth.uid(), grupo_id::text)
     and public.tiene_capacidad(auth.uid(), ''dupleta:fn_armar_dupleta'')'
);

-- ============================================================================
-- TRANSACCIONES_FINANCIERAS — contabilidad (origen o destino del cliente)
-- ============================================================================
select public._aplicar_grupo(
  'transacciones_financieras', 'personal lee movimientos', 'select',
  array['cliente_origen_id', 'cliente_destino_id'],
  '(public.usuario_en_cliente(auth.uid(), cliente_origen_id::text)
    or public.usuario_en_cliente(auth.uid(), cliente_destino_id::text))',
  null
);
select public._aplicar_grupo(
  'transacciones_financieras', 'personal escribe movimientos', 'insert',
  array['cliente_origen_id', 'cliente_destino_id'],
  null,
  '(public.usuario_en_cliente(auth.uid(), cliente_origen_id::text)
    or public.usuario_en_cliente(auth.uid(), cliente_destino_id::text))
    and public.puede_contexto(auth.uid(), ''contabilidad:fn_registrar_movimiento'',
          jsonb_build_object(
            ''monto'', to_jsonb(coalesce(monto, 0)),
            ''metodo_pago'', to_jsonb(coalesce(modalidad, ''''))))'
);

-- ============================================================================
-- DEPOSITOS — ingresos de caja (grupo por el cliente)
-- ============================================================================
select public._aplicar_grupo(
  'depositos', 'personal lee depositos', 'select', array['cliente_id'],
  'public.usuario_en_cliente(auth.uid(), cliente_id::text)', null
);
select public._aplicar_grupo(
  'depositos', 'personal escribe depositos', 'insert', array['cliente_id'],
  null,
  'public.usuario_en_cliente(auth.uid(), cliente_id::text)
     and public.tiene_capacidad(auth.uid(), ''contabilidad:fn_registrar_movimiento'')'
);

-- ============================================================================
-- USUARIO_SISTEMA — los usuarios de cada grupo
-- ============================================================================
-- Reemplaza la lectura ("authenticated lee el personal") y la escritura
-- ("escribe el personal quien asigna tipo") del maestro para que un
-- administrador de grupo solo vea y dé de alta gente de SU grupo. El principal
-- (y quien no tiene grupo) sigue viendo todo.
--
-- La lectura propia se mantiene por `usuario_de`, que es la que deja entrar a
-- un usuario sin capacidades de administración (su `id` local no coincide con
-- el correo del JWT, así que la condición vieja `id = email` no lo cubría).
select public._aplicar_grupo(
  'usuario_sistema', 'authenticated lee el personal', 'select', array['grupo_id'],
  $expr$(
    public.soy_principal(auth.uid())
    or public.tiene_capacidad(auth.uid(), 'seguridad:fn_asignar_tipo')
    or public.tiene_capacidad(auth.uid(), 'seguridad:fn_editar_matriz')
    or id = coalesce((select id from public.usuario_de(auth.uid())), '')
  )
  and public.usuario_en_grupo(auth.uid(), grupo_id::text)$expr$,
  null
);
select public._aplicar_grupo(
  'usuario_sistema', 'escribe el personal quien asigna tipo', 'all', array['grupo_id'],
  $expr$(
    (public.tiene_capacidad(auth.uid(), 'seguridad:fn_asignar_tipo')
     or public.soy_principal(auth.uid()))
    and (not es_principal or public.soy_principal(auth.uid()))
  )
  and public.usuario_en_grupo(auth.uid(), grupo_id::text)$expr$,
  $expr$(
    (public.tiene_capacidad(auth.uid(), 'seguridad:fn_asignar_tipo')
     or public.soy_principal(auth.uid()))
    and (not es_principal or public.soy_principal(auth.uid()))
  )
  and public.usuario_en_grupo(auth.uid(), grupo_id::text)$expr$
);

-- ============================================================================
-- GRANTS — recordatorio (los de rls-negocio.sql ya cubren estas tablas)
-- ============================================================================
-- `depositos` no estaba en rls-negocio.sql: se enciende su RLS acá, así que hay
-- que asegurar el GRANT de `authenticated` (y cerrar `anon`) o la app dejaría de
-- poder leer la caja. Va blindado: si la tabla no existe, no hace nada.
do $$
begin
  if to_regclass('public.depositos') is not null then
    execute 'grant all on public.depositos to authenticated';
    execute 'revoke all on public.depositos from anon';
  end if;
end
$$;
-- Si otra tabla de arriba todavía no tiene GRANT para `authenticated`,
-- descomentá la línea que corresponda y corré de nuevo:
--   grant all on public.cierres_jornada to authenticated;

-- ============================================================================
-- VERIFICACIÓN — qué quedó aplicado
-- ============================================================================
--   select tablename, policyname, cmd
--   from pg_policies
--   where schemaname = 'public'
--     and tablename in ('clientes','tickets_apuestas','tickets_jugadas',
--                       'notificaciones','solicitudes_tablas','dupletas',
--                       'transacciones_financieras','depositos')
--   order by tablename, cmd;
-- ============================================================================
