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
  diaDeAlta,
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

console.log("\n== diaDeAlta (fecha de venta en hora LOCAL) ==");
igual(diaDeAlta("2026-10-18"), "2026-10-18", "sin hora: se corta tal cual");
igual(diaDeAlta("18-10-2026"), "2026-10-18", "DD-MM-YYYY a ISO");
igual(diaDeAlta(""), "", "vacío queda vacío");
igual(diaDeAlta(null), "", "null queda vacío");
igual(diaDeAlta("2026-10-18T12:00:00"), "2026-10-18", "timestamp sin Z = hora local");
// Un ISO en UTC se lleva al día LOCAL (no al de Greenwich): comprobamos que un
// instante de las 23:59 locales cae en el día local correcto sea cual sea el TZ.
{
  const d = new Date(2026, 9, 18, 23, 59, 0); // 18-oct-2026 23:59 LOCAL
  const esperado = "2026-10-18";
  igual(diaDeAlta(d.toISOString()), esperado, "UTC -> día local, no el de Greenwich");
}

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

// ---------------------------------------------------------------------------
// EJE DUAL: una tabla tiene DOS fechas. "carrera" = cuándo corre (`fecha`);
// "venta" = cuándo se vendió/publicó (`fecha_creacion`). Deben poder agruparse
// por separado y, si falta una, caer en la otra.
// ---------------------------------------------------------------------------
console.log("\n== EJE fecha de carrera vs fecha de venta ==");
const mixtas: CarreraAgrupable[] = [
  { hipodromo: "La Rinconada", carrera: 1, fecha: "2026-10-18", fecha_creacion: "2026-10-16" },
  { hipodromo: "Santa Rita", carrera: 2, fecha: "2026-10-18", fecha_creacion: "2026-10-17" },
];
igual(diaDeCarrera(mixtas[0], "x", "carrera"), "2026-10-18", "eje carrera lee `fecha`");
igual(diaDeCarrera(mixtas[0], "x", "venta"), "2026-10-16", "eje venta lee `fecha_creacion`");
igual(diaDeCarrera({ fecha: "2026-10-18" }, "x", "venta"), "2026-10-18", "venta cae en `fecha` si no hay alta");
igual(diaDeCarrera({ fecha_creacion: "2026-10-16" }, "x", "carrera"), "2026-10-16", "carrera cae en `fecha_creacion`");
igual(
  agruparPorHipodromo(mixtas, "2026-10-18", "carrera").map((g) => g.hipodromo),
  ["LARINCONADA", "SANTARITA"],
  "eje carrera: el 18 agrupa las dos (corren ese día)"
);
igual(
  agruparPorHipodromo(mixtas, "2026-10-17", "venta").map((g) => g.hipodromo),
  ["SANTARITA"],
  "eje venta: el 17 solo vendió Santa Rita"
);
igual(agruparPorHipodromo(mixtas, "2026-10-18", "venta").length, 0, "eje venta: el 18 no se vendió nada");
igual(agruparPorHipodromo(mixtas, "2026-10-17", "carrera").length, 0, "eje carrera: el 17 no corre nadie");
igual(agruparPorHipodromo(mixtas, "", "venta").flatMap((g) => g.carreras).length, 2, "eje venta sin día: TODAS");

console.log("\n== UNIFICACIÓN Y REDACCIÓN CANÓNICA (Gulfstream Park y Charles Town) ==");
const { claveHipodromo } = require("../src/features/carreras/lib/claves");
const { formatearNombre, normalizarNombreHipodromo } = require("../src/features/hipodromos/lib/tipos");
const { nombrePropioHipodromo, nombreHipodromoParaMostrar } = require("../src/features/hipodromos/lib/nombre");

// 1. Unificación canónica de Hollywood Charles Town y Charles Town
igual(claveHipodromo("Hollywood Charles Town"), "CHARLESTOWN", "Hollywood Charles Town clave es CHARLESTOWN");
igual(claveHipodromo("Charles Town"), "CHARLESTOWN", "Charles Town clave es CHARLESTOWN");
igual(claveHipodromo("HOLLYWOOD CHARLES TOWN"), "CHARLESTOWN", "HOLLYWOOD CHARLES TOWN clave es CHARLESTOWN");
igual(formatearNombre("Hollywood Charles Town"), "Charles Town", "formatearNombre unifica Hollywood Charles Town a Charles Town");
igual(formatearNombre("Charles Town"), "Charles Town", "formatearNombre mantiene Charles Town");
igual(nombrePropioHipodromo("HOLLYWOODCHARLESTOWN"), "Charles Town", "nombrePropioHipodromo formatea a Charles Town");
igual(nombreHipodromoParaMostrar("Hollywood Charles Town"), "Charles Town", "nombreHipodromoParaMostrar unifica a Charles Town");

// 2. Redacción y separación de Gulfstream Park
igual(claveHipodromo("Gulfstream Park"), "GULFSTREAMPARK", "Gulfstream Park clave es GULFSTREAMPARK");
igual(claveHipodromo("Gulfstreampark"), "GULFSTREAMPARK", "Gulfstreampark clave es GULFSTREAMPARK");
igual(claveHipodromo("GULFSTREAM"), "GULFSTREAMPARK", "GULFSTREAM clave es GULFSTREAMPARK");
igual(formatearNombre("Gulfstreampark"), "Gulfstream Park", "formatearNombre separa Gulfstreampark a Gulfstream Park");
igual(formatearNombre("GULFSTREAMPARK"), "Gulfstream Park", "formatearNombre separa GULFSTREAMPARK a Gulfstream Park");
igual(nombrePropioHipodromo("GULFSTREAMPARK"), "Gulfstream Park", "nombrePropioHipodromo devuelve Gulfstream Park con espacio");
igual(nombreHipodromoParaMostrar("Gulfstreampark"), "Gulfstream Park", "nombreHipodromoParaMostrar devuelve Gulfstream Park");

// 3. Agrupación unificada en agruparPorHipodromo
const carrerasMixtasCharlesTown: CarreraAgrupable[] = [
  { hipodromo: "Hollywood Charles Town", carrera: 1, fecha: "2026-10-30" },
  { hipodromo: "Charles Town", carrera: 2, fecha: "2026-10-30" },
  { hipodromo: "Gulfstreampark", carrera: 1, fecha: "2026-10-30" },
  { hipodromo: "Gulfstream Park", carrera: 2, fecha: "2026-10-30" },
];
const gruposUnificados = agruparPorHipodromo(carrerasMixtasCharlesTown, "2026-10-30");
igual(gruposUnificados.map((g) => g.hipodromo), ["CHARLESTOWN", "GULFSTREAMPARK"], "unifica en 2 únicos hipódromos");
igual(gruposUnificados.find((g) => g.hipodromo === "CHARLESTOWN")?.carreras.map((c) => c.carrera), [1, 2], "carreras 1 y 2 unificadas en Charles Town");
igual(gruposUnificados.find((g) => g.hipodromo === "GULFSTREAMPARK")?.carreras.map((c) => c.carrera), [1, 2], "carreras 1 y 2 unificadas en Gulfstream Park");

console.log(`\n  ${pasan} ok, ${fallan} fallaron`);
if (fallan > 0) process.exit(1);
