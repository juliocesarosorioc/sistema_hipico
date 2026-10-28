-- ============================================================================
-- OPERADORES POR GRUPO — ACCESO CELULAR Y CONTRASEÑA
-- ============================================================================
-- Agrega columna `clave_acceso` en public.usuario_sistema para permitir
-- gestionar la contraseña de acceso celular de los operadores asignados a cada
-- grupo directamente desde el modal de grupos.

alter table public.usuario_sistema
  add column if not exists clave_acceso text;

comment on column public.usuario_sistema.clave_acceso is
  'Contraseña de acceso celular para operadores asignados al grupo de venta.';
