# REPORTE DE CULMINACIÓN - Sistema Hípico

## Tareas realizadas (última solicitud)

1. Sistema Universal e Idempotente de Re-liquidación Post-Carrera (recalcularCarreraCompleta)
- Implementado en src/features/liquidacion/lib/recalcular.ts
- Incluye revertir/aplicar con simetría TABLA FIJA%, reliquidarEspecialesDeCarrera, autoReliquidarSiLiquidada
- Botón 🔄 Recalcular en Gestión de Jugadas
- Suite: 2076 aserciones OK, 53 archivos, SUITE OK

2. Regla de cruces (Solo Puestos) condicionada por permite_cruces del grupo
- Función calcularLiquidacionPuestosCarrera en src/features/motores/lib/puestos.ts
- netearComisionCruce actualizado para agruparPorCliente y permiteCruces
- Integración en saldos.ts y pagarYCerrar.ts
- UI de grupos actualizada
- Test cruces-puestos.test.ts

3. Integración de Pollas documentada como pendiente
- Añadida entrada en docs/PLANIFICACION.md

4. Guardado de permite_cruces en grupos corregido
- Ajustado crearGrupo/actualizar para enviar permite_cruces

5. Limpieza UI y guardas en Gestión
- Eliminados botones Preresultado/Preliminar
- Guard al Reporte Final (bloquea si no hay resultados cargados)
- Precarga inteligente en CargaResultadosModal

## Estado actual
- npx tsc --noEmit: sin errores
- node pruebas/correr.cjs: 2076 aserciones OK, 53 archivos, SUITE OK
- Cambios aplicados y verificados
