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
  /** Tasa de comisión del ticket (%), la que retiene la casa sobre la ganancia. */
  comision_porcentaje?: number | null;
  estado?: string | null;
  cliente_juega_nombre?: string | null;
  cliente_consigue_nombre?: string | null;
  anulada?: boolean | null;
  nota_auditoria?: string | null;
};

/**
 * Resultado de UN lado de la jugada (el que JUEGA o el que DA/CONSIGUE).
 *
 * El panel muestra, a la derecha de cada jugador, si GANÓ o PERDIÓ (✅ / ✖) y el
 * saldo: mientras la carrera NO esté liquidada, el dinero que ARRIESGA; una vez
 * liquidada, la ganancia o la pérdida definitiva.
 */
export type LadoResultado = {
  /** Cómo se pinta el lado. */
  estado: "GANO" | "PERDIO" | "ARRIESGA" | "ANULADA" | "RETIRADO" | "SIN_DATO";
  /** true si la carrera YA está liquidada (el saldo es definitivo). */
  liquidada: boolean;
  /** Signo del saldo: 1 gana · -1 pierde · 0 neutro/arriesga. */
  signo: -1 | 0 | 1;
  /** Importe a mostrar, SIEMPRE en positivo (el signo lo aporta `signo`). */
  monto: number;
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
  observacion?: string | null;
  saldoRestante?: number | null;
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
  /**
   * Estado que muestra la COLUMNA «Estado» del panel: SOLO refleja el ciclo de
   * vida de la jugada, nunca si ganó o perdió.
   *   · `Liquidada` — la carrera ya se liquidó (antes decía Ganador/Perdedor).
   *   · `Pendiente` — todavía falta liquidar la carrera.
   *   · `Anulada`   — la jugada se anuló.
   */
  estadoLiquidacion: "Liquidada" | "Pendiente" | "Anulada";
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
  observacion: string | null;
  saldoRestante: number | null;
  /** Resultado del que JUEGA (Cliente 1): ✅/✖ y su saldo. */
  lado1: LadoResultado;
  /** Resultado del que DA/CONSIGUE (Cliente 2): ✅/✖ y su saldo. */
  lado2: LadoResultado;
};

const NUM = (v: unknown): number => {
  const n = parseFloat(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

const TXT = (v: unknown): string => (v == null ? "" : String(v).trim());

function leerDatosSaldo(raw: unknown): { observacion: string | null; saldoRestante: number | null } {
  let nota: Record<string, unknown> = {};
  if (raw && typeof raw === "object") nota = raw as Record<string, unknown>;
  else if (typeof raw === "string" && /^[\[{]/.test(raw.trim())) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object") nota = parsed as Record<string, unknown>;
    } catch {
      return { observacion: null, saldoRestante: null };
    }
  }
  const saldo = Number(nota.saldo_restante);
  return {
    observacion: typeof nota.observacion === "string" ? nota.observacion.trim() || null : null,
    saldoRestante: nota.saldo_restante == null || !Number.isFinite(saldo) ? null : saldo,
  };
}

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

/**
 * Traduce el estado fino (Ganador/Perdedor/Retirado/…) al estado que muestra la
 * columna «Estado» del panel: solo Liquidada / Pendiente / Anulada.
 *
 * Una jugada Ganador o Perdedor YA se liquidó; una Retirada también se resolvió
 * (se devuelve el capital), así que ambas cuentan como `Liquidada`. La Anulada
 * se conserva aparte para distinguirla de una liquidación normal.
 */
export function estadoLiquidacionDe(estadoFino: string): "Liquidada" | "Pendiente" | "Anulada" {
  if (estadoFino === "Anulada") return "Anulada";
  if (estadoFino === "Ganador" || estadoFino === "Perdedor" || estadoFino === "Retirado") return "Liquidada";
  return "Pendiente";
}

/**
 * Resultados por LADO de la jugada.
 *
 * Reproduce la MISMA convención que el reporte de liquidación y la relación de
 * WhatsApp:
 *   · `premio_pagar` se guarda BRUTO (capital + ganancia).
 *   · la casa retiene `comisionPct` sobre la ganancia bruta.
 *   · el que JUEGA gana el NETO (`premio_pagar − comisión`); si pierde, arriesga
 *     el monto.
 *   · el que DA/CONSIGUE juega en espejo: si el que juega acierta, el que da
 *     entrega el neto del jugador más la comisión; si el que juega falla, el que
 *     da cobra el monto menos la comisión.
 *
 * Mientras la carrera NO esté liquidada (Pendiente) se muestra el saldo que
 * ARRIESGA cada uno (el monto), sin ✅ ni ✖.
 */
function ladosDeLaJugada(
  monto: number,
  estadoFila: string,
  premioPagar: number,
  comisionPct: number
): { lado1: LadoResultado; lado2: LadoResultado } {
  const arriesga = (): LadoResultado => ({ estado: "ARRIESGA", liquidada: false, signo: 0, monto });

  if (estadoFila === "Anulada") {
    const lado: LadoResultado = { estado: "ANULADA", liquidada: true, signo: 0, monto: 0 };
    return { lado1: lado, lado2: lado };
  }
  if (estadoFila === "Retirado") {
    const lado: LadoResultado = { estado: "RETIRADO", liquidada: true, signo: 0, monto: 0 };
    return { lado1: lado, lado2: lado };
  }

  // Carrera YA liquidada: el estado manda. Un ticket 'Ganador' SIEMPRE es ✅ y
  // un 'Perdedor' SIEMPRE es ✖, aunque el premio quede por debajo del monto
  // (break-even o premio incompleto): antes se exigía `premio_pagar > monto`, así
  // que un ganador sin premio —o con el dividendo aún sin cargar— se pintaba como
  // perdedor y "no se le pagaba al ganador".
  if (estadoFila === "Ganador" || estadoFila === "Perdedor") {
    const gano = estadoFila === "Ganador";
    // Ganancia bruta sobre la que se cobra la comisión (nunca negativa).
    const gananciaBruta = gano ? Math.max(0, Math.round((premioPagar - monto) * 100) / 100) : 0;
    const comision = Math.round(gananciaBruta * (comisionPct / 100) * 100) / 100;
    const netoJuega = Math.round((gananciaBruta - comision) * 100) / 100; // ganancia NETA del que juega
    // El que da, en espejo: entrega el neto del jugador + la comisión si perdió
    // el jugador; cobra el monto menos la comisión si el jugador falló.
    const ladoJuegaGano: LadoResultado = { estado: "GANO", liquidada: true, signo: 1, monto: Math.max(0, netoJuega) };
    const ladoJuegaPerdio: LadoResultado = { estado: "PERDIO", liquidada: true, signo: -1, monto };
    const ladoDaGano: LadoResultado = {
      estado: "GANO",
      liquidada: true,
      signo: 1,
      monto: Math.round(Math.max(0, monto - monto * (comisionPct / 100)) * 100) / 100,
    };
    const ladoDaPerdio: LadoResultado = {
      estado: "PERDIO",
      liquidada: true,
      signo: -1,
      monto: Math.round(Math.max(0, premioPagar - monto) * 100) / 100,
    };
    return gano
      ? { lado1: ladoJuegaGano, lado2: ladoDaPerdio }
      : { lado1: ladoJuegaPerdio, lado2: ladoDaGano };
  }

  // Pendiente: SIEMPRE el monto en riesgo (gris), en ambos lados. Aunque la
  // sesión tenga una proyección, la carrera todavía NO se liquidó, así que no
  // corresponde pintar ✅/✖: eso es exclusivo de una carrera liquidada.
  return { lado1: arriesga(), lado2: arriesga() };
}

function filaDesdePersistida(j: JugadaPersistida, sesion?: TicketSesion): FilaPreviewCarrera {
  const monto = NUM(j.monto_jugado);
  const anulada = Boolean(j.anulada);
  const estado = estadoDeFila(j.estado, anulada);
  const ticketId = String(j.id ?? "").trim() || null;
  const datosSaldo = leerDatosSaldo(j.nota_auditoria);

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

  const comisionPct = NUM(j.comision_porcentaje);
  const { lado1, lado2 } = ladosDeLaJugada(monto, estado, NUM(j.premio_pagar), comisionPct);

  return {
    clave: `db-${ticketId ?? TXT(j.nombre_jugada)}-${TXT(j.caballo)}`,
    ticketId,
    jugada: TXT(j.nombre_jugada),
    caballo: TXT(j.caballo) || (j.ejemplar_numero != null ? String(j.ejemplar_numero) : ""),
    monto,
    cliente1: TXT(j.cliente_juega_nombre),
    cliente2: TXT(j.cliente_consigue_nombre),
    estado,
    estadoLiquidacion: estadoLiquidacionDe(estado),
    validada: true,
    anulada: estado === "Anulada",
    soloSesion: false,
    premioSaldo,
    esPremio,
    tieneProyeccion,
    observacion: datosSaldo.observacion ?? sesion?.observacion ?? null,
    saldoRestante: datosSaldo.saldoRestante ?? sesion?.saldoRestante ?? null,
    lado1,
    lado2,
  };
}

function filaDesdeSesion(t: TicketSesion): FilaPreviewCarrera {
  const monto = NUM(t.monto);
  const mejor = mejorCobreDe(t);
  const esPremio = mejor > monto;
  const ticketId = t.ticketId != null && String(t.ticketId).trim() !== "" ? String(t.ticketId) : null;
  const { lado1, lado2 } = ladosDeLaJugada(monto, "Pendiente", 0, 0);
  return {
    clave: `ses-${t.id ?? ticketId ?? jugadaSinMonto(t.comando)}`,
    ticketId,
    jugada: jugadaSinMonto(t.comando),
    caballo: TXT(t.caballo),
    monto,
    cliente1: TXT(t.cliente1),
    cliente2: TXT(t.cliente2),
    estado: "Pendiente",
    estadoLiquidacion: "Pendiente",
    validada: ticketId !== null,
    anulada: false,
    soloSesion: true,
    premioSaldo: esPremio ? mejor - monto : -monto,
    esPremio,
    tieneProyeccion: true,
    observacion: t.observacion ?? null,
    saldoRestante: t.saldoRestante ?? null,
    lado1,
    lado2,
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
    // Una jugada ANULADA no suma al monto del panel: se devolvió el capital, así
    // que no es plata en juego. El conteo de jugadas sí la incluye (está en la
    // lista), pero no aporta al total de dinero.
    if (!f.anulada) monto += f.monto;
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
