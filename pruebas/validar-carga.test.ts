// ============================================================================
// CONTRATO DE LA VALIDACION DE CARGA — el escudo del 04-10-2026.
//
// Reproduce el incidente como caso de prueba: si alguien quita la regla, la
// jornada se vuelve a partir y estas pruebas se ponen rojas.
//
// Corre con:  npx tsx pruebas/validar-carga.test.ts
// ============================================================================
import { resumenProblemasCarga, validarFechasDeCarga } from "../src/lib/tablas/validar-carga";

let pasan = 0;
let fallan = 0;
const ok = (m: string) => { pasan++; console.log(`  ok   ${m}`); };
const mal = (m: string, d?: string) => { fallan++; console.log(`  FALLA ${m}${d ? `\n         ${d}` : ""}`); };
const si = (c: boolean, m: string, d?: string) => (c ? ok(m) : mal(m, d));

// ----------------------------------------------------------------------------
// EL INCIDENTE, DE NUEVO
// ----------------------------------------------------------------------------
console.log("\n== El incidente del 04-10-2026 reproducido ==");

{
  // Tal cual como llegó a producción: C10 con la fecha invertida, el resto con
  // la buena. Con la regla OFF, esto se publicaba así y partía la jornada.
  const drafts = [
    { uid: "1", hipodromo: "LA RINCONADA", carrera: "9", fecha: "2026-10-04" },
    { uid: "2", hipodromo: "LA RINCONADA", carrera: "10", fecha: "04-10-2026" },
    { uid: "3", hipodromo: "LA RINCONADA", carrera: "11", fecha: "10-04-2026" },
    { uid: "4", hipodromo: "LA RINCONADA", carrera: "12", fecha: "2026-10-04" },
  ];
  const r = validarFechasDeCarga(drafts, "2026-10-04");

  si(!r.ok, "el ensamblaje del incidente NO pasa la validación");
  si(r.problemas.length === 2, `los 2 problemas se detectan juntos`, `detectados ${r.problemas.length}`);

  const c10 = r.problemas.find((p) => p.carrera === "10");
  si(!!c10 && /AMBIGUA/i.test(c10.motivo), "C10 con '04-10-2026' se marca ambigua",
     c10?.motivo);
  si(!!c10 && /2026-10-04|2026-04-10/.test(c10.motivo), "y se le muestran las DOS lecturas",
     c10?.motivo);

  const c11 = r.problemas.find((p) => p.carrera === "11");
  si(!!c11 && /2026-04-10/.test(c11.motivo || ""),
     "C11 con '10-04-2026' se detecta como fecha que NO es la jornada",
     c11?.motivo);

  // Y lo más importante: la fecha cruda nunca llega a la base.
  si(r.fechaIso === "2026-10-04", "la fecha que se usaría es ISO de la jornada", r.fechaIso);
}

{
  // El caso todavía más peligroso: la fecha es interpretable y válida, pero es
  // de ABRIL. No es ambigua, no está "mal escrita" — simplemente no es el día
  // que el operador tiene abierto. Solo la regla 3 lo detiene.
  const r = validarFechasDeCarga(
    [{ uid: "x", hipodromo: "LA RINCONADA", carrera: "10", fecha: "2026-04-10" }],
    "2026-10-04"
  );
  si(!r.ok, "una fecha válida de OTRO día también se detiene");
  si(/2026-04-10/.test(r.problemas[0]?.motivo || "") && /2026-10-04/.test(r.problemas[0]?.motivo || ""),
     "y el mensaje dice qué tiene y cuál debería ser", r.problemas[0]?.motivo);
}

// ----------------------------------------------------------------------------
// LOS CASOS NORMALES: no hay que molestar al operador
// ----------------------------------------------------------------------------
console.log("\n== Los casos normales pasan sin ruido ==");

{
  // Sin fecha en la tarjeta: es lo NORMAL (la Gaceta muchas veces no la trae y
  // el operador trabaja la jornada que tiene abierta). No es un problema.
  const r = validarFechasDeCarga(
    [
      { uid: "1", hipodromo: "LA RINCONADA", carrera: "1", fecha: null },
      { uid: "2", hipodromo: "LA RINCONADA", carrera: "2", fecha: "" },
      { uid: "3", hipodromo: "LA RINCONADA", carrera: "3", fecha: undefined },
    ],
    "2026-10-04"
  );
  si(r.ok, "sin fecha en la tarjeta se hereda la jornada y no molesta", JSON.stringify(r.problemas));
}

{
  // DECISION DE DISEÑO: "04/10/2026" con la jornada 2026-10-04 SE DETIENE,
  // aunque las dos lecturas del texto no puedan dar un resultado distinto del
  // que ya se va a publicar.
  //
  // Se podría permitir (el resultado sería el mismo) y sería lo cómodo. No se
  // permite por dos razones:
  //
  //   1. El incidente fue exactamente esto: el operador y el sistema no
  //      ponerse de acuerdo sobre el formato. Si se acepta el texto ambiguo,
  //      se sigue dependiendo de que la convención siga siendo DD/MM, y la
  //      convención es lo primero que otro programador "optimiza".
  //   2. El coste es un campo y un aviso, una vez por tarjeta. El beneficio de
  //      convertir cada fecha a ISO explícito es que la ambigüedad desaparece
  //      del sistema, no que se tolera.
  //
  // Con día > 12 no hay ambigüedad posible y no se molesta a nadie.
  const r = validarFechasDeCarga(
    [{ uid: "1", hipodromo: "LA RINCONADA", carrera: "1", fecha: "04/10/2026" }],
    "2026-10-04"
  );
  si(!r.ok, "'04/10/2026' se detiene aunque resuelva a la jornada, para obligar a dejar el día explícito");
  si(/AMBIGUA/i.test(r.problemas[0]?.motivo || ""), "y el motivo dice que es ambigua", r.problemas[0]?.motivo);
}

{
  // Con día > 12 no hay ambigüedad y se resuelve solo: esto sí pasa sin ruido.
  const r = validarFechasDeCarga(
    [{ uid: "1", hipodromo: "LA RINCONADA", carrera: "1", fecha: "25/10/2026" }],
    "2026-10-25"
  );
  si(r.ok, "'25/10/2026' se resuelve solo y pasa sin molestar", JSON.stringify(r.problemas));
}

{
  // El 09-09 no es ambiguo (día = mes) y debe pasar sin preguntar.
  const r = validarFechasDeCarga(
    [{ uid: "1", hipodromo: "X", carrera: "1", fecha: "09-09-2026" }],
    "2026-09-09"
  );
  si(r.ok, "'09-09-2026' no se considera ambigua", JSON.stringify(r.problemas));
}

// ----------------------------------------------------------------------------
// BASURA: se detiene, y se dice por qué
// ----------------------------------------------------------------------------
console.log("\n== Basura se detiene con motivo ==");

for (const malo of ["ayer", "2026-02-30", "2026-13-01", "cualquier cosa", "2026-10-4-5"]) {
  const r = validarFechasDeCarga(
    [{ uid: "1", hipodromo: "X", carrera: "1", fecha: malo }],
    "2026-10-04"
  );
  si(!r.ok && !!r.problemas[0]?.motivo, `"${malo}" se detiene con motivo`);
  si(
    !!r.problemas[0]?.como,
    `"${malo}" además dice cómo arreglarlo`
  );
}

{
  // La jornada ABIERTA también se valida. Si el date picker devolvió basura,
  // no tiene sentido evaluar las tarjetas contra ella.
  const r = validarFechasDeCarga(
    [{ uid: "1", hipodromo: "X", carrera: "1", fecha: "2026-10-04" }],
    "no-es-fecha"
  );
  si(!r.ok && r.problemas[0]?.uid === "__jornada__", "una jornada abierta inválida se reporta como jornada, no como tarjeta");
}

// ----------------------------------------------------------------------------
// El mensaje que ve el operador
// ----------------------------------------------------------------------------
console.log("\n== El mensaje que ve el operador ==");

{
  const r = validarFechasDeCarga(
    [
      { uid: "1", hipodromo: "LA RINCONADA", carrera: "10", fecha: "04-10-2026" },
      { uid: "2", hipodromo: "LA RINCONADA", carrera: "11", fecha: "2026-04-10" },
    ],
    "2026-10-04"
  );
  const msg = resumenProblemasCarga(r.problemas);
  si(/No se publicaron 2 carreras/.test(msg), "el resumen cuenta las carreras", msg);
  si(/LA RINCONADA C10/.test(msg), "y nombra la primera", msg);
  si(/C11/.test(msg), "y la segunda", msg);
  si(msg.length > 0, "hay un mensaje que leer");

  si(resumenProblemasCarga([]) === "", "sin problemas no hay mensaje");

  const muchos = Array.from({ length: 7 }, (_, i) => ({
    uid: String(i), hipodromo: "X", carrera: String(i), fecha: "basura",
  }));
  const msg2 = resumenProblemasCarga(validarFechasDeCarga(muchos, "2026-10-04").problemas);
  si(/y 3 más/.test(msg2), "si son muchas, avisa cuántas faltan sin volcar las 7", msg2);
}

// ----------------------------------------------------------------------------
console.log(`\n${fallan === 0 ? "TODO OK" : "HAY FALLAS"}: ${pasan} ok, ${fallan} fallaron\n`);
process.exit(fallan > 0 ? 1 : 0);

