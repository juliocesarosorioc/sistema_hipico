-- ===========================================================================
-- CLIENTES: MÚLTIPLES FORMAS DE PAGO              (PROMPT #7 — ítem 3)
-- ===========================================================================
-- QUE RESUELVE
-- Hasta ahora un cliente tenía UNA forma de pago: `metodo_pago` + `datos_pago`
-- (dos columnas). El alta y la edición (ModalCliente / ModalEditarCliente) y
-- la ficha del portal ahora permiten VARIAS a la vez —Pago Móvil,
-- Transferencia, Zelle, Binance/USDT, Efectivo, un banco…— cada una con sus
-- datos (banco, teléfono/correo, cédula/RIF, titular), su moneda y una sola
-- marcada como ⭐ Principal.
--
-- DÓNDE VIVE LA LISTA
-- En la columna nueva `clientes.formas_pago`, jsonb:
--
--   [
--     { "metodo": "PAGO MÓVIL", "moneda": "VES", "principal": true,
--       "datos": { "codigo": "0134", "nombre": "BANESCO",
--                  "tipo_cuenta": "CORRIENTE", "numero_cuenta": "01340000000000000000",
--                  "telefono": "4121234567", "titular": "JUAN PEREZ" } },
--     { "metodo": "ZELLE", "moneda": "USD", "principal": false,
--       "datos": { "tipo_contacto": "correo", "dato": "juan@correo.com",
--                  "titular": "JUAN PEREZ" } }
--   ]
--
-- COMPATIBILIDAD HACIA ATRÁS (lo que hace que esto sea seguro de aplicar)
--   · `metodo_pago` y `datos_pago` SIGUEN EXISTIENDO y se escriben a la vez,
--     con la forma ⭐ Principal. Todo lo que todavía lee UNA sola forma (la
--     columna "Método de Pago" del Cuadre Semanal, tickets, notificaciones,
--     el legacy) sigue funcionando sin cambios.
--   · Las filas leídas antes de la migración (sin la columna) se comportan
--     igual: `formasPagoDe()` cae al par legacy cuando `formas_pago` está
--     vacío. No hay backfill y no hace falta: la fuente de verdad de las
--     filas viejas sigue siendo ese par.
--   · Si algún día hay que volver atrás, basta con dejar de escribir la
--     columna: los datos ya quedaron reflejados en las dos columnas viejas.
--
-- QUIÉN ESCRIBE LA LISTA
--   · ModalCliente / ModalEditarCliente (personal, sesión Auth).
--   · La acción `perfil` de la Edge Function `portal-auth`, para que el
--     cliente edite sus propias formas de cobro desde "👤 Mi Perfil". Esa
--     acción aplica una lista blanca de columnas; saldo, comisión, aval y
--     credenciales no están en ella.
--
-- IDEMPOTENCIA. Aplicarlo varias veces no cambia nada.
-- Ejecutar en el SQL Editor de Supabase.
-- ===========================================================================

begin;

alter table public.clientes add column if not exists formas_pago jsonb;

comment on column public.clientes.formas_pago is
  'Array jsonb de formas de pago del cliente (PROMPT #7): '
  '[{ metodo, moneda, principal, datos }]. Exactamente una con principal=true. '
  'Las columnas metodo_pago/datos_pago se mantienen espejadas con la principal '
  'por compatibilidad con los lectores de una sola forma.';

commit;

-- ===========================================================================
-- VERIFICACIÓN
-- 1) La columna existe (debe devolver una fila con jsonb):
--      SELECT column_name, data_type
--        FROM information_schema.columns
--       WHERE table_schema = 'public' AND table_name = 'clientes'
--         AND column_name = 'formas_pago';
-- 2) Estado actual de la cartera (las viejas siguen con el par legacy y las
--    nuevas con el arreglo; ambas se leen igual desde la app):
--      SELECT id, seudonimo, metodo_pago, formas_pago
--        FROM public.clientes
--       ORDER BY id DESC
--       LIMIT 20;
-- 3) Clientes con más de una forma de pago:
--      SELECT id, seudonimo, jsonb_array_length(formas_pago) AS formas
--        FROM public.clientes
--       WHERE formas_pago IS NOT NULL AND jsonb_array_length(formas_pago) > 1;
-- ===========================================================================
