/**
 * Pruebas del núcleo PURO de estados maestros de jugada
 * (src/features/liquidacion/lib/estados-jugada.ts).
 *
 * Regla: TODA la plataforma muestra PENDIENTE / LIQUIDADA / ANULADA, y las
 * jugadas ANULADAS quedan SIEMPRE fuera de las sumatorias financieras.
 */
import {
  estadoMaestro,
  esLiquidada,
  esAnulada,
  esPendiente,
  sumarVigente,
  contarPorEstado,
  filtrarPorEstado,
  ESTADOS_MAESTROS,
  ETIQUETA_ESTADO,
} from "../src/features/liquidacion/lib/estados-jugada";

let fallas = 0;
let aserciones = 0;
function ok(cond: boolean, msg: string) {
  aserciones++;
  if (!cond) {
    fallas++;
    console.error("  ✗ " + msg);
  } else {
    console.log("  ✓ " + msg);
  }
}
function eq<T>(a: T, b: T, msg: string) {
  ok(JSON.stringify(a) === JSON.stringify(b), `${msg} (esperado ${JSON.stringify(b)}, recibido ${JSON.stringify(a)})`);
}

console.log("estados-jugada");

// --- Mapeo de estados internos a maestros --------------------------------
eq(ESTADOS_MAESTROS.length, 3, "hay exactamente 3 estados maestros");
eq(estadoMaestro({ estado: "Pendiente" }), "PENDIENTE", "Pendiente → PENDIENTE");
eq(estadoMaestro({ estado: "Ganador" }), "LIQUIDADA", "Ganador → LIQUIDADA");
eq(estadoMaestro({ estado: "Perdedor" }), "LIQUIDADA", "Perdedor → LIQUIDADA");
eq(estadoMaestro({ estado: "Retirado" }), "LIQUIDADA", "Retirado (jugada) → LIQUIDADA");
eq(estadoMaestro({ estado: "Anulado" }), "ANULADA", "Anulado → ANULADA");
eq(estadoMaestro({ estado: "GANO" }), "LIQUIDADA", "GANO → LIQUIDADA");
eq(estadoMaestro({ estado: "PERDIO" }), "LIQUIDADA", "PERDIO → LIQUIDADA");
eq(estadoMaestro({ estado: "SOLUCIONADO" }), "LIQUIDADA", "SOLUCIONADO → LIQUIDADA");
eq(estadoMaestro({ estado: "Rechazado" }), "ANULADA", "Rechazado → ANULADA");

// La bandera `anulada` manda sobre cualquier estado interno.
eq(estadoMaestro({ estado: "Ganador", anulada: true }), "ANULADA", "anulada=true manda sobre Ganador");
eq(estadoMaestro({ estado: "Pendiente", anulada: true }), "ANULADA", "anulada=true manda sobre Pendiente");
eq(estadoMaestro({ estado: "Ganador", anulada: false }), "LIQUIDADA", "anulada=false respeta el estado");

// Estado vacío / desconocido → PENDIENTE (conservador: no inventa un pago).
eq(estadoMaestro({ estado: "" }), "PENDIENTE", "estado vacío → PENDIENTE");
eq(estadoMaestro({}), "PENDIENTE", "sin estado → PENDIENTE");
eq(estadoMaestro({ estado: "LoQueSea" }), "PENDIENTE", "desconocido → PENDIENTE");

// Acepta el estado suelto (string) además del objeto.
eq(estadoMaestro("Ganador"), "LIQUIDADA", "estado suelto 'Ganador' → LIQUIDADA");
eq(estadoMaestro("anulada"), "ANULADA", "estado suelto 'anulada' → ANULADA");

// --- Predicados -----------------------------------------------------------
ok(esLiquidada({ estado: "Ganador" }), "esLiquidada(Ganador)");
ok(!esLiquidada({ estado: "Pendiente" }), "!esLiquidada(Pendiente)");
ok(esAnulada({ estado: "Ganador", anulada: true }), "esAnulada bandera");
ok(esPendiente({ estado: "Pendiente" }), "esPendiente(Pendiente)");

// --- Sumatoria financiera: ANULADA excluida -------------------------------
type Fila = { estado?: string; anulada?: boolean; monto_jugado: number };
const filas: Fila[] = [
  { estado: "Pendiente", monto_jugado: 100 },
  { estado: "Ganador", monto_jugado: 50 },
  { estado: "Perdedor", monto_jugado: 25 },
  { estado: "Anulado", monto_jugado: 999 },
  { estado: "Pendiente", anulada: true, monto_jugado: 500 },
];
eq(sumarVigente(filas), 175, "sumarVigente excluye las anuladas (100+50+25)");
eq(sumarVigente(filas, (f) => f.monto_jugado * 2), 350, "sumarVigente acepta extractor alterno");
eq(sumarVigente([]), 0, "sumarVigente de lista vacía = 0");

// --- Conteo y filtro ------------------------------------------------------
eq(contarPorEstado(filas), { PENDIENTE: 1, LIQUIDADA: 2, ANULADA: 2 }, "conteo por estado");
eq(filtrarPorEstado(filas, "ANULADA").length, 2, "filtrar ANULADA");
eq(filtrarPorEstado(filas, ["PENDIENTE", "LIQUIDADA"]).length, 3, "filtrar por arreglo (no anuladas)");
eq(filtrarPorEstado(filas, null).length, 5, "sin filtro devuelve todo");

// --- Etiquetas ------------------------------------------------------------
eq(ETIQUETA_ESTADO.PENDIENTE, "Pendiente", "etiqueta PENDIENTE");
eq(ETIQUETA_ESTADO.LIQUIDADA, "Liquidada", "etiqueta LIQUIDADA");
eq(ETIQUETA_ESTADO.ANULADA, "Anulada", "etiqueta ANULADA");

console.log(`\n${aserciones} pasaron, ${fallas} fallaron`);
if (fallas > 0) process.exit(1);
