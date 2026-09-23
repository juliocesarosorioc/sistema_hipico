export type TipoJugada = "nini" | "remate" | "tabla" | "ganador";

/**
 * Jugadas de PAGO INMEDIATO: se liquidan SOLO con el 1er lugar de la Pizarra
 * (Fase 1), ignorando por completo los dividendos de la Fase 2.
 */
export const PAGO_INMEDIATO: ReadonlySet<TipoJugada> = new Set(["nini", "remate"]);

export function esPagoInmediato(t: TipoJugada): boolean {
  return PAGO_INMEDIATO.has(t);
}

export type PizarraOrden = {
  primero: string;
  segundo?: string;
  tercero?: string;
  cuarto?: string;
};

export type DividendosOficiales = {
  tabla?: number;
  ganador?: number;
  nini?: number;
  remate?: number;
};

export type PayloadLiquidacion = {
  hipodromo: string;
  fecha: string;
  carrera: number;
  tipo_jugada: TipoJugada;
  pizarra: PizarraOrden;
  dividendos: DividendosOficiales | null;
  monto_total: number;
};

export type ResultadoValidacion =
  | { ok: true }
  | { ok: false; motivo: string };

export function validarPizarra(
  tipo: TipoJugada,
  p: PizarraOrden
): ResultadoValidacion {
  if (!p.primero) return { ok: false, motivo: "Falta el 1er lugar de la pizarra" };
  if (!esPagoInmediato(tipo) && !p.segundo) {
    return { ok: false, motivo: "tabla/ganador exigen 2do lugar" };
  }
  return { ok: true };
}