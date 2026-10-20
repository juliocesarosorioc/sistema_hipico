/**
 * ============================================================================
 * NÚCLEO PURO de la PRE-VISUALIZACIÓN de jugadas cargadas (Bloque 2)
 * ============================================================================
 *
 * El panel de pre-visualización de Gestión de Jugadas debe mostrar SIEMPRE las
 * jugadas de la carrera que ya están en `tickets_apuestas` —no solo las de la
 * sesión en curso—. Antes el panel leía únicamente el store de la taquilla: al
 * recargar la página, cambiar de operador o liquidar la carrera, la lista se
 * vaciaba aunque las jugadas siguieran en la base.
 *
 * Este módulo cruza las dos fuentes:
 *   · `persistidas`: filas de `v_jugadas_carrera` (ya cobradas y auditables);
 *   · `sesion`: tickets del store local (pueden incluir ventas recién hechas
 *     que todavía no se reflejan en la lista persistida).
 *
 * Reglas:
 *   · Una jugada persistida SIEMPRE se pinta y lleva `✅ Validada / Cargada`.
 *   · Un ticket de sesión con `ticketId` también está en la base → validado.
 *   · Una venta de TABLA FIJA / MARCA / DUPLETA / REMATE / POLLA no es una
 *     jugada de taquilla y no entra al panel (igual que antes).
 *   · No se duplica: el ticket de sesión que ya tiene fila persistida se usa
 *     solo para completar la proyección, no como fila aparte.
 *
 * Sin React ni Supabase: testeable en node (pruebas/preview-carrera.test.ts).
 */

/** Fila mínima de `v_jugadas_carrera` que necesita el panel. */
export type JugadaPersistida = {
  id: string | number;
  nombre_jugada?: string | null;
  caballo?: string | null;
  ejemplar_numero?: number | null;
  monto_jugado?: number | null;
  premio_pagar?: number | null;
  estado?: string | null;
  cliente_juega_nombre?: string | null;
  cliente_consigue_nombre?: string | null;
  anulada?: boolean | null;
};

/** Ticket del store de la taquilla (solo lo que usa la proyección). */
export type TicketSesion = {
  id?: string;
  comando: string;
  monto: number;
  caballo?: string;
  cliente1?: string;
  cliente2?: string;
  cobro1?: number;
  cobro2?: number;
  gananciaProyectada?: number;
  ticketId?: number | string;
};

/** Una fila lista para pintar en el panel. */
export type FilaPreviewCarrera = {
  /** Clave estable de React. */
  clave: string;
  /** id del ticket en `tickets_apuestas` (null si solo vive en la sesión). */
  ticketId: string | null;
  /** Nomenclatura de la jugada, sin el monto. */
  jugada: string;
  caballo: string;
  monto: number;
  cliente1: string;
  cliente2: string;
  /** Pendiente | Ganador | Perdedor | Retirado | Anulada. */
  estado: string;
  /** true si ya está guardada en la base (✅ Validada / Cargada). */
  validada: boolean;
  anulada: boolean;
  /** true si la fila solo existe en la sesión (todavía no se refleja en la BD). */
  soloSesion: boolean;
  /** Premio neto (+) o saldo en contra (−) que muestra la última columna. */
  premioSaldo: number;
  /** true si `premioSaldo` es una ganancia; false si es un saldo en contra. */
  esPremio: boolean;
  /** false si no hay proyección disponible (se pinta «—»). */
  tieneProyeccion: boolean;
};

const NUM = (v: unknown): number => {
  const n = parseFloat(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

const TXT = (v: unknown): string => (v == null ? "" : String(v).trim());

/**
 * ¿La fila es una jugada de TAQUILLA? Excluye las modalidades que se venden
 * por su propio módulo y caen en la misma tabla de tickets.
 */
export function esJugadaDeTaquilla(nombre: unknown): boolean {
  const n = TXT(nombre).toUpperCase();
  if (!n) return false;
  if (n.startsWith("REMATE ")) return false;
  if (n.startsWith("TABLA FIJA")) return false;
  if (n.startsWith("MARCA")) return false;
  if (n.startsWith("DUPLETA")) return false;
  if (n.startsWith("POLLA")) return false;
  return true;
}

/** Quita el monto del comando crudo de la taquilla ("100 2P" → "2P"). */
export function jugadaSinMonto(comando: unknown): string {
  return TXT(comando).replace(/^\d+(?:[.,]\d+)?\s+/, "").trim() || TXT(comando);
}

/** Mejor cobro proyectado de un ticket de sesión (mismo criterio del panel). */
function mejorCobreDe(t: TicketSesion): number {
  const monto = NUM(t.monto);
  return Math.max(NUM(t.cobro1), NUM(t.cobro2), NUM(t.gananciaProyectada) + monto);
}

/** Estado normalizado para pintar (las filas anuladas ganan). */
function estadoDeFila(estado: unknown, anulada: boolean): string {
  if (anulada) return "Anulada";
  const s = TXT(estado);
  if (!s) return "Pendiente";
  const low = s.toLowerCase();
  if (low.startsWith("gan")) return "Ganador";
  if (low.startsWith("perd")) return "Perdedor";
  if (low.startsWith("retir")) return "Retirado";
  if (low.startsWith("anul")) return "Anulada";
  return "Pendiente";
}

function filaDesdePersistida(j: JugadaPersistida, sesion?: TicketSesion): FilaPreviewCarrera {
  const monto = NUM(j.monto_jugado);
  const anulada = Boolean(j.anulada);
  const estado = estadoDeFila(j.estado, anulada);
  const ticketId = String(j.id ?? "").trim() || null;

  let premioSaldo = 0;
  let esPremio = false;
  let tieneProyeccion = true;

  if (estado === "Ganador") {
    premioSaldo = NUM(j.premio_pagar);
    esPremio = premioSaldo > 0;
  } else if (estado === "Perdedor") {
    premioSaldo = -monto;
  } else if (estado === "Retirado" || estado === "Anulada") {
    premioSaldo = 0;
  } else {
    // Pendiente: la proyección de la sesión (si está) es la única disponible.
    if (sesion) {
      const mejor = mejorCobreDe(sesion);
      premioSaldo = mejor > monto ? mejor - monto : -monto;
      esPremio = mejor > monto;
    } else {
      tieneProyeccion = false;
    }
  }

  return {
    clave: `db-${ticketId ?? TXT(j.nombre_jugada)}-${TXT(j.caballo)}`,
    ticketId,
    jugada: TXT(j.nombre_jugada),
    caballo: TXT(j.caballo) || (j.ejemplar_numero != null ? String(j.ejemplar_numero) : ""),
    monto,
    cliente1: TXT(j.cliente_juega_nombre),
    cliente2: TXT(j.cliente_consigue_nombre),
    estado,
    validada: true,
    anulada: estado === "Anulada",
    soloSesion: false,
    premioSaldo,
    esPremio,
    tieneProyeccion,
  };
}

function filaDesdeSesion(t: TicketSesion): FilaPreviewCarrera {
  const monto = NUM(t.monto);
  const mejor = mejorCobreDe(t);
  const esPremio = mejor > monto;
  const ticketId = t.ticketId != null && String(t.ticketId).trim() !== "" ? String(t.ticketId) : null;
  return {
    clave: `ses-${t.id ?? ticketId ?? jugadaSinMonto(t.comando)}`,
    ticketId,
    jugada: jugadaSinMonto(t.comando),
    caballo: TXT(t.caballo),
    monto,
    cliente1: TXT(t.cliente1),
    cliente2: TXT(t.cliente2),
    estado: "Pendiente",
    validada: ticketId !== null,
    anulada: false,
    soloSesion: true,
    premioSaldo: esPremio ? mejor - monto : -monto,
    esPremio,
    tieneProyeccion: true,
  };
}

/**
 * Arma las filas del panel: primero las persistidas (en el orden que trae la
 * base) y después las ventas de sesión que todavía no aparecen en la lista.
 */
export function armarFilasPreview(
  persistidas: JugadaPersistida[],
  sesion: TicketSesion[]
): FilaPreviewCarrera[] {
  const ticketsSesion = sesion.filter((t) => esJugadaDeTaquilla(t.comando));
  const porTicketId = new Map<string, TicketSesion>();
  for (const t of ticketsSesion) {
    if (t.ticketId == null) continue;
    porTicketId.set(String(t.ticketId), t);
  }

  const filas: FilaPreviewCarrera[] = [];
  const idsUsados = new Set<string>();

  for (const j of persistidas) {
    if (!esJugadaDeTaquilla(j.nombre_jugada)) continue;
    const id = String(j.id ?? "").trim();
    const sesionDeFila = id ? porTicketId.get(id) : undefined;
    if (id) idsUsados.add(id);
    filas.push(filaDesdePersistida(j, sesionDeFila));
  }

  for (const t of ticketsSesion) {
    const id = t.ticketId != null ? String(t.ticketId) : "";
    if (id && idsUsados.has(id)) continue;
    filas.push(filaDesdeSesion(t));
  }

  return filas;
}

/** Totales del panel (para el encabezado y el resumen del operador). */
export function resumenPreview(filas: FilaPreviewCarrera[]): {
  jugadas: number;
  validadas: number;
  soloSesion: number;
  monto: number;
} {
  let monto = 0;
  let validadas = 0;
  let soloSesion = 0;
  for (const f of filas) {
    monto += f.monto;
    if (f.validada) validadas += 1;
    if (f.soloSesion) soloSesion += 1;
  }
  return {
    jugadas: filas.length,
    validadas,
    soloSesion,
    monto: Math.round(monto * 100) / 100,
  };
}
