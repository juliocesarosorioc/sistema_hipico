// ============================================================================
// Pruebas de la centralizacion del resultado de una carrera.
//
// `posicionesDePizarra` convierte la pizarra con campos por nombre
// (primero..octavo) en la lista ordenada que guarda `resultados_carreras.
// ganadores`. La lista es la que consumen las jugadas de puestos, los reportes
// y Carreras del Dia, asi que perder una posicion deja datos incompletos sin
// que nada falle de forma visible.
//
// Corre con pruebas/run-marcas.ps1
// ============================================================================
import {
  posicionesDePizarra,
  ordenLlegadaDePizarra,
  dividendosDePizarra,
  CAMPOS_POSICION,
} from "../src/lib/liquidacion/posiciones";
import { readFileSync } from "node:fs";
import { join } from "node:path";

let pasan = 0;
let fallan = 0;

function eq(nombre: string, obtenido: unknown, esperado: unknown) {
  const a = JSON.stringify(obtenido);
  const b = JSON.stringify(esperado);
  if (a === b) {
    pasan++;
    console.log(`  ok   ${nombre}`);
  } else {
    fallan++;
    console.log(`  FALLA ${nombre}\n         obtenido:  ${a}\n         esperado:  ${b}`);
  }
}

console.log("\n-- La pizarra completa conserva las 8 posiciones");
eq(
  "las ocho, en orden",
  posicionesDePizarra({
    primero: "1",
    segundo: "2",
    tercero: "3",
    cuarto: "4",
    quinto: "5",
    sexto: "6",
    septimo: "7",
    octavo: "8",
  }),
  ["1", "2", "3", "4", "5", "6", "7", "8"]
);

console.log("\n-- Un resultado a medias NO se corta en el ganador");
eq(
  "solo los 4 primeros cargados",
  posicionesDePizarra({ primero: "7", segundo: "2", tercero: "3", cuarto: "9" }),
  ["7", "2", "3", "9"]
);
eq(
  "5 cargados con el 6to vacio",
  posicionesDePizarra({ primero: "1", segundo: "2", tercero: "3", cuarto: "4", quinto: "5", sexto: "  " }),
  ["1", "2", "3", "4", "5"]
);

console.log("\n-- Casos borde que hoy se comian una posicion");
eq("pizarra vacia", posicionesDePizarra({}), []);
eq("pizarra nula", posicionesDePizarra(null), []);
eq("pizarra indefinida", posicionesDePizarra(undefined), []);
eq("solo el ganador", posicionesDePizarra({ primero: "4" }), ["4"]);
eq("el 0 no es un caballo", posicionesDePizarra({ primero: "0", segundo: "3" }), ["3"]);
eq("recorta espacios", posicionesDePizarra({ primero: "  5  " }), ["5"]);
eq("undefined en el medio no corta la lista", posicionesDePizarra({ primero: "1", segundo: undefined, tercero: "3" }), ["1", "3"]);
eq("null en el medio no corta la lista", posicionesDePizarra({ primero: "1", segundo: null, tercero: "3" }), ["1", "3"]);

console.log("\n-- El orden de los campos es el de las posiciones");
eq("los 8 campos, en orden", CAMPOS_POSICION, [
  "primero",
  "segundo",
  "tercero",
  "cuarto",
  "quinto",
  "sexto",
  "septimo",
  "octavo",
]);

console.log("\n-- Nadie centraliza una sola posicion (regresion del 2º al 8º)");
// El bug era `ganadores: [r.pizarra.primero]` en PagarCarreraModal: el pago
// salia bien, pero del 2º al 8º no llegaba a la fuente de verdad.
eq("el 2do..8mo NO se pierden", posicionesDePizarra({ primero: "1", segundo: "2", tercero: "3" }).length, 3);

console.log("\n-- orden_llegada: la forma estructurada [{numero,puesto}]");
eq(
  "los 3 primeros con su puesto",
  ordenLlegadaDePizarra({ primero: "7", segundo: "2", tercero: "3" }),
  [
    { numero: "7", puesto: 1 },
    { numero: "2", puesto: 2 },
    { numero: "3", puesto: 3 },
  ]
);
eq("el puesto respeta los huecos", ordenLlegadaDePizarra({ segundo: "5" }), [{ numero: "5", puesto: 2 }]);
eq("acepta numeros", ordenLlegadaDePizarra({ primero: 9 }), [{ numero: "9", puesto: 1 }]);
eq("pizarra nula", ordenLlegadaDePizarra(null), []);
eq("sin llegadas", ordenLlegadaDePizarra({}), []);

console.log("\n-- dividendos: une pools por caballo + matriz WPS");
eq(
  "win + wps_",
  dividendosDePizarra({ dividendos: { "win:7": 20 }, matrizWps: { wps_WW: 15 } }),
  { "win:7": 20, wps_WW: 15 }
);
eq("solo pools", dividendosDePizarra({ dividendos: { "place:3": 8 } }), { "place:3": 8 });
eq("vacio da null", dividendosDePizarra({}), null);
eq("nulo da null", dividendosDePizarra(null), null);
eq("undefined da null", dividendosDePizarra(undefined), null);

console.log("\n-- Nadie liquida dejando el central sin orden_llegada/dividendos");
// El bug: Taquilla los guardaba (los pasaba a mano), pero la liquidacion de
// Gestion de Jugadas escribia el central sin ellos -> la fila quedaba con
// `orden_llegada`/`dividendos` en NULL y no habia con que pagar puestos.
const pagarYCerrar = readFileSync(
  join(process.cwd(), "src", "lib", "liquidacion", "pagarYCerrar.ts"),
  "utf8"
);
eq("el central guarda orden_llegada", /orden_llegada:\s*ordenLlegadaDePizarra\(/.test(pagarYCerrar), true);
eq("el central guarda dividendos", /dividendos:\s*dividendos\s*\?\?/.test(pagarYCerrar), true);
const gestion = readFileSync(
  join(process.cwd(), "src", "components", "gestion", "GestionJugadasModule.tsx"),
  "utf8"
);
eq("Gestion de Jugadas pasa los dividendos", /dividendos:\s*dividendosDePizarra\(/.test(gestion), true);

console.log(`\nTODAS: ${pasan} pasaron, ${fallan} fallaron`);
if (fallan) process.exit(1);
