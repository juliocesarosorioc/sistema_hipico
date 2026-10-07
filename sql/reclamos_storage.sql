-- ============================================================
--  RECLAMOS DEL PORTAL: IMÁGENES (Storage privado) + ESTADOS
-- ============================================================
--  Ejecutar en Supabase -> SQL Editor (una sola vez, es idempotente).
--
--  ⚠️ ESTA ES LA VERSIÓN CORRECTA. La anterior creaba el bucket `reclamos`
--  como PÚBLICO, le ponía políticas para `anon` y además hacía
--  `disable row level security` sobre `clientes` y `tickets_apuestas`
--  (dejando la cartera y las apuestas de todo el club legibles y
--  editables por cualquiera). NO EJECUTES LA VERSIÓN VIEJA.
--
--  Lo que se hace acá:
--   1) Bucket `reclamos` PRIVADO (sin policies para anon/authenticated).
--   2) Se borra cualquier policy de lectura/escritura que haya quedado sobre
--      ese bucket, y se fuerza a privado.
--   3) Se amplía el check de tickets_jugadas.estado para admitir RECHAZADO.
--   4) Se deja RLS ACTIVO en clientes/tickets_apuestas (nunca desactivar).
--
--  El flujo de subida y de lectura ya no usa este SQL desde el navegador:
--  la Edge Function `portal-auth` valida el token y firma una URL de subida
--  de un solo uso y una URL de lectura de 10 minutos. El navegador PUTea /
--  abre contra esas URLs. Por eso el bucket puede y DEBE ser privado.
-- ============================================================

-- 1) BUCKET PRIVADO -------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'reclamos',
    'reclamos',
    false,
    8388608, -- 8 MB, mismo tope que valida el portal antes de subir
    array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
    set public             = false,
        file_size_limit    = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

-- 2) QUITAR POLÍTICAS DE ESE BUCKET --------------------------------
-- Una imagen de reclamo muestra la apuesta del cliente: nada de lectura
-- abierta. Si quedó una policy vieja (p. ej. `reclamos_publico_lectura`),
-- se elimina; el acceso pasa solo por la URL firmada de la Edge Function.
do $$
declare
    pol record;
begin
    for pol in
        select schemaname, tablename, policyname
        from pg_policies
        where schemaname = 'storage'
          and tablename = 'objects'
          and policyname like '%reclamos%'
    loop
        execute format(
            'drop policy if exists %I on %I.%I',
            pol.policyname, pol.schemaname, pol.tablename
        );
        raise notice 'policy eliminada: %', pol.policyname;
    end loop;
end $$;

-- 3) AMPLIAR ESTADOS DE RECLAMO ------------------------------------
-- (el check original del paquete_pendientes permite solo
--  CREADO | EN_REVISION | SOLUCIONADO)
do $$
begin
    if exists (
        select 1 from pg_constraint
        where conrelid = 'public.tickets_jugadas'::regclass
          and conname = 'tickets_jugadas_estado_check'
    ) then
        alter table public.tickets_jugadas drop constraint tickets_jugadas_estado_check;
        alter table public.tickets_jugadas
            add constraint tickets_jugadas_estado_check
            check (estado in ('CREADO', 'EN_REVISION', 'SOLUCIONADO', 'RECHAZADO'));
    end if;
end $$;

-- 4) RLS ACTIVO EN LA CARTERA Y LAS APUESTAS -----------------------
-- La app escribe con RPC `security definer` (club_*), que salta RLS con
-- derecho. Desactivar el RLS aquí era lo que dejaba la base abierta.
alter table public.tickets_apuestas enable row level security;
alter table public.clientes        enable row level security;

-- VERIFICACION ------------------------------------------------------
-- Debe salir: reclamos | false | 8388608 | {image/png,...}
--   select id, public, file_size_limit, allowed_mime_types
--     from storage.buckets where id = 'reclamos';
--
-- Debe salir: 0 filas (el bucket no tiene policies para el público)
--   select policyname, roles from pg_policies
--    where schemaname = 'storage' and tablename = 'objects'
--      and policyname like '%reclamos%';
--
-- Debe salir: relrowsecurity = true en las dos
--   select relname, relrowsecurity from pg_class
--    where relname in ('clientes', 'tickets_apuestas');
