-- ============================================================================
-- RESTAURACIÓN TOTAL DE ACCESO A REPORTES, JUGADAS, SALDOS Y TABLAS FIJAS
-- ============================================================================
-- Este script soluciona los 3 bloqueos reportados:
-- 1. "permission denied for function puede_ver_principal" en tickets_apuestas (401)
-- 2. "permission denied for table depositos" en saldos semanales (401)
-- 3. Carga y visualización de jugadas y tablas fijas en todos los reportes
--
-- Ejecutar TODO este bloque en el SQL Editor de Supabase:
-- ============================================================================

-- 1. Conceder uso del esquema público
GRANT USAGE ON SCHEMA public TO anon, authenticated;

-- 2. Conceder permisos sobre todas las tablas y secuencias
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated;

-- 3. Conceder ejecución explícita sobre funciones de verificación y visibilidad
DO $$
BEGIN
  IF to_regproc('public.puede_ver_principal(uuid)') IS NOT NULL THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.puede_ver_principal(uuid) TO anon, authenticated, public';
  END IF;
  IF to_regproc('public.usuario_en_grupo(uuid, text)') IS NOT NULL THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.usuario_en_grupo(uuid, text) TO anon, authenticated, public';
  END IF;
  IF to_regproc('public.usuario_en_cliente(uuid, text)') IS NOT NULL THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.usuario_en_cliente(uuid, text) TO anon, authenticated, public';
  END IF;
  IF to_regproc('public.grupo_del_usuario(uuid)') IS NOT NULL THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.grupo_del_usuario(uuid) TO anon, authenticated, public';
  END IF;
  IF to_regproc('public.ve_todos_los_grupos(uuid)') IS NOT NULL THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.ve_todos_los_grupos(uuid) TO anon, authenticated, public';
  END IF;
END $$;

-- 4. Habilitar política de lectura universal para la app en tickets_apuestas (elimina el 401)
DROP POLICY IF EXISTS tickets_apuestas_anon_read ON public.tickets_apuestas;
CREATE POLICY tickets_apuestas_anon_read ON public.tickets_apuestas
  FOR SELECT TO anon, authenticated USING (true);

-- 5. Habilitar política en depositos (elimina el error de saldo semanal de movimientos)
DROP POLICY IF EXISTS depositos_anon_all ON public.depositos;
CREATE POLICY depositos_anon_all ON public.depositos
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- 6. Habilitar políticas en tablas fijas, grupos y auditoría
DO $$
BEGIN
  IF to_regclass('public.tablas_fijas') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS tablas_fijas_anon_all ON public.tablas_fijas';
    EXECUTE 'CREATE POLICY tablas_fijas_anon_all ON public.tablas_fijas FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)';
  END IF;
  IF to_regclass('public.tabla_fija_caballos') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS tabla_fija_caballos_anon_all ON public.tabla_fija_caballos';
    EXECUTE 'CREATE POLICY tabla_fija_caballos_anon_all ON public.tabla_fija_caballos FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)';
  END IF;
  IF to_regclass('public.tabla_grupos') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS tabla_grupos_anon_all ON public.tabla_grupos';
    EXECUTE 'CREATE POLICY tabla_grupos_anon_all ON public.tabla_grupos FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)';
  END IF;
END $$;

-- Confirmación
SELECT 'Permisos y políticas restaurados exitosamente para tickets, depósitos, tablas fijas y reportes' AS resultado;
