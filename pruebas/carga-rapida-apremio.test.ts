// ============================================================================
// ÍTEM 6 — CARGA RÁPIDA: JUGADAS A PREMIO con "A" y decimal (punto o coma).
//
// El dueño pasa planos de WhatsApp y la Carga Rápida debe interpretarlos:
//   · "10A4" · "10a4" · "10/4"  → la MISMA jugada a premio;
//   · "10A3.5" = "10a3.5" = "10/3,5" (decimal con punto O coma);
//   · los ejemplares entre paréntesis "(2)" · "(1x6)" · "(6x4)" · "(1X6)" van a
//     la columna CABALLO.
// Todas las formas se etiquetan "Jugadas a Premio".
//
// Corre con:  node pruebas/correr.cjs
// ============================================================================
import { normalizarLineaRapida } from "../src/features/taquilla/lib/normalizar";
import { clasificarLineaRapida } from "../src/features/taquilla/lib/validar";
import { categoriaJugada, canonicalizarA_Premio } from "../src/features/taquilla/lib/nomenclatura";

let pasan = 0;
let fallan = 0;
const si = (c: boolean, m: string, d?: string) => {
  if (c) { pasan++; console.log(`  ok   ${m}`); }
  else { fallan++; console.log(`  FALLA ${m}${d ? `\n         ${d}` : ""}`); }
};

/** Monto del normalizador → número (acepta "10.000,00", "24512,5", "10000"). */
const toNum = (s: string): number => {
  const limpio = String(s).replace(/\./g, "").replace(",", ".");
  const n = parseFloat(limpio);
  return Number.isFinite(n) ? n : NaN;
};

// Las 19 líneas del plano de referencia (tal cual las pasó el dueño).
const PLANO: Array<{ linea: string; jugada: string; caballo: string; monto: number; juega: string; da: string }> = [
  { linea: "1) Juega Wisky 10A4 (2) con 10.000,00 da Gareth", jugada: "10A4", caballo: "2", monto: 10000, juega: "Wisky", da: "Gareth" },
  { linea: "2) Juega Miguelon 10A4 (2) con 10.000,00 da Paris", jugada: "10A4", caballo: "2", monto: 10000, juega: "Miguelon", da: "Paris" },
  { linea: "3) Juega Benelli (1x6) con 5.000,00 da Sanchez", jugada: "1X6", caballo: "1X6", monto: 5000, juega: "Benelli", da: "Sanchez" },
  { linea: "4) Juega Guason 10A3.5 (2) con 30.000,00 da Parcero", jugada: "10A3.5", caballo: "2", monto: 30000, juega: "Guason", da: "Parcero" },
  { linea: "5) Juega Enger 10A3 (2) con 100.000,00 da Parcero", jugada: "10A3", caballo: "2", monto: 100000, juega: "Enger", da: "Parcero" },
  { linea: "6) Juega Miguelon 10A3 (2) con 20.000,00 da Yerson", jugada: "10A3", caballo: "2", monto: 20000, juega: "Miguelon", da: "Yerson" },
  { linea: "7) Juega Money 10A3.5 (2) con 2.200,00 da Duran", jugada: "10A3.5", caballo: "2", monto: 2200, juega: "Money", da: "Duran" },
  { linea: "8) Juega Alambre 10A3 (2) con 20.000,00 da Yerson", jugada: "10A3", caballo: "2", monto: 20000, juega: "Alambre", da: "Yerson" },
  { linea: "9) Juega Adolfo 10A8 (1X6) con 15.000,00 da Cheo", jugada: "10A8", caballo: "1X6", monto: 15000, juega: "Adolfo", da: "Cheo" },
  { linea: "10) Juega Caracazo 10A3 (2) con 20.000,00 da Rh", jugada: "10A3", caballo: "2", monto: 20000, juega: "Caracazo", da: "Rh" },
  { linea: "11) Juega Alambre 10A3 (2) con 24.512,50 da Rh", jugada: "10A3", caballo: "2", monto: 24512.5, juega: "Alambre", da: "Rh" },
  { linea: "12) Juega Ps 10A3 (2) con 35.000,00 da Rh", jugada: "10A3", caballo: "2", monto: 35000, juega: "Ps", da: "Rh" },
  { linea: "13) Juega Jaime (6x4) con 5.700,00 da Gringo", jugada: "6X4", caballo: "6X4", monto: 5700, juega: "Jaime", da: "Gringo" },
  { linea: "14) Juega Money 10A3 (2) con 20.000,00 da Newyork", jugada: "10A3", caballo: "2", monto: 20000, juega: "Money", da: "Newyork" },
  { linea: "15) Juega Money 10A3 (2) con 51.510,00 da Yayaju", jugada: "10A3", caballo: "2", monto: 51510, juega: "Money", da: "Yayaju" },
  { linea: "16) Juega Wisky 10A3 (2) con 20.000,00 da Yayaju", jugada: "10A3", caballo: "2", monto: 20000, juega: "Wisky", da: "Yayaju" },
  { linea: "17) Juega Gringo (4x6) con 10.000,00 da Ele", jugada: "4X6", caballo: "4X6", monto: 10000, juega: "Gringo", da: "Ele" },
  { linea: "18) Juega Wisky 10A3 (2) con 10.000,00 da Houston", jugada: "10A3", caballo: "2", monto: 10000, juega: "Wisky", da: "Houston" },
  { linea: "19) Juega Paizita 10A3 (2) con 80.000,00 da Wilmer", jugada: "10A3", caballo: "2", monto: 80000, juega: "Paizita", da: "Wilmer" },
];

// Catálogo de clientes: los que juegan (tras "Juega") y los dadores (tras "da").
const CLIENTES = [...new Set(PLANO.flatMap((j) => [j.juega, j.da]))].map((nombre) => ({ nombre }));

console.log("\n== Las 19 líneas del plano se estructuran (jugada · caballo · monto · clientes) ==");
for (const j of PLANO) {
  const r = normalizarLineaRapida(j.linea, { clientes: CLIENTES });
  si(
    r?.ok === true && r.ok &&
      r.jugada === j.jugada &&
      r.caballo === j.caballo &&
      toNum(r.monto) === j.monto &&
      r.cliente1 === j.juega &&
      r.cliente2 === j.da,
    `"${j.linea.slice(0, 34)}…" → ${j.jugada}·${j.caballo}·${j.monto}·${j.juega}·${j.da}`,
    JSON.stringify(r)
  );
}

console.log("\n== Todas las formas A Premio se etiquetan «Jugadas a Premio» ==");
for (const codigo of ["10A4", "10a4", "10/4", "10A3.5", "10a3.5", "10/3,5", "10a9,75", "10/3.5"]) {
  si(categoriaJugada(codigo) === "Jugadas a Premio", `categoriaJugada("${codigo}") → Jugadas a Premio`, categoriaJugada(codigo));
}
for (const codigo of ["2P", "2N", "3Y3", "PP", "6X4", "1/2 Y 2N"]) {
  si(categoriaJugada(codigo) === "Jugadas de Puestos", `categoriaJugada("${codigo}") sigue siendo Jugadas de Puestos`, categoriaJugada(codigo));
}

console.log("\n== Canonicalización A→/ (punto 2) en un solo lugar ==");
si(canonicalizarA_Premio("10A3") === "10/3", 'canonicalizarA_Premio("10A3") → "10/3"', canonicalizarA_Premio("10A3"));
si(canonicalizarA_Premio("10a3.5") === "10/3,5", 'canonicalizarA_Premio("10a3.5") → "10/3,5"', canonicalizarA_Premio("10a3.5"));
si(canonicalizarA_Premio("10/A") === "10/A", 'forma no canónica se deja intacta ("10/A")', canonicalizarA_Premio("10/A"));

console.log("\n== La barra con punto decimal «10/3.5» ya se detecta como jugada ==");
{
  const c = clasificarLineaRapida("Guason 10/3.5 (2) 30.000 Parcero");
  si(c?.ok === true && c.ok && c.jugada === "10/3.5" && c.caballo === "2",
    '"10/3.5 (2)" → jugada 10/3.5 · caballo 2', JSON.stringify(c));
}

console.log(`\n${pasan} pasaron, ${fallan} fallaron`);
process.exit(fallan > 0 ? 1 : 0);
