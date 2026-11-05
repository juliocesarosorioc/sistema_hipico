// ============================================================================
// Pruebas de Retiros y Reactivación de Ejemplares y Jugadas
// (src/features/carreras/lib/retiros-nucleo.ts)
// ============================================================================
import {
  identificarReactivados,
  jugadaEsReactivable,
  jugadaInvolucraRetirado,
  extraerNumerosCaballoJugada,
  normalizarRetirados,
  parsearRetirados,
} from "../src/features/carreras/lib/retiros-nucleo";

let pasan = 0;
let fallan = 0;

function ok(nombre: string, condicion: boolean) {
  if (condicion) {
    pasan++;
    console.log(`  ok   ${nombre}`);
  } else {
    fallan++;
    console.log(`  FALLA ${nombre}`);
  }
}

function eq(nombre: string, obtenido: unknown, esperado: unknown) {
  const a = JSON.stringify(obtenido);
  const b = JSON.stringify(esperado);
  if (a === b) {
    pasan++;
    console.log(`  ok   ${nombre}`);
  } else {
    fallan++;
    console.log(`  FALLA ${nombre}\n        obtenido:  ${a}\n        esperado:  ${b}`);
  }
}

console.log("\n--- TEST: Identificación de Ejemplares Reactivados ---");

eq(
  "Detecta ejemplar 2 des-retirado cuando antes estaban 2 y 5, y ahora solo 5",
  identificarReactivados(["2", "5"], ["5"]),
  ["2"]
);

eq(
  "Detecta todos los ejemplares cuando se borran todos los retiros (reactivación completa)",
  identificarReactivados(["2", "5", "8"], []),
  ["2", "5", "8"]
);

eq(
  "No detecta reactivaciones si solo se agregan retiros nuevos",
  identificarReactivados(["2"], ["2", "4"]),
  []
);

eq(
  "No detecta reactivaciones si la lista es la misma",
  identificarReactivados(["2", "7"], ["7", "2"]),
  []
);

console.log("\n--- TEST: Validación de Jugadas Reactivables ---");

ok(
  "Jugada directa de ejemplar 2 es reactivable si se reactiva 2 y no hay otros retirados",
  jugadaEsReactivable("2", 2, "TABLA", ["2"], [])
);

ok(
  "Jugada directa de ejemplar 2 NO es reactivable si el reactivado fue el 3",
  !jugadaEsReactivable("2", 2, "TABLA", ["3"], [])
);

ok(
  "Jugada pareo (2 con 5) NO es reactivable si se reactiva el 2 pero el 5 sigue retirado",
  !jugadaEsReactivable("2/5", null, "PAREO", ["2"], ["5"])
);

ok(
  "Jugada pareo (2 con 5) SÍ es reactivable si se reactivan tanto el 2 como el 5",
  jugadaEsReactivable("2/5", null, "PAREO", ["2", "5"], [])
);

ok(
  "Jugada con dorsal en nombre_jugada ('4G') es reactivable si se reactiva el 4",
  jugadaEsReactivable("", null, "4G", ["4"], [])
);

console.log(`\n========================================`);
console.log(`Total: ${pasan + fallan} | Pasan: ${pasan} | Fallan: ${fallan}`);
if (fallan > 0) process.exit(1);
