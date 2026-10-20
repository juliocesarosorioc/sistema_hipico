/**
 * ============================================================================
 * NÚCLEO PURO de la REVERSIÓN de la liquidación de una carrera.
 * ============================================================================
 *
 * Reversar una liquidación es la operación INVERSA de liquidar: cada ticket que
 * se decidió (Ganador / Perdedor / Retirado) vuelve a 'Pendiente' y se le
 * DEVUELVE al cliente el dinero que se le había acreditado, para que la carrera
 * quede como recién programada ("ABIERTA") y se pueda volver a cargar el
 * resultado y liquidar de nuevo.
 *
 * Cada modalidad tiene su PROPIA fórmula de acreditación:
 *
 *   · UNIVERSAL (WPS, Puestos, Bloques, Ninis…): la acreditación la hizo el motor
 *     `aplicarLiquidacionSaldos`. Su reversión NO vive acá: la hace
 *     `revertirLiquidacionCarrera` reusando `decidirTickets`, que es la MISMA
 *     fórmula con la que se pagó (ver `saldos.ts`).
 *   · TABLA FIJA: `club_liquidar_tabla_fija` acredita `premio_pagar` (=
 *     `monto_decidido`) al ganador; los retirados los reembolsa
 *     `club_reembolsar_retirados` (devuelve `monto_jugado`).
 *   · MARCA: `club_liquidar_marca` acredita el bruto en `monto_decidido` al
 *     ganador y devuelve `monto_jugado` si el caballo/rival se retiró.
 *   · DUPLETA: `club_liquidar_dupleta` acredita el `premio` en `monto_decidido`
 *     al ganador y devuelve `monto_jugado` si hubo retiro.
 *
 * Regla de reversión (idéntica para las tres especiales):
 *   · Ganador   → se devuelve `monto_decidido` (el premio acreditado).
 *   · Retirado  → se devuelve `monto_jugado` (el stake reintegrado).
 *   · Perdedor  → no movió saldo: se devuelve 0 (solo cambia el estado).
 *
 * Es lógica PURA, testeable en node (pruebas/reversion-liquidacion.test.ts).
 */
// Relativo a propósito: este archivo se corre en node y las pruebas no resuelven
// el alias `@/`. Es un hermano en la misma carpeta.
import { esLiquidada } from "./estados-jugada";

/** Modalidad de un ticket, derivada de `nombre_jugada`. */
export type ModalidadReversion = "UNIVERSAL" | "TABLA" | "MARCA" | "DUPLETA";

/** Una operación de reversión para un ticket de modalidad especial. */
export type OperacionReversion = {
  id: string | number;
  clienteId: string | number | null;
  modalidad: ModalidadReversion;
  estado: string;
  /** Dinero a QUITAR del saldo del cliente para deshacer la acreditación. */
  credito: number;
};

const NUM = (v: unknown): number => {
  const n = parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
};

const TXT = (v: unknown): string => (v == null ? "" : String(v).trim());

/** ¿El estado del ticket ya fue DECIDIDO por la liquidación? */
export function esEstadoDecidido(estado: unknown): boolean {
  const s = TXT(estado);
  // Los estados INTERNOS de decisión son Ganador/Perdedor/Retirado. Se
  // reconocen también las variantes legacy del legacy ("GANO", "PERDIO",
  // "SOLUCIONADO") y —por el ESTADO MAESTRO— cualquier forma que signifique
  // LIQUIDADA, para no dejar tickets sin revertir. Una jugada ANULADA NO es
  // decidida: su capital ya se devolvió por otra vía.
  if (s === "Ganador" || s === "Perdedor" || s === "Retirado") return true;
  return esLiquidada(estado);
}

/** Clasifica la modalidad de un ticket por su `nombre_jugada`. */
export function modalidadDeTicket(nombre: unknown): ModalidadReversion {
  const n = TXT(nombre).toUpperCase();
  if (n.startsWith("TABLA FIJA")) return "TABLA";
  if (n === "MARCA" || n.startsWith("MARCA ")) return "MARCA";
  if (n.startsWith("DUPLETA")) return "DUPLETA";
  return "UNIVERSAL";
}

/**
 * Crédito que hay que DEVOLVER (quitar del saldo) para deshacer la liquidación
 * de un ticket de modalidad ESPECIAL. Un ticket Perdedor devuelve 0.
 */
export function creditoARevertir(row: Record<string, unknown>): number {
  const estado = TXT(row.estado);
  if (estado === "Ganador") return NUM(row.monto_decidido ?? row.premio_pagar);
  if (estado === "Retirado") return NUM(row.monto_jugado);
  return 0;
}

/**
 * Planifica la reversión de las modalidades ESPECIALES a partir de las filas
 * crudas de `tickets_apuestas`: descarta los Pendientes y los universales (esos
 * los maneja `revertirLiquidacionCarrera`) y devuelve, por cada ticket
 * decidido, cuánto hay que devolverle al cliente.
 */
export function planearReversion(filas: Array<Record<string, unknown>>): OperacionReversion[] {
  const out: OperacionReversion[] = [];
  for (const f of filas) {
    const estado = TXT(f.estado);
    if (!esEstadoDecidido(estado)) continue;
    const modalidad = modalidadDeTicket(f.nombre_jugada);
    if (modalidad === "UNIVERSAL") continue;
    out.push({
      id: (f.id ?? "") as string | number,
      clienteId: (row_cliente(f) ?? null) as string | number | null,
      modalidad,
      estado,
      credito: creditoARevertir(f),
    });
  }
  return out;
}

/** `cliente_juega_id` puede venir con otro nombre en filas normalizadas. */
function row_cliente(f: Record<string, unknown>): unknown {
  return f.cliente_juega_id ?? f.clienteId ?? f.cliente_id ?? null;
}

/** Resumen de un plan de reversión (para reportes y auditoría). */
export type ResumenReversion = {
  tickets: number;
  credito: number;
  porModalidad: Record<ModalidadReversion, { tickets: number; credito: number }>;
};

/** Agrupa un plan de reversión por modalidad con sus totales. */
export function resumirReversion(ops: OperacionReversion[]): ResumenReversion {
  const porModalidad: ResumenReversion["porModalidad"] = {
    UNIVERSAL: { tickets: 0, credito: 0 },
    TABLA: { tickets: 0, credito: 0 },
    MARCA: { tickets: 0, credito: 0 },
    DUPLETA: { tickets: 0, credito: 0 },
  };
  let credito = 0;
  for (const op of ops) {
    porModalidad[op.modalidad].tickets += 1;
    porModalidad[op.modalidad].credito = Math.round((porModalidad[op.modalidad].credito + op.credito) * 100) / 100;
    credito += op.credito;
  }
  return { tickets: ops.length, credito: Math.round(credito * 100) / 100, porModalidad };
}
