-- Archivo: sql/blindaje_seguridad_produccion.sql
BEGIN;

-- 1. Forzar RLS en absolutamente todas las tablas operativas y financieras
ALTER TABLE IF EXISTS public.usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.grupos ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.carreras ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.ejemplares ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.jugadas ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.tablas_fijas ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.remates ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.pollas ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.dupletas ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.movimientos_contables ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.auditoria ENABLE ROW LEVEL SECURITY;

-- 2. Trigger Anti-Escalada de Privilegios: Ningún usuario no-superadmin puede autoelevase el rol
CREATE OR REPLACE FUNCTION public.proteger_cambio_rol_usuario()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (NEW.rol IS DISTINCT FROM OLD.rol OR NEW.es_superadmin IS DISTINCT FROM OLD.es_superadmin) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.usuarios
      WHERE id = auth.uid() AND (rol ILIKE '%SuperAdmin%' OR es_superadmin = true)
    ) THEN
      RAISE EXCEPTION 'VIOLACIÓN DE SEGURIDAD: No tiene autorización para alterar roles ni privilegios.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_proteger_cambio_rol ON public.usuarios;
CREATE TRIGGER trg_proteger_cambio_rol
BEFORE UPDATE ON public.usuarios
FOR EACH ROW
EXECUTE FUNCTION public.proteger_cambio_rol_usuario();

-- 3. Inmutabilidad de la tabla de Auditoría (Nadie puede borrar ni editar trazas)
DROP POLICY IF EXISTS "auditoria_no_delete" ON public.auditoria;
CREATE POLICY "auditoria_no_delete" ON public.auditoria FOR DELETE USING (false);

DROP POLICY IF EXISTS "auditoria_no_update" ON public.auditoria;
CREATE POLICY "auditoria_no_update" ON public.auditoria FOR UPDATE USING (false);

COMMIT;