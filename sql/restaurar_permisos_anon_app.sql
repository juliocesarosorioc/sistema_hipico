-- ============================================================================
-- RESTAURAR PERMISOS OPERATIVOS A ANON Y AUTHENTICATED EN SUPABASE
-- ============================================================================
-- La aplicación web (SPA) opera conectándose con la llave pública (anon key)
-- de Supabase. Si se revoca SELECT a `anon`, el navegador recibe:
-- "ERROR 42501: permission denied for table clientes / tickets_apuestas"
-- y no puede cargar la información de grupos, clientes ni jugadas.
--
-- Ejecutar esta orden en el SQL Editor de Supabase para rehabilitar el acceso
-- inmediato a todas las tablas del sistema:
-- ============================================================================

GRANT USAGE ON SCHEMA public TO anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.clientes TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tickets_apuestas TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.remates TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.remate_caballos TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.remate_pujas TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dupletas TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pollas TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.polla_ventas TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notificaciones TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tickets_jugadas TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.solicitudes_tablas TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.transacciones_financieras TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.carreras TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.resultados_carreras TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tablas_fijas TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.grupos_venta TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clientes_grupos TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.usuario_sesion TO anon, authenticated;

-- Permisos sobre vistas operativas
GRANT SELECT ON public.v_jugadas_carrera TO anon, authenticated;

-- Permisos sobre secuencias numéricas (IDs autoincrementales de tickets)
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;

-- Notificar estado de ejecución exitosa
SELECT 'Permisos concedidos exitosamente a anon y authenticated para clientes, jugadas y tablas' AS resultado;
