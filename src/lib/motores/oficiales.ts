/**
 * MotoresOficiales — Liquidación UNIVERSAL con dividendos oficiales.
 *
 * Requisito de la casa (Bloque 3): el motor debe liquidar MATEMÁTICAMENTE
 * TABLAS FIJAS, PUESTOS (1P/2P), GANADOR (además de NINI/REMATE),
 * cruzando cada jugada con `resultados_carreras.dividendos` (pago por $1) y
 * la orden de llegada oficial, aplicando la comisión del 5% SIEMPRE sobre el
 * premio BRUTO de la modalidad ganadora.
 *
 * Regla de decisión de modalidad → clave de dividendo:
 *   - GANADOR ("5G", "GANADOR")          → dividendos.win
 *   - PUESTOS puros ("2P")               → dividendos.puestos
 *   - TABLABAS ("TABLA …")               → dividendos.tabla (premio por tabla)
 *   - NINI ("2N" …)                      → dividendos.nini
 *   - AMERICANAS ("W","P","S")           → matriz wps_WW / wps_WP / wps_WS /
 *                                            wps_PP / wps_PS / wps_SS
 *   - REMATE / resto                     → dividendos.remate o laz 2× de la casa
 *
 * Las americanas se resuelven ANTES que los puestos porque su pago depende de
 * dos cosas a la vez (qué se apostó × en qué puesto llegó) y no de una sola
 * clave de dividendo. Ver `motores/wps.ts`.
 *
 * Si el dividendo oficial no existe, el motor conserva el pago a la par de la
 * casa (2× / 120×100), por lo que NUNCA degrada el comportamiento previo.
 *
 * EXCEPCIÓN (W/P/S): si la matriz de una jugada que GANÓ por posición todavía
 * no está cargada, el motor devuelve `indeterminado` en vez de perderla. La
 * par de la casa no aplica: un W que llegó 1º no se puede pagar "a 2×" solo
 * porque falte el dividendo, y cobrar $0 a una jugada ganadora por un dato no
 * cargado sería un error que ni el estado "Perdedor" ya escrito revierte.
 */
import { registrarProcesador, TicketMotor, ResultadoMotor, COMISION_CASA, parsearNini, liquidarPareo } from "../bettingEngine";
import { liquidarPuestos } from "./puestos";
import { liquidarWps } from "./wps";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const TASA_DEFECTO = COMISION_CASA.rate * 100;

const ORDEN_PIZARRA = ["primero", "segundo", "tercero", "cuarto", "quinto", "sexto", "septimo", "octavo"] as const;

/**
 * Normaliza CUALQUIER forma en que se haya guardado el orden de llegada a la
 * lista de ejemplares del 1º al 8º, que es lo que entiende la pizarra.
 *
 * Se encontraron cuatro formatos conviviendo en el proyecto (y en la base):
 *   - `[{ numero, puesto }]`  ← forma canónica (club_registrar_orden_llegada,
 *                               PagarCarreraModal.ordenLlegadaDePizarra)
 *   - `["7", "9"]`            ← lista suelta de ejemplares
 *   - `{ 1: "7", 2: "9" }`    ← mapa puesto → ejemplar
 *   - `{ primero, segundo… }` ← PizarraCarrera tal cual
 * Sin esto, leer `[{numero,puesto}]` con un `map(String)` devolvía
 * "[object Object]" y la liquidación daba cualquier cosa.
 */
export function puestosDesdeOrdenLlegada(v: unknown): string[] {
  if (v == null) return [];
  const limpio = (x: unknown): string => {
    if (x == null) return "";
    if (typeof x === "number" || typeof x === "string") return String(x).trim();
    if (typeof x === "object") {
      const o = x as { numero?: unknown; ejemplar?: unknown; caballo?: unknown };
      return limpio(o.numero ?? o.ejemplar ?? o.caballo ?? "");
    }
    return "";
  };

  // 1) Arreglo de objetos {numero, puesto}: se ordena por el puesto.
  if (Array.isArray(v)) {
    if (!v.length) return [];
    if (v.some((e) => typeof e === "object" && e !== null)) {
      return [...(v as Array<Record<string, unknown>>)]
        .map((e, i) => ({
          numero: limpio(e),
          puesto: Number(e.puesto) || i + 1,
        }))
        .filter((e) => e.numero !== "")
        .sort((a, b) => a.puesto - b.puesto)
        .map((e) => e.numero);
    }
    return (v as unknown[]).map(limpio).filter(Boolean);
  }

  if (typeof v !== "object") return [];

  // 2) PizarraCarrera {primero, segundo, …}
  const como = v as Record<string, unknown>;
  if (ORDEN_PIZARRA.some((k) => k in como)) {
    return ORDEN_PIZARRA.map((k) => limpio(como[k])).filter(Boolean);
  }

  // 3) Mapa { puesto: ejemplar } → se ordena por la clave del puesto.
  return Object.keys(como)
    .map((k) => ({ puesto: Number(k) || 0, numero: limpio(como[k]) }))
    .filter((e) => e.numero !== "")
    .sort((a, b) => a.puesto - b.puesto)
    .map((e) => e.numero);
}

export type ClaveDividendo =
  | "win"
  | "place"
  | "show"
  | "puestos"
  | "tabla"
  | "nini"
  | "remate";

/** Decide la clave de dividendo que corresponde a la modalidad del ticket. */
export function claveDeModalidad(tipoJugada: string): ClaveDividendo | null {
  const t = String(tipoJugada ?? "").trim().toUpperCase();
  if (!t) return null;
  if (/^TABLA/.test(t)) return "tabla";
  if (parsearNini(t)) return "nini";
  if (/^\d*G$/i.test(t) || /^GANADOR/.test(t)) return "win";
  if (/^(\d+)P$/i.test(t)) return "puestos";
  if (/^REMATE/.test(t)) return "remate";
  return null;
}

/** Multiplicador oficial (por $1) o null si la modalidad no tiene dividendo.
 *  Primero busca el dividendo POR CABALLO del ticket (clave "win:7", "place:7",
 *  "show:7") y, si no existe, cae al dividendo global de la modalidad. */
export function dividendoDe(t: TicketMotor): number | null {
  const div = t.dividendos;
  if (!div || typeof div !== "object") return null;
  const k = claveDeModalidad(t.tipo_jugada);
  if (!k) return null;
  const numero = t.caballo != null ? String(t.caballo).trim() : "";
  const porCaballo = numero ? Number(div[`${k}:${numero}`]) : NaN;
  if (Number.isFinite(porCaballo) && porCaballo >= 1) return porCaballo;
  const mult = Number(div[k]);
  return Number.isFinite(mult) && mult >= 1 ? mult : null;
}

/**
 * Motor UNIFICADO: ejecuta la lógica de decisión del submódulo de la modalidad
 * y, si el ticket GANA y existe dividendo oficial, sustituye el premio bruto
 * por monto × dividendo (pago por $1) manteniendo la comisión 5% estricta
 * SOLO sobre la ganancia bruta.
 */
/** Resuelve una jugada de Tabla Fija: gana si el ejemplar apostado es quien
    cruzó la raya primero (o si es TABLA COMPLETA = cubre todo el lote). Como el
    ganador oficial puede ser bajado/descalificado después, el pago se mantiene
    en `primero_raya` (por defecto = primero). Bruto = monto × premio_por_tabla
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
  const cruce = t.pizarra.primero_raya ?? t.pizarra.primero;
  const gana = esCompleta || (!!ejemplar && String(cruce) === ejemplar);
  if (!gana) {
    return {
      ok: false,
      motivo: `TABLA pierde (cruzó la raya 1º el ${cruce ?? "?"}, jugada ${ejemplar ?? "COMPLETA"}).`,
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

  // AMERICANAS W/P/S: el pago depende de la matriz (que se aposto x en que
  // puesto llego), asi que se resuelven antes de los puestos y NO reusan
  // `dividendoDe`, que solo conoce una clave por modalidad.
  const wps = liquidarWps(t, tasa);
  if (wps) return wps;

  const base = liquidarPuestos(t, tasa);

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