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
import { jornadasDesalineadas } from "../src/features/liquidacion/lib/fecha";

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
const igual = (real: unknown, esperado: unknown, m: string) =>
  ok(`${m} -> ${JSON.stringify(real)}`, JSON.stringify(real) === JSON.stringify(esperado));

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

// ============================================================================
// DETECCIÓN DE JUGADAS ARCHIVADAS EN OTRA JORNADA
// ----------------------------------------------------------------------------
// Cuando una jugada queda archivada bajo otra jornada, la liquidación no la
// encuentra y —antes— devolvía un OK en verde: la carrera nunca cobraba ni
// pagaba (VALENCIA C9, LA RINCONADA C9). `jornadasDesalineadas` es el núcleo
// puro que destapa ese caso para que la liquidación falle con un mensaje claro.
// ============================================================================
console.log("\n== jornadasDesalineadas: destapa el día equivocado ==");
{
  igual(
    jornadasDesalineadas("2026-10-18", ["2026-10-18", "2026-10-18"]),
    [],
    "todo el mismo día: nada desalineado"
  );
  igual(
    jornadasDesalineadas("2026-10-17", ["2026-10-18"]),
    ["2026-10-18"],
    "la jugada quedó un día después: se destapa"
  );
  igual(
    jornadasDesalineadas("2026-10-17", ["2026-10-18", "2026-10-16", null, "", "2026-10-17"]),
    ["2026-10-16", "2026-10-18"],
    "varios días y nulos: solo los días reales distintos, ordenados"
  );
  igual(
    jornadasDesalineadas("2026-10-18", ["2026-10-18T12:00:00"]),
    [],
    "acepta timestamps: corta a 10 caracteres"
  );
  igual(jornadasDesalineadas("", ["2026-10-18"]), ["2026-10-18"], "día esperado vacío: todo es 'otro'");
}

console.log("\n== La liquidación ya no miente con un OK en verde ==");
{
  const saldos = leer("src", "features", "liquidacion", "lib", "saldos.ts");
  ok("usa jornadasDesalineadas para detectar el día equivocado", /jornadasDesalineadas\(/.test(saldos));
  ok("devuelve ok:false cuando las jugadas están en otra jornada", /archivadas en OTRA jornada/.test(saldos));
  ok(
    "ya no devuelve 'Sin tickets pendientes' sin comprobar el desalineamiento",
    /jornadasConJugadasDeOtraFecha/.test(saldos)
  );
}

console.log("\n== La taquilla liquida con la jornada REAL de la carrera ==");
{
  const modal = leer("src", "features", "taquilla", "components", "PagarCarreraModal.tsx");
  ok("importa jornadaDeCarrera", /jornadaDeCarrera/.test(modal));
  ok("resuelve la jornada (no usa hoyLocal() fijo al liquidar)", /const dia = jornada \?\?/.test(modal));
  ok("pasa fecha a liquidarCarreraYCerrarTabla", /fecha: dia,[\s\S]{0,120}pizarra/.test(modal));
  ok("pasa fecha a aplicarLiquidacionSaldos", /fecha: dia,[\s\S]{0,200}aplicarLiquidacionSaldos|aplicarLiquidacionSaldos[\s\S]{0,200}fecha: dia/.test(modal));

  const carrerasDia = leer("src", "features", "carreras", "lib", "carreras-dia.ts");
  ok("declara jornadaDeCarrera", /export async function jornadaDeCarrera/.test(carrerasDia));
  ok("la resuelve contra la matriz `carreras`", /from\("carreras"\)/.test(carrerasDia));
}

console.log("\n== El script de reparación es genérico (no por carrera) ==");
{
  const sql = leer("sql", "reparar_jornada_tickets.sql");
  ok("no cablea una carrera concreta", !/carrera\s*=\s*9\b/.test(sql) && !/t\.carrera\s*=\s*9\b/.test(sql));
  ok("resuelve la jornada real contra `carreras`", /from public\.carreras/.test(sql));
  ok("respalda antes de tocar", /tickets_bkp_jornada_/.test(sql));
  ok("actualiza fecha_carrera", /set fecha_carrera = jr\.fecha_real/.test(sql));
}

console.log(`\n${pasan} pasaron, ${fallan} fallaron`);
process.exit(fallan > 0 ? 1 : 0);
