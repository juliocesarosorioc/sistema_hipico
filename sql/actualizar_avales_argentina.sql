-- ============================================================================
-- ARGENTINA — AVALES (límite de pérdida) Y MODO DE JUEGO DE LOS JUGADORES
-- ============================================================================
-- Ejecutar en Supabase -> SQL Editor.
--
-- Lista del dueño (grupo ARGENTINA):
--   · los que traen MONTO -> AVAL (límite de pérdida, USD) y modo "Con Aval";
--   · los que dicen "libre" -> modo "Libre" (sin aval / aval 0).
--
--   ARELY    +2.000,00      ARRAEZ   libre
--   AYARI    +2.000,00      BERSAREZ libre
--   CAMACHO  +500,00        BG       libre
--   LAMINE   +500,00        CHINO    libre
--   LARRY    +500,00        EDDIE    libre
--   RUCIO    +2.000,00      EVERY    libre
--   SOLDADO  +2.000,00      FORTUNA  libre
--                           GAETANO  libre
--                           LEYBA    libre
--                           MAKI     libre
--                           PARTNER  libre
--                           ROCA     libre
--                           RUSSO    libre
--                           SAM      libre
--                           SPEEDY   libre
--                           THOR     libre
--                           URIEL    libre
--
-- Es IDEMPOTENTE y NO destructivo:
--   · a quien YA está en ARGENTINA (por nombre, sin importar mayúsculas) le
--     actualiza `aval`, `modo_juego` y `libre`;
--   · a quien NO está lo da de alta en ARGENTINA con esos mismos valores.
-- No borra filas ni cambia ids: los tickets/jugadas que apuntan a un cliente
-- siguen enlazados a la misma fila. NO toca saldos ni otros grupos.
-- ============================================================================

begin;

-- 0) Asegurar el grupo de venta ARGENTINA ------------------------------------
insert into public.grupos_venta (nombre, moneda, es_principal, cupo_tabla, activo)
select 'ARGENTINA', 'USD', false, 100, true
where not exists (select 1 from public.grupos_venta where upper(nombre) = 'ARGENTINA');

-- 1) Actualizar aval / modo de juego de los que YA están en ARGENTINA --------
update public.clientes c
   set aval       = l.aval,
       modo_juego = l.modo,
       libre      = l.libre
  from (
    values
      ('ARELY',    2000.00, 'aval',  false),
      ('ARRAEZ',      0.00, 'libre', true),
      ('AYARI',    2000.00, 'aval',  false),
      ('BERSAREZ',    0.00, 'libre', true),
      ('BG',          0.00, 'libre', true),
      ('CAMACHO',   500.00, 'aval',  false),
      ('CHINO',       0.00, 'libre', true),
      ('EDDIE',       0.00, 'libre', true),
      ('EVERY',       0.00, 'libre', true),
      ('FORTUNA',     0.00, 'libre', true),
      ('GAETANO',     0.00, 'libre', true),
      ('LAMINE',    500.00, 'aval',  false),
      ('LARRY',     500.00, 'aval',  false),
      ('LEYBA',       0.00, 'libre', true),
      ('MAKI',        0.00, 'libre', true),
      ('PARTNER',     0.00, 'libre', true),
      ('ROCA',        0.00, 'libre', true),
      ('RUCIO',    2000.00, 'aval',  false),
      ('RUSSO',       0.00, 'libre', true),
      ('SAM',         0.00, 'libre', true),
      ('SOLDADO',  2000.00, 'aval',  false),
      ('SPEEDY',      0.00, 'libre', true),
      ('THOR',        0.00, 'libre', true),
      ('URIEL',       0.00, 'libre', true)
  ) as l(nombre, aval, modo, libre)
  where upper(c.nombre) = l.nombre
    and c.grupo_id = (select id from public.grupos_venta where upper(nombre) = 'ARGENTINA' limit 1);

-- 2) Dar de alta en ARGENTINA a los que todavía no están ---------------------
insert into public.clientes
  (nombre, libre, saldo_actual, aval, comision, modo_juego, mostrar_saldo_socio, es_socio, grupo_id)
select l.nombre, l.libre, 0.00, l.aval, 0.00, l.modo, false, false,
       (select id from public.grupos_venta where upper(nombre) = 'ARGENTINA' limit 1)
  from (
    values
      ('ARELY',    2000.00, 'aval',  false),
      ('ARRAEZ',      0.00, 'libre', true),
      ('AYARI',    2000.00, 'aval',  false),
      ('BERSAREZ',    0.00, 'libre', true),
      ('BG',          0.00, 'libre', true),
      ('CAMACHO',   500.00, 'aval',  false),
      ('CHINO',       0.00, 'libre', true),
      ('EDDIE',       0.00, 'libre', true),
      ('EVERY',       0.00, 'libre', true),
      ('FORTUNA',     0.00, 'libre', true),
      ('GAETANO',     0.00, 'libre', true),
      ('LAMINE',    500.00, 'aval',  false),
      ('LARRY',     500.00, 'aval',  false),
      ('LEYBA',       0.00, 'libre', true),
      ('MAKI',        0.00, 'libre', true),
      ('PARTNER',     0.00, 'libre', true),
      ('ROCA',        0.00, 'libre', true),
      ('RUCIO',    2000.00, 'aval',  false),
      ('RUSSO',       0.00, 'libre', true),
      ('SAM',         0.00, 'libre', true),
      ('SOLDADO',  2000.00, 'aval',  false),
      ('SPEEDY',      0.00, 'libre', true),
      ('THOR',        0.00, 'libre', true),
      ('URIEL',       0.00, 'libre', true)
  ) as l(nombre, aval, modo, libre)
  where not exists (
    select 1 from public.clientes c
     where upper(c.nombre) = l.nombre
       and c.grupo_id = (select id from public.grupos_venta where upper(nombre) = 'ARGENTINA' limit 1)
  );

commit;

-- ============================================================================
-- VERIFICACIÓN (opcional): cómo quedaron los 24 jugadores en ARGENTINA.
-- ============================================================================
-- select c.nombre, c.aval, c.modo_juego, c.libre, c.saldo_actual
--   from public.clientes c
--  where c.grupo_id = (select id from public.grupos_venta where upper(nombre) = 'ARGENTINA' limit 1)
--    and upper(c.nombre) in (
--      'ARELY','ARRAEZ','AYARI','BERSAREZ','BG','CAMACHO','CHINO','EDDIE',
--      'EVERY','FORTUNA','GAETANO','LAMINE','LARRY','LEYBA','MAKI','PARTNER',
--      'ROCA','RUCIO','RUSSO','SAM','SOLDADO','SPEEDY','THOR','URIEL'
--    )
--  order by c.nombre;
