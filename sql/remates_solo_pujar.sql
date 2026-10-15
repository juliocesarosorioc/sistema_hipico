-- ===========================================================================
-- REMATES · VISIBILIDAD PARA USUARIOS + PUJA CON EL BOTON "SUBIR"
-- ===========================================================================
--
-- 1) `usuario_sistema.cliente_id` liga a cada usuario del sistema con la fila
--    de `clientes` que representa. Es la identidad del pujador: un usuario
--    habilitado solo para VER los remates no elige comprador en la pizarra,
--    puja SIEMPRE con ese cliente.
--
-- 2) Capacidad nueva `remates:fn_pujar`: el permiso MINIMO de la pizarra.
--    Alcanza para subir una puja con el boton Subir. Se le habilita a mano,
--    por usuario, en Seguridad > Personalizar usuario. NO se le da por defecto
--    a nadie: quien ya pujaba (los tipos que tienen `fn_asignar_caballos`) lo
--    hereda abajo para que nadie pierda la puja que tenia.
--
-- 3) La RPC `club_pujar_caballo_remate` pasa a exigir `fn_pujar` (y que el
--    cliente de la puja sea el VINCULADO al usuario cuando no administra).
--    Ese cambio vive en `sql/remate_pujas_rpc.sql`: APLICAR ESE ARCHIVO TAMBIEN.
--
-- Verificar antes de aplicar:
--   select data_type from information_schema.columns
--    where table_schema='public' and table_name='usuario_sistema'
--      and column_name='cliente_id';
-- ===========================================================================

begin;

-- ------------------------------------------------- 1) cliente del usuario
alter table public.usuario_sistema
  add column if not exists cliente_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'usuario_sistema_cliente_id_fkey'
  ) then
    alter table public.usuario_sistema
      add constraint usuario_sistema_cliente_id_fkey
      foreign key (cliente_id) references public.clientes (id)
      on delete set null;
  end if;
end $$;

-- Un usuario con un solo cliente asignado (nunca dos usuarios sobre el mismo).
create unique index if not exists usuario_sistema_cliente_id_uq
  on public.usuario_sistema (cliente_id) where cliente_id is not null;

comment on column public.usuario_sistema.cliente_id is
  'Cliente de `clientes` que representa este usuario. En Remates es con el que pujan los usuarios habilitados solo para ver/pujar.';

-- ------------------------------------------------------- 2) la capacidad
insert into public.capacidad (clave, modulo, tipo, titulo, riesgo, fuente)
values (
  'remates:fn_pujar',
  'remates',
  'funcion',
  'Pujar con el botón Subir',
  'escritura',
  'src/lib/remates.ts'
)
on conflict (clave) do nothing;

-- ------------------------------------------------ 3) nadie pierde su puja
-- Los tipos que ya podian pujar (tenian `fn_asignar_caballos`) reciben
-- `fn_pujar` para que el cambio de permiso no les cierre la pizarra. Los tipos
-- de solo consulta NO lo reciben: a ellos se les habilita por usuario.
insert into public.tipo_usuario_capacidad (tipo_usuario_id, capacidad_id, decision)
select t.tipo_usuario_id, c.id, 'permitido'
  from public.tipo_usuario_capacidad t
  join public.capacidad c on c.clave = 'remates:fn_asignar_caballos'
 where t.decision = 'permitido'
   and not exists (
     select 1 from public.tipo_usuario_capacidad x
      where x.tipo_usuario_id = t.tipo_usuario_id
        and x.capacidad_id = c.id
   );

-- Mismo criterio, pero por la BASE generica del tipo (cuando la matriz del tipo
-- esta vacia y manda `baseDeTipo`): ahi no hay fila que copiar, y el codigo cae
-- a la base de `resolver.ts`, que no incluye `fn_pujar`. Se deja registrado solo
-- cuando si hay matriz cargada; si no, el principal y las excepciones individuales
-- se encargan.
commit;

-- ===========================================================================
-- APLICAR TAMBIEN (obligatorio, si no la puja rebota con "Sin permiso"):
--   sql/remate_pujas_rpc.sql
--
-- LUEGO, en Seguridad > Personalizar usuario, habilitar por usuario:
--   · remates:ruta_remates   → puede ver la pantalla /remates
--   · remates:fn_pujar       → puede pujar con el boton Subir
--   · remates:fn_guardar_remate (y demas fn_*) → administra el remate
-- y cargarle el cliente vinculado (columna cliente_id de usuario_sistema).
-- ===========================================================================
