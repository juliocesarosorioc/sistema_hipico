/**
 * MarcasEngine — modalidad MARCA (120/100).
 * Registrado en procesarTicket() vía registrarProcesador("marca"/"marcas"/"marcar").
 * REGLA DE RESOLUCIÓN:
 *  - La jugada enfrenta a [Caballos de la Derecha + Cualquier otro caballo
 *    registrado en la carrera que NO esté en la Izquierda] CONTRA [Caballos de
 *    la Izquierda (los "Marcados"/favoritos)].
 *  - Gana la MARCA si el ganador de la carrera NO pertenece a la Izquierda.
 * PROPORCIÓN ASIMÉTRICA: a diferencia del cruce 10/8, la marca opera por
 *  defecto a 120 para 100 (riesgo 120 para ganar 100): el premio bruto se
 *  calcula con bruto = monto × (1 + paga/riesgo) ANTES de descontar la
 *  comisión estándar (5% SOLO sobre la ganancia bruta).
 */
import { registrarProcesador, TicketMotor, ResultadoMotor, COMISION_CASA } from "../bettingEngine";

export const MARCA_PAGA = 100;
export const MARCA_RIESGO = 120;

export type MarcasConfig = {
  /** Izquierda — los "marcados"/favoritos contra quienes se apuesta. */
  marcados?: string[];
  /** Derecha — los caballos que van en contra (informativos; el resto de la
   *  carrera no marcado también hace ganar la marca). */
  contra?: string[];
  /** Paga (numerador de la proporción, defecto 100). */
  paga?: number;
  /** Riesgo (denominador de la proporción, defecto 120). */
  riesgo?: number;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function normalizarNum(v: unknown): string {
  const s = String(v ?? "").trim();
  const m = /\d+/.exec(s);
  return m ? m[1] : s.toUpperCase();
}

export function parsearMarcasLista(txt?: string | null): string[] {
  return String(txt ?? "")
    .split(/[/,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function ganadorPizarra(t: TicketMotor): string {
  return normalizarNum(t.pizarra?.primero);
}

export function liquidarMarcas(
  t: TicketMotor,
  config?: MarcasConfig,
  tasaComision?: number | null
): ResultadoMotor {
  const cfg = config ?? (t as TicketMotor & { marcas?: MarcasConfig }).marcas ?? {};
  const marcados = new Set((cfg.marcados ?? []).map(normalizarNum).filter(Boolean));
  const ganador = ganadorPizarra(t);
  if (!ganador) {
    return {
      ok: false,
      motivo: "MARCA: falta el 1er lugar en la pizarra.",
      totalClienteNeto: 0,
      balanceBanca: t.monto,
      gananciaCasa: 0,
    };
  }
  const paga = Number.isFinite(Number(cfg.paga)) && Number(cfg.paga) > 0 ? Number(cfg.paga) : MARCA_PAGA;
  const riesgo = Number.isFinite(Number(cfg.riesgo)) && Number(cfg.riesgo) > 0 ? Number(cfg.riesgo) : MARCA_RIESGO;
  const tasa =
    Number.isFinite(Number(tasaComision)) && Number(tasaComision) >= 0
      ? Number(tasaComision)
      : COMISION_CASA.rate * 100;

  const gana = !marcados.has(ganador);
  if (!gana) {
    return {
      ok: false,
      motivo: `MARCA pierde: el marcado ${ganador} gana la carrera.`,
      totalClienteNeto: 0,
      balanceBanca: t.monto,
      gananciaCasa: 0,
    };
  }
  const bruto = round2(t.monto * (1 + paga / riesgo));
  const gananciaBruta = bruto - t.monto;
  const comision = gananciaBruta > 0 ? round2(gananciaBruta * (tasa / 100)) : 0;
  const motivoMarcados = (cfg.marcados ?? []).length ? ` (marcados: ${(cfg.marcados ?? []).join("/")})` : "";
  return {
    ok: true,
    motivo: `MARCA gana${motivoMarcados}: gana un NO marcado (${ganador}). Paga ${paga}/${riesgo} → bruto $${bruto}` + (comision > 0 ? ` · comisión casa $${round2(comision)}` : ""),
    totalClienteNeto: round2(bruto - comision),
    balanceBanca: round2(t.monto - bruto + comision),
    gananciaCasa: comision,
  };
}

export function procesarMarcas(t: TicketMotor): ResultadoMotor {
  return liquidarMarcas(t);
}

registrarProcesador("marca", procesarMarcas);
registrarProcesador("marcas", procesarMarcas);
registrarProcesador("marcar", procesarMarcas);