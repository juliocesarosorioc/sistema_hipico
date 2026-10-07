// ============================================================================
// CONTRATO DE FECHAS — la defensa contra el incidente del 04-10-2026.
//
// Estas pruebas fijan las TRES reglas de `src/lib/fechas.ts`:
//
//   A. A la base solo sale ISO. En particular que "04-10-2026" jamas viaje crudo.
//   B. Una entrada ambigua se DECLARA ambigua, no se resuelve en silencio.
//   C. La validacion falla cerrada: `exigirFechaIso` lanza, nunca devuelve null.
//
// El caso `04-10-2026` tiene su propio bloque porque es el que produjo el
// incidente: sin esta prueba, alguien vuelve a "simplificar" el regex y la
// fecha cruda se fuga al INSERT otra vez.
//
// Corre con:  npx tsx pruebas/fechas.test.ts
// ============================================================================
import {
  esFechaIso,
  exigirFechaIso,
  fechaOpcional,
  interpretarFecha,
  isoAFechaLocal,
} from "../src/lib/fechas";

let pasan = 0;
let fallan = 0;
const ok = (m: string) => { pasan++; console.log(`  ok   ${m}`); };
const mal = (m: string, d?: string) => { fallan++; console.log(`  FALLA ${m}${d ? `\n         ${d}` : ""}`); };
const igual = (real: unknown, esperado: unknown, m: string) =>
  JSON.stringify(real) === JSON.stringify(esperado)
    ? ok(`${m} -> ${JSON.stringify(real)}`)
    : mal(m, `esperado ${JSON.stringify(esperado)}, llego ${JSON.stringify(real)}`);

// ----------------------------------------------------------------------------
// EL CASO DEL INCIDENTE
// ----------------------------------------------------------------------------
console.log("\n== El caso que rompio la jornada del 04-10-2026 ==");

{
  // Lo que el operador escribio. El guion TIENE que aceptarse: es como se
  // escribe una fecha todos los dias en Venezuela.
  const r = interpretarFecha("04-10-2026");
  igual(r.iso, "2026-10-04", "04-10-2026 se lee como 4 de OCTUBRE (convencion del pais)");
  igual(r.ambigua, true, "04-10-2026 se declara AMBIGUA");
  igual(r.alternativas, ["2026-10-04", "2026-04-10"], "04-10-2026 ofrece las dos lecturas");

  // Y lo que NO se puede hacer: devolver null y que el texto crudo se vaya al
  // servidor. Si esta prueba falla, el bug del 04 de octubre esta de vuelta.
  if (r.iso === null) mal("04-10-2026 NO debe devolver null (se iba crudo a Postgres)");
  else ok("04-10-2026 nunca queda sin normalizar");

  // La version que lanza: una fecha ambigua detiene la operacion y explica.
  let fallo = "";
  try { exigirFechaIso("04-10-2026", "Fecha de la carrera"); }
  catch (e) { fallo = (e as Error).message; }
  if (/AMBIGUA/.test(fallo)) ok("exigirFechaIso detiene la ambigua y lo dice");
  else mal("exigirFechaIso debe rechazar la ambigua", fallo || "no lanzo");

  // Y con confirmacion explicita si.
  igual(exigirFechaIso("04-10-2026", "Fecha de la carrera", false), "2026-10-04",
    "exigirFechaIso(ambiguaSi=false) si resuelve, para lecturas");
}

{
  // El otro lado: "10-04-2026" leido como dia/mes es el 10 de ABRIL. Que el
  // sistema no lo confunda con el 4 de octubre.
  igual(interpretarFecha("10-04-2026").iso, "2026-04-10", "10-04-2026 se lee como 10 de ABRIL");
}

{
  // El texto que el servidor si sabe leer sin ambiguedad: se respeta tal cual.
  igual(interpretarFecha("2026-10-04").iso, "2026-10-04", "ISO pasa intacto");
  igual(interpretarFecha("2026-10-04").ambigua, false, "ISO nunca es ambiguo");
  igual(interpretarFecha("2026-10-04T00:00:00Z").iso, "2026-10-04", "ISO con hora se recorta al dia");
  igual(interpretarFecha("20261004").iso, "2026-10-04", "ISO compacto se acepta");
}

{
  // Una fecha que NO es ambigua porque el dia no puede ser mes.
  igual(interpretarFecha("25-12-2026").iso, "2026-12-25", "25-12-2026 es 25 de diciembre, no ambiguo");
  igual(interpretarFecha("25-12-2026").ambigua, false, "25/12 no puede ser ambigua");
  igual(interpretarFecha("31/01/2026").iso, "2026-01-31", "31/01/2026 es 31 de enero");
}

{
  // El formato largo de la Gaceta (lo que devuelve la IA) y el separador con
  // punto, que tambien se usa.
  igual(interpretarFecha("Domingo, 4 de Octubre de 2026").iso, "2026-10-04", "texto largo de la Gaceta");
  igual(interpretarFecha("4 de Octubre de 2026").iso, "2026-10-04", "texto largo sin el dia de la semana");
  igual(interpretarFecha("04.10.2026").iso, "2026-10-04", "punto como separador");
}

// ----------------------------------------------------------------------------
// A. A LA BASE SOLO SALE ISO
// ----------------------------------------------------------------------------
console.log("\n== Regla A: solo ISO llega a la base ==");

for (const iso of ["2026-10-04", "2026-01-31", "2024-02-29"]) {
  igual(esFechaIso(iso), true, `esFechaIso("${iso}")`);
}
// El 29 de febrero de 2025 no existe (2025 no es bisiesto): tiene que rechazarse,
// o el servidor se inventa una fecha.
for (const falso of ["2025-02-29", "2026-02-30", "2026-13-01", "2026-00-10", "2026-04-31"]) {
  igual(esFechaIso(falso), false, `esFechaIso("${falso}") es false (no existe)`);
}
// Textos que SOLIAN colarse y no son ISO aceptable para una columna date.
for (const crudo of ["04-10-2026", "10/04/2026", "4 de octubre de 2026", "", "hoy", "2026-10", "20261004"]) {
  igual(esFechaIso(crudo), false, `esFechaIso("${crudo}") es false (no es ISO)`);
}

// ----------------------------------------------------------------------------
// C. FALLA CERRADA: lo que no se puede interpretar LANZA, no pasa
// ----------------------------------------------------------------------------
console.log("\n== Regla C: la validacion falla cerrada ==");

for (const malo of ["", "   ", "ayer", "2026-13-40", "32/01/2026", "2026-02-30", null, undefined]) {
  let msg = "";
  try { exigirFechaIso(malo, "Fecha de la carrera"); mal(`exigirFechaIso(${JSON.stringify(malo)}) debe lanzar`); }
  catch (e) { msg = (e as Error).message; ok(`exigirFechaIso(${JSON.stringify(malo)}) lanza: ${msg.slice(0, 58)}...`); }
}

// ----------------------------------------------------------------------------
// B. AMBIGUEDAD DECLARADA, NO RESUELTA EN SILENCIO
// ----------------------------------------------------------------------------
console.log("\n== Regla B: la ambiguedad se declara ==");

{
  // Las dos lecturas, siempre la del pais primero.
  const r = interpretarFecha("05-06-2026");
  igual(r.alternativas, ["2026-06-05", "2026-05-06"], "05-06-2026 ofrece 5 de junio y 6 de mayo");
  igual(r.iso, "2026-06-05", "y la del pais va primera (5 de junio)");

  // Todo lo que se puede leer de dos maneras con dia <= 12 es ambiguo, MENOS
  // cuando dia y mes coinciden: ahi las dos lecturas dan la misma fecha.
  for (const d of ["01-02", "04-10", "12-11"]) {
    const anio = "2026";
    const r2 = interpretarFecha(`${d}-${anio}`);
    if (r2.ambigua) ok(`${d}-${anio} es ambiguo (dia ${r2.alternativas[0]} o ${r2.alternativas[1]})`);
    else mal(`${d}-${anio} deberia ser ambiguo`, `alternativas: ${JSON.stringify(r2.alternativas)}`);
  }

  // 09-09-2026: dia = mes, las dos lecturas coinciden. NO es ambiguo y por eso
  // `exigirFechaIso` lo acepta sin pedir confirmacion.
  igual(interpretarFecha("09-09-2026").iso, "2026-09-09", "09-09-2026 es el 9 de septiembre");
  igual(interpretarFecha("09-09-2026").ambigua, false, "09-09-2026 NO es ambiguo (dia = mes)");
  igual(exigirFechaIso("09-09-2026", "Fecha de la carrera"), "2026-09-09",
    "09-09-2026 pasa sin pedir confirmacion");
}

// ----------------------------------------------------------------------------
// Utilidades
// ----------------------------------------------------------------------------
console.log("\n== Utilidades ==");

igual(fechaOpcional("").iso, null, 'fechaOpcional("") es null (vacio, no error)');
igual(fechaOpcional("").motivo, null, 'y no es un error');
igual(fechaOpcional("ayer").motivo !== null, true, 'fechaOpcional("ayer") SI explica el motivo');
igual(fechaOpcional("churro").motivo !== null, true, 'fechaOpcional("churro") SI explica el motivo');
igual(isoAFechaLocal("2026-10-04"), "04/10/2026", "isoAFechaLocal muestra dd/mm/aaaa");
igual(isoAFechaLocal("basura"), "basura", "isoAFechaLocal no inventa fecha para basura");

// ----------------------------------------------------------------------------
console.log(`\n${fallan === 0 ? "TODO OK" : "HAY FALLAS"}: ${pasan} ok, ${fallan} fallaron\n`);
process.exit(fallan > 0 ? 1 : 0);
