-- ============================================================================
-- RETIRAR `public.operadores` — la tabla de contraseñas en texto plano.
-- Ejecutar en el SQL Editor de Supabase. Idempotente.
--
-- ----------------------------------------------------------------------------
-- POR QUÉ
-- ----------------------------------------------------------------------------
-- El login legacy (html/index.html + js/) comparaba la contraseña que escribía
-- el operador contra el valor en claro de `operadores.password`. Esa tabla quedó
-- viva, y la llave ANON —que va incrustada en el bundle de JavaScript, o sea
-- que no es secreta: se lee abriendo devtools— podía leerla entera. Tres
-- cuentas del negocio, con su contraseña al aire, accesibles sin credenciales.
--
-- El código nuevo (src/) no consulta `operadores` en ningún lado: el login es
-- contra Supabase Auth. La tabla ya no tiene consumidor. Sigue siendo la razón
-- más barata de que alguien entre al sistema.
--
-- ----------------------------------------------------------------------------
-- QUÉ HACE ESTE ARCHIVO
-- ----------------------------------------------------------------------------
-- 1. Le quita el acceso a `anon`. Con RLS encendido y NINGUNA policy que lo
--    mencione, el rol no autenticado no lee ni escribe: se lo deniega por
--    omisión. No hace falta una policy que diga "denegar"; lo que hace falta es
--    no abrir ninguna.
-- 2. Revoca los permisos de `anon` a nivel de tabla, que es la mitad que
--    suele olvidarse: aunque la policy esté bien, un GRANT residual deja
--    pasar la lectura.
-- 3. NO borra la tabla. Romperla es decisión del dueño, no de este script, y
--    acá no hay forma de saber si algún reporte, export o copia de respaldo la
--    usa todavía.
--
-- ----------------------------------------------------------------------------
-- LO QUE HAY QUE HACER ANTES DE CORRER ESTO
-- ----------------------------------------------------------------------------
-- Rotar las contraseñas. Bloquear la lectura con este archivo frena la
-- exposición a partir de ahora; no deshace el hecho de que las contraseñas
-- migrar: cualquiera que ya las copió las sigue teniendo. El orden correcto es:
-- cambiar la clave, y recién después cerrar la puerta.
-- ============================================================================

-- 1) Sin acceso para anon, por RLS...
alter table public.operadores enable row level security;

-- ...y explícitamente, sin ninguna policy para anon a propósito. No hay que
-- escribir "create policy ... using (false)": la ausencia de policy ya es el
-- deny. Escribirla además serviría solo para que alguien la lea creyendo que
-- hay un candado donde en realidad lo hay por omisión.

-- 2) ...y por permisos de tabla, que es lo que sobrevive a un RLS mal hecho.
revoke all on public.operadores from anon;
revoke all on public.operadores from authenticated;
-- El dueño de la tabla conserva todo: esto no le hace nada a las consultas que
-- se corran desde el SQL Editor ni desde un service_role.

-- 3) Que quede escrito qué se encontró acá, para el que llegue después.
comment on table public.operadores is
  'RETIRADA. Contenia las contrasenas del negocio en TEXTO PLANO, legibles con la llave anon. El login actual va contra Supabase Auth y no consulta esta tabla. Las contrasenas de estas filas deben rotarse: bloquear la tabla no las borra de donde ya se copiaron. DROP TABLE cuando se confirme que ningun reporte ni export la usa.';

-- ============================================================================
-- DESPUÉS, cuando el dueño confirme que no hace falta:
--
--   drop table if exists public.operadores;
--
-- Y en Supabase > Authentication > Users, rotar las cuentas que vivían fuera
-- de este sistema.
-- ============================================================================
