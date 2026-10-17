// ============================================================================
// AGRUPACIÓN POR HIPÓDROMO — el Monitor de Hipódromos del Día.
//
// Fija dos reglas que compartieron Tablas Fijas y Carreras del Día:
//
//   A. Con un día concreto, solo entran las carreras de ESE día (cruce por
//      `fecha`, con respaldo en `fecha_creacion`).
//   B. Con `dia === ""` (TODOS LOS DÍAS) NO se filtra: el reporte de Tablas
//      Fijas arranca mostrando todo lo publicado. Antes el panel quedaba vacío
//      porque se comparaba contra "".
//
// Corre con:  node pruebas/correr.cjs
// ============================================================================
import {
  agruparPorHipodromo,
  diaDeCarrera,
  normalizarDia,
  type CarreraAgrupable,
} from "../src/features/carreras/lib/agruparHipodromos";

let pasan = 0;
let fallan = 0;
const ok = (m: string) => { pasan++; console.log(`  ok   ${m}`); };
const mal = (m: string, d?: string) => { fallan++; console.log(`  FALLA ${m}${d ? `\n         ${d}` : ""}`); };
const igual = (real: unknown, esperado: unknown, m: string) =>
  JSON.stringify(real) === JSON.stringify(esperado)
    ? ok(`${m} -> ${JSON.stringify(real)}`)
    : mal(m, `esperado ${JSON.stringify(esperado)}, llego ${JSON.stringify(real)}`);

const filas: CarreraAgrupable[] = [
  { hipodromo: "la rinconada", carrera: 3, fecha: "2026-10-18", estado: "Programada" },
  { hipodromo: "LA RINCONADA", carrera: 1, fecha: "2026-10-18", estado: "Liquidada" },
  { hipodromo: "Santa Rita", carrera: 2, fecha: "2026-10-19", estado: "Programada" },
  { hipodromo: "Santa Rita", carrera: 5, fecha_creacion: "2026-10-19", estado: "Programada" },
  // Sin hipódromo o sin carrera: se descartan siempre.
  { hipodromo: "", carrera: 9, fecha: "2026-10-18" },
  { hipodromo: "Valencia", carrera: 0, fecha: "2026-10-18" },
];

console.log("\n== normalizarDia / diaDeCarrera ==");
igual(normalizarDia("18-10-2026"), "2026-10-18", "DD-MM-YYYY a ISO");
igual(normalizarDia("2026-10-18T12:00:00"), "2026-10-18", "ISO con hora");
igual(normalizarDia(""), "", "vacío queda vacío");
igual(diaDeCarrera({ fecha_creacion: "2026-10-19" }, "1999-01-01"), "2026-10-19", "cae a fecha_creacion");
igual(diaDeCarrera({ fecha: "" }, "2026-10-18"), "2026-10-18", "cae al fallback");

console.log("\n== TODOS LOS DÍAS (dia vacío) ==");
const todos = agruparPorHipodromo(filas, "");
igual(todos.map((g) => g.hipodromo), ["LARINCONADA", "SANTARITA"], "agrupa ambas fechas y normaliza la clave");
igual(todos.find((g) => g.hipodromo === "LARINCONADA")?.carreras.map((c) => c.carrera), [1, 3], "ordena las carreras");
igual(todos.find((g) => g.hipodromo === "SANTARITA")?.carreras.map((c) => c.carrera), [2, 5], "incluye la del día por fecha_creacion");

console.log("\n== UN DÍA CONCRETO ==");
const d18 = agruparPorHipodromo(filas, "2026-10-18");
igual(d18.map((g) => g.hipodromo), ["LARINCONADA"], "solo el día elegido");
const d19 = agruparPorHipodromo(filas, "2026-10-19");
igual(d19.map((g) => g.hipodromo), ["SANTARITA"], "el otro día");
igual(d19[0].carreras.map((c) => c.carrera), [2, 5], "mismo día por fecha o fecha_creacion");

console.log("\n== DESCARTA SIN HIPÓDROMO / SIN CARRERA ==");
igual(agruparPorHipodromo(filas, "").flatMap((g) => g.carreras).length, 4, "solo quedan las 4 válidas");

console.log(`\n  ${pasan} ok, ${fallan} fallaron`);
if (fallan > 0) process.exit(1);
