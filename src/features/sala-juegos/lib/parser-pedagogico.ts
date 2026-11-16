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
  proporcion?: string;
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
 * Extrae y normaliza el monto desde una cadena:
 * - Soporta montos con puntos de miles (ej. "20.000" -> 20000, "1.500" -> 1500)
 * - Soporta decimales con coma (ej. "20.000,50" -> 20000.5, "10,5" -> 10.5)
 * - Elimina ceros flotantes de formato ("00"): "20,00" -> 20, "20.00" -> 20, "20.000,00" -> 20000
 * - Soporta sufijo k/K (miles): "5k" -> 5000, "5.5k" -> 5500
 */
export function extraerMontoNumerico(rawInput: string): { monto: number; montoTexto: string; esKilo: boolean } {
  if (!rawInput) return { monto: 0, montoTexto: "0", esKilo: false };
  let str = String(rawInput).trim();
  // Eliminar prefijos de moneda o espacios
  str = str.replace(/^[\$Bs\.\s]+/i, "").trim();
  // Eliminar ceros flotantes de formato final (,00 o .00 o 00 final)
  str = str.replace(/[,.]00(?!\d)/g, "").replace(/\s+00$/g, "").trim();
  if (!str) return { monto: 0, montoTexto: "0", esKilo: false };

  // 1. Detectar explícitamente sufijo k / K (ej. 5k, 5.5k, 5,5k, 10k, 20k)
  const matchK = /^(\d+(?:[\.,]\d+)?)\s*k$/i.exec(str);
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

  // 2. Formato con puntos de miles y coma decimal (ej. "20.000,50" o "10.424,50")
  if (str.includes(".") && str.includes(",")) {
    const lastComma = str.lastIndexOf(",");
    const lastDot = str.lastIndexOf(".");
    let numStr = str;
    if (lastComma > lastDot) {
      numStr = str.replace(/\./g, "").replace(",", ".");
    } else {
      numStr = str.replace(/,/g, "");
    }
    const monto = parseFloat(numStr);
    if (Number.isFinite(monto) && monto > 0) {
      const rounded = Math.round(monto * 100) / 100;
      return {
        monto: rounded,
        montoTexto: String(rounded),
        esKilo: false,
      };
    }
  }

  // 3. Puntos de miles solos (ej: "5.000", "10.000", "20.000", "50.000", "100.000", "1.500")
  if (/^\d{1,3}(?:\.\d{3})+$/.test(str) || /^\d+\.\d{3}$/.test(str)) {
    const monto = parseFloat(str.replace(/\./g, ""));
    if (Number.isFinite(monto) && monto > 0) {
      const rounded = Math.round(monto * 100) / 100;
      return {
        monto: rounded,
        montoTexto: String(rounded),
        esKilo: false,
      };
    }
  }

  // 4. Coma decimal sola (ej: "43,50", "100,5")
  if (/^\d+,\d+$/.test(str)) {
    const monto = parseFloat(str.replace(",", "."));
    if (Number.isFinite(monto) && monto > 0) {
      const rounded = Math.round(monto * 100) / 100;
      return {
        monto: rounded,
        montoTexto: String(rounded),
        esKilo: false,
      };
    }
  }

  // 5. Número estándar
  const limpioSinPuntos = str.replace(/\.(?=\d{3})/g, "");
  const f = parseFloat(limpioSinPuntos);
  const m = Number.isFinite(f) && f > 0 ? Math.round(f * 100) / 100 : 0;
  return {
    monto: m,
    montoTexto: String(m),
    esKilo: false,
  };
}

/**
 * Normaliza cualquier variante de proporción o parada a premio al estándar interno 10/X:
 * Formatos: 10@7, 10a7, 10/7, 10A7, 10 a 7, 10 A 7, 10 @ 7, 10 / 7, 10-7, @7, a7, A7
 */
export function normalizarParadaPremio(texto: string): string {
  if (!texto) return texto;
  return texto
    .replace(/(?:^|(?<=[\s,(\[]))10\s*[@aªA\/\-]\s*(\d+(?:[.,]\d+)?)(?=$|[\s,)\]])/g, "10/$1")
    .replace(/(?:^|(?<=[\s,(\[]))[@aªA\/]\s*(\d+(?:[.,]\d+)?)(?=$|[\s,)\]])/g, "10/$1");
}

/**
 * Valida que ninguna proporción supere la paridad máxima de 10 a 10 (PP / parejo).
 */
export function validarParidadProporcion(proporcion?: string): { valido: boolean; motivo?: string } {
  if (!proporcion || proporcion === "1x1" || proporcion === "PP") return { valido: true };
  const m = /^10\/(\d+(?:\.\d+)?)$/i.exec(proporcion.trim().replace(",", "."));
  if (!m) return { valido: true };
  const x = parseFloat(m[1]);
  if (x > 10) {
    return {
      valido: false,
      motivo: `🚫 La proporción ${proporcion} supera la paridad máxima permitida de 10 a 10 (PP).`,
    };
  }
  return { valido: true };
}

/**
 * Calcula el riesgo real según proporción 10/X y lado:
 * - Lado del 10 (CONSIGUE / dador): arriesga M
 * - Lado del X (JUEGA recibiendo 10aX): arriesga ROUND(M * (X / 10), 2)
 */
export function calcularRiesgoReal(
  monto: number,
  proporcion?: string,
  accion: 'JUEGA' | 'CONSIGUE' = 'JUEGA'
): number {
  const m = Number(monto || 0);
  if (!Number.isFinite(m) || m <= 0) return 0;
  const prop = String(proporcion || '1x1').replace(',', '.').trim();
  const match = /^10\/(\d+(?:\.\d+)?)$/.exec(prop);
  if (!match) return Math.round(m * 100) / 100;
  const x = parseFloat(match[1]);
  if (!Number.isFinite(x) || x <= 0) return Math.round(m * 100) / 100;
  if (accion === 'CONSIGUE') {
    return Math.round(m * 100) / 100;
  }
  return Math.round(m * (x / 10) * 100) / 100;
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
  // Blindaje SecOps Anti-ReDoS: Descartar textos gigantes antes de evaluar regex
  if (!textoRespuesta || typeof textoRespuesta !== 'string' || textoRespuesta.length > 180) {
    return {
      valido: false,
      motivoRechazo: 'El texto de concreción excede el límite de 180 caracteres permitidos.',
      montoSolicitado: 0,
      montoEfectivo: 0,
      excedioSaldo: false,
    };
  }

  const texto = normalizarParadaPremio(textoRespuesta.trim());

  // Validar verbos autorizados según el rol de la propuesta citada:
  // - Si el proponente "CONSIGUE / DA" (accion_proponente = consigo/doy): Solo concretan: Juego, Jugue, Jugué, Ponte, Jugamos, Voy, J
  // - Si el proponente "JUEGA / VOY" (accion_proponente = juego): Solo concretan: Jugaste, Ponte, Consigo, J
  const esPropuestaJuego = accionPropuesta === 'JUEGA';

  // Soporta montos opcionales: 5k, 10k, 10.000, 20.000, 10.424,50, etc.
  const regexJuego = /^(jugaste|ponte|consigo|j)(?:\s+(?:con\s+|por\s+|\$|bs\.?|bs\s+)?([0-9kK\.,]+))?$/i;
  const regexConsigo = /^(juego|jugue|jugué|ponte|jugamos|voy|j)(?:\s+(?:con\s+|por\s+|\$|bs\.?|bs\s+)?([0-9kK\.,]+))?$/i;

  const match = esPropuestaJuego ? texto.match(regexJuego) : texto.match(regexConsigo);

  if (!match) {
    const permitidas = esPropuestaJuego
      ? 'Jugaste, Ponte, Consigo, J'
      : 'Juego, Jugue, Jugué, Ponte, Jugamos, Voy, J';
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
    const saldoFmt = formatearMontoRegional(topeSaldo);
    msgPublicoBot = `⚠️ *${nombreAceptante || 'Jugador'}* dispone de $${saldoFmt} para jugar`;
    msgPrivadoBot = `⚠️ Hola ${nombreAceptante || 'Jugador'}, tu jugada se procesó por $${formatearMontoRegional(montoEfectivo)} ya que es lo que dispones para realizarla. Tu saldo actual es $${saldoFmt}.\n\nTe invitamos a jugar hasta el tope exacto de tu saldo disponible ($${saldoFmt}).`;
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
  // Blindaje SecOps Anti-ReDoS: Descartar textos gigantes antes de evaluar regex
  if (!textoUsuario || typeof textoUsuario !== 'string' || textoUsuario.length > 180) {
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
      jugadaEstandarizada: String(textoUsuario || '').slice(0, 180),
      confianza: 1.0,
      requiereOperador: false,
    };
  }

  const textoNormalizado = normalizarParadaPremio(textoUsuario.trim());
  const texto = textoNormalizado.replace(/\s+/g, ' ');
  const prefijo = prefijoMonedaGrupo(moneda);

  // Extraer proporción gabela si existe en el texto (ej. 10/5, 10/8, 10/6.5)
  const matchGabela = texto.match(/\b(10\/\d+(?:[.,]\d+)?)\b/);
  const proporcionDetectada = matchGabela ? matchGabela[1].replace(',', '.') : '1x1';

  // 1. Detectar si el mensaje tiene intención de jugada
  const patronIntencion = /\b(juego|jugo|jugó|jugue|jugué|j|consigo|doy|pido|voy|ponte|copiado|pago|ganador|win|a\s+ganador|g|[1-6]p|[2-6]n|1n|[1-5]y[1-5][pn]?|[1-5]\/[1-5]n?|10\/\d+|x|contra)\b/i;
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
      proporcion: '1x1',
      jugadaEstandarizada: texto,
      confianza: 1.0,
      requiereOperador: false,
    };
  }

  // Determinar verbo inicial (Juego vs Consigo/Doy/Pido)
  const esConsigue = /^(consigo|doy|pido)\b/i.test(texto);
  const verboEstandar = /^doy\b/i.test(texto)
    ? 'Doy'
    : /^pido\b/i.test(texto)
    ? 'Pido'
    : esConsigue
    ? 'Consigo'
    : 'Juego';
  const accionProponente: 'JUEGA' | 'CONSIGUE' = esConsigue ? 'CONSIGUE' : 'JUEGA';

  // 2. CASO A: JUGADA DE MATCH CON "x" O "contra" (soporta proporción opcional 10/X)
  // Ejemplos: "Juego 1x4 50", "Juego 3x5 10/8 con 100", "Consigo 3x5 10/8 con 100", "Juego 1-2x4-6 10/8 con 100"
  const regexMatch = /^(?:(juego|jugo|jugó|consigo|doy|pido)\s+)?(?:de\s+la\s+|la\s+|del\s+|el\s+)?([0-9A-Za-z\.\-,\s]+?)\s*(?:x|vs|contra)\s*(?:de\s+la\s+|la\s+|del\s+|el\s+)?([0-9A-Za-z\.\-,]+(?:\s+[0-9A-Za-z\.\-,]+)*?)(?:\s+(10\/\d+(?:[.,]\d+)?))?\s+(?:con\s+|por\s+|\$|bs\.?|bs\s+)?([0-9kK\.,]+)$/i;
  const matchVs = texto.match(regexMatch);

  if (matchVs) {
    const tienePrefijoLaA = /\b(la|de\s+la)\s+[0-9A-Za-z\.\-,\s]+?\s*(?:x|vs|contra)/i.test(texto);
    const ambos2Digitos = /^\d{2}$/.test(matchVs[2].trim()) && /^\d{2}$/.test(matchVs[3].trim());
    const esDuplaA = tienePrefijoLaA || ambos2Digitos;
    const esDuplaB = /^\d{2}$/.test(matchVs[3].trim()) && (ambos2Digitos || tienePrefijoLaA);

    const bandoA = normalizarBandoCaballos(matchVs[2], maxEjemplarCarrera, esDuplaA);
    const bandoB = normalizarBandoCaballos(matchVs[3], maxEjemplarCarrera, esDuplaB);
    const propMatch = matchVs[4] ? matchVs[4].replace(',', '.') : proporcionDetectada;

    const { monto, montoTexto } = extraerMontoNumerico(matchVs[5]);

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
          proporcion: propMatch,
          jugadaEstandarizada: '',
          confianza: 1.0,
          requiereOperador: false,
          mensajePedagogicoPrivado: `🚫 El ejemplar #${retiradoDetectado} está RETIRADO oficialmente. No se permiten jugadas con ejemplares retirados.`,
        };
      }

      // Validar paridad máxima 10 a 10 (PP)
      const valParidadMatch = validarParidadProporcion(propMatch);
      if (!valParidadMatch.valido) {
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
          proporcion: propMatch,
          jugadaEstandarizada: '',
          confianza: 1.0,
          requiereOperador: false,
          mensajePedagogicoPrivado: valParidadMatch.motivo,
          msgPrivadoBot: valParidadMatch.motivo,
        };
      }

      // Verificar saldo disponible según riesgo real (10/X)
      const riesgoMatch = calcularRiesgoReal(monto, propMatch, accionProponente);
      const excedioSaldoMatch = riesgoMatch > saldoDisponible;
      const saldoFmt = formatearMontoRegional(Math.max(0, saldoDisponible));

      if (saldoDisponible <= 0) {
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
          proporcion: propMatch,
          jugadaEstandarizada: '',
          confianza: 1.0,
          requiereOperador: false,
          excedioSaldo: true,
          montoDisponibleValido: 0,
          mensajePedagogicoPrivado: `🔒 Saldo insuficiente ($${saldoFmt}). Debes recargar saldo antes de publicar jugadas.`,
          msgPublicoBot: `⚠️ *${nombreUsuario || 'Jugador'}* dispone de $0,00 para jugar`,
          msgPrivadoBot: `⚠️ Hola ${nombreUsuario || 'Jugador'}, no dispones de saldo para realizar jugadas. Tu saldo disponible es $0,00. Por favor realiza una recarga para continuar jugando.`,
        };
      }

      const factorRiesgo = riesgoMatch > 0 ? monto / riesgoMatch : 1;
      const montoRecortado = excedioSaldoMatch
        ? Math.round(saldoDisponible * factorRiesgo * 100) / 100
        : monto;

      const jugadaEstandarizada = `${verboEstandar} ${bandoA.join('-')} x ${bandoB.join('-')}${propMatch !== '1x1' ? ` ${propMatch}` : ''} ${montoTexto}`;
      const msgPublicoBotMatch = excedioSaldoMatch
        ? `⚠️ *${nombreUsuario || 'Jugador'}* dispone de $${saldoFmt} para jugar`
        : undefined;
      const msgPrivadoBotMatch = excedioSaldoMatch
        ? `⚠️ Hola ${nombreUsuario || 'Jugador'}, tu jugada se procesó por $${formatearMontoRegional(montoRecortado)} ya que es lo que dispones para realizarla. Tu saldo actual es $${saldoFmt}.\n\nTe invitamos a jugar hasta el tope exacto de tu saldo disponible ($${saldoFmt}).`
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
        proporcion: propMatch,
        jugadaEstandarizada,
        confianza: 0.99,
        requiereOperador: false,
        excedioSaldo: excedioSaldoMatch,
        montoDisponibleValido: montoRecortado,
        msgPublicoBot: msgPublicoBotMatch,
        msgPrivadoBot: msgPrivadoBotMatch,
      };
    }
  }

  // 3. CASO B: JUGADAS DE PUESTOS, NINIS, GANADOR, PROPORCIONES Y CABALLOS
  // Soporta: G, GANADOR, WIN, A GANADOR, 1P..6P, 1Y2P..4Y5P, 2N..6N, 1/2N, 2/3N, 3/4N,
  // 1Y2N..4Y5N, 2Y2N..4Y4N, 1P Y 2N, 2N Y 2Y2N, 2Y3N Y 3N, 3N Y 3Y3N, 1Y2N Y 2N, 10/X
  const MODS_COMPUESTAS_RE =
    "1P\\s+Y\\s+2N|2N\\s+Y\\s+2Y2N|2Y3N\\s+Y\\s+3N|3N\\s+Y\\s+3Y3N|1Y2N\\s+Y\\s+2N|A\\s+GANADOR|GANADOR|WIN|G|[1-5]Y[1-5][PN]?|[1-5]\\/[1-5]N?|[1-9]P|10P|[1-9]N|10N|10\\/\\d+(?:[\\.,]\\d+)?|A|AL";
  const regexPuestosYCaballos = new RegExp(
    `^(?:(juego|jugo|jugó|consigo|doy|pido|voy)\\s+)?(?:(${MODS_COMPUESTAS_RE})\\s+)?(?:de\\s+la\\s+|del\\s+|de\\s+|la\\s+|el\\s+|a\\s+|al\\s+|#)?([0-9A-Za-z\\.\\-,\\s']+?)\\s+(?:con\\s+|por\\s+|\\$|bs\\.?|bs\\s+)?([0-9kK\\.,]+)$`,
    "i"
  );
  const matchPuesto = texto.match(regexPuestosYCaballos);

  if (matchPuesto) {
    const rawMod = (matchPuesto[2] || "").trim().toUpperCase().replace(/\s+/g, " ");
    let modLimpia = "1P";
    if (rawMod && rawMod !== "A" && rawMod !== "AL") {
      if (rawMod === "G" || rawMod === "GANADOR" || rawMod === "WIN" || rawMod === "A GANADOR") {
        modLimpia = "1P";
      } else if (rawMod.startsWith("10/")) {
        modLimpia = rawMod.replace(",", ".");
      } else {
        modLimpia = rawMod.replace(/\s*-\s*/g, "-").replace(/\s+/g, " ");
        modLimpia = modLimpia.replace(/^([1-5]\/[1-5])(?=-|$)/, "$1N");
      }
    } else if (proporcionDetectada !== "1x1") {
      modLimpia = proporcionDetectada;
    }

    // Prohibición estricta de 1N (Primer Nini no existe)
    if (/\b1N\b/i.test(modLimpia) || /\b1\/1N?\b/i.test(modLimpia)) {
      return {
        esIntencionDeJugada: true,
        valido: false,
        accionProponente,
        esMatch: false,
        modalidad: modLimpia,
        caballosBandoA: [],
        caballosBandoB: [],
        ejemplarTexto: "",
        monto: 0,
        jugadaEstandarizada: "",
        confianza: 1.0,
        requiereOperador: false,
        mensajePedagogicoPrivado:
          "🚫 La modalidad '1N' no existe (Principio de Riesgo Bilateral). Usa '1P' (Ganador) o '2N' / '1Y2N'.",
        msgPublicoBot: "🚫 Modalidad '1N' inválida. Usa 1P, 2N o 1Y2N.",
      };
    }

    const rawEjemplar = (matchPuesto[3] || "")
      .replace(/\b(de\s+la|del|de|la|el|al?|con|por|#)\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    const { monto, montoTexto } = extraerMontoNumerico(matchPuesto[4]);

    if (rawEjemplar && monto > 0) {
      // Analizar si el ejemplar contiene números o nombres
      const numMatch = rawEjemplar.match(/^\d+/);
      const caballos = normalizarBandoCaballos(rawEjemplar, maxEjemplarCarrera);
      const ejemplarIdentificador = numMatch ? numMatch[0] : (caballos[0] || rawEjemplar.toUpperCase());
      const caballosBandoA = caballos.length > 0 ? caballos : [ejemplarIdentificador];

      // Formatear texto limpio del ejemplar
      let ejemplarTexto = rawEjemplar.toUpperCase();
      if (numMatch && !/^\d+$/.test(rawEjemplar)) {
        ejemplarTexto = `#${rawEjemplar.toUpperCase()}`;
      }

      // Verificar retirados
      const retiradoDetectado = caballosBandoA.find((c) =>
        ejemplaresRetirados.map((r) => r.trim().toUpperCase()).includes(c.toUpperCase())
      );
      if (retiradoDetectado) {
        return {
          esIntencionDeJugada: true,
          valido: false,
          accionProponente,
          esMatch: false,
          modalidad: modLimpia,
          caballosBandoA,
          caballosBandoB: [],
          ejemplarTexto,
          monto,
          montoTexto,
          jugadaEstandarizada: '',
          confianza: 1.0,
          requiereOperador: false,
          mensajePedagogicoPrivado: `🚫 El ejemplar ${ejemplarTexto} está RETIRADO oficialmente. Elige otro ejemplar activo.`,
        };
      }

      const propFinal = rawMod.startsWith('10/') ? rawMod.replace(',', '.') : proporcionDetectada;

      // Validar paridad máxima 10 a 10 (PP)
      const valParidadPuesto = validarParidadProporcion(propFinal);
      if (!valParidadPuesto.valido) {
        return {
          esIntencionDeJugada: true,
          valido: false,
          accionProponente,
          esMatch: false,
          modalidad: modLimpia,
          caballosBandoA,
          caballosBandoB: [],
          ejemplarTexto,
          monto,
          montoTexto,
          jugadaEstandarizada: '',
          confianza: 1.0,
          requiereOperador: false,
          mensajePedagogicoPrivado: valParidadPuesto.motivo,
          msgPrivadoBot: valParidadPuesto.motivo,
        };
      }

      const riesgoPuesto = calcularRiesgoReal(monto, propFinal, accionProponente);
      const excedioSaldoPuesto = riesgoPuesto > saldoDisponible;
      const saldoFmtPuesto = formatearMontoRegional(Math.max(0, saldoDisponible));

      if (saldoDisponible <= 0) {
        return {
          esIntencionDeJugada: true,
          valido: false,
          accionProponente,
          esMatch: false,
          modalidad: modLimpia,
          caballosBandoA,
          caballosBandoB: [],
          ejemplarTexto,
          monto,
          montoTexto,
          jugadaEstandarizada: '',
          confianza: 1.0,
          requiereOperador: false,
          excedioSaldo: true,
          montoDisponibleValido: 0,
          mensajePedagogicoPrivado: `🔒 Saldo insuficiente ($${saldoFmtPuesto}). Debes recargar saldo antes de publicar jugadas.`,
          msgPublicoBot: `⚠️ *${nombreUsuario || 'Jugador'}* dispone de $0,00 para jugar`,
          msgPrivadoBot: `⚠️ Hola ${nombreUsuario || 'Jugador'}, no dispones de saldo para realizar jugadas. Tu saldo disponible es $0,00. Por favor realiza una recarga para continuar jugando.`,
        };
      }

      const factorRiesgo = riesgoPuesto > 0 ? monto / riesgoPuesto : 1;
      const montoRecortado = excedioSaldoPuesto
        ? Math.round(saldoDisponible * factorRiesgo * 100) / 100
        : monto;

      const jugadaEstandarizada = `${verboEstandar} ${modLimpia} ${ejemplarTexto} ${montoTexto}`;
      const msgPublicoBotPuesto = excedioSaldoPuesto
        ? `⚠️ *${nombreUsuario || 'Jugador'}* dispone de $${saldoFmtPuesto} para jugar`
        : undefined;
      const msgPrivadoBotPuesto = excedioSaldoPuesto
        ? `⚠️ Hola ${nombreUsuario || 'Jugador'}, tu jugada se procesó por $${formatearMontoRegional(montoRecortado)} ya que es lo que dispones para realizarla. Tu saldo actual es $${saldoFmtPuesto}.\n\nTe invitamos a jugar hasta el tope exacto de tu saldo disponible ($${saldoFmtPuesto}).`
        : undefined;

      return {
        esIntencionDeJugada: true,
        valido: true,
        accionProponente,
        esMatch: false,
        modalidad: modLimpia,
        caballosBandoA,
        caballosBandoB: [],
        ejemplarTexto,
        monto,
        montoTexto,
        proporcion: propFinal,
        jugadaEstandarizada,
        confianza: 0.99,
        requiereOperador: false,
        excedioSaldo: excedioSaldoPuesto,
        montoDisponibleValido: montoRecortado,
        msgPublicoBot: msgPublicoBotPuesto,
        msgPrivadoBot: msgPrivadoBotPuesto,
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
          proporcion: proporcionDetectada,
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
          proporcion: proporcionDetectada,
          jugadaEstandarizada: '',
          confianza: 1.0,
          requiereOperador: false,
          excedioSaldo: true,
          montoDisponibleValido: 0,
          mensajePedagogicoPrivado: `🔒 Saldo insuficiente (${prefijo}${formatearMontoRegional(saldoDisponible)}). Debes recargar saldo antes de publicar jugadas.`,
          msgPublicoBot: `🚫 *Nada Aquí* — ${nombreUsuario || 'Jugador'}: Disponible 0`,
          msgPrivadoBot: `"Atento", no publique jugadas por encima de saldo disponible, nos agrada tenerlo en este grupo`,
        };
      }

      const jugadaEstandarizada = `${verboEstandar} 1P ${caballos[0]} ${montoTexto}`;
      const msgPublicoBotInv = excedioSaldoInv
        ? `⚠️ *${nombreUsuario || 'Jugador'}*: Disponible ${prefijo}${formatearMontoRegional(saldoDisponible)}`
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
        proporcion: proporcionDetectada,
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
    msgPrivadoBot:
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

/** Alias oficial pedagógico para evaluar mensajes e intenciones de jugadas */
export const evaluarMensajePedagogico = analizarYEstandarizarJugada;

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

  // 1. Palabras exactas autorizadas: Se Fue, SF, s fue, cf, cfue, c fue
  const regexExacto = /^(se\s*fue|sf|s\s*fue|cf|cfue|c\s*fue)$/i;
  if (regexExacto.test(texto)) {
    return {
      esComandoRetiro: true,
      esValido: true,
    };
  }

  // 2. Palabras similares que requieren aclaratoria obligatoria del bot
  const regexSimilar = /^(se\s*fu|sefve|c\s*fuee|se\s*fuee|se\s*va|c\s*va|me\s*fui|retirar|cancelar|cerrar\s*jugadas)$/i;
  if (regexSimilar.test(texto)) {
    return {
      esComandoRetiro: true,
      esValido: false,
      mensajeAclaratoria: "Por favor aclara si deseas retirar tus jugadas con: 'Se fue', 'sf' o 'cf'",
    };
  }

  return {
    esComandoRetiro: false,
    esValido: false,
  };
}

export interface ResultadoAmpliacionPropuesta {
  esAmpliacion: boolean;
  modo: 'TODOS' | 'HASTA_MONTO' | null;
  nuevoTope: number | null;
}

/**
 * Detecta frases de ampliación/contramarcha de una propuesta FIFO por parte del proponente
 * (ej. "todos", "jugaron todos", "van todos", "hasta 8k", "jugaron hasta 8.000").
 */
export function evaluarAmpliacionPropuesta(textoInput: string): ResultadoAmpliacionPropuesta {
  const textoLimpio = (textoInput || '')
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '')
    .trim()
    .replace(/\s+/g, ' ');

  if (!textoLimpio || textoLimpio.length > 180) {
    return { esAmpliacion: false, modo: null, nuevoTope: null };
  }

  if (/^(todos|jugaron\s+todos|juegan\s+todos|van\s+todos|entran\s+todos)$/i.test(textoLimpio)) {
    return { esAmpliacion: true, modo: 'TODOS', nuevoTope: null };
  }

  const matchMonto = textoLimpio.match(
    /^(?:jugaron|juegan|van|entran|hasta|tope)\s*(?:hasta)?\s*\$?\s*(\d+(?:[.,]\d+)?k?)$/i
  );
  if (matchMonto) {
    const { monto } = extraerMontoNumerico(matchMonto[1]);
    if (monto > 0) {
      return { esAmpliacion: true, modo: 'HASTA_MONTO', nuevoTope: monto };
    }
  }

  return { esAmpliacion: false, modo: null, nuevoTope: null };
}

/**
 * Desglosa un mensaje en múltiples jugadas cuando viene en bloque:
 * - Multilínea (\n)
 * - Múltiples caballos separados por coma en jugadas no-match (ej. "Juego 2p 3,5,8 con 100")
 */
export function analizarBloqueJugadas(
  textoUsuario: string,
  saldoDisponible: number,
  ejemplaresRetirados: string[] = [],
  maxEjemplarCarrera = 16,
  nombreUsuario?: string,
  moneda?: string
): ResultadoAnalisisJugada[] {
  if (!textoUsuario || typeof textoUsuario !== 'string') return [];

  const lineasRaw = textoUsuario
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lineasRaw.length === 0) return [];

  const resultados: ResultadoAnalisisJugada[] = [];
  let saldoRestante = Number(saldoDisponible || 0);

  for (const linea of lineasRaw) {
    const analizado = analizarYEstandarizarJugada(
      linea,
      saldoRestante,
      ejemplaresRetirados,
      maxEjemplarCarrera,
      nombreUsuario,
      moneda
    );

    // Si es no-match con múltiples caballos (ej: "Juego 2p 3,5,8 con 100")
    if (
      analizado.esIntencionDeJugada &&
      analizado.valido &&
      !analizado.esMatch &&
      analizado.caballosBandoA.length > 1 &&
      /,/.test(linea)
    ) {
      const verbo =
        analizado.accionProponente === 'CONSIGUE'
          ? /^doy\b/i.test(linea)
            ? 'Doy'
            : /^pido\b/i.test(linea)
            ? 'Pido'
            : 'Consigo'
          : 'Juego';
      for (const cab of analizado.caballosBandoA) {
        const subLinea = `${verbo} ${analizado.modalidad} ${cab} ${analizado.montoTexto || analizado.monto}`;
        const subRes = analizarYEstandarizarJugada(
          subLinea,
          saldoRestante,
          ejemplaresRetirados,
          maxEjemplarCarrera,
          nombreUsuario,
          moneda
        );
        resultados.push(subRes);
        if (subRes.valido) {
          const montoUsado = subRes.montoDisponibleValido ?? subRes.monto;
          const riesgo = calcularRiesgoReal(montoUsado, subRes.proporcion, subRes.accionProponente);
          saldoRestante = Math.max(0, Math.round((saldoRestante - riesgo) * 100) / 100);
        }
      }
      continue;
    }

    resultados.push(analizado);
    if (analizado.esIntencionDeJugada && analizado.valido) {
      const montoUsado = analizado.montoDisponibleValido ?? analizado.monto;
      const riesgo = calcularRiesgoReal(montoUsado, analizado.proporcion, analizado.accionProponente);
      saldoRestante = Math.max(0, Math.round((saldoRestante - riesgo) * 100) / 100);
    }
  }

  return resultados;
}