// ============================================================================
// DÍA DE LA JUGADA = día de la CARRERA (no el de la venta)
// ----------------------------------------------------------------------------
// El reporte de liquidación, la liquidación de saldos y la reversión filtraban
// los tickets por `fecha_registro` (el instante de la VENTA). Una jugada cargada
// hoy para una carrera de ayer (o al revés) quedaba fuera: el reporte salía
// vacío y la carrera no se acreditaba. El eje correcto es `fecha_carrera` (lo
// sella el trigger `trg_tickets_fecha_carrera`), con respaldo a la ventana de
// venta sólo para las filas heredadas sin la columna.
//
// Sin base de datos se blinda por inspección de fuente, como el resto.
//
// Corre con:  node pruebas/correr.cjs
// ============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";

let pasan = 0;
let fallan = 0;
const ok = (m: string, c: boolean) => {
  if (c) {
    pasan++;
    console.log(`  ok   ${m}`);
  } else {
    fallan++;
    console.log(`  FALLA ${m}`);
  }
};

const raiz = process.cwd();
const leer = (...p: string[]) => readFileSync(join(raiz, ...p), "utf8");

const fecha = leer("src", "features", "liquidacion", "lib", "fecha.ts");

console.log("\n== filtroDiaJornada: fecha_carrera + respaldo a la venta ==");
ok("declara filtroDiaJornada", /export function filtroDiaJornada/.test(fecha));
ok("filtra por fecha_carrera", /fecha_carrera\.eq\./.test(fecha));
ok("respalda fecha_carrera nula", /fecha_carrera\.is\.null/.test(fecha));
ok("respalda la ventana de fecha_registro", /fecha_registro\.gte/.test(fecha));

const usos: Array<[string, string[]]> = [
  ["reporte de liquidación", ["src", "features", "liquidacion", "lib", "reportes.ts"]],
  ["liquidación de saldos", ["src", "features", "liquidacion", "lib", "saldos.ts"]],
  ["reversión / re-liquidación", ["src", "features", "liquidacion", "lib", "recalcular.ts"]],
  ["relación de resultados", ["src", "features", "impresion", "lib", "reportGenerator.ts"]],
];

console.log("\n== Todos los caminos usan filtroDiaJornada ==");
for (const [nombre, ruta] of usos) {
  const src = leer(...ruta);
  ok(`${nombre}: usa filtroDiaJornada`, /filtroDiaJornada\(/.test(src));
  ok(`${nombre}: no acota tickets por fecha_registro (regresión)`, !/\.gte\("fecha_registro"/.test(src));
}

console.log(`\n${pasan} pasaron, ${fallan} fallaron`);
process.exit(fallan > 0 ? 1 : 0);
