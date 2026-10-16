// ============================================================================
// ÍTEM 7 — PP = 10/10 y MATCH sin fracción se juega PP.
//
// Regla del dueño: un MATCH/emparejamiento que NO declara fracción se juega
// PELO A PELO, así que la JUGADA se guarda como "PP" (=10/10) y los ejemplares
// quedan en la columna CABALLO. Vale para pareo simple ("1x6") y para el
// emparejamiento dividido ("1-2 x 3-4"). Si el match declara fracción
// ("1-2X3-4 10/7" · "2x3 10/8"), la fracción prevalece (A Premio).
//
// Corre con:  node pruebas/correr.cjs
// ============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { clasificarLineaRapida } from "../src/features/taquilla/lib/validar";
import { proporcionDeclarada, esPareo, rotuloPareo } from "../src/features/taquilla/lib/nomenclatura";

let pasan = 0;
let fallan = 0;
const si = (c: boolean, m: string, d?: string) => {
  if (c) { pasan++; console.log(`  ok   ${m}`); }
  else { fallan++; console.log(`  FALLA ${m}${d ? `\n         ${d}` : ""}`); }
};

console.log("\n== Clasificación: MATCH sin fracción → JUGADA PP (ejemplares en CABALLO) ==");
for (const [linea, jugada, caballo] of [
  ["1x6 100 Ana", "PP", "1X6"],
  ["4x7 100 Ana", "PP", "4X7"],
  ["(4x7) 100 Ana", "PP", "4X7"],
  ["6x7 100 Ana", "PP", "6X7"],
  ["1-2x3-4 100 Ana", "PP", "1-2X3-4"],
  ["1,2 x 3,4 100 Ana", "PP", "1,2 X 3,4"],
] as Array<[string, string, string]>) {
  const r = clasificarLineaRapida(linea);
  si(r?.ok === true && r.jugada === jugada && r.caballo === caballo,
    `"${linea}" → JUGADA ${jugada} · CABALLO ${caballo}`, JSON.stringify(r));
}

console.log("\n== MATCH CON fracción declarada → la fracción prevalece (A Premio) ==");
for (const [linea, jugada, caballo] of [
  ["1-2X3-4 10/7 100 Ana", "10/7", "1-2X3-4"],
  ["1-2x3-4 10a7 100 Ana", "10A7", "1-2X3-4"],
  ["10A8 (1x6) 100 Ana", "10A8", "1X6"],
  ["2x3 10/8 100 Ana", "2X3 10/8", ""],
] as Array<[string, string, string]>) {
  const r = clasificarLineaRapida(linea);
  si(r?.ok === true && r.jugada === jugada && r.caballo === caballo,
    `"${linea}" → JUGADA ${jugada} · CABALLO ${caballo}`, JSON.stringify(r));
}

console.log("\n== Proporción declarada: MATCH sin fracción = PP (10/10) ==");
for (const [jugada, esperado] of [
  ["4x7", "10/10"],
  ["1X6", "10/10"],
  ["PP", "10/10"],
  ["2x3 10/8", "10/8"],
  ["10/6", "10/6"],
] as Array<[string, string]>) {
  si(proporcionDeclarada(jugada) === esperado, `proporcionDeclarada("${jugada}") → ${esperado}`, proporcionDeclarada(jugada));
}

console.log("\n== Detección de pareo/MATCH ==");
si(esPareo("4x7") === true, 'esPareo("4x7") → true');
si(esPareo("", "1X6") === true, 'esPareo con caballo "1X6" → true');
si(esPareo("PP") === true, 'esPareo("PP") → true');
si(esPareo("2P", "1") === false, 'esPareo("2P", "1") → false');

console.log("\n== Rótulo del badge (solo cuando aporta) ==");
si(rotuloPareo("PP") === "", 'rotuloPareo("PP") → "" (la jugada ya dice PP)');
si(rotuloPareo("PP", "1X6") === "", 'rotuloPareo("PP","1X6") → "" (nada que aclarar)');
si(rotuloPareo("4X7") === "PP (10/10)", 'rotuloPareo("4X7") → "PP (10/10)" (fila legacy)');
si(rotuloPareo("2x3 10/8") === "10/8", 'rotuloPareo("2x3 10/8") → "10/8" (fracción declarada)');
si(rotuloPareo("2P", "1") === "", 'rotuloPareo("2P","1") → "" (no es pareo)');

console.log("\n== La UI usa el rótulo compartido (un solo lugar) ==");
const gestion = readFileSync(join(process.cwd(), "src", "features", "gestion", "components", "GestionJugadasModule.tsx"), "utf8");
const reporte = readFileSync(join(process.cwd(), "src", "features", "saldos", "components", "ReporteModule.tsx"), "utf8");
si(/import \{ rotuloPareo \} from "@\/features\/taquilla\/lib\/nomenclatura"/.test(gestion), "Carga Individual importa rotuloPareo");
si(gestion.includes("rotuloPareo(p.jugada, p.caballo)"), "Carga Individual muestra el badge para pareos");
si(/import \{ rotuloPareo \} from "@\/features\/taquilla\/lib\/nomenclatura"/.test(reporte), "el reporte importa el mismo helper");
si(reporte.includes("rotuloPareo(f.jugada, f.caballo)"), "el reporte usa el mismo helper");
si(!/function proporcionDe\(/.test(reporte), "el reporte ya no define su propia copia");

console.log(`\n${pasan} pasaron, ${fallan} fallaron`);
process.exit(fallan > 0 ? 1 : 0);
