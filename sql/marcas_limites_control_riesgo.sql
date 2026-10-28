-- =============================================================================
-- MIGRACION: COLUMNA DE LIMITES Y RIESGO EN MARCAS_CARRERA
-- =============================================================================
-- Permite almacenar configuraciones de límites por grupo y de la plataforma,
-- ampliaciones autorizadas por el administrador y auditoría de topes por marca.
-- =============================================================================

alter table public.marcas_carrera 
  add column if not exists limites jsonb not null default '{}'::jsonb;

comment on column public.marcas_carrera.limites is 
  'Configuración de control de riesgo: límite general por marca, límite por grupo, ampliaciones autorizadas y auditoría de cupos.';
