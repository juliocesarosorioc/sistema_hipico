// ============================================================================
// ORDEN DE HIPÓDROMOS EN LOS BUSCADORES DE JORNADA.
//
// La regla nació en Gestión de Jugadas: primero los hipódromos que TIENEN
// carreras cargadas ese día, después el resto del catálogo (que nunca se
// recorta). Pollas e Inteligencia la comparten para que el operador encuentre
// la jornada en el mismo lugar en todas las pantallas.
//
// Lo que se protege acá:
//   1. Se compara por CLAVE canónica: "LA RINCONADA" del catálogo matchea
//      "LARINCONADA" del registro central (sin espacios).
//   2. El `value` puede ser un ID (Pollas filtra por `hipodromo_id`): el orden
//      se decide por `nombreDe(opcion)`, no por el id.
//   3. Sin jornada no se reordena ni se pierde nada.
//
// Corre con:  node pruebas/correr.cjs
// ============================================================================
import { ordenarHipodromosDeLaJornada } from "../src/shared/lib/hipodromos-jornada";

let pasan = 0;
let fallan = 0;
const ok = (m: string) => {
  pasan++;
  console.log(`  ok   ${m}`);
};
const mal = (m: string, d?: string) => {
  fallan++;
  console.log(`  FALLA ${m}${d ? `\n         ${d}` : ""}`);
};
const si = (c: boolean, m: string, d?: string) => (c ? ok(m) : mal(m, d));
const igual = (a: unknown, b: unknown, m: string) =>
  si(
    JSON.stringify(a) === JSON.stringify(b),
    m,
    `esperado ${JSON.stringify(b)} · recibido ${JSON.stringify(a)}`
  );

// ---------------------------------------------------------------------------
console.log("[1] catálogo con nombres como valor (Gestión / Inteligencia)");
// ---------------------------------------------------------------------------

const catalogo = [
  { value: "VALENCIA", label: "Valencia" },
  { value: "LA RINCONADA", label: "La Rinconada" },
  { value: "SANTA RITA", label: "Santa Rita" },
];

const orden = ordenarHipodromosDeLaJornada(catalogo, ["LARINCONADA"]);
igual(
  orden.map((o) => o.value),
  ["LA RINCONADA", "SANTA RITA", "VALENCIA"],
  "el del día va primero; el resto queda alfabético y NO se recorta"
);
igual(
  orden.length,
  catalogo.length,
  "el catálogo completo sigue disponible (3 de 3)"
);

const dosDelDia = ordenarHipodromosDeLaJornada(catalogo, ["SANTA RITA", "LARINCONADA"]);
igual(
  dosDelDia.map((o) => o.value),
  ["LA RINCONADA", "SANTA RITA", "VALENCIA"],
  "dos del día se ordenan entre sí por etiqueta"
);
igual(
  ordenarHipodromosDeLaJornada(
    [{ value: "", label: "Todos" }, ...catalogo],
    ["LARINCONADA"]
  ).map((o) => o.value),
  ["", "LA RINCONADA", "SANTA RITA", "VALENCIA"],
  "la opción vacía para ver todos se conserva al inicio del selector"
);

// ---------------------------------------------------------------------------
console.log("\n[2] value = ID con nombre real aparte (Pollas)");
// ---------------------------------------------------------------------------

const porId = [
  { value: "uuid-3", label: "Valencia" },
  { value: "uuid-1", label: "La Rinconada" },
  { value: "uuid-2", label: "Santa Rita" },
];
const nombreDe = (o: { value: string }) =>
  ({ "uuid-1": "LA RINCONADA", "uuid-2": "SANTA RITA", "uuid-3": "VALENCIA" })[o.value] ?? "";

igual(
  ordenarHipodromosDeLaJornada(porId, ["LA RINCONADA"], nombreDe).map((o) => o.value),
  ["uuid-1", "uuid-2", "uuid-3"],
  "ordena por el NOMBRE real aunque el value sea un UUID"
);

// ---------------------------------------------------------------------------
console.log("\n[3] sin jornada: no se toca el orden");
// ---------------------------------------------------------------------------

igual(
  ordenarHipodromosDeLaJornada(catalogo, []).map((o) => o.value),
  ["VALENCIA", "LA RINCONADA", "SANTA RITA"],
  "sin carreras cargadas se respeta el orden recibido"
);

const original = [...catalogo];
ordenarHipodromosDeLaJornada(catalogo, ["LARINCONADA"]);
igual(
  catalogo.map((o) => o.value),
  original.map((o) => o.value),
  "no muta el arreglo original (el catálogo del store queda intacto)"
);

// ---------------------------------------------------------------------------
console.log("\n[4] claves sucias no rompen la comparación");
// ---------------------------------------------------------------------------

igual(
  ordenarHipodromosDeLaJornada(catalogo, ["  la rinconada  "]).map((o) => o.value),
  ["LA RINCONADA", "SANTA RITA", "VALENCIA"],
  "espacios y minúsculas se normalizan por claveHipodromo"
);

console.log(`\n${pasan} pasaron, ${fallan} fallaron`);
process.exit(fallan > 0 ? 1 : 0);
