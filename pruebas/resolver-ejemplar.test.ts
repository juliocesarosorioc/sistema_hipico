/**
 * Pruebas del núcleo PURO de sincronización número de ejemplar → nombre oficial
 * (src/features/liquidacion/lib/resolver-ejemplar-nucleo.ts).
 *
 * Bug que cubre: al cambiar el Nº de caballo en un editor, el nombre del
 * ejemplar quedaba con el ANTERIOR (ej. "ETNA'S NAPPER(USA)"). El núcleo
 * garantiza que el nombre se resuelve SIEMPRE contra el padrón por el número
 * NUEVO.
 */
import {
  indiceNombresPorNumero,
  nombreDeNumero,
  cambioDeNumeroEjemplar,
  clavePadronCarrera,
} from "../src/features/liquidacion/lib/resolver-ejemplar-nucleo";

let fallas = 0;
let aserciones = 0;
function ok(cond: boolean, msg: string) {
  aserciones++;
  if (!cond) {
    fallas++;
    console.error("  ✗ " + msg);
  } else {
    console.log("  ✓ " + msg);
  }
}
function eq<T>(a: T, b: T, msg: string) {
  ok(JSON.stringify(a) === JSON.stringify(b), `${msg} (esperado ${JSON.stringify(b)}, recibido ${JSON.stringify(a)})`);
}

console.log("resolver-ejemplar");

const padron = [
  { numero: 5, nombre: "ORO PURO" },
  { numero: "7", nombre: "ETNA'S NAPPER(USA)" },
  { numero: 12, nombre: "RELAMPAGO" },
  { numero: 9, nombre: "" }, // sin nombre: no se indexa
  { numero: null, nombre: "FANTASMA" }, // sin número: no se indexa
];

// --- Índice ---------------------------------------------------------------
const idx = indiceNombresPorNumero(padron);
eq(idx.size, 3, "el índice descarta ejemplares sin número o sin nombre");
eq(idx.get("5"), "ORO PURO", "número 5 → ORO PURO");
eq(idx.get("7"), "ETNA'S NAPPER(USA)", "número 7 → ETNA'S NAPPER(USA)");

// --- Resolución por número ------------------------------------------------
eq(nombreDeNumero(5, padron), "ORO PURO", "resuelve número 5");
eq(nombreDeNumero("12", padron), "RELAMPAGO", "resuelve número 12 en texto");
eq(nombreDeNumero(7, padron), "ETNA'S NAPPER(USA)", "resuelve número 7");
eq(nombreDeNumero(99, padron), null, "número inexistente → null");
eq(nombreDeNumero("", padron), null, "número vacío → null");
eq(nombreDeNumero(5, []), null, "padrón vacío → null");
eq(nombreDeNumero(5, null), null, "padrón null → null");

// EL BUG: el mismo número siempre trae el MISMO nombre, no el anterior.
eq(nombreDeNumero(5, padron), nombreDeNumero("5", padron), "5 y '5' dan el mismo nombre");

// --- Cambio de número -----------------------------------------------------
ok(cambioDeNumeroEjemplar("7", "5"), "7→5 cambia el número");
ok(!cambioDeNumeroEjemplar("5", "5"), "5→5 no cambia");
ok(!cambioDeNumeroEjemplar(5, "5"), "5 (número) vs '5' (texto) no cambia");
ok(cambioDeNumeroEjemplar("", "5"), "vacío→5 cambia");
ok(cambioDeNumeroEjemplar(7, null), "7→null cambia");

// --- Clave de padrón ------------------------------------------------------
eq(
  clavePadronCarrera("2026-10-18", "La Rinconada", 3),
  "2026-10-18|LARINCONADA|3",
  "clave canónica de carrera (fecha|hipódromo|Nº)"
);
eq(
  clavePadronCarrera("2026-10-18", "la rinconada", "3"),
  clavePadronCarrera("2026-10-18", "LA RINCONADA", 3),
  "la clave ignora mayúsculas y espacios"
);

console.log(`\n${aserciones} pasaron, ${fallas} fallaron`);
if (fallas > 0) process.exit(1);
