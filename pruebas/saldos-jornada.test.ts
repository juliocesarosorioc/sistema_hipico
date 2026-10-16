// ============================================================================
// Fix: `aplicarLiquidacionSaldos` debe scopear por la JORNADA, no por "hoy".
//
// Los tickets viven en `fecha_registro` (día de la VENTA). La función armaba la
// ventana con `hoyLocal()` fijo: al liquidar una carrera de otra jornada
// (resultado cargado con retraso, o carga de una fecha pasada) no encontraba los
// Pendientes y la carrera quedaba sin acreditar. Ahora acepta `fecha` y los
// llamadores que la conocen la pasan (la taquilla "de hoy" sigue igual, con el
// default).
//
// Sin base de datos se blinda por inspección de fuente, como el resto de la
// liquidación transaccional.
//
// Corre con:  node pruebas/correr.cjs
// ============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";

let pasan = 0;
let fallan = 0;
const ok = (n: string, c: boolean) => {
  if (c) { pasan++; console.log(`  ok   ${n}`); }
  else { fallan++; console.log(`  FALLA ${n}`); }
};

const raiz = process.cwd();
const leer = (...p: string[]) => readFileSync(join(raiz, ...p), "utf8");

const saldos = leer("src", "features", "liquidacion", "lib", "saldos.ts");
const pagar = leer("src", "features", "liquidacion", "lib", "pagarYCerrar.ts");
const gestion = leer("src", "features", "gestion", "components", "GestionJugadasModule.tsx");

console.log("\n[1] LiquidarSaldosInput acepta la fecha de la jornada");
ok("el tipo declara `fecha?: string`", /fecha\?:\s*string/.test(saldos));

console.log("\n[2] La ventana usa input.fecha y cae a hoyLocal()");
ok("usa `const f = input.fecha || hoyLocal();`", /const f = input\.fecha \|\| hoyLocal\(\);/.test(saldos));
ok("NO usa `const f = hoyLocal();` (regresión)", !/const f = hoyLocal\(\);/.test(saldos));

console.log("\n[3] Los llamadores que conocen la jornada la pasan");
const pasaFecha = (src: string) => /aplicarLiquidacionSaldos\(\{[\s\S]*?fecha,[\s\S]*?\}\)/.test(src);
ok("pagarYCerrar pasa `fecha`", pasaFecha(pagar));
ok("Gestión de Jugadas pasa `fecha`", pasaFecha(gestion));

console.log(`\n${pasan} pasaron, ${fallan} fallaron`);
process.exit(fallan > 0 ? 1 : 0);
