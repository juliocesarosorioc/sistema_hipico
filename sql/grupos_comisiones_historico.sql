-- ============================================================================
-- HISTORIAL DE COMISIONES POR GRUPO
-- ============================================================================
-- Guarda los cambios de comision_default de grupos_venta para que cada cambio
-- tenga una fecha de vigencia (a partir de cuándo aplica). Esto evita que un
-- ajuste retroactivo afecte liquidaciones ya realizadas y permite aplicar el
-- porcentaje correcto por fecha de la jugada (taquilla/jugadas entre tercios).
-- ============================================================================
create table if not exists public.grupos_comisiones_historico (
  id                bigserial primary key,
  grupo_id          uuid not null references public.grupos_venta(id) on delete cascade,
  comision_default  numeric(5,2) not null check (comision_default >= 0 and comision_default <= 100),
  fecha_vigencia    date not null,
  creado_por        text,
  nota              text,
  created_at        timestamptz not null default now(),
  unique (grupo_id, fecha_vigencia)
);

create index if not exists idx_gch_grupo_fecha on public.grupos_comisiones_historico (grupo_id, fecha_vigencia desc);
create index if not exists idx_gch_fecha on public.grupos_comisiones_historico (fecha_vigencia);

grant select, insert, update, delete on public.grupos_comisiones_historico to authenticated;
grant select, insert, update, delete on public.grupos_comisiones_historico to service_role;
grant usage, select on sequence public.grupos_comisiones_historico_id_seq to authenticated;
grant usage, select on sequence public.grupos_comisiones_historico_id_seq to service_role;

alter table public.grupos_comisiones_historico enable row level security;

drop policy if exists gch_todos on public.grupos_comisiones_historico;
create policy gch_todos on public.grupos_comisiones_historico
  for all to authenticated
  using (true)
  with check (true);

-- Mantener una entrada inicial al crear grupo (opcional): se puede poblar desde app
-- Función para obtener comisión vigente por grupo y fecha
create or replace function public.comision_vigente_grupo(
  p_grupo_id uuid,
  p_fecha    date
)
returns numeric
language sql
stable
as $$
  select coalesce(
    (select comision_default
       from public.grupos_comisiones_historico
      where grupo_id = p_grupo_id
        and fecha_vigencia <= p_fecha
      order by fecha_vigencia desc, id desc
      limit 1),
    (select comision_default from public.grupos_venta where id = p_grupo_id),
    5.00
  );
$$;

grant execute on function public.comision_vigente_grupo(uuid, date) to anon, authenticated, service_role;
