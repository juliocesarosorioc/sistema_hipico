-- ============================================================
-- Comisiones jerárquicas por cliente
-- Si clientes.comision_personalizada es NULL -> se usa la
-- comision DEFAULT del tipo de jugada (PREMIO/COMBINADA/NINI/PUESTO).
-- Si tiene valor -> esa tasa anula la default al procesar.
-- ============================================================
alter table public.clientes
    add column if not exists comision_personalizada numeric;

comment on column public.clientes.comision_personalizada is
    'Tasa de comision jerarquica por cliente. NULL = usar default por tipo de jugada.';