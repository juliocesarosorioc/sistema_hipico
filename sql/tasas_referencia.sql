-- ============================================================
--  REGISTRO DE TASAS DE REFERENCIA CON FECHA DE APLICACION
-- ============================================================
--  Ejecutar en Supabase -> SQL Editor (una sola vez).
--  Guarda el historial de tasas del dolar BCV, Binance y Euro
--  con la FECHA en la que cada una debe tomarse.
--  Ej: cargas la tasa del dia 05 => se registra con fecha 05.
--  Al dia siguiente se registra la nueva y la anterior NO se toca.
-- ============================================================

create table if not exists public.tasas_referencia (
    id             uuid primary key default gen_random_uuid(),
    tipo           text not null,             -- 'BCV' | 'BINANCE' | 'EURO'
    tasa           numeric not null,          -- Bs por 1 unidad (USD para BCV/BINANCE, EUR para EURO)
    fecha_aplicar  date not null,             -- fecha en que debe tomarse esa tasa
    created_at     timestamptz not null default now()
);

-- Indice para buscar rapido "tasa de X tipo hasta Y fecha"
create index if not exists idx_tasas_ref_tipo_fecha
    on public.tasas_referencia (tipo, fecha_aplicar desc);

-- Comentario util
comment on table public.tasas_referencia is
    'Historial de tasas de referencia: BCV, Binance y EURO con su fecha de aplicacion. Inmutable: cada carga nueva agrega un registro.';

-- VERIFICACION -------------------------------------------------
-- select tipo, tasa, fecha_aplicar from public.tasas_referencia order by tipo, fecha_aplicar desc;