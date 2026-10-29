// ============================================================================
// SUITE DE CERTIFICACIÓN EXHAUSTIVA DE PUESTOS UNIFICADOS (SSOT)
// ============================================================================
//
// Certificación de las 6 Reglas Matemáticas Obligatorias:
//   1. Tabla Completa de Multiplicadores (TABLA_JUGADAS): 44 combinaciones oficiales,
//      factores {1, 0.75, 0.50, 0.25, 0, -0.25, -0.50, -0.75, -1}, expansión 1/2 -> 1Y2N,
//      2/3 -> 2Y3N y reconocimiento de componentes invertidos (buscarJugadaPorComponentes).
//   2. Jugadas de Puestos con 2 o más ejemplares (1y2, 3y4, 1-2, 1,2, 1 2) y regla de mejorPos.
//   3. Jugadas a Premio (10Ax y 10/x con decimales, coma o punto, mayúscula o minúscula).
//   4. Jugadas PP (Para-Para / Mano a Mano AxB).
//   5. Caballos Retirados (RET -> multiplicador 0, neto 0, riesgo 0) y Empates de pizarra.
//   6. Paridad e idempotencia 1:1 entre motores/puestos y liquidacion/puestos.
//
// Corre con: node pruebas/correr.cjs
// ============================================================================

import {
  TABLA_JUGADAS as TABLA_MOTORES,
  normalizarCodigoJugada as normMotores,
  normalizarJugadaPremio as normPremioMotores,
  buscarJugadaPorComponentes as buscarMotores,
  extraerEjemplaresMultiples as extraerMotores,
  construirMapaPosicionesPizarra as mapaMotores,
  getMejorPos as mejorPosMotores,
  calcularRiesgoCliente2 as riesgoMotores,
  calcularMultiplicadorJugada as multMotores,
  logicaGanancias as logicaMotores,
  liquidarPuesto as liqPuestoMotores,
  liquidarPuestos as liqPuestosMotores,
  validarPuesto as valPuestoMotores,
  Puestos as PuestosMotores,
} from "../src/features/motores/lib/puestos";

import {
  TABLA_JUGADAS as TABLA_LIQ,
  normalizarCodigoJugada as normLiq,
  normalizarJugadaPremio as normPremioLiq,
  buscarJugadaPorComponentes as buscarLiq,
  extraerEjemplaresMultiples as extraerLiq,
  construirMapaPosicionesPizarra as mapaLiq,
  getMejorPos as mejorPosLiq,
  calcularRiesgoCliente2 as riesgoLiq,
  calcularMultiplicadorJugada as multLiq,
  logicaGanancias as logicaLiq,
  liquidarPuesto as liqPuestoLiq,
  liquidarPuestos as liqPuestosLiq,
  validarPuesto as valPuestoLiq,
  Puestos as PuestosLiq,
} from "../src/features/liquidacion/lib/puestos";

import type { TicketMotor } from "../src/features/betting/lib/bettingEngine";
import type { PizarraCarrera } from "../src/features/liquidacion/lib/liquidacion";

let pasan = 0;
let fallan = 0;

function ok(msg: string) {
  pasan++;
  console.log(`  ok   ${msg}`);
}

function fallo(msg: string, detalle?: unknown) {
  fallan++;
  console.error(`  FALLA ${msg}`, detalle ?? "");
}

function assertEq(actual: unknown, expected: unknown, desc: string) {
  if (actual === expected) {
    ok(desc);
  } else {
    fallo(desc, { actual, expected });
  }
}

function assertAprox(actual: number, expected: number, desc: string, tol = 0.001) {
  if (Math.abs(actual - expected) <= tol) {
    ok(`${desc} (esperado ${expected}, obtenido ${actual})`);
  } else {
    fallo(desc, { actual, expected, dif: Math.abs(actual - expected) });
  }
}

console.log("\n--- [SUITE CERTIFICACIÓN DE PUESTOS UNIFICADOS] ---");

// ============================================================================
// BLOQUE 1: TABLA DE 44 COMBINACIONES OFICIALES Y FACTORES DE LA ESCALERA
// ============================================================================
console.log("\n[1] Verificación de la Tabla Completa de Multiplicadores y Escalera de Factores");

// 1.1 Existencia de las 44 combinaciones oficiales
const COMBINACIONES_OFICIALES = [
  // Tramo 1P -> 2P (8 combinaciones)
  "1P", "1PY1Y2N", "1Y2N", "1Y2NY2N", "2N", "2NY2Y2N", "2Y2N", "2Y2NY2P", "2P",
  // Tramo 2P -> 3P
  "2PY2Y3N", "2Y3N", "2Y3NY3N", "3N", "3NY3Y3N", "3Y3N", "3Y3NY3P", "3P",
  // Tramo 3P -> 4P
  "3PY3Y4N", "3Y4N", "3Y4NY4N", "4N", "4NY4Y4N", "4Y4N", "4Y4NY4P", "4P",
  // Tramo 4P -> 5P
  "4PY4Y5N", "4Y5N", "4Y5NY5N", "5N", "5NY5Y5N", "5Y5N", "5Y5NY5P", "5P",
  // Tramo 5P -> 6P
  "5PY5Y6N", "5Y6N", "5Y6NY6N", "6N", "6NY6Y6N", "6Y6N", "6Y6NY6P", "6P",
  // Extensión 6P -> 7
  "6PY6Y7N", "6Y7N", "6Y7NY7N",
];

for (const jugada of COMBINACIONES_OFICIALES) {
  const r = TABLA_MOTORES[jugada];
  assertEq(Boolean(r), true, `Combinación oficial '${jugada}' presente en TABLA_JUGADAS`);
}

// 1.2 Factores exactos de la progresión de peldaño 1P -> 2P en las posiciones 1, 2 y 3
// 1P: 1° -> +1, 2° -> -1
assertAprox(multMotores("1P", 1), 1.0, "1P en 1° lugar da +1.00");
assertAprox(multMotores("1P", 2), -1.0, "1P en 2° lugar da -1.00");

// 1PY1Y2N (75/25): 1° -> +1, 2° -> -0.75, 3° -> -1
assertAprox(multMotores("1PY1Y2N", 1), 1.0, "1PY1Y2N en 1° lugar da +1.00");
assertAprox(multMotores("1PY1Y2N", 2), -0.75, "1PY1Y2N en 2° lugar da -0.75");
assertAprox(multMotores("1PY1Y2N", 3), -1.0, "1PY1Y2N en 3° lugar da -1.00");

// 1Y2N (50/50): 1° -> +1, 2° -> -0.50, 3° -> -1
assertAprox(multMotores("1Y2N", 1), 1.0, "1Y2N en 1° lugar da +1.00");
assertAprox(multMotores("1Y2N", 2), -0.50, "1Y2N en 2° lugar da -0.50");
assertAprox(multMotores("1Y2N", 3), -1.0, "1Y2N en 3° lugar da -1.00");

// 1Y2NY2N (25/75): 1° -> +1, 2° -> -0.25, 3° -> -1
assertAprox(multMotores("1Y2NY2N", 1), 1.0, "1Y2NY2N en 1° lugar da +1.00");
assertAprox(multMotores("1Y2NY2N", 2), -0.25, "1Y2NY2N en 2° lugar da -0.25");
assertAprox(multMotores("1Y2NY2N", 3), -1.0, "1Y2NY2N en 3° lugar da -1.00");

// 2N (Individual Nini): 1° -> +1, 2° -> 0, 3° -> -1
assertAprox(multMotores("2N", 1), 1.0, "2N en 1° lugar da +1.00");
assertAprox(multMotores("2N", 2), 0.0, "2N en 2° lugar da 0.00 (empata)");
assertAprox(multMotores("2N", 3), -1.0, "2N en 3° lugar da -1.00");

// 2NY2Y2N (75/25): 1° -> +1, 2° -> +0.25, 3° -> -1
assertAprox(multMotores("2NY2Y2N", 1), 1.0, "2NY2Y2N en 1° lugar da +1.00");
assertAprox(multMotores("2NY2Y2N", 2), 0.25, "2NY2Y2N en 2° lugar da +0.25");
assertAprox(multMotores("2NY2Y2N", 3), -1.0, "2NY2Y2N en 3° lugar da -1.00");

// 2Y2N (50/50): 1° -> +1, 2° -> +0.50, 3° -> -1
assertAprox(multMotores("2Y2N", 1), 1.0, "2Y2N en 1° lugar da +1.00");
assertAprox(multMotores("2Y2N", 2), 0.50, "2Y2N en 2° lugar da +0.50");
assertAprox(multMotores("2Y2N", 3), -1.0, "2Y2N en 3° lugar da -1.00");

// 2Y2NY2P (25/75): 1° -> +1, 2° -> +0.75, 3° -> -1
assertAprox(multMotores("2Y2NY2P", 1), 1.0, "2Y2NY2P en 1° lugar da +1.00");
assertAprox(multMotores("2Y2NY2P", 2), 0.75, "2Y2NY2P en 2° lugar da +0.75");
assertAprox(multMotores("2Y2NY2P", 3), -1.0, "2Y2NY2P en 3° lugar da -1.00");

// 2P: 1° -> +1, 2° -> +1, 3° -> -1
assertAprox(multMotores("2P", 1), 1.0, "2P en 1° lugar da +1.00");
assertAprox(multMotores("2P", 2), 1.0, "2P en 2° lugar da +1.00");
assertAprox(multMotores("2P", 3), -1.0, "2P en 3° lugar da -1.00");

// 1.3 Normalización de slashes y aliases requeridos: 1/2 -> 1Y2N, 2/3 -> 2Y3N
assertEq(normMotores("1/2"), "1Y2N", "Normalización expande '1/2' a '1Y2N'");
assertEq(normMotores("2/3"), "2Y3N", "Normalización expande '2/3' a '2Y3N'");
assertEq(normMotores(" 1 / 2 "), "1Y2N", "Normalización con espacios expande ' 1 / 2 ' a '1Y2N'");
assertEq(buscarMotores("1/2")?.codigo, "1Y2N", "buscarJugadaPorComponentes('1/2') resuelve a '1Y2N'");
assertEq(buscarMotores("2/3")?.codigo, "2Y3N", "buscarJugadaPorComponentes('2/3') resuelve a '2Y3N'");

// Componentes invertidos
assertEq(buscarMotores("1Y2NY1P")?.codigo, "1PY1Y2N", "buscarJugadaPorComponentes('1Y2NY1P') resuelve a '1PY1Y2N'");
assertEq(buscarMotores("2NY1Y2N")?.codigo, "1Y2NY2N", "buscarJugadaPorComponentes('2NY1Y2N') resuelve a '1Y2NY2N'");

// ============================================================================
// BLOQUE 2: MULTI-EJEMPLAR EN PUESTOS (1y2, 3y4, 1-2, 1,2, 1 2)
// ============================================================================
console.log("\n[2] Verificación de Jugadas Multi-Ejemplar y mejorPos");

const pizarraEjemplo: PizarraCarrera = {
  primero: "1",
  segundo: "4",
  tercero: "7",
  cuarto: "3",
  quinto: "8",
  sexto: "2",
  septimo: "5",
  octavo: "6",
};

// 2.1 Ejemplo Obligatorio 1: 1P con '1y2'
// #1 llega 1°, #2 llega 6° -> mejorPos === 1 -> Gana (+1)
const res1P_gana1 = logicaMotores({
  jugada: "1P",
  caballo: "1y2",
  monto: 100,
  pizarra: pizarraEjemplo,
  comisionPct: 5,
});
assertEq(res1P_gana1.mejorPos, 1, "1P con '1y2' tiene mejorPos 1 cuando el 1 llega 1°");
assertEq(res1P_gana1.ganaJugador1, true, "1P con '1y2' gana quien juega cuando el 1 llega 1°");
assertAprox(res1P_gana1.netoJugador1, 95.0, "Neto Jugador 1 es +95 (100 - 5% com)");
assertAprox(res1P_gana1.netoJugador2, -100.0, "Neto Jugador 2 (dador) es -100");

// #2 llega 1°, #1 llega 6° -> mejorPos === 1 -> Gana (+1)
const pizarraInvertida1_2: PizarraCarrera = {
  primero: "2",
  segundo: "4",
  tercero: "7",
  cuarto: "3",
  quinto: "8",
  sexto: "1",
};
const res1P_gana2 = logicaMotores({
  jugada: "1P",
  caballo: "1y2",
  monto: 100,
  pizarra: pizarraInvertida1_2,
});
assertEq(res1P_gana2.mejorPos, 1, "1P con '1y2' tiene mejorPos 1 cuando el 2 llega 1°");
assertEq(res1P_gana2.ganaJugador1, true, "1P con '1y2' gana cuando el 2 llega 1°");

// Ambos llegan fuera del 1° (#1 llega 3°, #2 llega 4°) -> Pierde (-1)
const pizarraFuera1: PizarraCarrera = {
  primero: "5",
  segundo: "6",
  tercero: "1",
  cuarto: "2",
};
const res1P_pierden = logicaMotores({
  jugada: "1P",
  caballo: "1y2",
  monto: 100,
  pizarra: pizarraFuera1,
});
assertEq(res1P_pierden.mejorPos, 3, "1P con '1y2' tiene mejorPos 3 cuando llegan 3° y 4°");
assertEq(res1P_pierden.ganaJugador1, false, "1P con '1y2' pierde quien juega si ambos están fuera del 1°");
assertEq(res1P_pierden.ganaJugador2, true, "1P con '1y2' gana dador si ambos están fuera del 1°");
assertAprox(res1P_pierden.netoJugador1, -100.0, "Neto Jugador 1 es -100");
assertAprox(res1P_pierden.netoJugador2, 95.0, "Neto Jugador 2 es +95");

// 2.2 Ejemplo Obligatorio 2: 2P con '3y4'
// #4 llega 2°, #3 llega 4° -> mejorPos === 2 -> Gana (+1)
const res2P_4llega2 = logicaMotores({
  jugada: "2P",
  caballo: "3y4",
  monto: 100,
  pizarra: pizarraEjemplo,
});
assertEq(res2P_4llega2.mejorPos, 2, "2P con '3y4' tiene mejorPos 2 cuando el 4 llega 2°");
assertEq(res2P_4llega2.ganaJugador1, true, "2P con '3y4' gana cuando el 4 llega 2° (mejorPos <= 2)");

// #3 llega 1°, #4 llega 5° -> mejorPos === 1 -> Gana (+1)
const pizarra3_1ro: PizarraCarrera = {
  primero: "3",
  segundo: "1",
  tercero: "7",
  cuarto: "8",
  quinto: "4",
};
const res2P_3llega1 = logicaMotores({
  jugada: "2P",
  caballo: "3y4",
  monto: 100,
  pizarra: pizarra3_1ro,
});
assertEq(res2P_3llega1.mejorPos, 1, "2P con '3y4' tiene mejorPos 1 cuando el 3 llega 1°");
assertEq(res2P_3llega1.ganaJugador1, true, "2P con '3y4' gana cuando el 3 llega 1°");

// Llegan 3° y 5° -> mejorPos === 3 -> Pierde (-1)
const pizarra3_3ro: PizarraCarrera = {
  primero: "1",
  segundo: "2",
  tercero: "3",
  cuarto: "8",
  quinto: "4",
};
const res2P_pierden = logicaMotores({
  jugada: "2P",
  caballo: "3y4",
  monto: 100,
  pizarra: pizarra3_3ro,
});
assertEq(res2P_pierden.mejorPos, 3, "2P con '3y4' tiene mejorPos 3 cuando llegan 3° y 5°");
assertEq(res2P_pierden.ganaJugador1, false, "2P con '3y4' pierde cuando mejorPos es 3 (3 > 2)");
assertEq(res2P_pierden.ganaJugador2, true, "2P con '3y4' gana dador cuando mejorPos es 3");

// 2.3 Combinadas 2Y3N y 3Y3N con 1 y 2 caballos
// 2Y3N con 1 caballo (llega 3° -> 50% pierde puesto, 50% empata nini -> factor -0.50)
assertAprox(multMotores("2Y3N", 3), -0.50, "2Y3N con llegada 3° da factor -0.50");
assertAprox(multMotores("2Y3N", 1), 1.0, "2Y3N con llegada 1° da factor +1.00");
assertAprox(multMotores("2Y3N", 2), 1.0, "2Y3N con llegada 2° da factor +1.00");
assertAprox(multMotores("2Y3N", 4), -1.0, "2Y3N con llegada 4° da factor -1.00");

// 2Y3N con 2 caballos ("2y5"): caballo 2 llega 2°, caballo 5 llega 6° -> mejorPos 2 -> GANA (+1)
const res2Y3N_multi = logicaMotores({
  jugada: "2Y3N",
  caballo: "2y5",
  monto: 100,
  pizarra: { primero: "1", segundo: "2", sexto: "5" },
});
assertEq(res2Y3N_multi.mejorPos, 2, "2Y3N con '2y5' calcula mejorPos 2");
assertEq(res2Y3N_multi.ganaJugador1, true, "2Y3N con '2y5' gana cuando mejorPos es 2");
assertAprox(res2Y3N_multi.netoJugador1, 95.0, "2Y3N con '2y5' neto jugador es +95");

// 3Y3N (50% 3N + 50% 3P):
// Si llega 3°: 3P gana (+1), 3N empata (0) -> factor (+1 + 0)/2 = +0.50
assertAprox(multMotores("3Y3N", 3), 0.50, "3Y3N con llegada 3° da factor +0.50");
assertAprox(multMotores("3Y3N", 1), 1.0, "3Y3N con llegada 1° da factor +1.00");
assertAprox(multMotores("3Y3N", 4), -1.0, "3Y3N con llegada 4° da factor -1.00");

// 3Y3N con 2 caballos ("3y7"): el 7 llega 3°, el 3 llega 5° -> mejorPos 3 -> factor +0.50
const res3Y3N_multi = logicaMotores({
  jugada: "3Y3N",
  caballo: "3y7",
  monto: 100,
  pizarra: { primero: "1", segundo: "2", tercero: "7", quinto: "3" },
});
assertEq(res3Y3N_multi.mejorPos, 3, "3Y3N con '3y7' calcula mejorPos 3");
assertEq(res3Y3N_multi.ganaJugador1, true, "3Y3N con '3y7' gana cuando mejorPos es 3 (+50% bruto)");
assertAprox(res3Y3N_multi.netoJugador1, 47.5, "3Y3N neto jugador 1 es +47.50 (50 - 5% com)");
assertAprox(res3Y3N_multi.netoJugador2, -50.0, "3Y3N neto jugador 2 es -50.00");

// ============================================================================
// BLOQUE 3: JUGADAS A PREMIO (10Ax, 10/x, DECIMALES, PUNTO/COMA, MAYÚS/MINÚS)
// ============================================================================
console.log("\n[3] Verificación de Jugadas a Premio (10Ax / 10/x)");

// 3.1 Normalización Canónica a 10A<factor>
assertEq(normPremioMotores("10a7"), "10A7", "'10a7' normaliza a '10A7'");
assertEq(normPremioMotores("10/7"), "10A7", "'10/7' normaliza a '10A7'");
assertEq(normPremioMotores("10A7"), "10A7", "'10A7' normaliza a '10A7'");
assertEq(normPremioMotores("10A3.5"), "10A3.5", "'10A3.5' normaliza a '10A3.5'");
assertEq(normPremioMotores("10/3,5"), "10A3.5", "'10/3,5' normaliza a '10A3.5'");
assertEq(normPremioMotores("10a3,5"), "10A3.5", "'10a3,5' normaliza a '10A3.5'");
assertEq(normPremioMotores("10a3.5"), "10A3.5", "'10a3.5' normaliza a '10A3.5'");

// 3.2 Riesgo del Dador (Cliente 2)
assertAprox(riesgoMotores(100, "10a7"), 70.0, "Riesgo Dador en 10a7 de 100 es 70");
assertAprox(riesgoMotores(100, "10/7"), 70.0, "Riesgo Dador en 10/7 de 100 es 70");
assertAprox(riesgoMotores(100, "10A3.5"), 35.0, "Riesgo Dador en 10A3.5 de 100 es 35");
assertAprox(riesgoMotores(100, "10/3,5"), 35.0, "Riesgo Dador en 10/3,5 de 100 es 35");

// 3.3 Evaluación individual al 1° lugar
// 10A7 con 1 ejemplar: llega 1° -> gana +pct (+0.70)
assertAprox(multMotores("10A7", 1), 0.70, "Multiplicador 10A7 llegando 1° es +0.70");
assertAprox(multMotores("10A7", 2), -1.0, "Multiplicador 10A7 llegando 2° es -1.00");

// 10A3.5 con 1 ejemplar: llega 1° -> gana +pct (+0.35)
assertAprox(multMotores("10A3.5", 1), 0.35, "Multiplicador 10A3.5 llegando 1° es +0.35");
assertAprox(multMotores("10A3.5", 2), -1.0, "Multiplicador 10A3.5 llegando 2° es -1.00");

// 3.4 Matchup Mano a Mano AxB con proporción (ej. '3x6' con '10a3.5')
// Caso A: caballo 3 llega 2°, caballo 6 llega 4° (p1 < p2) -> gana C1 (+0.35)
const multMatchupGana1 = multMotores("10A3.5", 2, { p2: 4 });
assertAprox(multMatchupGana1, 0.35, "10A3.5 matchup '3x6' cuando p1=2 y p2=4 da +0.35");

// Caso B: caballo 6 llega 2°, caballo 3 llega 4° (p2 < p1) -> gana C2 (-1.00)
const multMatchupGana2 = multMotores("10A3.5", 4, { p2: 2 });
assertAprox(multMatchupGana2, -1.0, "10A3.5 matchup '3x6' cuando p1=4 y p2=2 da -1.00");

// Caso C: ambos empatan o fuera de pizarra (p1 === p2) -> 0.00
const multMatchupEmpate = multMotores("10A3.5", 99, { p2: 99 });
assertAprox(multMatchupEmpate, 0.0, "10A3.5 matchup cuando p1===p2 da 0.00");

// ============================================================================
// BLOQUE 4: JUGADA PP (PARA-PARA / MANO A MANO)
// ============================================================================
console.log("\n[4] Verificación de Jugada PP (Para-Para / Mano a Mano)");

// Mano a mano '4x8'
// Caso A: C1 llega 1°, C2 llega 3° (p1 < p2) -> gana C1 (+1.00)
assertAprox(multMotores("PP", 1, { p2: 3 }), 1.0, "PP con p1=1 y p2=3 da +1.00");

// Caso B: C2 llega 2°, C1 llega 5° (p2 < p1) -> gana C2 (-1.00)
assertAprox(multMotores("PP", 5, { p2: 2 }), -1.0, "PP con p1=5 y p2=2 da -1.00");

// Caso C: C1 y C2 empatan (p1 === p2) -> 0.00 (anula / devuelve)
assertAprox(multMotores("PP", 1, { p2: 1 }), 0.0, "PP con empate oficial p1=1 y p2=1 da 0.00");
assertAprox(multMotores("PP", 99, { p2: 99 }), 0.0, "PP con ambos fuera de pizarra da 0.00");

// ============================================================================
// BLOQUE 5: RETIRADOS Y EMPATES EN PIZARRA
// ============================================================================
console.log("\n[5] Verificación de Caballos Retirados y Empates");

// 5.1 Caballo Retirado en jugada simple
const resRetSimple = logicaMotores({
  jugada: "1P",
  caballo: "5",
  monto: 100,
  pizarra: { primero: "1", segundo: "2" },
  retirados: ["5"],
});
assertEq(resRetSimple.empate, true, "Jugada simple con ejemplar retirado queda anulada/empate");
assertEq(resRetSimple.ganaJugador1, false, "Jugador 1 no gana si el ejemplar está retirado");
assertEq(resRetSimple.ganaJugador2, false, "Jugador 2 no gana si el ejemplar está retirado");
assertEq(resRetSimple.netoJugador1, 0, "Neto Jugador 1 es 0 con retirado");
assertEq(resRetSimple.netoJugador2, 0, "Neto Jugador 2 es 0 con retirado");

// 5.2 Caballo Retirado en combinación multi-ejemplar o AxB
const resRetMulti = logicaMotores({
  jugada: "10A3.5",
  caballo: "3x6",
  monto: 100,
  pizarra: { primero: "3", segundo: "2" },
  retirados: ["6"],
});
assertEq(resRetMulti.empate, true, "Matchup con rival retirado queda anulado/empate");
assertEq(resRetMulti.netoJugador1, 0, "Neto Jugador 1 es 0 en matchup con retirado");
assertEq(resRetMulti.netoJugador2, 0, "Neto Jugador 2 es 0 en matchup con retirado");

// 5.3 Liquidar ticket con retirado vía liquidarPuestos
const ticketRetirado: TicketMotor = {
  id: "ticket-ret-1",
  hipodromo: "LR",
  carrera: "1",
  tipo_jugada: "1P",
  caballo: "5",
  monto: 100,
  cruces: 1,
  cuota: null,
  total: 100,
  fechas: [],
  addedAt: 0,
  puesto_final: "SOC",
  pizarra: { primero: "1", segundo: "2" },
  dividendos: null,
};
(ticketRetirado as Record<string, unknown>).retirados = ["5"];
const resTicketRet = liqPuestosMotores(ticketRetirado);
assertEq(resTicketRet.ok, false, "Ticket con ejemplar retirado retorna ok=false (no ganador)");
assertEq(resTicketRet.totalClienteNeto, 100, "Ticket con ejemplar retirado devuelve el capital íntegro (100)");
assertEq(resTicketRet.balanceBanca, 0, "Balance banca es 0 en ticket con retirado");

// ============================================================================
// BLOQUE 6: PARIDAD 1:1 ENTRE MOTORES/PUESTOS Y LIQUIDACION/PUESTOS
// ============================================================================
console.log("\n[6] Verificación de Paridad Estricta 1:1 entre Motores y Liquidación");

const CASOS_PARIDAD = [
  { jugada: "1P", caballo: "1y2", pizarra: pizarraEjemplo },
  { jugada: "2P", caballo: "3y4", pizarra: pizarraEjemplo },
  { jugada: "1Y2N", caballo: "1", pizarra: pizarraEjemplo },
  { jugada: "2Y3N", caballo: "2y5", pizarra: pizarraEjemplo },
  { jugada: "3Y3N", caballo: "3", pizarra: pizarraEjemplo },
  { jugada: "10a7", caballo: "1", pizarra: pizarraEjemplo },
  { jugada: "10/3,5", caballo: "1", pizarra: pizarraEjemplo },
  { jugada: "PP", caballo: "1x4", pizarra: pizarraEjemplo },
  { jugada: "10A3.5", caballo: "4x1", pizarra: pizarraEjemplo },
  { jugada: "2P", caballo: "5", pizarra: pizarraEjemplo, retirados: ["5"] },
];

for (const caso of CASOS_PARIDAD) {
  const rMotores = logicaMotores({
    jugada: caso.jugada,
    caballo: caso.caballo,
    monto: 100,
    pizarra: caso.pizarra,
    retirados: caso.retirados,
  });

  const rLiq = logicaLiq({
    jugada: caso.jugada,
    caballo: caso.caballo,
    monto: 100,
    pizarra: caso.pizarra,
    retirados: caso.retirados,
  });

  assertEq(rMotores.codigoNormalizado, rLiq.codigoNormalizado, `Paridad código: ${caso.jugada}`);
  assertEq(rMotores.mejorPos, rLiq.mejorPos, `Paridad mejorPos: ${caso.jugada}`);
  assertEq(rMotores.ganaJugador1, rLiq.ganaJugador1, `Paridad ganaJugador1: ${caso.jugada}`);
  assertEq(rMotores.ganaJugador2, rLiq.ganaJugador2, `Paridad ganaJugador2: ${caso.jugada}`);
  assertEq(rMotores.empate, rLiq.empate, `Paridad empate: ${caso.jugada}`);
  assertAprox(rMotores.netoJugador1, rLiq.netoJugador1, `Paridad netoJugador1: ${caso.jugada}`);
  assertAprox(rMotores.netoJugador2, rLiq.netoJugador2, `Paridad netoJugador2: ${caso.jugada}`);
  assertAprox(rMotores.riesgoJugador1, rLiq.riesgoJugador1, `Paridad riesgoJugador1: ${caso.jugada}`);
  assertAprox(rMotores.riesgoJugador2, rLiq.riesgoJugador2, `Paridad riesgoJugador2: ${caso.jugada}`);
}

// Resumen final de la suite
console.log(`\n${pasan} pasan, ${fallan} fallan.`);
if (fallan > 0) {
  process.exit(1);
} else {
  console.log("\n🎉 TODAS LAS ASIGNACIONES DE LA SUITE DE CERTIFICACIÓN DE PUESTOS UNIFICADOS PASARON EXITOSAMENTE.");
}
