// LÍNEA 1: Motor Determinístico de Estandarización Hípica y Corrección Pedagógica
import { formatearMontoRegional } from "@/shared/lib/dinero";

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
 * Valida de forma estricta las palabras autorizadas para responder y concretar una propuesta
 */
export function evaluarConcrecionEstricta(
  textoRespuesta: string,
  accionPropuesta: 'JUEGA' | 'CONSIGUE',
  montoDisponiblePropuesta: number,
  saldoDisponibleAceptante: number,
  nombreAceptante?: string
): ResultadoConcrecionEstricta {
  const texto = (textoRespuesta || '').trim();

  // Validar verbos autorizados según el rol de la propuesta citada:
  // - Si la propuesta es Juego: solo acepta Consigo, Doy, J, Jugaste, Jugamos, Ponte
  // - Si la propuesta es Consigo / Doy: solo acepta Juego, Jugue, Jugué, J, Voy, Ponte
  const esPropuestaJuego = accionPropuesta === 'JUEGA';

  const regexJuego = /^(consigo|doy|j|jugaste|jugamos|ponte)(?:\s+(?:con\s+|por\s+|\$)?(\d+(?:[\.,]\d+)?))?$/i;
  const regexConsigo = /^(juego|jugue|jugué|j|voy|ponte)(?:\s+(?:con\s+|por\s+|\$)?(\d+(?:[\.,]\d+)?))?$/i;

  const match = esPropuestaJuego ? texto.match(regexJuego) : texto.match(regexConsigo);

  if (!match) {
    const permitidas = esPropuestaJuego
      ? 'Consigo, Doy, J, Jugaste, Jugamos, Ponte'
      : 'Juego, Jugue, Jugué, J, Voy, Ponte';
    return {
      valido: false,
      motivoRechazo: `Palabra no autorizada para concretar. Palabras válidas: ${permitidas}`,
      montoSolicitado: 0,
      montoEfectivo: 0,
      excedioSaldo: false,
    };
  }

  // Extraer monto especificado, o tomar el remanente disponible si no se indicó monto explícito
  const montoParsed = match[2] ? parseFloat(match[2].replace(',', '.')) : montoDisponiblePropuesta;
  const montoSolicitado = Math.max(0, Number.isFinite(montoParsed) ? montoParsed : montoDisponiblePropuesta);

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

  if (excedioSaldo) {
    msgPublicoBot = `Esta jugada solo por $${formatearMontoRegional(topeSaldo)}`;
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
  nombreUsuario?: string
): ResultadoAnalisisJugada {
  const texto = textoUsuario.trim().replace(/\s+/g, ' ');

  // 1. Detectar si el mensaje tiene intención de jugada
  const patronIntencion = /\b(juego|j|consigo|doy|voy|1p|2p|3p|4p|2n|3n|4n|2y2n|3y3n|x|contra)\b/i;
  if (!patronIntencion.test(texto)) {
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
  // Ejemplos: "Juego 1x4 50", "Juego 1.6 x 4.5 100", "Juego 1,5 x 4-6 100", "Juego la 15 x 46 con 100"
  const regexMatch = /^(?:(juego|consigo|doy)\s+)?(?:de\s+la\s+|la\s+|del\s+|el\s+)?([0-9A-Za-z\.\-,\s]+?)\s*(?:x|vs|contra)\s*(?:de\s+la\s+|la\s+|del\s+|el\s+)?([0-9A-Za-z\.\-,\s]+?)\s+(?:con\s+|por\s+|\$)?(\d+(?:[\.,]\d+)?)$/i;
  const matchVs = texto.match(regexMatch);

  if (matchVs) {
    const tienePrefijoLaA = /\b(la|de\s+la)\s+[0-9A-Za-z\.\-,\s]+?\s*(?:x|vs|contra)/i.test(texto);
    const ambos2Digitos = /^\d{2}$/.test(matchVs[2].trim()) && /^\d{2}$/.test(matchVs[3].trim());
    const esDuplaA = tienePrefijoLaA || ambos2Digitos;
    const esDuplaB = /^\d{2}$/.test(matchVs[3].trim()) && (ambos2Digitos || tienePrefijoLaA);

    const bandoA = normalizarBandoCaballos(matchVs[2], maxEjemplarCarrera, esDuplaA);
    const bandoB = normalizarBandoCaballos(matchVs[3], maxEjemplarCarrera, esDuplaB);
    const monto = parseFloat(matchVs[4].replace(',', '.'));

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
          jugadaEstandarizada: '',
          confianza: 1.0,
          requiereOperador: false,
          excedioSaldo: true,
          montoDisponibleValido: 0,
          mensajePedagogicoPrivado: `🔒 Saldo insuficiente ($${formatearMontoRegional(saldoDisponible)}). Debes recargar saldo antes de publicar jugadas.`,
          msgPublicoBot: `${nombreUsuario || 'El jugador'} no dispone de saldo suficiente para esta jugada.`,
          msgPrivadoBot: `"Atento", no publique jugadas por encima de saldo disponible, nos agrada tenerlo en este grupo`,
        };
      }

      const montoTxtMatch = Number.isInteger(monto) ? String(monto) : formatearMontoRegional(monto);
      const jugadaEstandarizada = `${verboEstandar} ${bandoA.join('-')} x ${bandoB.join('-')} ${montoTxtMatch}`;
      const msgPublicoBotMatch = excedioSaldoMatch
        ? `${nombreUsuario || 'El jugador'} solo dispone de $${formatearMontoRegional(saldoDisponible)} para esta jugada.`
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

  // 3. CASO B: JUGADAS DE PUESTOS Y LLAVES ("1p", "1p-1/2n", "1/2-2n", "2n", ..., hasta "5p")
  const regexPuestos = /^(?:(juego|consigo|doy)\s+)?([1-5]p\s*-\s*[1-5]\/[1-5]n|[1-5]\/[1-5]\s*-\s*[1-5][pn]|[1-5]n\s*-\s*[1-5]\/[1-5]n|[1-5]\/[1-5]n|[1-5]n\s+y\s+[1-5]y[1-5]n|[1-5]p\s+y\s+[1-5]y[1-5]n|[1-5]y[1-5]n|[1-5][pn])\s+(?:de\s+la\s+|del\s+|de\s+|la\s+|el\s+|#)?([0-9A-Za-z\.\-,\s]+?)\s+(?:con\s+|por\s+|\$)?(\d+(?:[\.,]\d+)?)$/i;
  const matchPuesto = texto.match(regexPuestos);

  if (matchPuesto) {
    const modLimpia = matchPuesto[2].toUpperCase().replace(/\s*-\s*/g, '-').replace(/\s+/g, ' ');
    const caballos = normalizarBandoCaballos(matchPuesto[3], maxEjemplarCarrera);
    const monto = parseFloat(matchPuesto[4].replace(',', '.'));

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
          jugadaEstandarizada: '',
          confianza: 1.0,
          requiereOperador: false,
          excedioSaldo: true,
          montoDisponibleValido: 0,
          mensajePedagogicoPrivado: `🔒 Saldo insuficiente ($${formatearMontoRegional(saldoDisponible)}). Debes recargar saldo antes de publicar jugadas.`,
          msgPublicoBot: `${nombreUsuario || 'El jugador'} no dispone de saldo suficiente para esta jugada.`,
          msgPrivadoBot: `"Atento", no publique jugadas por encima de saldo disponible, nos agrada tenerlo en este grupo`,
        };
      }

      const montoTxtPuesto = Number.isInteger(monto) ? String(monto) : formatearMontoRegional(monto);
      const jugadaEstandarizada = `${verboEstandar} ${modLimpia} ${caballos.join('-')} ${montoTxtPuesto}`;
      const msgPublicoBotPuesto = excedioSaldoPuesto
        ? `${nombreUsuario || 'El jugador'} solo dispone de $${formatearMontoRegional(saldoDisponible)} para esta jugada.`
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

  // 4. CORRECCIÓN PEDAGÓGICA CUANDO EL JUGADOR ESCRIBE CON ERROR DE FORMATO
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