// ============================================================================
// BLOQUE 1 — REVERSIÓN DE LA LIQUIDACIÓN DE UNA CARRERA.
//
// El dueño pidió un botón dinámico «🏆 Liquidar Carrera ↔ 🔄 Reversar
// Liquidación» que deshaga por completo la liquidación de una carrera (taquilla,
// tablas fijas, marcas, dupletas, remates, pollas + saldos/cuaderno), la vuelva a
// dejar ABIERTA y refresque los stores, con modal de confirmación propio (nunca
// `window.confirm`).
//
// Sin base de datos no se puede ejercitar el dinero real, así que se blinda:
//   · el NÚCLEO PURO de la reversión (`reversar-nucleo.ts`) — clasificación de
//     modalidad y crédito exacto a devolver (Ganador=premio, Retirado=stake);
//   · el ORQUESTADOR (`reversar.ts`) — permisos, orden especiales→universal,
//     reapertura de remates/pollas, borrado del resultado central y auditoría;
//   · el CABLEADO en Gestión (botón dinámico + modal propio, sin window.confirm).
//
// Corre con:  node pruebas/correr.cjs
// ============================================================================
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  modalidadDeTicket,
  creditoARevertir,
  esEstadoDecidido,
  planearReversion,
  resumirReversion,
} from "../src/features/liquidacion/lib/reversar-nucleo";

let pasan = 0;
let fallan = 0;
function ok(nombre: string, condicion: boolean) {
  if (condicion) {
    pasan++;
    console.log(`  ok   ${nombre}`);
  } else {
    fallan++;
    console.log(`  FALLA ${nombre}`);
  }
}

const raiz = process.cwd();
const leer = (...p: string[]) => readFileSync(join(raiz, ...p), "utf8");
const reversar = leer("src", "features", "liquidacion", "lib", "reversar.ts");
const nucleo = leer("src", "features", "liquidacion", "lib", "reversar-nucleo.ts");
const carrerasDia = leer("src", "features", "carreras", "lib", "carreras-dia.ts");
const gestion = leer("src", "features", "gestion", "components", "GestionJugadasModule.tsx");

// ---------------------------------------------------------------------------
console.log("\n[1] Núcleo puro: modalidad del ticket por nombre_jugada");
ok("TABLA FIJA → TABLA", modalidadDeTicket("TABLA FIJA (LA RINCONADA C1)") === "TABLA");
ok("MARCA x → MARCA", modalidadDeTicket("MARCA 3 vs 5") === "MARCA");
ok("MARCA sola → MARCA", modalidadDeTicket("MARCA") === "MARCA");
ok("DUPLETA → DUPLETA", modalidadDeTicket("DUPLETA 3 x 5") === "DUPLETA");
ok("WPS/Puestos → UNIVERSAL", modalidadDeTicket("2 x 3") === "UNIVERSAL");

console.log("\n[2] Núcleo puro: crédito exacto a revertir por estado");
ok("Ganador devuelve monto_decidido", creditoARevertir({ estado: "Ganador", monto_decidido: 340 }) === 340);
ok("Ganador cae a premio_pagar si no hay monto_decidido", creditoARevertir({ estado: "Ganador", premio_pagar: 90 }) === 90);
ok("Retirado devuelve el stake (monto_jugado)", creditoARevertir({ estado: "Retirado", monto_jugado: 50, monto_decidido: 0 }) === 50);
ok("Perdedor no movió saldo (0)", creditoARevertir({ estado: "Perdedor", monto_jugado: 50 }) === 0);
ok("no decidido no cuenta", esEstadoDecidido("Pendiente") === false && esEstadoDecidido("Ganador") === true);
ok("ANULADO no es decidido", esEstadoDecidido("Anulado") === false);

console.log("\n[3] Núcleo puro: plan + resumen de la reversión");
const plan = planearReversion([
  { id: 1, nombre_jugada: "TABLA FIJA (HIPO C1)", estado: "Ganador", monto_decidido: 1000, cliente_juega_id: "c1" },
  { id: 2, nombre_jugada: "MARCA 2 vs 5", estado: "Retirado", monto_jugado: 200, cliente_juega_id: "c2" },
  { id: 3, nombre_jugada: "DUPLETA 3 x 5", estado: "Ganador", monto_decidido: 500, cliente_juega_id: "c3" },
  { id: 4, nombre_jugada: "2 x 3", estado: "Ganador", monto_decidido: 400, cliente_juega_id: "c4" }, // universal: se ignora
  { id: 5, nombre_jugada: "MARCA 1 vs 4", estado: "Pendiente", monto_jugado: 100, cliente_juega_id: "c5" }, // pendiente: se ignora
]);
ok("ignora el universal (lo maneja revertirLiquidacionCarrera)", plan.every((o) => o.modalidad !== "UNIVERSAL"));
ok("ignora los Pendientes", plan.length === 3);
ok("tabla fija = 1000", plan.find((o) => o.id === 1)?.credito === 1000);
ok("marca retirada = stake 200", plan.find((o) => o.id === 2)?.credito === 200);
ok("dupleta = 500", plan.find((o) => o.id === 3)?.credito === 500);
const res = resumirReversion(plan);
ok("total a devolver = 1700", res.credito === 1700);
ok("conteo por modalidad", res.porModalidad.TABLA.tickets === 1 && res.porModalidad.MARCA.tickets === 1 && res.porModalidad.DUPLETA.tickets === 1);

// ---------------------------------------------------------------------------
console.log("\n[4] Orquestador reversar.ts: permisos, orden y alcance");
ok("exporta reversarLiquidacionCarrera", /export async function reversarLiquidacionCarrera/.test(reversar));
ok("exige la capacidad de re-apertura", /exigirPermiso\(\s*"gestion_jugadas:fn_reabrir_carrera"/.test(reversar));
ok("usa el núcleo puro (planearReversion)", /planearReversion\(/.test(reversar));
ok("revierte las especiales ANTES del barrido universal", reversar.indexOf("await revertirEspecialesDeCarrera") < reversar.indexOf("await revertirLiquidacionCarrera"));
ok("revierte el universal con revertirLiquidacionCarrera", /revertirLiquidacionCarrera\(/.test(reversar));
ok("reabre remates (club_reabrir_remate vía reabrirRemate)", /reabrirRemate\(/.test(reversar));
ok("reabre pollas (cambiarEstadoPolla)", /cambiarEstadoPolla\(/.test(reversar));
ok("borra el resultado central (revertirResultadoCentral)", /revertirResultadoCentral\(/.test(reversar));
ok("resetea estado/premio/monto/comisión del ticket", /estado: "Pendiente", premio_pagar: 0, monto_decidido: 0, comision_pagada: 0/.test(reversar));
ok("deja traza en la auditoría", /"REVERSAR_LIQUIDACION"/.test(reversar));

console.log("\n[5] carreras-dia.ts: revertir el resultado central deja la carrera ABIERTA");
ok("exporta revertirResultadoCentral", /export async function revertirResultadoCentral/.test(carrerasDia));
ok("acepta permisos de reversión o de carga/liquidación", /PERMISOS_REVERTIR_RESULTADO/.test(carrerasDia));
ok("vuelve el store a \"Programada\"", /estado: "Programada"/.test(carrerasDia));
ok("desaplica del central (aplicado_a_tablas=false)", /aplicado_a_tablas: false/.test(carrerasDia));
ok("intenta la RPC dedicada club_revertir_resultado_carrera", /club_revertir_resultado_carrera/.test(carrerasDia));
ok("cae al camino de guardarResultado si la RPC no existe", /guardarResultado\(/.test(carrerasDia));

// ---------------------------------------------------------------------------
console.log("\n[6] Gestión: botón dinámico + modal propio (sin window.confirm)");
ok("importa el reversor", /from "@\/features\/liquidacion\/lib\/reversar"/.test(gestion));
ok("define el handler ejecutarReversar", /const ejecutarReversar = async \(\)/.test(gestion));
ok("tiene el modal de reversión", /const \[modalReversar, setModalReversar\] = useState\(false\)/.test(gestion));
ok("el botón cambia a «Reversar Liquidación»", gestion.includes("🔄 Reversar Liquidación"));
ok("el botón de liquidar es «Liquidar Carrera»", gestion.includes("🏆 Liquidar Carrera"));
ok("el botón de reversar depende de la carrera liquidada + permiso", /carreraLiquidada && puedeReabrir/.test(gestion) || /carreraLiquidada && puedeReabrir \?/.test(gestion));
ok("refresca los saldos tras reversar", /recargarClientes\(\)/.test(gestion) && /reversarLiquidacionCarrera\(\{/.test(gestion));
ok("refresca el registro central tras reversar", /recargarRegistroCentral\(\)/.test(gestion));
// El handler NUNCA usa window.confirm (prohibido): el modal propio es la vía.
const cuerpoReversar = (() => {
  const i = gestion.indexOf("const ejecutarReversar = async () =>");
  if (i < 0) return "";
  const j = gestion.indexOf("\n  };\n", i);
  return gestion.slice(i, j < 0 ? i + 2200 : j + 4);
})();
ok("el handler de reversión NO usa window.confirm", !/window\.confirm/.test(cuerpoReversar));
ok("el modal pide confirmación explícita", gestion.includes("Sí, reversar liquidación"));

// ---------------------------------------------------------------------------
console.log("\n[7] SQL: RPC de reversión del resultado central");
const sqlPath = join(raiz, "sql", "reversar_liquidacion.sql");
ok("existe sql/reversar_liquidacion.sql", existsSync(sqlPath));
const sql = existsSync(sqlPath) ? readFileSync(sqlPath, "utf8") : "";
ok("crea club_revertir_resultado_carrera", /function public\.club_revertir_resultado_carrera/.test(sql));
ok("valida capacidad en el servidor", /tiene_capacidad\(auth\.uid\(\), 'gestion_jugadas:fn_reabrir_carrera'\)/.test(sql));
ok("borra ganadores/orden_llegada/dividendos", /ganadores\s*=\s*null[\s\S]*orden_llegada\s*=\s*null[\s\S]*dividendos\s*=\s*null/.test(sql));
ok("deja de aplicar a tablas", /aplicado_a_tablas\s*=\s*false/.test(sql));

console.log(`\n${pasan} pasaron, ${fallan} fallaron`);
process.exit(fallan > 0 ? 1 : 0);
