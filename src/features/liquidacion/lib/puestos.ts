/**
 * ============================================================================
 * MOTOR DE JUGADAS DE PUESTOS MULTI-EJEMPLAR Y NORMALIZACIÓN 10Ax (`puestos.ts`)
 * ============================================================================
 *
 * Módulo de Liquidación unificado con el SSOT (`@/features/motores/lib/puestos`):
 *  1. `TABLA_JUGADAS`: 44 combinaciones oficiales completas (1P..6Y7NY7N, PP, 10Ax).
 *  2. `extraerEjemplaresMultiples`: Separadores (`y`, `,`, `-`, `/`, espacio).
 *  3. `getMejorPos`: Mejor posición del grupo (`Math.min(...posiciones)`).
 *  4. `normalizarJugadaPremio` y `normalizarCodigoJugada`: Parser canónico con decimales.
 *  5. `calcularMultiplicadorJugada`: Factores exactos {1, 0.75, 0.5, 0.25, 0, -0.25, -0.5, -0.75, -1}.
 *  6. `logicaGanancias`: Evaluación matemática exacta, determinista e idempotente.
 */

import {
  validarPizarraSinDuplicados,
  type ValidacionUnicidadPizarra,
} from "@/features/liquidacion/lib/posiciones";

export { validarPizarraSinDuplicados, type ValidacionUnicidadPizarra };

import {
  TABLA_JUGADAS,
  type ReglaTablaJugada,
  normalizarCodigoJugada,
  obtenerReglaTablaJugada,
  buscarJugadaPorComponentes,
  extraerEjemplaresMultiples,
  construirMapaPosicionesPizarra,
  getMejorPos,
  normalizarJugadaPremio,
  calcularRiesgoCliente2,
  calcularMultiplicadorJugada,
  logicaGanancias,
  liquidarPuestos,
  posicionesDePizarra,
  calcularLiquidacionPuestosCarrera,
  procesarPuestos,
  finalizar,
  validarPuesto,
  minimoCorredoresRequeridos,
  minimoCorredoresDeNomenclatura,
  evaluarPuestoPorPosicion,
  liquidarPuesto,
  aplicarComision,
  Puestos,
  ESCALERA_PROGRESION_PUESTOS,
  parsearNomenclatura,
  type EntradaCrucePuestos,
  type ModalidadesCruce,
  type OpcionesCrucesPuestos,
  type LiquidacionCrucePuestosCliente,
  type ValidationResult,
  type LiquidationResult,
} from "@/features/motores/lib/puestos";

export {
  TABLA_JUGADAS,
  type ReglaTablaJugada,
  normalizarCodigoJugada,
  obtenerReglaTablaJugada,
  buscarJugadaPorComponentes,
  extraerEjemplaresMultiples,
  construirMapaPosicionesPizarra,
  getMejorPos,
  normalizarJugadaPremio,
  calcularRiesgoCliente2,
  calcularMultiplicadorJugada,
  logicaGanancias,
  liquidarPuestos,
  posicionesDePizarra,
  calcularLiquidacionPuestosCarrera,
  procesarPuestos,
  finalizar,
  validarPuesto,
  minimoCorredoresRequeridos,
  minimoCorredoresDeNomenclatura,
  evaluarPuestoPorPosicion,
  liquidarPuesto,
  aplicarComision,
  Puestos,
  ESCALERA_PROGRESION_PUESTOS,
  parsearNomenclatura,
  type EntradaCrucePuestos,
  type ModalidadesCruce,
  type OpcionesCrucesPuestos,
  type LiquidacionCrucePuestosCliente,
  type ValidationResult,
  type LiquidationResult,
};
