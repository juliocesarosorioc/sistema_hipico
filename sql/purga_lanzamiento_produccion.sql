-- ============================================================================
-- SCRIPT DE PURGA Y VACIADO SEGURO PARA LANZAMIENTO A PRODUCCIÓN (MÓDULO 4)
-- Archivo: sql/purga_lanzamiento_produccion.sql
--
-- Comando de ejecución recomendado en Supabase SQL Editor o psql:
--   \i sql/purga_lanzamiento_produccion.sql
--
-- 1. ELIMINA TODOS LOS REGISTROS DE:
--    - Carreras y Juegos: carreras, ejemplares, programa_dia, jugadas, tickets,
--      dupletas, pollas, remates, remate_pujas, tablas_fijas, marcas,
--      eventos_libres, apuestas_eventos_especiales, historial_inteligencia_ejemplares
--      y todas sus tablas hijas/dependientes.
--    - Movimientos Contables y Saldos: asientos_contables, movimientos_contables,
--      libro_mayor_clientes, pagos_comprobantes, cierres_jornada,
--      ciclos_facturacion_semanal, saldos_semanales, asientos_niif, contabilidad_asientos.
--    - Clientes: clientes, formas_pago_clientes, cuaderno_jugadas, bitacora_externa.
--
-- 2. CONSERVA ESTRICTAMENTE (NO BORRA):
--    - Grupos preconfigurados: grupos, grupos_venta, grupos_comisiones_convenio,
--      parametros_semana_grupo, visibilidad_principal, grupos_visibilidad_principal.
--    - Operadores y Superadministradores: operadores, usuario_sistema,
--      grupos_usuarios, operadores_grupo_acceso, tipo_usuario, usuario_capacidad.
--    - Catálogo maestro de Hipódromos: hipodromos y logos_hipodromos_grupos.
--    - Plan de Cuentas NIIF: plan_cuentas_niif (con saldos reiniciados en 0.00).
-- ============================================================================

BEGIN;

DO $$
DECLARE
  t TEXT;
  tablas_a_vaciar TEXT[] := ARRAY[
    -- 1. Hijos y Detalles de Juegos y Carreras
    'remate_pujas',
    'remate_caballos',
    'polla_combinaciones',
    'polla_participantes',
    'polla_ventas',
    'dupleta_tickets',
    'tabla_fija_caballos',
    'tabla_grupos',
    'solicitudes_tablas',
    'carrera_ejemplares',
    'resultados_carreras',
    'cruces_carrera_config',
    'ih_inscripciones_carrera',
    'ih_carreras_programa',
    'ih_tendencia_jornada',
    'ih_cuadros_maestros_5y6',
    'historial_inteligencia_ejemplares',
    'gaceta_procesada',

    -- 2. Juegos, Tickets y Carreras Principales
    'apuestas_eventos_especiales',
    'eventos_libres',
    'marcas',
    'marcas_carrera',
    'tablas_fijas',
    'remates',
    'pollas',
    'dupletas',
    'wps_tickets',
    'tickets_apuestas',
    'tickets_jugadas',
    'tickets',
    'jugadas_adelantadas',
    'jugadas_monitor',
    'jugadas_auditoria',
    'portal_jugadas_reclamos',
    'portal_jugadas_externas',
    'jugadas',
    'programa_dia',
    'ejemplares',
    'carreras',

    -- 3. Movimientos Contables, Financieros y Saldos
    'asientos_niif_lineas',
    'asientos_niif',
    'contabilidad_asientos_lineas',
    'contabilidad_asientos',
    'movimientos_contables',
    'asientos_contables',
    'libro_mayor_clientes',
    'pagos_comprobantes',
    'pagos_vzla',
    'movimientos_caja',
    'transacciones_financieras',
    'cierres_jornada',
    'saldos_semanales',
    'ciclos_facturacion_semanal',

    -- 4. Clientes y Bitácoras Operativas de Clientes
    'formas_pago_clientes',
    'clientes_comision_personalizada',
    'comision_socio_por_cliente',
    'cuaderno_jugadas',
    'bitacora_externa',
    'whatsapp_envios',
    'clientes'
  ];
BEGIN
  FOREACH t IN ARRAY tablas_a_vaciar
  LOOP
    IF to_regclass('public.' || quote_ident(t)) IS NOT NULL THEN
      EXECUTE format('TRUNCATE TABLE public.%I RESTART IDENTITY CASCADE', t);
      RAISE NOTICE 'Tabla vaciada: public.%', t;
    END IF;
  END LOOP;

  -- Reiniciar todos los saldos en el Plan de Cuentas NIIF base a 0.00 sin borrar las cuentas
  IF to_regclass('public.plan_cuentas_niif') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'plan_cuentas_niif' AND column_name = 'saldo_actual'
    ) THEN
      EXECUTE 'UPDATE public.plan_cuentas_niif SET saldo_actual = 0.00';
    END IF;

    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'plan_cuentas_niif' AND column_name = 'saldo_deudor'
    ) THEN
      EXECUTE 'UPDATE public.plan_cuentas_niif SET saldo_deudor = 0.00';
    END IF;

    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'plan_cuentas_niif' AND column_name = 'saldo_acreedor'
    ) THEN
      EXECUTE 'UPDATE public.plan_cuentas_niif SET saldo_acreedor = 0.00';
    END IF;
    RAISE NOTICE 'Saldos de plan_cuentas_niif reiniciados en 0.00.';
  END IF;
END $$;

COMMIT;
