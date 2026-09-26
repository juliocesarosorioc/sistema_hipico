/**
 * MotoresOficiales — Liquidación UNIVERSAL con dividendos oficiales.
 *
 * Requisito de la casa (Bloque 3): el motor debe liquidar MATEMÁTICAMENTE
 * TABLAS FIJAS, PUESTOS (1P/2P), GANADOR y MARCAS (además de NINI/REMATE),
 * cruzando cada jugada con `resultados_carreras.dividendos` (pago por $1) y
 * la orden de llegada oficial, aplicando la comisión del 5% SIEMPRE sobre el
 * premio BRUTO de la modalidad ganadora.
 *
 * Regla de decisión de modalidad → clave de dividendo:
 *   - GANADOR ("5G", "GANADOR")          → dividendos.win
 *   - PUESTOS puros ("2P")               → dividendos.puestos
 *   - TABLABAS ("TABLA …")               → dividendos.tabla (premio por tabla)
 *   - MARCAS ("MARCA …")                 → dividendos.marcas
 *   - NINI ("2N" …)                      → dividendos.nini
 *   - REMATE / resto                     → dividendos.remate o laz 2× de la casa
 *
 * Si el dividendo oficial no existe, el motor conserva el pago a la par de la
 * casa (2× / 120×100), por lo que NUNCA degrada el comportamiento previo.
 */
import { registrarProcesador, TicketMotor, ResultadoMotor, COMISION_CASA, parsearNini, liquidarPareo } from "../bettingEngine";
import { liquidarMarcas, type MarcasConfig } from "./marcas";
import { liquidarPuestos } from "./puestos";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const TASA_DEFECTO = COMISION_CASA.rate * 100;

export type ClaveDividendo =
  | "win"
  | "place"
  | "show"
  | "puestos"
  | "marcas"
  | "tabla"
  | "nini"
  | "remate";

/** Decide la clave de dividendo que corresponde a la modalidad del ticket. */
export function claveDeModalidad(tipoJugada: string): ClaveDividendo | null {
  const t = String(tipoJugada ?? "").trim().toUpperCase();
  if (!t) return null;
  if (/^TABLA/.test(t)) return "tabla";
  if (/^MARCA/.test(t)) return "marcas";
  if (parsearNini(t)) return "nini";
  if (/^\d*G$/i.test(t) || /^GANADOR/.test(t)) return "win";
  if (/^(\d+)P$/i.test(t)) return "puestos";
  if (/^REMATE/.test(t)) return "remate";
  return null;
}

/** Multiplicador oficial (por $1) o null si la modalidad no tiene dividendo. */
export function dividendoDe(t: TicketMotor): number | null {
  const div = t.dividendos;
  if (!div || typeof div !== "object") return null;
  const k = claveDeModalidad(t.tipo_jugada);
  if (!k) return null;
  const mult = Number(div[k]);
  return Number.isFinite(mult) && mult >= 1 ? mult : null;
}

/**
 * Motor UNIFICADO: ejecuta la lógica de decisión del submódulo de la modalidad
 * y, si el ticket GANA y existe dividendo oficial, sustituye el premio bruto
 * por monto × dividendo (pago por $1) manteniendo la comisión 5% estricta
 * SOLO sobre la ganancia bruta. Config opcional de marcas (t.marcas).
 */
/** Resuelve una jugada de Tabla Fija: gana si el ejemplar apostado es el 1º
    (o si es TABLA COMPLETA = cubre todo el lote). Bruto = monto × premio_por_tabla
    (o dividendo.tabla si no hay premio). */
export function liquidarTabla(
  t: TicketMotor,
  premio_por_tabla?: number | null,
  tasaComision?: number | null,
): ResultadoMotor | null {
  const tipo = String(t.tipo_jugada ?? "").trim().toUpperCase();
  if (!/^TABLA/.test(tipo)) return null;
  const n = /N(\d+)/.exec(tipo);
  const ejemplar = n ? n[1] : null;
  const esCompleta = tipo.includes("TABLA COMPLETA");
  const gana = esCompleta || (!!ejemplar && String(t.pizarra.primero) === ejemplar);
  if (!gana) {
    return {
      ok: false,
      motivo: `TABLA pierde (ganó el ${t.pizarra.primero ?? "?"}, jugada ${ejemplar ?? "COMPLETA"}).`,
      totalClienteNeto: 0,
      balanceBanca: t.monto,
      gananciaCasa: 0,
    };
  }
  const tasa = Number.isFinite(Number(tasaComision)) && Number(tasaComision) >= 0 ? Number(tasaComision) : TASA_DEFECTO;
  const porTabla = premio_por_tabla ?? t.dividendos?.tabla ?? 2;
  const bruto = round2(t.monto * porTabla);
  const gananciaBruta = bruto - t.monto;
  const comision = gananciaBruta > 0 ? round2(gananciaBruta * (tasa / 100)) : 0;
  return {
    ok: true,
    motivo: `TABLA gana: ${ejemplar ? "ejemplar " + ejemplar : "tabla completa"} 1º. ${t.monto} × premio $${round2(porTabla)} → bruto $${round2(bruto)}` +
      (comision > 0 ? ` · comisión casa $${round2(comision)}` : ""),
    totalClienteNeto: round2(bruto - comision),
    balanceBanca: round2(t.monto - bruto + comision),
    gananciaCasa: comision,
  };
}

export function liquidarOficial(
  t: TicketMotor,
  tasaComision?: number | null
): ResultadoMotor {
  const tasa =
    Number.isFinite(Number(tasaComision)) && Number(tasaComision) >= 0
      ? Number(tasaComision)
      : TASA_DEFECTO;

  // TABLAS FIJAS: resolución explícita (no pasa por el motor de puestos).
  const tabla = liquidarTabla(t, t.premio_por_tabla, tasa);
  if (tabla) return tabla;

  // PAREOS (PP): el bando elegido (sintaxis "A X B") se resuelve por la mejor
  // posición en la pizarra (liquidarPareo). Con proporción (ej. "10/8") se
  // ESTIMA el premio; sin proporción se paga PARIDAD. Comisión sobre el neto.
  const tipoPP = String(t.tipo_jugada ?? "").toUpperCase();
  const caballoPP = String(t.caballo ?? "").toUpperCase();
  if (/^PP/.test(tipoPP) || /X/.test(caballoPP)) {
    return liquidarPareo(t, tasa);
  }

  const cfgMarcas = (t as TicketMotor & { marcas?: MarcasConfig }).marcas;
  const base =
    claveDeModalidad(t.tipo_jugada) === "marcas"
      ? liquidarMarcas(t, cfgMarcas, tasa)
      : liquidarPuestos(t, tasa);

  const mult = dividendoDe(t);
  if (!base.ok || mult == null) return base;

  const bruto = round2(t.monto * mult);
  const gananciaBruta = bruto - t.monto;
  const comision = gananciaBruta > 0 ? round2(gananciaBruta * (tasa / 100)) : 0;

  return {
    ok: true,
    motivo: `${base.motivo ?? "Gana"} · dividendo oficial ${mult}x → bruto $${round2(bruto)}` +
      (comision > 0 ? ` · comisión casa $${round2(comision)}` : ""),
    totalClienteNeto: round2(bruto - comision),
    balanceBanca: round2(t.monto - bruto + comision),
    gananciaCasa: comision,
  };
}

export function procesarOficial(t: TicketMotor): ResultadoMotor {
  return liquidarOficial(t);
}

registrarProcesador("oficial", procesarOficial);
registrarProcesador("tabla", procesarOficial);
registrarProcesador("ganador", procesarOficial);