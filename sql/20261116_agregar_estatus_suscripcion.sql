-- Migración: Campo estatus_suscripcion en grupos_venta y grupos para Monitor Global SaaS
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'grupos_venta' 
        AND column_name = 'estatus_suscripcion'
    ) THEN
        ALTER TABLE public.grupos_venta ADD COLUMN estatus_suscripcion TEXT DEFAULT 'al_dia';
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'grupos'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'grupos' 
        AND column_name = 'estatus_suscripcion'
    ) THEN
        ALTER TABLE public.grupos ADD COLUMN estatus_suscripcion TEXT DEFAULT 'al_dia';
    END IF;
END $$;
