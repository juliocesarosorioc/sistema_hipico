-- ============================================================================
-- REMATES — historial de pujas + incentivo porcentual
-- ============================================================================
-- Que arregla / que agrega
-- -----------------------
-- 1) `remate_pujas`: una fila por puja. Antes `remate_caballos` guardaba solo
--    el ULTIMO monto y el ultimo comprador: al subir una puja se perdia quien
--    la habia hecho antes y a que monto. Esta tabla es el historial.
--
-- 2) `remates.incentivo_pct`: el incentivo de la casa pasa a poder cargarse como
--    porcentaje del subtotal. Si el % es > 0, ese % del subtotal es el
--    incentivo y el monto fijo se ignora (`incentivoDe()` en core.ts).
--    El incentivo NO entra en la base de la comisión en ningun caso.
--
-- Que hace
-- --------
--   - Crea `remate_pujas` si no existe (instalacion limpia) y la completa con
--     `add column if not exists` en una base ya existente.
--   - Agrega las FK (remate_id, caballo_id, cliente_id) con guarda por nombre,
--     para que los embeds `remate_pujas?select=*,clientes(nombre),
--     remate_caballos(numero,nombre)` resuelvan.
--   - RLS permisiva para `anon` y `authenticated` (mismo patron que
--     sql/remates.sql).
--
-- Idempotente: se puede correr las veces que haga falta.
-- Ejecutar en el SQL Editor de Supabase (SQL puro, sin metacomandos).
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) Tabla de historial
-- ---------------------------------------------------------------------------
create table if not exists public.remate_pujas (
  id          uuid primary key default gen_random_uuid(),
  remate_id   uuid references public.remates(id) on delete cascade,
  caballo_id  uuid references public.remate_caballos(id) on delete cascade,
  monto_usd   numeric default 0,
  cliente_id  uuid references public.clientes(id),
  created_at  timestamptz default now()
);

alter table public.remate_pujas add column if not exists remate_id   uuid;
alter table public.remate_pujas add column if not exists caballo_id  uuid;
alter table public.remate_pujas add column if not exists monto_usd   numeric default 0;
alter table public.remate_pujas add column if not exists cliente_id  uuid;
alter table public.remate_pujas add column if not exists created_at  timestamptz default now();

alter table public.remate_pujas alter column id set default gen_random_uuid();
alter table public.remate_pujas alter column monto_usd set default 0;

-- Incentivo como porcentaje del subtotal (0 = manda el monto fijo).
alter table public.remates          add column if not exists incentivo_pct numeric default 0;
alter table public.remates          alter column incentivo_pct set default 0;

-- Escalera de pujas EDITABLE por remate. Antes la regla de la casa vivia
-- hardcodeada en ESCALONES_PUJA (src/lib/remates/core.ts) y nadie podía
-- cambiarla sin tocar código y desplegar. Aqui se guarda por remate:
--   escalera     jsonb  [{ desde, hasta, incremento }]  (hasta null = abierto)
--   nota_escalera text   observación que explica la escalera en palabras
-- La app cae en ESCALONES_PUJA si la columna todavia no esta aplicada, asi que
-- esto no rompe a quien aun no lo corrió.
alter table public.remates          add column if not exists escalera     jsonb;
alter table public.remates          add column if not exists nota_escalera text;

-- Estado de la subasta. 'Abierto' / 'Cerrado'. Cuando esta Cerrado el modulo
-- Remates no deja ni subir pujas ni abrir pujas nuevas: se sigue pudiendo leer
-- y un administrador puede reabrirlo (y editarlo) desde la misma pantalla.
create index if not exists remates_estado_idx on public.remates (estado);

-- ---------------------------------------------------------------------------
-- 2) Claves foraneas (guarda por nombre = idempotente)
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'remate_pujas_remate_id_fkey') then
    alter table public.remate_pujas
      add constraint remate_pujas_remate_id_fkey
      foreign key (remate_id) references public.remates(id) on delete cascade;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'remate_pujas_caballo_id_fkey') then
    alter table public.remate_pujas
      add constraint remate_pujas_caballo_id_fkey
      foreign key (caballo_id) references public.remate_caballos(id) on delete cascade;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'remate_pujas_cliente_id_fkey') then
    alter table public.remate_pujas
      add constraint remate_pujas_cliente_id_fkey
      foreign key (cliente_id) references public.clientes(id);
  end if;
end
$$;

create index if not exists remate_pujas_remate_id_idx on public.remate_pujas (remate_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 3) RLS + grants
--    `remate_pujas`: SOLO LECTURA para authenticated; escribe via RPC.
-- ---------------------------------------------------------------------------
alter table public.remate_pujas enable row level security;

grant usage on schema public to anon, authenticated;

-- `remate_pujas` es SOLO LECTURA para el navegador. El historial lo insertan las
-- RPC `security definer` de sql/remate_pujas_rpc.sql; ninguna escritura directa
-- desde anon/authenticated es legitima.
drop policy if exists remate_pujas_publico on public.remate_pujas;
drop policy if exists remate_pujas_lectura on public.remate_pujas;
create policy remate_pujas_lectura on public.remate_pujas
  for select to authenticated
  using (true);

grant select on public.remate_pujas to authenticated, service_role;
revoke select on public.remate_pujas from anon;
revoke insert, update, delete on public.remate_pujas from anon, authenticated;
grant insert, update, delete on public.remate_pujas to service_role;

commit;