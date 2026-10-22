// ============================================================================
// INVARIANTE FINANCIERA: las jugadas ANULADAS no suman ni restan en NINGÚN
// reporte.
//
// Una jugada anulada se devolvió: su capital no está en juego y no se paga
// premio ni comisión. La marca de anulación es la BANDERA `anulada` (la pone el
// Monitor al anular y NO reescribe `estado`, que sigue en
// Ganador/Perdedor/Retirado). Por eso un reporte NO puede clasificar una jugada
// solo por `estado`: tiene que mirar la bandera.
//
// Este test protege los dos frentes:
//   A. El NÚCLEO puro (se ejecuta): `ventaAnulada`/`totalesDe`/`cobradoDeVenta`
//      del reporte de Tablas, y `resumenPreview` del panel de Gestión.
//   B. Los archivos que hablan con Supabase (se INSPECCIONA su fuente, porque no
//      se pueden ejecutar sin base): reporte de comisiones por convenio, reporte
//      de liquidación, estado de cuenta del cliente y reporte de jugadores de
//      impresión.
//
// Corre con:  node pruebas/correr.cjs
// ============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  cobradoDeVenta,
  normalizarVenta,
  totalesDe,
  ventaAnulada,
  type VentaTablaReporte,
} from "../src/features/tablas/lib/reporte-tablas-nucleo";
import { armarFilasPreview, resumenPreview, type JugadaPersistida } from "../src/features/gestion/lib/preview-carrera";

let pasan = 0;
let fallan = 0;
const ok = (m: string) => { pasan++; console.log(`  ok   ${m}`); };
const mal = (m: string, d?: string) => { fallan++; console.log(`  FALLA ${m}${d ? `\n         ${d}` : ""}`); };
const si = (c: boolean, m: string, d?: string) => (c ? ok(m) : mal(m, d));
const igual = (a: unknown, b: unknown, m: string) =>
  si(JSON.stringify(a) === JSON.stringify(b), m, `esperado ${JSON.stringify(b)} · recibido ${JSON.stringify(a)}`);

const raiz = process.cwd();
const leer = (...partes: string[]) => readFileSync(join(raiz, ...partes), "utf8");

// ---------------------------------------------------------------------------
console.log("\nINVARIANTE ANULADAS — núcleo puro (reporte de Tablas)");
// ---------------------------------------------------------------------------

// Fila base mínima: lo que `normalizarVenta` necesita para armar la venta.
const venta = (over: Partial<VentaTablaReporte> = {}): VentaTablaReporte => ({
  ...normalizarVenta({ id: "t1", monto_jugado: 100, estado: "Ganador" }),
  ...over,
});

// La bandera manda sobre un estado que quedó "Ganador".
si(ventaAnulada(venta({ anulada: true, estado: "Ganador" })), "bandera anulada manda sobre 'Ganador'");
si(ventaAnulada(venta({ anulada: true, estado: "Perdedor" })), "bandera anulada manda sobre 'Perdedor'");
si(ventaAnulada(venta({ estado: "Anulado" })), "estado 'Anulado' sin bandera también cuenta");
si(ventaAnulada(venta({ estado: "Rechazado" })), "estado 'Rechazado' cuenta como anulada");
si(!ventaAnulada(venta({ estado: "Ganador" })), "una Ganador normal NO es anulada");
si(!ventaAnulada(venta({ estado: "Pendiente" })), "una Pendiente normal NO es anulada");

// totalesDe: una anulada no entra en NINGUNA cifra.
const normalT = totalesDe([venta({ monto: 100, pagado: 500, comision: 25 })]);
const conAnuladaT = totalesDe([
  venta({ id: "ok", monto: 100, pagado: 500, comision: 25 }),
  venta({ id: "an", monto: 999, pagado: 9999, comision: 999, anulada: true, estado: "Ganador" }),
]);
igual(conAnuladaT.tickets, normalT.tickets, "anulada: no cuenta como ticket");
igual(conAnuladaT.enRiesgo, normalT.enRiesgo, "anulada: no suma al en riesgo");
igual(conAnuladaT.pagado, normalT.pagado, "anulada: no suma al pagado");
igual(conAnuladaT.comision, normalT.comision, "anulada: no suma comisión");
igual(conAnuladaT.balance, normalT.balance, "anulada: no mueve el balance");

// cobradoDeVenta: una anulada no deja "cobrado" aunque su estado sea Perdedor.
igual(cobradoDeVenta(venta({ estado: "Perdedor", anulada: true, pctConvenio: 10 })), 0, "anulada perdedora no cobra");
igual(cobradoDeVenta(venta({ estado: "Perdedor", pctConvenio: 10 })), 90, "perdedora vigente sí cobra (100 × 0.9)");

// ---------------------------------------------------------------------------
console.log("\nINVARIANTE ANULADAS — panel de Gestión (resumenPreview)");
// ---------------------------------------------------------------------------
const persistida = (over: Partial<JugadaPersistida> = {}): JugadaPersistida => ({
  id: "1",
  nombre_jugada: "2P",
  caballo: "7",
  monto_jugado: 100,
  estado: "Pendiente",
  ...over,
});
const resumen = resumenPreview(
  armarFilasPreview([persistida({ id: "1", monto_jugado: 100 }), persistida({ id: "2", monto_jugado: 900, anulada: true })], [])
);
igual(resumen.jugadas, 2, "el panel lista la anulada como jugada");
igual(resumen.monto, 100, "el monto del panel NO incluye la anulada");

// ---------------------------------------------------------------------------
console.log("\nINVARIANTE ANULADAS — fuente de los reportes que hablan con la base");
// ---------------------------------------------------------------------------

// Reporte de comisiones por convenio: la anulada no genera comisión ni detalle.
const comisiones = leer("src", "features", "grupos", "lib", "reporte-comisiones.ts");
si(/esTicketAnulado/.test(comisiones), "el reporte de comisiones define el corte de anulado");
si(/if \(esTicketAnulado\(t\)\) return;/.test(comisiones), "acumularTicket descarta la anulada");
si(/if \(esTicketAnulado\(t\)\) continue;/.test(comisiones), "el detalle descarta la anulada");
si(/t\.anulada === true/.test(comisiones), "esTicketAnulado mira la bandera anulada");

// Reporte de liquidación: la anulada no entra a filas ni al neteo.
const liquidacion = leer("src", "features", "liquidacion", "lib", "reportes.ts");
si(/if \(f\.anulada === true\) return;/.test(liquidacion), "el reporte de liquidación salta la anulada");
si(/f\.anulada === true \|\| estado === "ANULADO"/.test(liquidacion), "evaluar trata la anulada como neutra");

// Estado de cuenta del cliente: la anulada no suma base ni devolución.
const clientes = leer("src", "features", "clientes", "lib", "clientes.ts");
si(/const anulada = t\.anulada === true;/.test(clientes), "el estado de cuenta detecta la anulada");
si(/const baseVigente = anulada \? 0 : base;/.test(clientes), "la base vigente es 0 para la anulada");
si(/raiz\.monto \+= baseVigente;/.test(clientes), "la raíz del estado de cuenta suma la base vigente");
si(/, estado, anulada,/.test(clientes), "la consulta del estado de cuenta pide la columna anulada");

// Reporte de jugadores (impresión): la anulada no suma jugado/pagado.
const reporteImpresion = leer("src", "features", "impresion", "lib", "reporte.ts");
si(/if \(t\.anulada !== true\)/.test(reporteImpresion), "el reporte de jugadores ignora el monto de la anulada");
si(/estado,anulada"/.test(reporteImpresion), "la consulta del reporte de jugadores pide anulada");

// Monitor de jugadas (vista SQL): total_monto/premio excluyen las anuladas.
const sqlMonitor = leer("sql", "jugadas_monitor.sql");
si(/sum\(t\.monto\) filter \(where not t\.anulada\), 0\)\s+as total_monto/.test(sqlMonitor), "la vista del monitor excluye anulada de total_monto");
si(/sum\(t\.premio\) filter \(where not t\.anulada\), 0\)\s+as total_premio/.test(sqlMonitor), "la vista del monitor excluye anulada de total_premio");

// Reporte Diario (RPC): el premio tampoco cuenta en una anulada.
const sqlDiario = leer("sql", "reporte_diario.sql");
si(/then 0 else coalesce\(t\.monto_jugado, 0\) end/.test(sqlDiario), "la RPC del diario ya excluía el jugado de la anulada");
si(/then 0\s*\n\s*else coalesce\(t\.premio_pagar, t\.premio_por_tabla, 0\)\s*\n\s*end\s+as premio/.test(sqlDiario), "la RPC del diario excluye el premio de la anulada");

console.log(`\n  ANULADAS EN REPORTES: ${pasan} ok, ${fallan} fallaron\n`);
if (fallan > 0) process.exit(1);
