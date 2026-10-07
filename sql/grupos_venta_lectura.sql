-- ============================================================================
-- grupos_venta + clientes_grupos: lectura para `anon` Y `authenticated`
-- ============================================================================
-- Que paso
-- ---------
-- La app corre con la llave `anon`, pero el login es REAL
-- (`src/lib/auth/sesion.ts` -> `signInWithPassword`). Una vez que hay sesion,
-- Supabase adjunta el JWT a cada consulta y PostgREST ejecuta el rol
-- `authenticated`, NO `anon`.
--
-- `grupos_venta` quedaba con HTTP 200 y 0 filas a pesar de tener 5 grupos en la
-- base. No era un error de la consulta: con RLS habilitado y sin policy que
-- deje pasar, Postgres filtra las filas y responde 200 con `[]`, asi que el
-- `catch` de la app nunca se disparaba. La primera version de este archivo
-- concedia lectura SOLO a `anon`, que es el rol equivocado con sesion iniciada.
--
-- Que arregla
-- -----------
-- Da lectura de `grupos_venta` y `clientes_grupos` a `anon` Y `authenticated`.
-- Ademas, hace ejecutables por `authenticated` las RPC de grupos del legacy
-- (`club_listar_grupos`, `club_guardar_grupo`, etc.), que en
-- `sql/paquete_pendientes.sql` se concedieron solo a `anon`: sin esto, el
-- fallback de `src/lib/grupos.ts` fallaba con permiso denegado para el rol real.
--
-- Que NO hace, a proposito
-- -----------------------
-- No se toca INSERT/UPDATE/DELETE de las tablas. El modulo /grupos es lo mas
-- cercano a una tabla maestra y escribirla desde el navegador no es asunto de
-- este arreglo. Ojo con `sql/multi_grupos.sql`: sus 4 policies usan
-- `using (true)` para escribir, o sea cualquiera con la llave publica podria
-- reasignar clientes de grupo. Ese archivo NO se debe aplicar tal cual.
--
-- Idempotente: se puede correr las veces que haga falta.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- grupos_venta
-- ---------------------------------------------------------------------------
alter table public.grupos_venta enable row level security;

grant usage on schema public to anon, authenticated;
grant select on public.grupos_venta to anon, authenticated;

drop policy if exists grupos_venta_select on public.grupos_venta;
create policy grupos_venta_select on public.grupos_venta
  for select to anon, authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- clientes_grupos: el puente de un cliente a VARIOS grupos.
-- Sin esto, `listarClientesVenta()` degrada a `grupo_id` principal y un cliente
-- en dos grupos aparece como si estuviera en uno solo.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.clientes_grupos') is not null then
    execute $q$alter table public.clientes_grupos enable row level security$q$;
    execute $q$grant select on public.clientes_grupos to anon, authenticated$q$;
    execute $q$drop policy if exists clientes_grupos_select_anon on public.clientes_grupos$q$;
    execute $q$create policy clientes_grupos_select_anon on public.clientes_grupos
              for select to anon, authenticated using (true)$q$;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- RPC de grupos del legacy: ejecutables por `authenticated`.
-- Se conceden SOLO las firmas que existan (idempotente y tolerante a que el
-- paquete aun no se haya aplicado en la base).
-- ---------------------------------------------------------------------------
do $$
declare
  firmas text[] := array[
    'public.club_listar_grupos()',
    'public.club_guardar_grupo(jsonb)',
    'public.club_actualizar_grupo(uuid, jsonb)',
    'public.club_toggle_grupo(uuid, boolean)',
    'public.club_eliminar_grupo(uuid)',
    'public.club_garantizar_grupo_principal()',
    'public.club_agregar_clientes_grupo(uuid[], uuid)',
    'public.club_quitar_clientes_grupo(uuid[], uuid)',
    'public.club_mover_clientes_grupo(uuid[], uuid)'
  ];
  f text;
begin
  for f in select unnest(firmas) loop
    if to_regprocedure(f) is not null then
      execute format('grant execute on function %s to authenticated', f);
    end if;
  end loop;
end
$$;

commit;
