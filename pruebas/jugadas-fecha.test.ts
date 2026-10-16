// ============================================================================
// REGRESIÓN — "no puede haber jugada sin fecha".
//
// Protege el contrato del 10-10-2026: la fecha de CARRIERA de una jugada vive en
// `nota_auditoria.fecha_carrera`; las filas heredadas (p. ej. WPS_LEGACY) no la
// traían y se mostraban "sin fecha". `fechaCarreraDeJugada` debe caer al
// respaldo `fecha_registro` (fecha real en que se registró) y nunca devolver
// vacío si existe una fecha registrable.
//
// Corre con:  node pruebas/correr.cjs
// ============================================================================
import { fechaCarreraDeJugada, type JugadaAdmin } from "../src/features/jugadas/lib/jugadas";

let pasan = 0;
let fallan = 0;
const ok = (m: string) => { pasan++; console.log(`  ok   ${m}`); };
const mal = (m: string, d?: string) => { fallan++; console.log(`  FALLA ${m}${d ? `\n         ${d}` : ""}`); };
const si = (c: boolean, m: string, d?: string) => (c ? ok(m) : mal(m, d));

function ju(nota: unknown, fechaRegistro: string | null): JugadaAdmin {
  return {
    id: "1",
    hipodromo: "LA RINCONADA",
    carrera: 1,
    nota_auditoria: typeof nota === "string" ? nota : JSON.stringify(nota),
    fecha_registro: fechaRegistro,
  };
}

// 1) La fecha de carrera del JSON manda (ventas nuevas: taquilla, tablas…).
si(
  fechaCarreraDeJugada(ju({ origen: "TAQUILLA", fecha_carrera: "2026-10-04" }, "2026-10-10T12:00:00+00:00")) === "2026-10-04",
  "fecha_carrera del JSON manda",
  "se esperaba 2026-10-04"
);

// 2) Fila heredada sin fecha_carrera (WPS_LEGACY) → respaldo fecha_registro.
si(
  fechaCarreraDeJugada(ju({ origen: "WPS_LEGACY" }, "2026-09-14T15:57:09+00:00")) === "2026-09-14",
  "WPS_LEGACY sin fecha_carrera cae a fecha_registro",
  "se esperaba 2026-09-14"
);

// 3) nota_auditoria que ni siquiera es JSON → respaldo fecha_registro.
si(
  fechaCarreraDeJugada(ju("texto libre de otra módulo", "2026-09-14T15:57:09+00:00")) === "2026-09-14",
  "nota_auditoria no JSON cae a fecha_registro",
  "se esperaba 2026-09-14"
);

// 4) Sin JSON ni fecha_registro → null (no puede pasar si el trigger SQL existe).
si(
  fechaCarreraDeJugada(ju({ origen: "WPS_LEGACY" }, null)) === null,
  "sin JSON ni fecha_registro devuelve null (caso imposible con trigger)"
);

// 5) Una fecha regrabada en JSON con fecha_registro distinta NO debe pisarse.
si(
  fechaCarreraDeJugada(ju({ fecha_carrera: "2026-10-04" }, "2026-10-10T12:00:00+00:00")) === "2026-10-04",
  "fecha_registro posterior no pisa la fecha_carrera del JSON",
  "se esperaba 2026-10-04"
);

console.log(`\njugadas-fecha.test.js: ${pasan} ok, ${fallan} fallaron.`);
if (fallan > 0) process.exit(1);