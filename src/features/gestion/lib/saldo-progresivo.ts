export interface LineaJugadaProgresivaInput {
  id?: string;
  lineaIndice: number;
  jugador: string;
  contraparte?: string;
  montoSolicitado: number;
  textoOriginal?: string;
  observacionExistente?: string | null;
}

export interface ResultadoLineaSaldoProgresivo {
  lineaIndice: number;
  jugador: string;
  saldoAntes: number;
  montoSolicitado: number;
  montoAceptado: number;
  montoExcedido: number;
  saldoRestante: number;
  excedido: boolean;
  observacionCorta: string | null;
  etiquetaRestante: string;
}

export interface MapaSaldoInicial {
  [jugador: string]: number;
}

export function evaluarSaldoProgresivoJugadas(
  lineas: LineaJugadaProgresivaInput[],
  saldoInicialPorJugador: MapaSaldoInicial
): ResultadoLineaSaldoProgresivo[] {
  const saldoActual: MapaSaldoInicial = {};
  for (const [jugador, saldo] of Object.entries(saldoInicialPorJugador)) {
    const key = String(jugador || "").trim().toUpperCase();
    saldoActual[key] = Number(saldo) || 0;
  }

  const resultados: ResultadoLineaSaldoProgresivo[] = [];

  for (const linea of lineas) {
    const jugadorKey = String(linea.jugador || "").trim().toUpperCase();
    const saldoAntes = Math.max(0, Number(saldoActual[jugadorKey]) || 0);
    const montoSolicitado = Math.max(0, Number(linea.montoSolicitado) || 0);

    if (montoSolicitado <= 0) {
      resultados.push({
        lineaIndice: linea.lineaIndice,
        jugador: jugadorKey,
        saldoAntes,
        montoSolicitado: 0,
        montoAceptado: 0,
        montoExcedido: 0,
        saldoRestante: saldoAntes,
        excedido: false,
        observacionCorta: null,
        etiquetaRestante: `Queda: ${Math.round(saldoAntes)}`,
      });
      continue;
    }

    if (saldoAntes <= 0) {
      const montoExcedido = montoSolicitado;
      resultados.push({
        lineaIndice: linea.lineaIndice,
        jugador: jugadorKey,
        saldoAntes: 0,
        montoSolicitado,
        montoAceptado: 0,
        montoExcedido,
        saldoRestante: 0,
        excedido: true,
        observacionCorta: `Excedido ${Math.round(montoExcedido)}`,
        etiquetaRestante: `Queda: 0`,
      });
      saldoActual[jugadorKey] = 0;
      continue;
    }

    if (montoSolicitado <= saldoAntes) {
      const montoAceptado = montoSolicitado;
      const saldoRestante = saldoAntes - montoAceptado;
      resultados.push({
        lineaIndice: linea.lineaIndice,
        jugador: jugadorKey,
        saldoAntes,
        montoSolicitado,
        montoAceptado,
        montoExcedido: 0,
        saldoRestante,
        excedido: false,
        observacionCorta: null,
        etiquetaRestante: `Queda: ${Math.round(saldoRestante)}`,
      });
      saldoActual[jugadorKey] = saldoRestante;
      continue;
    }

    // Excede: acepta lo que queda
    const montoAceptado = saldoAntes;
    const montoExcedido = montoSolicitado - saldoAntes;
    const saldoRestante = 0;
    resultados.push({
      lineaIndice: linea.lineaIndice,
      jugador: jugadorKey,
      saldoAntes,
      montoSolicitado,
      montoAceptado,
      montoExcedido,
      saldoRestante,
      excedido: true,
      observacionCorta: `Excedido ${Math.round(montoExcedido)}`,
      etiquetaRestante: `Queda: 0`,
    });
    saldoActual[jugadorKey] = 0;
  }

  return resultados;
}

export function formatearSinMoneda(valor: number | string | null | undefined): string {
  if (valor === null || valor === undefined || valor === "") return "";
  const num = typeof valor === "string" ? parseFloat(valor.replace(/[^0-9.-]/g, "")) : Number(valor);
  if (isNaN(num)) return String(valor);
  return Math.round(num).toLocaleString("es-VE");
}
