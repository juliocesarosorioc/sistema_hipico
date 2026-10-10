// ============================================================================
// REGRESIÓN — clave de dupleta: GUARDAR y BORRAR deben usar la MISMA clave.
//
// Bug del 10-10-2026: el módulo decía "🗑️ Dupleta eliminada" pero la fila seguía
// en la BD. La causa: el componente armaba su propia clave
//   `${carrera1}|${carrera2}${hipodromo}${fecha}`  -> "13|4LARINCONADA2026-10-04"
// mientras `guardarDupleta` persistía la canónica
//   "LARINCONADA|2026-10-04|13|4".
// El `delete().eq("clave", ...)` no encontraba ninguna fila y devolvía ok.
//
// Ahora hay UN solo criterio (`claveDeDupleta` en src/lib/dupletas.ts) y el
// listado pega la `clave` real de la fila al estado.
//
// Corre con:  node pruebas/correr.cjs
// ============================================================================
import { claveDupleta, claveDeDupleta } from "../src/lib/dupletas";

let pasan = 0;
let fallan = 0;
const ok = (m: string) => { pasan++; console.log(`  ok   ${m}`); };
const mal = (m: string, d?: string) => { fallan++; console.log(`  FALLA ${m}${d ? `\n         ${d}` : ""}`); };
const si = (c: boolean, m: string, d?: string) => (c ? ok(m) : mal(m, d));

const base = { hipodromo: "larinconada", fecha: "2026-10-04", carrera1: 13, carrera2: 4 };

// 1) Formato canónico: lo que escribe `guardarDupleta` en la columna `clave`.
si(
  claveDupleta(base) === "LARINCONADA|2026-10-04|13|4",
  "claveDupleta normaliza hipódromo a mayúsculas y usa el formato HIP|fecha|c1|c2",
  `dio: ${claveDupleta(base)}`
);

// 2) Una fila cargada del listado usa SU clave real (la que está en la BD),
//    aunque hipodromo/carreras vengan escritos distinto.
si(
  claveDeDupleta({ ...base, clave: "LA RINCONADA|2026-09-27|14|9" }) === "LA RINCONADA|2026-09-27|14|9",
  "la dupleta con `clave` de fila usa la de la BD (no la recalcula)",
  "la clave de la fila debe mandar"
);

// 3) LA REGRESIÓN: la clave de borrado y la de guardado tienen que coincidir
//    para una matriz recién generada (sin `clave`).
si(
  claveDeDupleta(base) === claveDupleta(base),
  "guardar y borrar calculan la MISMA clave (matriz sin `clave`)",
  `borrar=${claveDeDupleta(base)} guardar=${claveDupleta(base)}`
);

// 4) La fórmula que tenía el componente divergía de la canónica: por eso el
//    delete no matcheaba ninguna fila. Queda documentado como regresión viva.
const formulaVieja = `${base.carrera1}|${base.carrera2}${base.hipodromo}${base.fecha}`;
si(
  formulaVieja !== claveDupleta(base),
  "la fórmula antigua del componente NO coincidía con la guardada (bug cubierto)",
  `vieja=${formulaVieja}`
);

console.log(`\ndupleta-clave.test.js: ${pasan} ok, ${fallan} fallaron.`);
if (fallan > 0) process.exit(1);