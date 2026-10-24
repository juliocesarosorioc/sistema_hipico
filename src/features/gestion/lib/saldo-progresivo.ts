export interface LineaJugadaProgresivaInput {
  id?: string;
  lineaIndice: number;
  jugador: string;
  contraparte?: string;
  montoSolicitado: number;
  textoOriginal?: string;
  observacionExistente?: string | null;
  /** Tope adicional calculado por el reparto de riesgo de la jugada. */
  montoAutorizado?: number;
  /** Una línea no válida no consume saldo ni genera observación de exceso. */
  valida?: boolean;
}

export interface ResultadoLineaSaldoProgresivo {
  lineaIndice: number;
  jugador: string;
  saldoAntes: number | null;
  montoSolicitado: number;
  montoAceptado: number;
  montoExcedido: number;
  saldoRestante: number | null;
  excedido: boolean;
  observacionCorta: string | null;
  etiquetaRestante: string;
  observacion: string | null;
}

const redondear = (monto: number): number => Math.round((monto + Number.EPSILON) * 100) / 100;
const claveJugador = (nombre: string): string =>
  nombre.trim().replace(/\s+/g, " ").toLocaleUpperCase("es-VE");

function formatearMonto(monto: number): string {
  return new Intl.NumberFormat("es-VE", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(monto);
}

function observacionSinExceso(observacion: string | null | undefined): string {
  return String(observacion ?? "")
    .split(/[·;\n]/)
    .map((parte) => parte.trim())
    .filter((parte) => parte && !/^excedido(?:\s|$)/i.test(parte))
    .join(" · ");
}

function esMapaSaldo(
  valores: ReadonlyMap<string, number | null> | Record<string, number | null>
): valores is ReadonlyMap<string, number | null> {
  return typeof (valores as ReadonlyMap<string, number | null>).get === "function";
}

/**
 * Evalúa una carga en el orden de sus líneas. El saldo inicial es disponible
 * (saldo + aval); los topes externos permiten respetar el reparto de riesgo.
 */
export function evaluarSaldoProgresivoJugadas(
  lineas: LineaJugadaProgresivaInput[],
  saldoInicialPorJugador: ReadonlyMap<string, number | null> | Record<string, number | null>
): ResultadoLineaSaldoProgresivo[] {
  const saldos = new Map<string, number | null>();
  const leerInicial = (jugador: string): number | null | undefined => {
    const clave = claveJugador(jugador);
    if (esMapaSaldo(saldoInicialPorJugador)) {
      return saldoInicialPorJugador.get(clave) ?? saldoInicialPorJugador.get(jugador);
    }
    const saldosPorClave = saldoInicialPorJugador as Record<string, number | null>;
    return saldosPorClave[clave] ?? saldosPorClave[jugador];
  };

  return lineas.map((linea) => {
    const clave = claveJugador(linea.jugador);
    const montoSolicitado = Number.isFinite(linea.montoSolicitado) && linea.montoSolicitado > 0
      ? redondear(linea.montoSolicitado)
      : 0;
    const inicial = leerInicial(linea.jugador);
    if (!saldos.has(clave)) {
      saldos.set(clave, inicial == null ? null : Math.max(0, redondear(inicial)));
    }
    const saldoAntes = saldos.get(clave) ?? null;
    const tope = Number.isFinite(linea.montoAutorizado)
      ? Math.max(0, redondear(linea.montoAutorizado as number))
      : montoSolicitado;
    const montoAceptado = linea.valida === false
      ? 0
      : redondear(Math.min(montoSolicitado, saldoAntes ?? montoSolicitado, tope));
    const montoExcedido = linea.valida === false
      ? 0
      : Math.max(0, redondear(montoSolicitado - montoAceptado));
    const saldoRestante = saldoAntes == null
      ? null
      : Math.max(0, redondear(saldoAntes - montoAceptado));
    if (saldoRestante != null) saldos.set(clave, saldoRestante);

    const sinSaldo = saldoAntes === 0 && montoAceptado === 0 && montoSolicitado > 0;
    const excedido = !sinSaldo && montoExcedido > 0;
    const observacionCorta = sinSaldo
      ? "Sin saldo"
      : excedido
        ? `Excedido ${formatearMonto(montoExcedido)}`
        : null;
    const notaExistente = observacionSinExceso(linea.observacionExistente);
    const observacion = [notaExistente, observacionCorta].filter(Boolean).join(" · ") || null;
    return {
      lineaIndice: linea.lineaIndice,
      jugador: linea.jugador,
      saldoAntes,
      montoSolicitado,
      montoAceptado,
      montoExcedido,
      saldoRestante,
      excedido,
      observacionCorta,
      etiquetaRestante: saldoRestante == null ? "Queda: sin tope" : `Queda: ${formatearMonto(saldoRestante)}`,
      observacion,
    };
  });
}
