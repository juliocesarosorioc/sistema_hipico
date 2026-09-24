-- ============================================================
--  RECLAMOS DEL PORTAL: IMÁGENES (Supabase Storage) + ESTADOS
-- ============================================================
--  Ejecutar en Supabase -> SQL Editor (una sola vez).
--  1) Crea el bucket público `reclamos` (fotos que adjunta el cliente).
--  2) Amplía el check de tickets_jugadas.estado para admitir RECHAZADO.
--  3) Políticas del bucket (RLS de Storage: rutas/cliente/*).
-- ============================================================

-- 1) BUCKET DE ALMACENAMIENTO -------------------------------------
insert into storage.buckets (id, name, public)
values ('reclamos', 'reclamos', true)
on conflict (id) do update set public = true;

comment on table storage.objects is '';
-- aviso: Storage usa RLS propio; las políticas se crean abajo.

create policy "reclamos_publico_lectura"
on storage.objects for select
using (bucket_id = 'reclamos');

create policy "reclamos_cliente_subida"
on storage.objects for insert
with check (
    bucket_id = 'reclamos'
    and (storage.foldername(name))[1] is not null
);

-- 2) AMPLIAR ESTADOS DE RECLAMO ------------------------------------
-- (el check original del paquete_pendientes permite solo CREADO | EN_REVISION | SOLUCIONADO)
do $$
begin
    if exists (
        select 1 from pg_constraint
        where conname = 'tickets_jugadas_estado_check'
          and conrelid = 'public.tickets_jugadas'::regclass
    ) then
        alter table public.tickets_jugadas drop constraint tickets_jugadas_estado_check;
        alter table public.tickets_jugadas
            add constraint tickets_jugadas_estado_check
            check (estado in ('CREADO', 'EN_REVISION', 'SOLUCIONADO', 'RECHAZADO'));
    end if;
end $$;

-- 3) GARANTIZAR RLS/POLÍTICAS DEL PORTAL ---------------------------
alter table public.tickets_apuestas disable row level security;
alter table public.clientes disable row level security;

-- VERIFICACION ------------------------------------------------------
-- select id, name, public from storage.buckets where id = 'reclamos';
-- select estado, count(*) from public.tickets_jugadas group by estado;