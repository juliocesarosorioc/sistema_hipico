/**
 * ============================================================================
 * MOTOR OFICIAL: Cálculo Exacto de Devoluciones, Cruces y Comisiones de Socios
 * ============================================================================
 *
 * Reglas de Negocio Oficiales:
 * 1. Base decidida: Se calcula única y exclusivamente sobre el monto DECIDIDO,
 *    gane o pierda, en jugadas de puestos:
 *    - 1 a 1: Si arriesga 100 y gana, cobra 200 (ganancia = 100). Sobre 100 se calcula.
 *    - Proporciones (ej. 10/5):
 *      · Si arriesga 100 y pierde, paga 100 -> base = 100 (al 1% = 1.00).
 *      · Si arriesga 100 y gana 50 -> ganancia = 50 -> base = 50 (al 1% = 0.50).
 * 2. Cruce de jugadas en la misma carrera:
 *    - La devolución o comisión se calcula SOLO en base a la diferencia entre lo ganado
 *      y lo perdido en la carrera.
 *    - Ejemplo: Si gana 100 y pierde 50, base = |100 - 50| = 50 -> al 1% = 0.50.
 * 3. Jugadas de bloque o dividida (ej. 2Y3N fraccionada):
 *    - Solo se computa la porción decidida (p. ej. si 50 pierde y 50 empata/devuelve,
 *      la base es 50).
 * 4. Signo:
 *    - La devolución al cliente SIEMPRE SUMA (+) a su favor a su saldo, nunca resta.
 * 5. Comisión de socio por afiliado:
 *    - Se calcula exactamente sobre esta misma base decidida neta de la carrera.
 * 6. Rol Consigue (dador):
 *    - Sin cruce, el rol Consigue NO genera devolución, incentivo ni comisión de socio.
 *    - CON cruce (el cliente gana y pierde en la misma carrera, incluyendo jugadas donde
 *      da/consigue), las jugadas Consigue SÍ participan y la devolución, el incentivo y la
 *      comisión de socio se calculan solo sobre la ganancia/pérdida de diferencia.
 *      Se emite `notaAsiento` para dejar constancia en el asiento contable.
 */

import { redondearCentavos } from "@/shared/lib/dinero";
import { esJugadaPuestosParaIncentivo } from "@/features/saldos/lib/contabilidad-central";

export interface JugadaEntradaBaseDecidida {
  id?: string | number;
  nombreJugada?: string | null;
  jugada?: string | null;
  modalidad?: string | null;
  origen?: string | null;
  tipoJugada?: string | null;
  monto?: number | string | null;
  montoJugado?: number | string | null;
  montoDecidido?: number | string | null;
  premioPagar?: number | string | null;
  premio?: number | string | null;
  resultado?: number | null;
  estado?: string | null;
  anulada?: boolean | null;
  esAdelantada?: boolean | null;
  rol?: string | null;
}

export interface ResultadoBaseDecididaCarrera {
  totalGanadoBruto: number;
  totalPerdidoBruto: number;
  hayCruce: boolean;
  baseDecidida: number;
  baseDecididaTotal: number;
  devolucion: number;
  /** true cuando jugadas en rol Consigue participaron por existir cruce en la carrera. */
  consigueIncluidoPorCruce: boolean;
  /** Nota para el asiento contable cuando el cruce incluye jugadas en rol Consigue. */
  notaAsiento?: string;
}

export function esRolConsigue(j: { rol?: string | null }): boolean {
  return Boolean(j.rol && String(j.rol).trim().toUpperCase() === "CONSIGUE");
}

function esJugadaElegibleIgnorandoRol(j: JugadaEntradaBaseDecidida): boolean {
  if (j.anulada === true) return false;
  const est = String(j.estado ?? "").trim().toUpperCase();
  if (
    est === "RETIRADO" ||
    est === "RETIRADA" ||
    est === "ANULADA" ||
    est === "ANULADO" ||
    est === "CANCELADA" ||
    est === "CANCELADO" ||
    est === "RECHAZADO" ||
    est === "RECHAZADA"
  ) {
    return false;
  }
  const nom = String(j.nombreJugada ?? j.jugada ?? "").trim();
  const mod = String(j.modalidad ?? j.tipoJugada ?? "").trim();
  const ori = String(j.origen ?? "").trim();
  return esJugadaPuestosParaIncentivo(nom, mod, ori);
}

/**
 * Determina si una jugada es elegible para devolución / incentivo por sí sola.
 * El rol Consigue no es elegible aislado; solo participa cuando hay cruce
 * (ver `calcularBaseDecididaCarrera`).
 */
export function esJugadaElegibleParaDevolucion(j: JugadaEntradaBaseDecidida): boolean {
  if (esRolConsigue(j)) return false;
  return esJugadaElegibleIgnorandoRol(j);
}

/** Ganado/perdido bruto de una jugada desde la perspectiva del cliente que la reporta. */
function ganadoPerdidoJugada(j: JugadaEntradaBaseDecidida): { ganado: number; perdido: number } {
  // 1. Si viene con resultado neto oficial pre-calculado
  if (typeof j.resultado === "number" && !isNaN(j.resultado)) {
    if (j.resultado > 0) return { ganado: j.resultado, perdido: 0 };
    if (j.resultado < 0) return { ganado: 0, perdido: Math.abs(j.resultado) };
    // j.resultado === 0 es empate total (ej. NINI devolviendo capital) -> no hay base decidida
    return { ganado: 0, perdido: 0 };
  }

  // 2. Si no tiene resultado numérico explícito, deducir según estado y montos
  const est = String(j.estado ?? "").trim().toUpperCase();
  const monto = Number(j.montoJugado ?? j.monto ?? 0);
  const premio = Number(j.premioPagar ?? j.premio ?? 0);
  const montoDec = Number(j.montoDecidido ?? 0);

  if (est === "GANADOR" || est === "GANO" || est === "SOLUCIONADO") {
    let ganancia = 0;
    if (premio > monto) {
      ganancia = premio - monto;
    } else if (montoDec > 0) {
      ganancia = montoDec;
    } else {
      ganancia = monto;
    }
    return { ganado: ganancia, perdido: 0 };
  }
  if (est === "PERDEDOR" || est === "PERDIO") {
    let perdida = monto;
    if (premio > 0 && premio < monto) {
      // Bloque o dividida con devolución parcial de empate
      perdida = monto - premio;
    } else if (montoDec > 0) {
      perdida = montoDec;
    }
    return { ganado: 0, perdido: perdida };
  }
  return { ganado: 0, perdido: 0 };
}

function sumar(jugadas: JugadaEntradaBaseDecidida[]): { ganado: number; perdido: number } {
  let ganado = 0;
  let perdido = 0;
  for (const j of jugadas) {
    const r = ganadoPerdidoJugada(j);
    ganado += r.ganado;
    perdido += r.perdido;
  }
  return { ganado: redondearCentavos(ganado), perdido: redondearCentavos(perdido) };
}

/**
 * Calcula la base decidida y la devolución para un grupo de jugadas de un mismo
 * cliente en una misma carrera. Las jugadas en rol Consigue deben venir con
 * resultado/estado desde la perspectiva del cliente (dador).
 */
export function calcularBaseDecididaCarrera(
  jugadasCarrera: JugadaEntradaBaseDecidida[],
  devolucionPct: number = 0
): ResultadoBaseDecididaCarrera {
  const elegibles = jugadasCarrera.filter(esJugadaElegibleIgnorandoRol);
  const soloJuega = elegibles.filter((j) => !esRolConsigue(j));
  const hayConsigue = elegibles.length !== soloJuega.length;

  // Con rol Consigue: solo participa si, al incluirlo, hay cruce (gana y pierde en la carrera).
  const conConsigue = sumar(elegibles);
  const consigueIncluidoPorCruce = hayConsigue && conConsigue.ganado > 0 && conConsigue.perdido > 0;
  const totales = consigueIncluidoPorCruce ? conConsigue : sumar(soloJuega);

  const totalGanadoBruto = totales.ganado;
  const totalPerdidoBruto = totales.perdido;

  const hayCruce = totalGanadoBruto > 0 && totalPerdidoBruto > 0;
  // Regla unificada de cruces: lo que gana menos lo que pierde y a la diferencia positiva
  // es lo que se le calcula la comisión en caso de que el saldo termine siendo positivo.
  // En ese caso, solo en base a ese monto positivo se estiman las devoluciones e incentivos.
  const diferenciaPositiva = hayCruce && totalGanadoBruto > totalPerdidoBruto
    ? redondearCentavos(totalGanadoBruto - totalPerdidoBruto)
    : 0;

  const baseDecidida = hayCruce
    ? diferenciaPositiva
    : redondearCentavos(totalGanadoBruto + totalPerdidoBruto);

  const pct = Math.max(0, Number(devolucionPct) || 0);
  const devolucion = redondearCentavos(baseDecidida * (pct / 100));

  return {
    totalGanadoBruto,
    baseDecididaTotal: baseDecidida,
    totalPerdidoBruto,
    hayCruce,
    baseDecidida,
    devolucion,
    consigueIncluidoPorCruce,
    ...(consigueIncluidoPorCruce
      ? {
          notaAsiento:
            `Cruce con rol Consigue: ganado ${totalGanadoBruto.toFixed(2)} vs perdido ` +
            `${totalPerdidoBruto.toFixed(2)} → devolución/incentivo/comisión sobre diferencia ` +
            `${baseDecidida.toFixed(2)}`,
        }
      : {}),
  };
}
