/**
 * ============================================================================
 * ESTADOS MAESTROS DE UNA JUGADA — PENDIENTE · LIQUIDADA · ANULADA
 * ============================================================================
 *
 * Regla del dueño: TODA la plataforma (Taquilla, Gestión, Marcas, Tablas,
 * Liquidación y Reportes) muestra el ciclo de vida de una jugada con SOLO tres
 * estados maestros:
 *
 *   · PENDIENTE  → la jugada todavía no se decidió (espera el resultado).
 *   · LIQUIDADA  → la carrera ya corrió y la jugada se pagó: ganó o perdió.
 *   · ANULADA    → la jugada quedó sin efecto (se devolvió el capital).
 *
 * Los estados INTERNOS que la base ya persiste en `tickets_apuestas.estado`
 * ("Pendiente", "Ganador", "Perdedor", "Retirado", "Anulado"…) NO se tocan: son
 * los que lee el motor de liquidación, la reversión y las RPC. Acá solo se
 * TRADUCEN a los tres maestros para que la UI, los filtros y las sumatorias
 * financieras trabajen con un vocabulario único.
 *
 * INVARIANTE FINANCIERA
 * ---------------------
 * ANULADA queda SIEMPRE fuera de las sumatorias: ni suma ni resta (el capital se
 * devolvió, la jugada es neutra). Por eso `sumarVigente` excluye las anuladas.
 *
 * Es lógica PURA, sin I/O ni React: testeable en node
 * (pruebas/estados-jugada.test.ts) como el resto de los "-nucleo".
 */

/** Los tres estados maestros que ve el usuario. */
export type EstadoMaestro = "PENDIENTE" | "LIQUIDADA" | "ANULADA";

/** Etiquetas legibles (para badges y selects de la UI). */
export const ETIQUETA_ESTADO: Record<EstadoMaestro, string> = {
  PENDIENTE: "Pendiente",
  LIQUIDADA: "Liquidada",
  ANULADA: "Anulada",
};

/** Orden canónico: primero lo que hay que decidir, al final lo sin efecto. */
export const ESTADOS_MAESTROS: readonly EstadoMaestro[] = ["PENDIENTE", "LIQUIDADA", "ANULADA"];

/** Ítem con los dos datos que el mapeo necesita: el estado interno y si está anulada. */
export type ItemConEstado = {
  estado?: unknown;
  /** Bandera de auditoría del Monitor: `anulada = true` manda sobre cualquier estado. */
  anulada?: unknown;
};

const TXT = (v: unknown): string => (v == null ? "" : String(v).trim());

/**
 * Traduce un estado INTERNO (o la bandera `anulada`) al estado MAESTRO.
 *
 * El orden importa: una jugada con `anulada = true` es ANULADA aunque su estado
 * interno siga en "Ganador"/"Retirado" (la anulación no reescribe el estado del
 * motor, solo marca la bandera de auditoría).
 */
export function estadoMaestro(item: ItemConEstado | unknown): EstadoMaestro {
  // Acepta tanto el objeto como el estado suelto ("Ganador", "Pendiente"…).
  const obj: ItemConEstado =
    item && typeof item === "object" ? (item as ItemConEstado) : { estado: item };
  if (obj.anulada === true) return "ANULADA";
  const s = TXT(obj.estado).toLowerCase();
  if (!s) return "PENDIENTE"; // s/d = todavía sin decidir
  if (s.startsWith("anul")) return "ANULADA";
  if (s.startsWith("pend")) return "PENDIENTE";
  if (s.startsWith("gan") || s.startsWith("perd") || s.startsWith("retir") || s.startsWith("solu")) {
    return "LIQUIDADA";
  }
  // "Rechazado" y demás variantes sin efecto → ANULADA; cualquier otra cosa que no
  // reconozcamos se deja como PENDIENTE (es lo conservador: no inventa un pago).
  if (s.startsWith("rechaz")) return "ANULADA";
  return "PENDIENTE";
}

/** ¿La jugada ya se decidió (ganó o perdió)? */
export function esLiquidada(item: ItemConEstado | unknown): boolean {
  return estadoMaestro(item) === "LIQUIDADA";
}

/** ¿La jugada quedó sin efecto? */
export function esAnulada(item: ItemConEstado | unknown): boolean {
  return estadoMaestro(item) === "ANULADA";
}

/** ¿La jugada sigue en juego? */
export function esPendiente(item: ItemConEstado | unknown): boolean {
  return estadoMaestro(item) === "PENDIENTE";
}

/**
 * Suma un importe SOLO si la jugada cuenta financieramente. Una jugada ANULADA
 * dejó de existir para las cuentas (capital devuelto), así que aporta 0.
 *
 * `montoDe` extrae el importe de la fila; por defecto `monto_jugado`.
 */
export function sumarVigente<T extends ItemConEstado>(
  items: T[],
  montoDe: (it: T) => number = (it) => Number((it as Record<string, unknown>).monto_jugado ?? 0)
): number {
  let total = 0;
  for (const it of items) {
    if (esAnulada(it)) continue;
    const m = montoDe(it);
    if (Number.isFinite(m)) total += m;
  }
  return Math.round(total * 100) / 100;
}

/** Conteo de jugadas por estado maestro (las anuladas se cuentan, pero aparte). */
export function contarPorEstado<T extends ItemConEstado>(items: T[]): Record<EstadoMaestro, number> {
  const out: Record<EstadoMaestro, number> = { PENDIENTE: 0, LIQUIDADA: 0, ANULADA: 0 };
  for (const it of items) out[estadoMaestro(it)] += 1;
  return out;
}

/**
 * Filtra por estado maestro. `null`/`undefined`/todos ⇒ sin filtro. Acepta un
 * arreglo para seleccionar varios (ej. ["PENDIENTE","LIQUIDADA"] = "no anuladas").
 */
export function filtrarPorEstado<T extends ItemConEstado>(
  items: T[],
  filtro: EstadoMaestro | EstadoMaestro[] | null | undefined
): T[] {
  if (!filtro) return items;
  const set = new Set(Array.isArray(filtro) ? filtro : [filtro]);
  return items.filter((it) => set.has(estadoMaestro(it)));
}

/** Clase CSS del badge por estado maestro (un solo lugar para el color). */
export const BADGE_ESTADO: Record<EstadoMaestro, string> = {
  PENDIENTE: "bg-sky-100 text-sky-700",
  LIQUIDADA: "bg-emerald-100 text-emerald-700",
  ANULADA: "bg-slate-200 text-slate-600",
};
