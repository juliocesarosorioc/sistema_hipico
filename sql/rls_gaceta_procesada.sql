-- ============================================================================
-- RLS para public.gaceta_procesada
-- Ejecutar en Supabase SQL Editor (idempotente)
-- Corrige: "new row violates row-level security policy for table \"gaceta_procesada\""
-- ============================================================================

-- 1) Habilitar RLS (por si quedó deshabilitado)
alter table public.gaceta_procesada enable row level security;

-- 2) Revocar anon (denegado por omisión)
revoke all on public.gaceta_procesada from anon;

-- 3) Conceder a authenticated
grant select, insert, update, delete on public.gaceta_procesada to authenticated;

-- 4) SELECT
drop policy if exists "personal lee gaceta_procesada" on public.gaceta_procesada;
create policy "personal lee gaceta_procesada" on public.gaceta_procesada
  for select
  to authenticated
  using (true);

-- 5) INSERT (Gaceta IA / extracción de carreras)
drop policy if exists "personal inserta gaceta_procesada" on public.gaceta_procesada;
create policy "personal inserta gaceta_procesada" on public.gaceta_procesada
  for insert
  to authenticated
  with check (
    public.soy_principal(auth.uid())
    or public.tiene_capacidad(auth.uid(), 'ejemplares:fn_guardar_gaceta')
  );

-- 6) UPDATE (reprocesos/ajustes)
drop policy if exists "personal actualiza gaceta_procesada" on public.gaceta_procesada;
create policy "personal actualiza gaceta_procesada" on public.gaceta_procesada
  for update
  to authenticated
  using (
    public.soy_principal(auth.uid())
    or public.tiene_capacidad(auth.uid(), 'ejemplares:fn_guardar_gaceta')
  )
  with check (
    public.soy_principal(auth.uid())
    or public.tiene_capacidad(auth.uid(), 'ejemplares:fn_guardar_gaceta')
  );

-- 7) DELETE (limpieza controlada)
drop policy if exists "personal elimina gaceta_procesada" on public.gaceta_procesada;
create policy "personal elimina gaceta_procesada" on public.gaceta_procesada
  for delete
  to authenticated
  using (
    public.soy_principal(auth.uid())
    or public.tiene_capacidad(auth.uid(), 'ejemplares:fn_guardar_gaceta')
  );