/**
 * Núcleo matemático de la plataforma — patrón Estrategia/Router.
 * procesarTicket(ticket) lee ticket.tipo_jugada y deriva al submódulo correcto.
 * CERO espagueti: cada modalidad vive en su propio submódulo.
 */
import { BetSlipEntry } from "@/store/bet-slip";
import { PizarraCarrera, ResultadoPago, esPagoInmediato } from "./liquidacion";

// ============================================================
// Dominio NINI (sintaxis con "N": 2N · 1N · 1y2N)
// ============================================================

export type NiniInfo = {
  /** Modalidad canonizada para reportes (ej. "2N", "1y2N"). */
  modalidad: string;
  /** Puestos 1..N cubiertos por el nini (oficial: hasta 8). */
  N: number;
};

const CLAVES_PIZARRA = [
  "primero",
  "segundo",
  "tercero",
  "cuarto",
  "quinto",
  "sexto",
  "septimo",
  "octavo",
] as const;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Parser de la modalidad NINI desde la columna JUGADA.
 * Reconoce expresiones compactas terminadas en "N": "2N", "1N", "1y2N",
 * "1Y2N". DEVUELVE null para formes espaciadas ("1 y 2n"), con "/" (compuestas
 * "1/2n y 2n") o sin sufijo N. Devuelve N = máximo puesto cubierto.
 */
export function parsearNini(tipoJugada: string): NiniInfo | null {
  const t = String(tipoJugada ?? "").trim().replace(/\s+/g, " ");
  if (!t || t.includes("/")) return null;
  const m = /^(\d+(?:[Yy]\d+)*)\s*N$/i.exec(t);
  if (!m) return null;
  const nums = m[1]
    .split(/[Yy]/)
    .map((x) => parseInt(x, 10))
    .filter((n) => Number.isFinite(n) && n >= 1 && n <= 8);
  if (nums.length === 0) return null;
  return {
    modalidad: `${nums.join("y")}N`,
    N: Math.max(...nums),
  };
}

export function esNini(tipoJugada: string): boolean {
  return parsearNini(tipoJugada) !== null;
}

/** Canoniza la nomenclatura de un NINI (ej. "2n" → "2N", "1y 2N" → "1y2N"). */
export function normalizarNini(tipoJugada: string): string {
  const info = parsearNini(tipoJugada);
  return info ? info.modalidad : String(tipoJugada ?? "").trim();
}

/**
 * Lista ordenada (1º→8º) de números de la pizarra oficial. Cada valor es el
 * NÚMERO del ejemplar que ocupó ese puesto (p. ej. primero = "6").
 */
export function numerosPizarra(p: PizarraCarrera): string[] {
  const out: string[] = [];
  for (const k of CLAVES_PIZARRA) {
    const raw = (p as Record<string, unknown>)[k];
    const v = raw == null ? "" : String(raw).trim();
    if (v) out.push(v);
  }
  return out;
}

/** ¿El caballo de la jugada figura dentro de los primeros `N` puestos? */
export function figuraEnPizarra(
  caballo: string | number,
  pizarra: PizarraCarrera,
  N: number
): boolean {
  const c = String(caballo ?? "").trim();
  if (!c) return false;
  const cNum = parseInt(c.replace(/[^0-9]/g, ""), 10);
  const fila = numerosPizarra(pizarra).slice(0, N);
  if (Number.isFinite(cNum)) {
    return fila.some((x) => {
      const n = parseInt(String(x).replace(/[^0-9]/g, ""), 10);
      return Number.isFinite(n) && n === cNum;
    });
  }
  return fila.some((x) => String(x).trim().toLowerCase() === c.toLowerCase());
}

/**
 * Motor de LIQUIDACIÓN del NINI (cruce contra la Pizarra oficial, hasta 8 puestos).
 *
 * REGLA DE NEGOCIO:
 *  - El Cliente que JUEGA el nini apuesta a que el caballo NO entra en las
 *    posiciones especificadas (top N). Si el caballo NO figura en la pizarra
 *    requerida → el Cliente 1 GANA (pago a la par 2× monto, menos comisión) y
 *    el Cliente 2 ("da") pierde.
 *  - Si el caballo gana/figura en la pizarra requerida → el Cliente 1 PIERDE
 *    su monto y el Cliente 2 ganaría (menos comisión).
 * La comisión se cobra SOLO sobre la ganancia bruta (igual que el resto del motor).
 */
export function liquidarNini(
  t: TicketMotor,
  tasaComision?: number | null
): ResultadoMotor {
  const info = parsearNini(t.tipo_jugada);
  if (!info) {
    return {
      ok: false,
      motivo: "NINI malformado: " + t.tipo_jugada,
      totalClienteNeto: 0,
      balanceBanca: t.monto,
      gananciaCasa: 0,
    };
  }
  const caballoNum = parseInt(String(t.caballo ?? "").replace(/[^0-9]/g, ""), 10);
  if (!Number.isFinite(caballoNum)) {
    return {
      ok: false,
      motivo: "NINI requiere el número del caballo (columna CABALLO)",
      totalClienteNeto: 0,
      balanceBanca: t.monto,
      gananciaCasa: 0,
    };
  }
  const tasa = Number.isFinite(Number(tasaComision)) && Number(tasaComision) >= 0
    ? Number(tasaComision)
    : COMISION_CASA.rate * 100;

  const figura = figuraEnPizarra(caballoNum, t.pizarra, info.N);
  if (!figura) {
    const bruto = t.monto * 2;
    const comision = bruto - t.monto > 0 ? round2((bruto - t.monto) * (tasa / 100)) : 0;
    return {
      ok: true,
      motivo:
        `NINI gana: caballo ${caballoNum} no figura en ${info.N === 1 ? "el 1er puesto" : `los ${info.N} primeros puestos`}` +
        (comision > 0 ? " · comisión casa $" + round2(comision) : ""),
      totalClienteNeto: round2(bruto - comision),
      balanceBanca: round2(t.monto - bruto + comision),
      gananciaCasa: comision,
    };
  }
  return {
    ok: false,
    motivo: `NINI pierde: caballo ${caballoNum} figura en ${info.N === 1 ? "el 1er puesto" : `el top ${info.N}`}`,
    totalClienteNeto: 0,
    balanceBanca: t.monto,
    gananciaCasa: 0,
  };
}

export type ComisionConfig = {
  /** Solo se descuenta sobre la GANANCIA NETA del jugador, nunca sobre el capital. */
  rate: number;
};

export const COMISION_CASA: ComisionConfig = { rate: 0.05 };

export type TicketMotor = BetSlipEntry & {
  /** Posición exhaustada del ejemplar según la Pagar (orden de llegada). */
  puesto_final: number | "SOC" | "EMP1";
  pizarra: PizarraCarrera;
  dividendos: Record<string, number> | null;
};

export type ResultadoMotor = {
  ok: boolean;
  motivo?: string;
  /** Lo que recibe el jugador en mano (capital + ganancia neta − comisión). */
  totalClienteNeto: number;
  /** +/- del balance de la casa (jugada a favor = negativo, uno de sus rubros). */
  balanceBanca: number;
  /** Comisión efectiva cobrada por la casa. */
  gananciaCasa: number;
};

export type ProcesarTicket = (t: TicketMotor) => ResultadoMotor;

const PROCESADORES = new Map<string, ProcesarTicket>();

export function registrarProcesador(tipo: string, fn: ProcesarTicket): void {
  PROCESADORES.set(tipo, fn);
}

export function procesarTicket(t: TicketMotor): ResultadoMotor {
  const fn = PROCESADORES.get(t.tipo_jugada);
  if (!fn) {
    return {
      ok: false,
      motivo: "modalidad sin motor registrado: " + t.tipo_jugada,
      totalClienteNeto: 0,
      balanceBanca: 0,
      gananciaCasa: 0,
    };
  }
  return fn(t);
}