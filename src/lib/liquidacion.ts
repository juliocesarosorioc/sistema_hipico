/**
 * Motor de pago inmediato: en esta Fase 2 solo se liquidan NINI y REMATE
 * (con el 1er lugar de la pizarra). TABLA, GANADOR, PUESTOS, MARCAS quedan
 * pendientes — exigen dividendos oficiales (Fase siguiente del plan).
 */
import type { BetSlipEntry } from "@/store/bet-slip";

export type PizarraCarrera = {
  primero: string;
  segundo?: string;
  tercero?: string;
  cuarto?: string;
};

export type PayloadPagar = {
  hipodromo: string;
  carrera: string;
  tipo_jugada: string;
  pizarra: PizarraCarrera;
  dividendos: Record<string, number> | null;
  monto_total: number;
};

export type ResultadoPago =
  | { ok: true; payload: PayloadPagar; pagoInmediato: boolean }
  | { ok: false; motivo: string };

const PAGO_INMEDIATO = new Set<string>(["nini", "remate"]);

export function esPagoInmediato(tipo: string): boolean {
  return PAGO_INMEDIATO.has(tipo);
}

export function crearPayloadPago(
  entries: BetSlipEntry[],
  tipo_jugada: string,
  pizarra: PizarraCarrera,
  dividendos: Record<string, number> | null
): ResultadoPago {
  if (entries.length === 0) return { ok: false, motivo: "Boleto vacío" };
  if (!pizarra.primero) return { ok: false, motivo: "Falta 1er lugar" };

  const inmediato = esPagoInmediato(tipo_jugada);

  return {
    ok: true,
    pagoInmediato: inmediato,
    payload: {
      hipodromo: entries[0].hipodromo,
      carrera: entries[0].carrera,
      tipo_jugada,
      pizarra,
      dividendos: inmediato ? null : dividendos,
      monto_total: entries.reduce((a, e) => a + e.total, 0),
    },
  };
}