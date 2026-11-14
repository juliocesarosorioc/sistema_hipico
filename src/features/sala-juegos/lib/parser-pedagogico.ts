// LÍNEA 1: Motor Determinístico de Estandarización Hípica y Corrección Pedagógica
import {
  formatearMontoRegional,
  parsearMontoConK,
  prefijoMonedaGrupo,
  esGrupoBolivares,
} from "@/shared/lib/dinero";

export interface ResultadoAnalisisJugada {
  esIntencionDeJugada: boolean;
  valido: boolean;
  accionProponente: 'JUEGA' | 'CONSIGUE';
  esMatch: boolean;
  modalidad: string;
  caballosBandoA: string[];
  caballosBandoB: string[];
  ejemplarTexto: string;
  monto: number;
  montoTexto?: string;
  jugadaEstandarizada: string;
  confianza: number;
  requiereOperador: boolean;
  mensajePedagogicoPrivado?: string;
  sugerenciasUnClic?: string[];
  excedioSaldo?: boolean;
  montoDisponibleValido?: number;
  msgPublicoBot?: string;
  msgPrivadoBot?: string;
}

export interface ResultadoConcrecionEstricta {
  valido: boolean;
  motivoRechazo?: string;
  montoSolicitado: number;
  montoEfectivo: number;
  excedioSaldo: boolean;
  msgPublicoBot?: string;
  msgPrivadoBot?: string;
}

/**
 * Extrae y normaliza el monto desde una cadena, soportando sufijo k/K (miles):
 * - "5k" o "5K" -> 5000 (monto: 5000, montoTexto: "5000")
 * - "5.5k" o "5,5K" -> 5500 (monto: 5500, montoTexto: "5500")
 * - "10.000" -> 10000 (monto: 10000, montoTexto: "10000")
 * - "100" -> 100 (monto: 100, montoTexto: "100")
 */
export function extraerMontoNumerico(rawInput: string): { monto: number; montoTexto: string; esKilo: boolean } {
  if (!rawInput) return { monto: 0, montoTexto: "0", esKilo: false };
  const limpio = rawInput.trim().replace(/^[\$Bs\.\s]+/i, "").trim();
  if (!limpio) return { monto: 0, montoTexto: "0", esKilo: false };

  // 1. Detectar explícitamente sufijo k / K (enteros o decimales: 5k, 5.5k, 5,5k, 10k, 20k)
  const matchK = /^(\d+(?:[\.,]\d+)?)\s*k$/i.exec(limpio);
  if (matchK) {
    const base = parseFloat(matchK[1].replace(",", "."));
    if (Number.isFinite(base) && base > 0) {
      const monto = Math.round(base * 1000 * 100) / 100;
      return {
        monto,
        montoTexto: String(monto),
        esKilo: true,
      };
    }
  }

  // 2. Usar parsearMontoConK para formatos de miles con puntos y comas
  const parsed = parsearMontoConK(limpio);
  if (parsed && parsed.monto > 0) {
    return {
      monto: parsed.monto,
      montoTexto: String(parsed.monto),
      esKilo: parsed.esKilo,
    };
  }

  // 3. Fallback numérico estándar
  const f = parseFloat(limpio.replace(",", "."));
  const m = Number.isFinite(f) && f > 0 ? Math.round(f * 100) / 100 : 0;
  return {
    monto: m,
    montoTexto: String(m),
    esKilo: false,
  };
}

/**
 * Valida de forma estricta las palabras autorizadas para responder y concretar una propuesta
 */
export function evaluarConcrecionEstricta(
  textoRespuesta: string,
  accionPropuesta: 'JUEGA' | 'CONSIGUE',
  montoDisponiblePropuesta: number,
  saldoDisponibleAceptante: number,
  nombreAceptante?: string,
  moneda?: string
): ResultadoConcrecionEstricta {
  const texto = (textoRespuesta || '').trim();

  // Validar verbos autorizados según el rol de la propuesta citada:
  // - Si la propuesta es Juego: solo acepta Consigo, Doy, J, Jugaste, Jugamos, Ponte
  // - Si la propuesta es Consigo / Doy: solo acepta Juego, Jugue, Jugué, J, Voy, Ponte
  const esPropuestaJuego = accionPropuesta === 'JUEGA';

  // Soporta 5k, 10k, 10.000, 20.000, 10.424,50, etc.
  const regexJuego = /^(consigo|doy|j|jugaste|jugamos|ponte)(?:\s+(?:con\s+|por\s+|\$|bs\.?|bs\s+)?([0-9kK\.,]+))?$/i;
  const regexConsigo = /^(juego|jugue|jugué|j|voy|ponte)(?:\s+(?:con\s+|por\s+|\$|bs\.?|bs\s+)?([0-9kK\.,]+))?$/i;

  const match = esPropuestaJuego ? texto.match(regexJuego) : texto.match(regexConsigo);

  if (!match) {
    const permitidas = esPropuestaJuego
      ? 'Consigo, J, Jugaste, Jugamos, Ponte'
      : 'Juego, Jugue, Jugué, J, Voy, Ponte';
    return {
      valido: false,
      motivoRechazo: `Palabra no autorizada para concretar. Palabras válidas: ${permitidas}`,
      montoSolicitado: 0,
      montoEfectivo: 0,
      excedioSaldo: false,
    };
  }

  // Extraer monto especificado mediante el parser inteligente con K, o tomar el remanente disponible
  let montoSolicitado = montoDisponiblePropuesta;
  if (match[2]) {
    const extraido = extraerMontoNumerico(match[2]);
    if (extraido.monto > 0) {
      montoSolicitado = extraido.monto;
    }
  }

  if (montoSolicitado <= 0) {
    return {
      valido: false,
      motivoRechazo: 'El monto a concretar debe ser mayor a 0',
      montoSolicitado: 0,
      montoEfectivo: 0,
      excedioSaldo: false,
    };
  }

  const excedioSaldo = montoSolicitado > saldoDisponibleAceptante;
  const topeSaldo = Math.max(0, saldoDisponibleAceptante);
  const montoEfectivo = Math.min(montoSolicitado, topeSaldo, montoDisponiblePropuesta);

  let msgPublicoBot: string | undefined;
  let msgPrivadoBot: string | undefined;

  const prefijo = prefijoMonedaGrupo(moneda);

  if (excedioSaldo) {
    msgPublicoBot = `Esta jugada solo por ${prefijo}${formatearMontoRegional(topeSaldo)}`;
    msgPrivadoBot = `"Atento", no publique jugadas por encima de saldo disponible, nos agrada tenerlo en este grupo`;
  }

  return {
    valido: montoEfectivo > 0,
    motivoRechazo: montoEfectivo <= 0 ? 'Saldo insuficiente para concretar' : undefined,
    montoSolicitado,
    montoEfectivo,
    excedioSaldo,
    msgPublicoBot,
    msgPrivadoBot,
  };
}

// Normaliza bloques de caballos como "45", "1.5", "1,5", "4 .5", "la 15" -> ["1", "5"] -> "1-5"
function normalizarBandoCaballos(raw: string, maxEjemplarCarrera = 16, esDupla = false): string[] {
  const limpio = raw
    .replace(/\b(de\s+la|del|de|la|el|#)\b/gi, ' ')
    .trim();

  // Si tiene separadores explícitos (., -, /, , o espacios entre números)
  if (/[\.\-,\/]/.test(limpio) || /\d+\s+\d+/.test(limpio)) {
    return limpio
      .split(/[\.\-,\/\s]+/)
      .map((s) => s.trim())
      .filter((s) => /^\d+[A-Z]?$/i.test(s));
  }

  // Si escribió un número de 2 dígitos pegado como "45", "15", "46"
  const soloDigitos = limpio.replace(/\s+/g, '');
  if (/^\d{2}$/.test(soloDigitos)) {
    const numEntero = parseInt(soloDigitos, 10);
    const d1 = soloDigitos[0];
    const d2 = soloDigitos[1];
    if (d1 !== '0' && d2 !== '0') {
      if (esDupla || numEntero > maxEjemplarCarrera || /\b(la|de\s+la)\b/i.test(raw)) {
        return [d1, d2];
      }
    }
  }

  return /^\d+[A-Z]?$/i.test(soloDigitos) ? [soloDigitos.toUpperCase()] : [];
}

export function analizarYEstandarizarJugada(
  textoUsuario: string,
  saldoDisponible: number,
  ejemplaresRetirados: string[] = [],
  maxEjemplarCarrera = 16,
  nombreUsuario?: string,
  moneda?: string
): ResultadoAnalisisJugada {
  const texto = textoUsuario.trim().replace(/\s+/g, ' ');
  const prefijo = prefijoMonedaGrupo(moneda);

  // 1. Detectar si el mensaje tiene intención de jugada
  const patronIntencion = /\b(juego|j|consigo|doy|voy|1p|2p|3p|4p|5p|1\/2|2\/3|2n|3n|4n|5n|2y2n|3y3n|x|contra)\b/i;
  if (!patronIntencion.test(texto) && !/^[0-9kK\.,]+\s+(?:al?|del?|el)\s+\d{1,2}$/i.test(texto)) {
    return {
      esIntencionDeJugada: false,
      valido: true,
      accionProponente: 'JUEGA',
      esMatch: false,
      modalidad: '',
      caballosBandoA: [],
      caballosBandoB: [],
      ejemplarTexto: '',
      monto: 0,
      jugadaEstandarizada: texto,
      confianza: 1.0,
      requiereOperador: false,
    };
  }

  // Determinar verbo inicial (Juego vs Consigo/Doy)
  const esConsigue = /^(consigo|doy)\b/i.test(texto);
  const verboEstandar = /^doy\b/i.test(texto) ? 'Doy' : esConsigue ? 'Consigo' : 'Juego';
  const accionProponente: 'JUEGA' | 'CONSIGUE' = esConsigue ? 'CONSIGUE' : 'JUEGA';

  // 2. CASO A: JUGADA DE MATCH CON "x" O "contra"
  // Ejemplos: "Juego 1x4 50", "Juego 1x4 5k", "Juego 1.6 x 4.5 10.000", "Juego la 15 x 46 con 20.000"
  const regexMatch = /^(?:(juego|consigo|doy)\s+)?(?:de\s+la\s+|la\s+|del\s+|el\s+)?([0-9A-Za-z\.\-,\s]+?)\s*(?:x|vs|contra)\s*(?:de\s+la\s+|la\s+|del\s+|el\s+)?([0-9A-Za-z\.\-,\s]+?)\s+(?:con\s+|por\s+|\$|bs\.?|bs\s+)?([0-9kK\.,]+)$/i;
  const matchVs = texto.match(regexMatch);

  if (matchVs) {
    const tienePrefijoLaA = /\b(la|de\s+la)\s+[0-9A-Za-z\.\-,\s]+?\s*(?:x|vs|contra)/i.test(texto);
    const ambos2Digitos = /^\d{2}$/.test(matchVs[2].trim()) && /^\d{2}$/.test(matchVs[3].trim());
    const esDuplaA = tienePrefijoLaA || ambos2Digitos;
    const esDuplaB = /^\d{2}$/.test(matchVs[3].trim()) && (ambos2Digitos || tienePrefijoLaA);

    const bandoA = normalizarBandoCaballos(matchVs[2], maxEjemplarCarrera, esDuplaA);
    const bandoB = normalizarBandoCaballos(matchVs[3], maxEjemplarCarrera, esDuplaB);

    const { monto, montoTexto } = extraerMontoNumerico(matchVs[4]);

    if (bandoA.length > 0 && bandoB.length > 0 && monto > 0) {
      // Verificar retirados en cualquiera de los dos bandos
      const retiradoDetectado = [...bandoA, ...bandoB].find((c) =>
        ejemplaresRetirados.map((r) => r.trim()).includes(c)
      );
      if (retiradoDetectado) {
        return {
          esIntencionDeJugada: true,
          valido: false,
          accionProponente,
          esMatch: true,
          modalidad: 'MATCH',
          caballosBandoA: bandoA,
          caballosBandoB: bandoB,
          ejemplarTexto: `${bandoA.join('-')} x ${bandoB.join('-')}`,
          monto,
          montoTexto,
          jugadaEstandarizada: '',
          confianza: 1.0,
          requiereOperador: false,
          mensajePedagogicoPrivado: `🚫 El ejemplar #${retiradoDetectado} está RETIRADO oficialmente. No se permiten jugadas con ejemplares retirados.`,
        };
      }

      // Verificar saldo disponible
      const excedioSaldoMatch = monto > saldoDisponible;
      if (excedioSaldoMatch && saldoDisponible <= 0) {
        return {
          esIntencionDeJugada: true,
          valido: false,
          accionProponente,
          esMatch: true,
          modalidad: 'MATCH',
          caballosBandoA: bandoA,
          caballosBandoB: bandoB,
          ejemplarTexto: `${bandoA.join('-')} x ${bandoB.join('-')}`,
          monto,
          montoTexto,
          jugadaEstandarizada: '',
          confianza: 1.0,
          requiereOperador: false,
          excedioSaldo: true,
          montoDisponibleValido: 0,
          mensajePedagogicoPrivado: `🔒 Saldo insuficiente (${prefijo}${formatearMontoRegional(saldoDisponible)}). Debes recargar saldo antes de publicar jugadas.`,
          msgPublicoBot: `${nombreUsuario || 'El jugador'} no dispone de saldo suficiente para esta jugada.`,
          msgPrivadoBot: `"Atento", no publique jugadas por encima de saldo disponible, nos agrada tenerlo en este grupo`,
        };
      }

      const jugadaEstandarizada = `${verboEstandar} ${bandoA.join('-')} x ${bandoB.join('-')} ${montoTexto}`;
      const msgPublicoBotMatch = excedioSaldoMatch
        ? `${nombreUsuario || 'El jugador'} solo dispone de ${prefijo}${formatearMontoRegional(saldoDisponible)} para esta jugada.`
        : undefined;
      const msgPrivadoBotMatch = excedioSaldoMatch
        ? `"Atento", no publique jugadas por encima de saldo disponible, nos agrada tenerlo en este grupo`
        : undefined;

      return {
        esIntencionDeJugada: true,
        valido: true,
        accionProponente,
        esMatch: true,
        modalidad: 'MATCH',
        caballosBandoA: bandoA,
        caballosBandoB: bandoB,
        ejemplarTexto: `${bandoA.join('-')} x ${bandoB.join('-')}`,
        monto,
        montoTexto,
        jugadaEstandarizada,
        confianza: 0.99,
        requiereOperador: false,
        excedioSaldo: excedioSaldoMatch,
        montoDisponibleValido: excedioSaldoMatch ? saldoDisponible : monto,
        msgPublicoBot: msgPublicoBotMatch,
        msgPrivadoBot: msgPrivadoBotMatch,
      };
    }
  }

  // 3. CASO B: JUGADAS DE PUESTOS Y LLAVES (1P, 1P-1/2N, 1/2N, 1/2N-2N, 2N, ..., hasta 5P)
  // Soporta montos numéricos estándar, K (5k, 10k), miles (10.000, 20.000) y exactos (10.424,50)
  const regexPuestos = /^(?:(juego|consigo|doy)\s+)?([1-5][pn]\s*-\s*[1-5]\/[1-5]n|[1-5]\/[1-5]n?\s*-\s*[1-5][pn]|[1-5]\/[1-5]n|[1-5]n\s*-\s*[1-5]\/[1-5]n|[1-5]n\s+y\s+[1-5]y[1-5]n|[1-5]p\s+y\s+[1-5]y[1-5]n|[1-5]y[1-5]n|[1-5][pn])\s+(?:de\s+la\s+|del\s+|de\s+|la\s+|el\s+|#)?([0-9A-Za-z\.\-,\s]+?)\s+(?:con\s+|por\s+|\$|bs\.?|bs\s+)?([0-9kK\.,]+)$/i;
  const matchPuesto = texto.match(regexPuestos);

  if (matchPuesto) {
    let modLimpia = matchPuesto[2].toUpperCase().replace(/\s*-\s*/g, '-').replace(/\s+/g, ' ');
    // Normalizar fracciones compuestas sin N previa (ej: 1/2-2N -> 1/2N-2N, 5/5-5P -> 5/5N-5P)
    modLimpia = modLimpia.replace(/^([1-5]\/[1-5])(?=-)/, '$1N');
    const caballos = normalizarBandoCaballos(matchPuesto[3], maxEjemplarCarrera);

    const { monto, montoTexto } = extraerMontoNumerico(matchPuesto[4]);

    if (caballos.length > 0 && monto > 0) {
      const retiradoDetectado = caballos.find((c) =>
        ejemplaresRetirados.map((r) => r.trim()).includes(c)
      );
      if (retiradoDetectado) {
        return {
          esIntencionDeJugada: true,
          valido: false,
          accionProponente,
          esMatch: false,
          modalidad: modLimpia,
          caballosBandoA: caballos,
          caballosBandoB: [],
          ejemplarTexto: caballos.join('-'),
          monto,
          montoTexto,
          jugadaEstandarizada: '',
          confianza: 1.0,
          requiereOperador: false,
          mensajePedagogicoPrivado: `🚫 El ejemplar #${retiradoDetectado} está RETIRADO oficialmente. Elige otro ejemplar activo.`,
        };
      }

      const excedioSaldoPuesto = monto > saldoDisponible;
      if (excedioSaldoPuesto && saldoDisponible <= 0) {
        return {
          esIntencionDeJugada: true,
          valido: false,
          accionProponente,
          esMatch: false,
          modalidad: modLimpia,
          caballosBandoA: caballos,
          caballosBandoB: [],
          ejemplarTexto: caballos.join('-'),
          monto,
          montoTexto,
          jugadaEstandarizada: '',
          confianza: 1.0,
          requiereOperador: false,
          excedioSaldo: true,
          montoDisponibleValido: 0,
          mensajePedagogicoPrivado: `🔒 Saldo insuficiente (${prefijo}${formatearMontoRegional(saldoDisponible)}). Debes recargar saldo antes de publicar jugadas.`,
          msgPublicoBot: `${nombreUsuario || 'El jugador'} no dispone de saldo suficiente para esta jugada.`,
          msgPrivadoBot: `"Atento", no publique jugadas por encima de saldo disponible, nos agrada tenerlo en este grupo`,
        };
      }

      const jugadaEstandarizada = `${verboEstandar} ${modLimpia} ${caballos.join('-')} ${montoTexto}`;
      const msgPublicoBotPuesto = excedioSaldoPuesto
        ? `${nombreUsuario || 'El jugador'} solo dispone de ${prefijo}${formatearMontoRegional(saldoDisponible)} para esta jugada.`
        : undefined;
      const msgPrivadoBotPuesto = excedioSaldoPuesto
        ? `"Atento", no publique jugadas por encima de saldo disponible, nos agrada tenerlo en este grupo`
        : undefined;

      return {
        esIntencionDeJugada: true,
        valido: true,
        accionProponente,
        esMatch: false,
        modalidad: modLimpia,
        caballosBandoA: caballos,
        caballosBandoB: [],
        ejemplarTexto: caballos.join('-'),
        monto,
        montoTexto,
        jugadaEstandarizada,
        confianza: 0.99,
        requiereOperador: false,
        excedioSaldo: excedioSaldoPuesto,
        montoDisponibleValido: excedioSaldoPuesto ? saldoDisponible : monto,
        msgPublicoBot: msgPublicoBotPuesto,
        msgPrivadoBot: msgPrivadoBotPuesto,
      };
    }
  }

  // 4. CASO C: JUGADA SIMPLE DE CABALLO (por defecto 1P)
  // Ejemplos: "Juego 5 5k", "Juego al 7 10.000", "Juego del 1 con 20.000", "Consigo 8 50", "Juego 7 10.424,50"
  const regexSimple = /^(?:(juego|consigo|doy)\s+)?(?:del?\s+|al?\s+|el\s+|#)?(\d{1,2})\s+(?:con\s+|por\s+|\$|bs\.?|bs\s+)?([0-9kK\.,]+)$/i;
  const matchSimple = texto.match(regexSimple);

  if (matchSimple) {
    const caballos = [matchSimple[2]];
    const { monto, montoTexto } = extraerMontoNumerico(matchSimple[3]);

    if (monto > 0) {
      const retiradoDetectado = caballos.find((c) =>
        ejemplaresRetirados.map((r) => r.trim()).includes(c)
      );
      if (retiradoDetectado) {
        return {
          esIntencionDeJugada: true,
          valido: false,
          accionProponente,
          esMatch: false,
          modalidad: '1P',
          caballosBandoA: caballos,
          caballosBandoB: [],
          ejemplarTexto: caballos[0],
          monto,
          montoTexto,
          jugadaEstandarizada: '',
          confianza: 1.0,
          requiereOperador: false,
          mensajePedagogicoPrivado: `🚫 El ejemplar #${retiradoDetectado} está RETIRADO oficialmente. Elige otro ejemplar activo.`,
        };
      }

      const excedioSaldoSimple = monto > saldoDisponible;
      if (excedioSaldoSimple && saldoDisponible <= 0) {
        return {
          esIntencionDeJugada: true,
          valido: false,
          accionProponente,
          esMatch: false,
          modalidad: '1P',
          caballosBandoA: caballos,
          caballosBandoB: [],
          ejemplarTexto: caballos[0],
          monto,
          montoTexto,
          jugadaEstandarizada: '',
          confianza: 1.0,
          requiereOperador: false,
          excedioSaldo: true,
          montoDisponibleValido: 0,
          mensajePedagogicoPrivado: `🔒 Saldo insuficiente (${prefijo}${formatearMontoRegional(saldoDisponible)}). Debes recargar saldo antes de publicar jugadas.`,
          msgPublicoBot: `${nombreUsuario || 'El jugador'} no dispone de saldo suficiente para esta jugada.`,
          msgPrivadoBot: `"Atento", no publique jugadas por encima de saldo disponible, nos agrada tenerlo en este grupo`,
        };
      }

      const jugadaEstandarizada = `${verboEstandar} 1P ${caballos[0]} ${montoTexto}`;
      const msgPublicoBotSimple = excedioSaldoSimple
        ? `${nombreUsuario || 'El jugador'} solo dispone de ${prefijo}${formatearMontoRegional(saldoDisponible)} para esta jugada.`
        : undefined;
      const msgPrivadoBotSimple = excedioSaldoSimple
        ? `"Atento", no publique jugadas por encima de saldo disponible, nos agrada tenerlo en este grupo`
        : undefined;

      return {
        esIntencionDeJugada: true,
        valido: true,
        accionProponente,
        esMatch: false,
        modalidad: '1P',
        caballosBandoA: caballos,
        caballosBandoB: [],
        ejemplarTexto: caballos[0],
        monto,
        montoTexto,
        jugadaEstandarizada,
        confianza: 0.99,
        requiereOperador: false,
        excedioSaldo: excedioSaldoSimple,
        montoDisponibleValido: excedioSaldoSimple ? saldoDisponible : monto,
        msgPublicoBot: msgPublicoBotSimple,
        msgPrivadoBot: msgPrivadoBotSimple,
      };
    }
  }

  // 5. CASO D: JUGADA INVERTIDA "<monto> al <caballo>"
  // Ejemplos: "5k al 7", "10.000 al 5", "20.000 al 2", "50 al 1"
  const regexInvertido = /^([0-9kK\.,]+)\s+(?:al?|del?|el)\s+(\d{1,2})$/i;
  const matchInvertido = texto.match(regexInvertido);

  if (matchInvertido) {
    const caballos = [matchInvertido[2]];
    const { monto, montoTexto } = extraerMontoNumerico(matchInvertido[1]);

    if (monto > 0) {
      const retiradoDetectado = caballos.find((c) =>
        ejemplaresRetirados.map((r) => r.trim()).includes(c)
      );
      if (retiradoDetectado) {
        return {
          esIntencionDeJugada: true,
          valido: false,
          accionProponente,
          esMatch: false,
          modalidad: '1P',
          caballosBandoA: caballos,
          caballosBandoB: [],
          ejemplarTexto: caballos[0],
          monto,
          montoTexto,
          jugadaEstandarizada: '',
          confianza: 1.0,
          requiereOperador: false,
          mensajePedagogicoPrivado: `🚫 El ejemplar #${retiradoDetectado} está RETIRADO oficialmente. Elige otro ejemplar activo.`,
        };
      }

      const excedioSaldoInv = monto > saldoDisponible;
      if (excedioSaldoInv && saldoDisponible <= 0) {
        return {
          esIntencionDeJugada: true,
          valido: false,
          accionProponente,
          esMatch: false,
          modalidad: '1P',
          caballosBandoA: caballos,
          caballosBandoB: [],
          ejemplarTexto: caballos[0],
          monto,
          montoTexto,
          jugadaEstandarizada: '',
          confianza: 1.0,
          requiereOperador: false,
          excedioSaldo: true,
          montoDisponibleValido: 0,
          mensajePedagogicoPrivado: `🔒 Saldo insuficiente (${prefijo}${formatearMontoRegional(saldoDisponible)}). Debes recargar saldo antes de publicar jugadas.`,
          msgPublicoBot: `${nombreUsuario || 'El jugador'} no dispone de saldo suficiente para esta jugada.`,
          msgPrivadoBot: `"Atento", no publique jugadas por encima de saldo disponible, nos agrada tenerlo en este grupo`,
        };
      }

      const jugadaEstandarizada = `${verboEstandar} 1P ${caballos[0]} ${montoTexto}`;
      const msgPublicoBotInv = excedioSaldoInv
        ? `${nombreUsuario || 'El jugador'} solo dispone de ${prefijo}${formatearMontoRegional(saldoDisponible)} para esta jugada.`
        : undefined;
      const msgPrivadoBotInv = excedioSaldoInv
        ? `"Atento", no publique jugadas por encima de saldo disponible, nos agrada tenerlo en este grupo`
        : undefined;

      return {
        esIntencionDeJugada: true,
        valido: true,
        accionProponente,
        esMatch: false,
        modalidad: '1P',
        caballosBandoA: caballos,
        caballosBandoB: [],
        ejemplarTexto: caballos[0],
        monto,
        montoTexto,
        jugadaEstandarizada,
        confianza: 0.99,
        requiereOperador: false,
        excedioSaldo: excedioSaldoInv,
        montoDisponibleValido: excedioSaldoInv ? saldoDisponible : monto,
        msgPublicoBot: msgPublicoBotInv,
        msgPrivadoBot: msgPrivadoBotInv,
      };
    }
  }

  // 6. CORRECCIÓN PEDAGÓGICA CUANDO EL JUGADOR ESCRIBE CON ERROR DE FORMATO
  const numerosDetectados = texto.match(/\d+/g) || [];
  const ej1 = numerosDetectados[0] || '5';
  const ej2 = numerosDetectados[1] || '4';
  const montoEj = numerosDetectados[numerosDetectados.length - 1] || '100';

  return {
    esIntencionDeJugada: true,
    valido: false,
    accionProponente,
    esMatch: false,
    modalidad: 'DUDA_FORMATO',
    caballosBandoA: [],
    caballosBandoB: [],
    ejemplarTexto: '',
    monto: 0,
    jugadaEstandarizada: '',
    confianza: 0.45,
    requiereOperador: true,
    mensajePedagogicoPrivado:
      `🤖 Corrección Pedagógica: No pude procesar tu jugada "${texto}". Así debes escribirla:\n` +
      `• Para jugar Puesto: Juego 1P ${ej1} ${montoEj} (o Consigo 1P ${ej1} ${montoEj})\n` +
      `• Para jugar Llave/Dupla: Juego 1P ${ej1}-${ej2} ${montoEj}\n` +
      `• Para jugar Match (Caballo vs Caballo): Juego ${ej1} x ${ej2} ${montoEj}\n` +
      `Se ha notificado también al operador por si requieres atención personalizada.`,
    sugerenciasUnClic: [
      `Juego 1P ${ej1} ${montoEj}`,
      `Consigo 1P ${ej1} ${montoEj}`,
      `Juego ${ej1} x ${ej2} ${montoEj}`,
    ],
  };
}

export interface ResultadoComandoRetiro {
  esComandoRetiro: boolean;
  esValido: boolean;
  mensajeAclaratoria?: string;
}

/**
 * Detecta si el jugador escribió la orden para cerrar/retirar todas sus jugadas abiertas
 * Palabras exactas autorizadas: "Se fue", "sf", "cf", "c fue", "ce fue"
 * Si escribió una similar, el bot pide aclaratoria.
 */
export function analizarComandoRetiro(textoInput: string): ResultadoComandoRetiro {
  const texto = (textoInput || "").trim().toLowerCase();

  // 1. Palabras exactas autorizadas
  const regexExacto = /^(se\s*fue|sf|cf|c\s*fue|ce\s*fue)$/i;
  if (regexExacto.test(texto)) {
    return {
      esComandoRetiro: true,
      esValido: true,
    };
  }

  // 2. Palabras similares que requieren aclaratoria obligatoria del bot
  const regexSimilar = /^(se\s*fu|sefve|c\s*fuee|cefue|se\s*fuee|se\s*va|c\s*va|me\s*fui|retirar|cancelar|cerrar\s*jugadas)$/i;
  if (regexSimilar.test(texto)) {
    return {
      esComandoRetiro: true,
      esValido: false,
      mensajeAclaratoria: "Por favor aclara si deseas retirar tus jugadas con: 'Se fue' o 'sf'",
    };
  }

  return {
    esComandoRetiro: false,
    esValido: false,
  };
}