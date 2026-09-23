/**
 * Núcleo matemático de la plataforma — patrón Estrategia/Router.
 * procesarTicket(ticket) lee ticket.tipo_jugada y deriva al submódulo correcto.
 * CERO espagueti: cada modalidad vive en su propio submódulo.
 */
import { BetSlipEntry } from "@/store/bet-slip";
import { PizarraCarrera, ResultadoPago, esPagoInmediato } from "./liquidacion";

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