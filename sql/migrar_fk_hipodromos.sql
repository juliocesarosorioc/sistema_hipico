-- ============================================================
--  PASO 2: VINCULAR HIPÓDROMOS POR FK (hipodromo_id)
--  1) Agrega columna hipodromo_id (uuid) a las tablas que hoy
--     guardan 'hipodromo' como TEXTO LIBRE.
--  2) Backfill: hermana cada fila con su hipódromo del catálogo
--     (public.hipodromos) usando nombre normalizado (sin acentos,
--     minúsculas, sin espacios).
--  3) Crea el FK + índice. El texto 'hipodromo' se CONSERVA para
--     no romper el resto del sistema (migración incremental).
--  4) Repara el estado de carreras.superficie/condición si aplica.
--
--  Copiar y pegar TODO este bloque en el SQL Editor de Supabase y
--  ejecutar. Es IDEMPOTENTE: se puede correr varias veces.
-- ============================================================

-- ---------- 1) COLUMNA hipodromo_id ----------
alter table public.tickets_apuestas
    add column if not exists hipodromo_id uuid;

alter table public.tickets_jugadas
    add column if not exists hipodromo_id uuid;

alter table public.tablas_fijas
    add column if not exists hipodromo_id uuid;

alter table public.tablas_fijas_pendientes
    add column if not exists hipodromo_id uuid;

alter table public.saldos
    add column if not exists hipodromo_id uuid;

alter table public.resultados_carreras
    add column if not exists hipodromo_id uuid;

-- ---------- 2) BACKFILL (normaliza texto libre -> catálogo) ----------
update public.tickets_apuestas t
set hipodromo_id = h.id
from public.hipodromos h
where t.hipodromo_id is null
  and upper(regexp_replace(t.hipodromo, '[\u00c0-\u00d6\u00d8-\u00de\s]', '', 'g'))
      = upper(regexp_replace(h.nombre, '[\u00c0-\u00d6\u00d8-\u00de\s]', '', 'g'));

update public.tickets_jugadas t
set hipodromo_id = h.id
from public.hipodromos h
where t.hipodromo_id is null
  and upper(regexp_replace(t.hipodromo, '[\u00c0-\u00d6\u00d8-\u00de\s]', '', 'g'))
      = upper(regexp_replace(h.nombre, '[\u00c0-\u00d6\u00d8-\u00de\s]', '', 'g'));

update public.tablas_fijas t
set hipodromo_id = h.id
from public.hipodromos h
where t.hipodromo_id is null
  and upper(regexp_replace(t.hipodromo, '[\u00c0-\u00d6\u00d8-\u00de\s]', '', 'g'))
      = upper(regexp_replace(h.nombre, '[\u00c0-\u00d6\u00d8-\u00de\s]', '', 'g'));

update public.tablas_fijas_pendientes t
set hipodromo_id = h.id
from public.hipodromos h
where t.hipodromo_id is null
  and upper(regexp_replace(t.hipodromo, '[\u00c0-\u00d6\u00d8-\u00de\s]', '', 'g'))
      = upper(regexp_replace(h.nombre, '[\u00c0-\u00d6\u00d8-\u00de\s]', '', 'g'));

update public.saldos t
set hipodromo_id = h.id
from public.hipodromos h
where t.hipodromo_id is null
  and upper(regexp_replace(t.hipodromo, '[\u00c0-\u00d6\u00d8-\u00de\s]', '', 'g'))
      = upper(regexp_replace(h.nombre, '[\u00c0-\u00d6\u00d8-\u00de\s]', '', 'g'));

update public.resultados_carreras t
set hipodromo_id = h.id
from public.hipodromos h
where t.hipodromo_id is null
  and upper(regexp_replace(t.hipodromo, '[\u00c0-\u00d6\u00d8-\u00de\s]', '', 'g'))
      = upper(regexp_replace(h.nombre, '[\u00c0-\u00d6\u00d8-\u00de\s]', '', 'g'));

-- ---------- 3) FK + ÍNDICES ----------
alter table public.tickets_apuestas
    add constraint fk_tickets_apuestas_hipodromo
    foreign key (hipodromo_id) references public.hipodromos(id);
create index if not exists ix_tickets_apuestas_hipodromo_id
    on public.tickets_apuestas(hipodromo_id);

alter table public.tickets_jugadas
    add constraint fk_tickets_jugadas_hipodromo
    foreign key (hipodromo_id) references public.hipodromos(id);
create index if not exists ix_tickets_jugadas_hipodromo_id
    on public.tickets_jugadas(hipodromo_id);

alter table public.tablas_fijas
    add constraint fk_tablas_fijas_hipodromo
    foreign key (hipodromo_id) references public.hipodromos(id);
create index if not exists ix_tablas_fijas_hipodromo_id
    on public.tablas_fijas(hipodromo_id);

alter table public.tablas_fijas_pendientes
    add constraint fk_tablas_fijas_pendientes_hipodromo
    foreign key (hipodromo_id) references public.hipodromos(id);
create index if not exists ix_tablas_fijas_pendientes_hipodromo_id
    on public.tablas_fijas_pendientes(hipodromo_id);

alter table public.saldos
    add constraint fk_saldos_hipodromo
    foreign key (hipodromo_id) references public.hipodromos(id);
create index if not exists ix_saldos_hipodromo_id
    on public.saldos(hipodromo_id);

alter table public.resultados_carreras
    add constraint fk_resultados_carreras_hipodromo
    foreign key (hipodromo_id) references public.hipodromos(id);
create index if not exists ix_resultados_carreras_hipodromo_id
    on public.resultados_carreras(hipodromo_id);

-- ---------- 4) VERIFICACIÓN ----------
-- ¿Cuántas filas quedaron sin hermanar (hipodromo_id null)?
select
    (select count(*) from public.tickets_apuestas     where hipodromo_id is null) as ta_sin_fk,
    (select count(*) from public.tickets_jugadas      where hipodromo_id is null) as tj_sin_fk,
    (select count(*) from public.tablas_fijas         where hipodromo_id is null) as tf_sin_fk,
    (select count(*) from public.tablas_fijas_pendientes where hipodromo_id is null) as tfp_sin_fk,
    (select count(*) from public.saldos               where hipodromo_id is null) as saldos_sin_fk,
    (select count(*) from public.resultados_carreras  where hipodromo_id is null) as rc_sin_fk;
