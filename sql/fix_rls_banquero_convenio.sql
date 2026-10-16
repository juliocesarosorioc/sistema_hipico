-- ============================================================================
-- FIX: "new row violates row-level security policy for table banquero_convenio"
-- ============================================================================
-- QUÉ PASA
-- --------
-- Al guardar un banquero desde Grupos de Venta y Convenios (guardarBanquero →
-- upsert sobre `banquero_convenio`) Postgres devuelve:
--
--     new row violates row-level security policy for table "banquero_convenio"
--
-- Ese texto solo puede venir de la BASE: la tabla tiene RLS ENCENDIDO pero no
-- tiene ninguna policy que permita escribir. El guard del navegador
-- (exigirCapacidad("grupos:fn_guardar_grupo")) ya pasó — si no, el error sería
-- el mensaje en castellano del propio guard, no el de Postgres.
--
-- CÓMO SE ARREGLA
-- ---------------
-- Se alinea `banquero_convenio` con el resto del personal en rls-negocio.sql:
-- RLS encendido + una policy que deja LEER al personal y exige la MISMA
-- capacidad que ya exige el navegador para ESCRIBIR. `public.tiene_capacidad`
-- devuelve true para el super administrador, así que josorioc sigue operando.
--
-- Por qué no se apaga el RLS: `banqueros.sql` lo apagaba (y además le daba
-- `grant all` a `anon`), pero esa postura quedó vieja — rls-negocio.sql ya
-- cerró `anon` para las tablas de negocio. Apagarlo otra vez dejaría el
-- convenio (que mueve comisiones y el espejo del banquero) legible y escribible
-- por cualquiera con la llave anon, que viaja en el bundle.
--
-- NOTA: los triggers que leen el convenio al vender (club_fijar_banquero_ticket)
-- corren `security definer`, así que NO los afecta esta RLS.
--
-- Idempotente. Ejecutar en el SQL Editor de Supabase.
-- ============================================================================

do $$
begin
  if to_regclass('public.banquero_convenio') is null then
    raise exception 'No existe public.banquero_convenio. Aplicá sql/banqueros.sql primero.';
  end if;
end
$$;

-- 1) PERMISOS — el personal (authenticated) opera; anon no ve nada.
revoke all on table public.banquero_convenio from anon;
grant all privileges on table public.banquero_convenio to authenticated, service_role;

-- 2) RLS encendido (idempotente).
alter table public.banquero_convenio enable row level security;

-- 3) POLICY — mismo patrón que «personal opera clientes» (rls-negocio.sql):
--    lectura abierta al personal; escritura atada a la capacidad que ya exige
--    el navegador. Es una sola policy `for all`, así que USING cubre
--    SELECT/UPDATE/DELETE y WITH CHECK cubre INSERT/UPDATE.
--
--    Si todavía no existe la matriz de seguridad (`tiene_capacidad`) se abre la
--    escritura al personal autenticado para no dejar la tabla inutilizable; el
--    aviso recuerda volver a correr este fix tras aplicar seguridad_maestro.sql.
drop policy if exists "personal opera banquero convenio" on public.banquero_convenio;

do $$
begin
  if to_regprocedure('public.tiene_capacidad(uuid,text)') is not null then
    execute 'create policy "personal opera banquero convenio" on public.banquero_convenio '
         || 'for all to authenticated using (true) '
         || 'with check (public.tiene_capacidad(auth.uid(), ''grupos:fn_guardar_grupo''))';
  else
    execute 'create policy "personal opera banquero convenio" on public.banquero_convenio '
         || 'for all to authenticated using (true) with check (true)';
    raise warning 'tiene_capacidad() no existe: la escritura queda abierta al personal autenticado. Aplicá src/core/db/seguridad_maestro.sql y volvé a correr este fix.';
  end if;
end
$$;

-- 4) VERIFICACIÓN — debe listar una policy (cmd = ALL, roles = {authenticated}).
select policyname, cmd, roles
  from pg_policies
 where schemaname = 'public'
   and tablename  = 'banquero_convenio';
