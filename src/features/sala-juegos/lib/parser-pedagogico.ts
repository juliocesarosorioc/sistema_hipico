// LÍNEA 1: Motor Determinístico de Estandarización Hípica y Corrección Pedagógica
import {
  formatearMontoRegional,
  parsearMontoConK,
  prefijoMonedaGrupo,
  esGrupoBolivares,
} from "@/shared/lib/dinero";
import {
  normalizarModalidadProgresiva,
  parsearBloqueEnfrentamiento,
} from "./modalidades-progresivas";
import { mensajeConCodigoSala } from "@/features/grupos/lib/codigo-sala";

/** Monto humanizado: 30 · 30,50 · 30.000,50 · 30k · 30 K · 30mil · 30 mil · todo */
const RE_MONTO_JUGADA = "(?:\\d+(?:[\\.,]\\d+)*\\s*(?:k|mil)?|todo)";

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
export function extraerMontoNumerico(
  rawInput: string,
  saldoDisponible?: number
): { monto: number; montoTexto: string; esKilo: boolean } {
  if (!rawInput) return { monto: 0, montoTexto: "0", esKilo: false };
  const str = String(rawInput).trim().replace(/^[\$Bs\.\s]+/i, "").trim();

  // "Voy Todo" / "Todo" significa el saldo disponible completo del jugador.
  if (/^(?:voy\s+)?todo$/.test(str)) {
    const montoTodo = Math.max(0, Math.round(Number(saldoDisponible || 0) * 100) / 100);
    return {
      monto: montoTodo,
      montoTexto: formatearMontoRegional(montoTodo),
      esKilo: false,
    };
  }

  // Núcleo único de abreviaturas y formatos regionales (30k / 30mil / 30 mil / 30.000,50).
  const parseado = parsearMontoConK(str);
  if (!parseado) return { monto: 0, montoTexto: "0", esKilo: false };
  return {
    monto: parseado.monto,
    montoTexto: formatearMontoRegional(parseado.monto),
    esKilo: parseado.esKilo,
  };
}

/**
 * Normaliza cualquier variante de proporción o parada a premio al estándar interno 10/X:
 * Formatos: 10@7, 10a7, 10/7, 10A7, 10 a 7, 10a 5, 10 a5, 10 / 7, 10-7, 10a9,99, 10a9.99, @7
 */
export function normalizarParadaPremio(texto: string): string {
  if (!texto) return texto;
  return texto
    .replace(
      /(?:^|(?<=[\s,(\[]))10\s*[@aªA\/\-]\s*(\d+(?:[.,]\d+)?)(?=$|[\s,)\]])/g,
      (_m, num) => `10/${String(num).replace(",", ".")}`
    )
    .replace(
      /(?:^|(?<=[\s,(\[]))@\s*(\d+(?:[.,]\d+)?)(?=$|[\s,)\]])/g,
      (_m, num) => `10/${String(num).replace(",", ".")}`
    );
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
 * Calcula el riesgo real según proporción 10/X y el lado efectivo de la apuesta:
 * - Quien JUEGA (proponente con accion='JUEGA' o aceptante cuando la propuesta es 'CONSIGUE'):
 *   arriesga 10 para ganar X -> 100% ROUND(M, 2).
 * - Quien CONSIGUE / DA (proponente con accion='CONSIGUE' o aceptante cuando la propuesta es 'JUEGA'):
 *   arriesga X para ganar 10 -> proporción ROUND(M * (X / 10), 2).
 */
export function calcularRiesgoReal(
  monto: number,
  proporcion?: string,
  accionPropuesta: 'JUEGA' | 'CONSIGUE' = 'JUEGA',
  rolEnTransaccion: 'PROPONENTE' | 'ACEPTANTE' = 'PROPONENTE'
): number {
  const m = Number(monto || 0);
  if (!Number.isFinite(m) || m <= 0) return 0;
  const prop = String(proporcion || '1x1').replace(',', '.').trim();
  const match = /^10\/(\d+(?:\.\d+)?)$/i.exec(prop);
  if (!match) return Math.round(m * 100) / 100;
  const x = parseFloat(match[1]);
  if (!Number.isFinite(x) || x <= 0 || x >= 10) return Math.round(m * 100) / 100;
  const esLadoJuega =
    (rolEnTransaccion === 'PROPONENTE' && accionPropuesta === 'JUEGA') ||
    (rolEnTransaccion === 'ACEPTANTE' && accionPropuesta === 'CONSIGUE');
  if (esLadoJuega) {
    return Math.round(m * 100) / 100;
  }
  return Math.round(m * (x / 10) * 100) / 100;
}

/**
 * Valida de forma estricta las palabras autorizadas para responder y concretar una propuesta
 */
function evaluarConcrecionEstrictaBase(
  textoRespuesta: string,
  accionPropuesta: 'JUEGA' | 'CONSIGUE',
  montoDisponiblePropuesta: number,
  saldoDisponibleAceptante: number,
  nombreAceptante?: string,
  moneda?: string,
  permitirMontoSuelto = false
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

  // Un monto suelto al citar una propuesta equivale a "J <monto>".
  const MONTO_ABREVIADO = "(?:\\d+(?:[\\.,]\\d+)*\\s*(?:k|mil)?|todo)";
  const textoConVerbo =
    permitirMontoSuelto && new RegExp(`^(?:con\\s+|por\\s+|\\$|bs\\.?\\s*)?${MONTO_ABREVIADO}$`, "i").test(texto)
      ? `J ${texto.replace(/^(?:con|por)\s+/i, "")}`
      : texto;

  // Validar verbos autorizados según el rol de la propuesta citada:
  // - Si el proponente "CONSIGUE / DA" (accion_proponente = consigo/doy): Solo concretan: Juego, Jugue, Jugué, Jugo, Jugó, Jugaron, Ponte, Jugamos, Voy, J
  // - Si el proponente "JUEGA / VOY" (accion_proponente = juego): Solo concretan: Jugaste, Jugo, Jugó, Jugaron, Ponte, Consigo, Doy, J
  const esPropuestaJuego = accionPropuesta === 'JUEGA';

  const regexJuego = new RegExp(`^(jugaste|jugaron|jugo|jugó|ponte|consigo|doy|j)(?:\\s+(?:con\\s+|por\\s+|\\$|bs\\.?|bs\\s+)?(${MONTO_ABREVIADO}))?$`, "i");
  const regexConsigo = new RegExp(`^(juego|jugue|jugué|jugo|jugó|jugaron|ponte|jugamos|voy|j)(?:\\s+(?:con\\s+|por\\s+|\\$|bs\\.?|bs\\s+)?(${MONTO_ABREVIADO}))?$`, "i");

  const match = esPropuestaJuego ? textoConVerbo.match(regexJuego) : textoConVerbo.match(regexConsigo);

  if (!match) {
    const permitidas = esPropuestaJuego
      ? 'Jugaste, Jugo, Ponte, Consigo, Doy, J'
      : 'Juego, Jugue, Jugué, Jugo, Ponte, Jugamos, Voy, J';
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
    const extraido = extraerMontoNumerico(match[2], saldoDisponibleAceptante);
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
    msgPublicoBot = `⚠️ *${nombreAceptante || 'Jugador'}* dispone de ${prefijo}${saldoFmt} para esta jugada.`;
    msgPrivadoBot = `⚠️ Nos agrada tenerlo en el grupo, por favor no exceda su saldo, ajuste el monto de sus jugadas. Usted dispone de ${prefijo}${saldoFmt}. Muchas gracias.`;
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

  // Si tiene separadores explícitos (., -, /, ,, y o espacios entre números)
  if (/[\.\-,\/y]/.test(limpio) || /\d+\s+\d+/.test(limpio)) {
    return limpio
      .replace(/\by\b/gi, ' ')
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

function normalizarEspaciosModalidadesEnTexto(t: string): string {
  return t
    .replace(/(?<![\d/])([1-5])\s*\/\s*([1-5])\s*([nNpP])\b/g, "$1/$2$3")
    .replace(/(?<![\d/])([1-5])\s*\/\s*([1-5])\b(?!\s*[.,]\d)/g, "$1/$2")
    .replace(/(?<![\d/])([1-5])\s+[yY]\s+([1-5])\s*([nNpP])\b/g, "$1/$2$3")
    .replace(/(?<![\d/])([1-5])[yY]([1-5])\s+([nNpP])\b/g, "$1/$2$3")
    .replace(/(?<![\d/])([1-9]|10)\s+([pPnN])\b/g, "$1$2");
}

function analizarYEstandarizarJugadaBase(
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

  const textoSinEspaciosMod = normalizarEspaciosModalidadesEnTexto(
    normalizarParadaPremio(textoUsuario.trim())
  );
  const bloqueDetectado = parsearBloqueEnfrentamiento(textoSinEspaciosMod);
  const textoNormalizado = bloqueDetectado ? bloqueDetectado.texto : textoSinEspaciosMod;
  const texto = textoNormalizado.replace(/\s+/g, ' ').trim();
  const prefijo = prefijoMonedaGrupo(moneda);

  // Extraer proporción gabela si existe en el texto (ej. 10/5, 10/8, 10/6.5, 10/9.99)
  const matchGabela = texto.match(/\b(10\/\d+(?:[.,]\d+)?)\b/);
  const propRawDetectada = matchGabela ? matchGabela[1].replace(',', '.') : '1x1';
  const proporcionDetectada = propRawDetectada === '10/10' ? '1x1' : propRawDetectada;

  // 1. Filtro de charla libre: sólo verbos de apuesta al inicio o estructura canónica de jugada.
  const patronVerbosApuesta = /^(?:juego|jugo|jugó|jugue|jugué|consigo|doy|pido)\b|^(?:j|voy)\s+(?:de\s+|del\s+|el\s+|la\s+|a\s+|con\s+)?(?:\d|[1-5]p\b|[1-5]n\b|[1-5]\/[2-5]n?\b|[1-5]y[1-5][pn]?\b|ganador\b|win\b)/i;
  const patronEstructuraApuesta = /(?:^|\s)(?:10\s*[\/a@]\s*\d+|[1-5]\s*p|[2-5]\s*n|[1-5]\s*[\/y]\s*[1-5]\s*n?|\d+(?:[.,-]\d+)*\s*(?:x|vs|contra)\s*\d+(?:[.,-]\d+)*)(?:\s|$)/i;
  const patronMontoAlCaballo = new RegExp(
    `^${RE_MONTO_JUGADA}\\s+(?:al?|del?|el)\\s+\\d{1,2}$`,
    "i"
  );
  if (
    evaluarAmpliacionPropuesta(textoUsuario).esAmpliacion ||
    analizarComandoRetiro(textoUsuario).esComandoRetiro ||
    (!patronVerbosApuesta.test(texto) && !patronEstructuraApuesta.test(texto) && !patronMontoAlCaballo.test(texto))
  ) {
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

  // Prohibición explícita de la palabra "pido" o "match"
  if (/^pido\b/i.test(texto)) {
    return {
      esIntencionDeJugada: true,
      valido: false,
      accionProponente: 'CONSIGUE',
      esMatch: false,
      modalidad: 'DUDA_FORMATO',
      caballosBandoA: [],
      caballosBandoB: [],
      ejemplarTexto: '',
      monto: 0,
      jugadaEstandarizada: '',
      confianza: 1.0,
      requiereOperador: false,
      msgPublicoBot: "⚠️¡Por favor, verificar redacción! ¡Gracias!",
      mensajePedagogicoPrivado:
        "🚫 No se usa 'Pido'. Debes indicar obligatoriamente si juegas ('Juego') o si das/consigues ('Consigo' o 'Doy'). Ejemplo: 'Juego 3x5 con 100' o 'Consigo 3x5 10a8 con 100'.",
      msgPrivadoBot:
        "🚫 No se usa 'Pido'. Debes indicar obligatoriamente si juegas ('Juego') o si das/consigues ('Consigo' o 'Doy'). Ejemplo: 'Juego 3x5 con 100' o 'Consigo 3x5 10a8 con 100'.",
    };
  }

  if (/\bmatch\b/i.test(textoUsuario)) {
    return {
      esIntencionDeJugada: true,
      valido: false,
      accionProponente: 'JUEGA',
      esMatch: true,
      modalidad: 'DUDA_FORMATO',
      caballosBandoA: [],
      caballosBandoB: [],
      ejemplarTexto: '',
      monto: 0,
      jugadaEstandarizada: '',
      confianza: 1.0,
      requiereOperador: false,
      msgPublicoBot: "⚠️¡Por favor, verificar redacción! ¡Gracias!",
      mensajePedagogicoPrivado:
        "🚫 No escribas la palabra 'match'. Escribe directamente los ejemplares con 'Juego', 'Consigo' o 'Doy'. Ejemplo: 'Juego 3x5 con 100' o 'Consigo 3x5 10a8 con 100'.",
      msgPrivadoBot:
        "🚫 No escribas la palabra 'match'. Escribe directamente los ejemplares con 'Juego', 'Consigo' o 'Doy'. Ejemplo: 'Juego 3x5 con 100' o 'Consigo 3x5 10a8 con 100'.",
    };
  }

  // Determinar verbo inicial (Juego vs Consigo/Doy)
  const tieneVerboExplicito = /^(?:juego|jugo|jugó|jugue|jugué|consigo|doy|voy|j)\b/i.test(texto);
  const esConsigue = /^(consigo|doy)\b/i.test(texto);
  const verboEstandar = /^doy\b/i.test(texto)
    ? 'Doy'
    : esConsigue
    ? 'Consigo'
    : 'Juego';
  const accionProponente: 'JUEGA' | 'CONSIGUE' = esConsigue ? 'CONSIGUE' : 'JUEGA';

  // 2. CASO A: JUGADA DE ENFRENTAMIENTO CON "x" O "contra" (soporta proporción opcional 10/X antes o después)
  // Ejemplos: "Juego 3x5 100", "Juego 3x5 con 100", "Doy 3x5 10a8 100", "Consigo 10a8 la 3x5 con 100"
  const regexMatch = new RegExp(
    `^(?:(juego|jugo|jugó|jugue|jugué|consigo|doy|voy|j)\\s+)?(?:(10\\/\\d+(?:[.,]\\d+)?)\\s+)?(?:de\\s+la\\s+|la\\s+|del\\s+|el\\s+)?([0-9A-Za-z\\.\\-,\\s]+?)\\s*(?:x|vs|contra)\\s*(?:de\\s+la\\s+|la\\s+|del\\s+|el\\s+)?([0-9A-Za-z\\.\\-,]+(?:\\s+[0-9A-Za-z\\.\\-,]+)*?)(?:\\s+(10\\/\\d+(?:[.,]\\d+)?))?\\s+(?:con\\s+|por\\s+|\\$|bs\\.?|bs\\s+)?(${RE_MONTO_JUGADA})$`,
    "i"
  );
  const matchVs = texto.match(regexMatch);

  if (matchVs) {
    if (!matchVs[1] && !tieneVerboExplicito) {
      return {
        esIntencionDeJugada: true,
        valido: false,
        accionProponente: 'JUEGA',
        esMatch: true,
        modalidad: 'DUDA_FORMATO',
        caballosBandoA: [],
        caballosBandoB: [],
        ejemplarTexto: '',
        monto: 0,
        jugadaEstandarizada: '',
        confianza: 1.0,
        requiereOperador: false,
        msgPublicoBot: "⚠️¡Por favor, verificar redacción! ¡Gracias!",
        mensajePedagogicoPrivado:
          "⚠️ Debes indicar obligatoriamente si juegas ('Juego') o si das/consigues ('Consigo' o 'Doy'). Ejemplo: 'Juego 3x5 con 100' o 'Consigo 3x5 10a8 con 100'.",
        msgPrivadoBot:
          "⚠️ Debes indicar obligatoriamente si juegas ('Juego') o si das/consigues ('Consigo' o 'Doy'). Ejemplo: 'Juego 3x5 con 100' o 'Consigo 3x5 10a8 con 100'.",
      };
    }

    const tienePrefijoLaA = /\b(la|de\s+la)\s+[0-9A-Za-z\.\-,\s]+?\s*(?:x|vs|contra)/i.test(textoSinEspaciosMod);
    const ambos2Digitos = /^\d{2}$/.test(matchVs[3].trim()) && /^\d{2}$/.test(matchVs[4].trim());
    const esDuplaA = tienePrefijoLaA || ambos2Digitos;
    const esDuplaB = /^\d{2}$/.test(matchVs[4].trim()) && (ambos2Digitos || tienePrefijoLaA);

    const bandoA = normalizarBandoCaballos(matchVs[3], maxEjemplarCarrera, esDuplaA);
    const bandoB = normalizarBandoCaballos(matchVs[4], maxEjemplarCarrera, esDuplaB);
    const rawPropMatch = (matchVs[5] || matchVs[2] || proporcionDetectada).replace(',', '.');
    const propMatch = rawPropMatch === '10/10' ? '1x1' : rawPropMatch;
    const modMatch = propMatch === '1x1' ? 'PP' : propMatch;

    const { monto, montoTexto } = extraerMontoNumerico(matchVs[6], saldoDisponible);

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
          modalidad: modMatch,
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
          modalidad: modMatch,
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
          modalidad: modMatch,
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
          mensajePedagogicoPrivado: `🔒 Saldo insuficiente (${prefijo}${saldoFmt}). Debes recargar saldo antes de publicar jugadas.`,
          msgPublicoBot: `⚠️ *${nombreUsuario || 'Jugador'}* dispone de ${prefijo}${formatearMontoRegional(0)} para jugar`,
          msgPrivadoBot: `⚠️ Hola ${nombreUsuario || 'Jugador'}, no dispones de saldo para realizar jugadas. Tu saldo disponible es ${prefijo}${formatearMontoRegional(0)}. Por favor realiza una recarga para continuar jugando.`,
        };
      }

      const factorRiesgo = riesgoMatch > 0 ? monto / riesgoMatch : 1;
      const montoRecortado = excedioSaldoMatch
        ? Math.round(saldoDisponible * factorRiesgo * 100) / 100
        : monto;
      const montoTextoEfectivo = excedioSaldoMatch
        ? formatearMontoRegional(montoRecortado)
        : montoTexto;

      const jugadaEstandarizada = `${verboEstandar} ${bandoA.join('-')} x ${bandoB.join('-')}${propMatch !== '1x1' ? ` ${propMatch}` : ''} ${montoTextoEfectivo}`;
      const msgPublicoBotMatch = excedioSaldoMatch
        ? `⚠️ *${nombreUsuario || 'Jugador'}* dispone de ${prefijo}${saldoFmt} para esta jugada.`
        : undefined;
      const msgPrivadoBotMatch = excedioSaldoMatch
        ? `⚠️ Nos agrada tenerlo en el grupo, por favor no exceda su saldo, ajuste el monto de sus jugadas. Usted dispone de ${prefijo}${saldoFmt}. Muchas gracias.`
        : undefined;

      return {
        esIntencionDeJugada: true,
        valido: true,
        accionProponente,
        esMatch: true,
        modalidad: modMatch,
        caballosBandoA: bandoA,
        caballosBandoB: bandoB,
        ejemplarTexto: `${bandoA.join('-')} x ${bandoB.join('-')}`,
        monto,
        montoTexto: montoTextoEfectivo,
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

  // 3. CASO B: JUGADAS DE PUESTOS, NINIS, GANADOR, ESCALERA ENTRE TERCIOS, PROPORCIONES Y CABALLOS
  const MODS_COMPUESTAS_RE = [
    "[1-4]P\\s*Y\\s*[1-4][\\/Y][2-5]N?",
    "[1-4][\\/Y][2-5]N?\\s*Y\\s*[2-5]N",
    "[2-5]N\\s*Y\\s*[2-5][\\/Y][2-5]N?",
    "[2-5][\\/Y][2-5]N?\\s*Y\\s*[2-5]P",
    "[1-4]P\\s*Y\\s*[2-5][PN]",
    "[2-5]N\\s*Y\\s*[2-5]P",
    "A\\s+GANADOR|GANADOR|WIN|G|PP",
    "[1-5]Y[1-5][PN]?",
    "[1-5]\\/[1-5][PN]?",
    "(?:[1-9]|10)[PN]",
    "10\\/\\d+(?:[\\.,]\\d+)?|A|AL",
  ].join("|");
  const regexPuestosYCaballos = new RegExp(
    `^(?:(juego|jugo|jugó|jugue|jugué|consigo|doy|voy|j)\\s+)?(?:(${MODS_COMPUESTAS_RE})\\s+)?(?:de\\s+la\\s+|del\\s+|de\\s+|la\\s+|el\\s+|a\\s+|al\\s+|#)?([0-9A-Za-z\\.\\-,\\s']+?)\\s+(?:con\\s+|por\\s+|\\$|bs\\.?|bs\\s+)?(${RE_MONTO_JUGADA})$`,
    "i"
  );
  const regexCaballoYModalidad = new RegExp(
    `^(?:(juego|jugo|jugó|jugue|jugué|consigo|doy|voy|j)\\s+)(?:de\\s+la\\s+|del\\s+|de\\s+|la\\s+|el\\s+|a\\s+|al\\s+|#)?(\\d{1,2})\\s+(${MODS_COMPUESTAS_RE})\\s+(?:con\\s+|por\\s+|\\$|bs\\.?|bs\\s+)?(${RE_MONTO_JUGADA})$`,
    "i"
  );
  const matchCabMod = texto.match(regexCaballoYModalidad);
  const matchPuesto = matchCabMod
    ? [matchCabMod[0], matchCabMod[1], matchCabMod[3], matchCabMod[2], matchCabMod[4]]
    : texto.match(regexPuestosYCaballos);

  if (matchPuesto) {
    const rawMod = (matchPuesto[2] || "").trim().toUpperCase().replace(/\s+/g, " ");
    let modLimpia = "1P";
    if (rawMod && rawMod !== "A" && rawMod !== "AL") {
      if (rawMod === "G" || rawMod === "GANADOR" || rawMod === "WIN" || rawMod === "A GANADOR" || rawMod === "PP" || rawMod === "10/10") {
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

    const modProgresiva = normalizarModalidadProgresiva(modLimpia);
    if (modProgresiva) {
      modLimpia = modProgresiva === "PP" ? "1P" : modProgresiva;
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
    const { monto, montoTexto } = extraerMontoNumerico(matchPuesto[4], saldoDisponible);

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

      // Regla Oficial: Puestos y Ninis son SIEMPRE a paridad (1x1). Prohibido ponerles proporción.
      const esPuestoONini = !modLimpia.startsWith("10/");

      const tieneProporcionEnTexto =
        matchGabela !== null ||
        /\b10\s*[@aªA\/\-]\s*\d+/i.test(texto);

      if (esPuestoONini && tieneProporcionEnTexto) {
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
          jugadaEstandarizada: "",
          confianza: 1.0,
          requiereOperador: false,
          msgPublicoBot: "⚠️¡Por favor, verificar redacción! ¡Gracias!",
          mensajePedagogicoPrivado: `⚠️ Hola ${nombreUsuario || "Jugador"}, los puestos y ninis son jugadas a paridad. No se les puede colocar proporción o gabela (ej. 10a8). ✅ Ejemplo correcto: "Juego ${modLimpia} ${ejemplarTexto || "5"} ${montoTexto || "100"}".`,
          msgPrivadoBot: `⚠️ Hola ${nombreUsuario || "Jugador"}, los puestos y ninis son jugadas a paridad. No se les puede colocar proporción o gabela (ej. 10a8). ✅ Ejemplo correcto: "Juego ${modLimpia} ${ejemplarTexto || "5"} ${montoTexto || "100"}".`,
        };
      }

      const propFinal = esPuestoONini ? "1x1" : (modLimpia.startsWith('10/') ? modLimpia.replace(',', '.') : proporcionDetectada);

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
          mensajePedagogicoPrivado: `🔒 Saldo insuficiente (${prefijo}${saldoFmtPuesto}). Debes recargar saldo antes de publicar jugadas.`,
          msgPublicoBot: `⚠️ *${nombreUsuario || 'Jugador'}* dispone de ${prefijo}${formatearMontoRegional(0)} para jugar`,
          msgPrivadoBot: `⚠️ Hola ${nombreUsuario || 'Jugador'}, no dispones de saldo para realizar jugadas. Tu saldo disponible es ${prefijo}${formatearMontoRegional(0)}. Por favor realiza una recarga para continuar jugando.`,
        };
      }

      const factorRiesgo = riesgoPuesto > 0 ? monto / riesgoPuesto : 1;
      const montoRecortado = excedioSaldoPuesto
        ? Math.round(saldoDisponible * factorRiesgo * 100) / 100
        : monto;
      const montoTextoEfectivo = excedioSaldoPuesto
        ? formatearMontoRegional(montoRecortado)
        : montoTexto;

      const jugadaEstandarizada = `${verboEstandar} ${modLimpia} ${ejemplarTexto} ${montoTextoEfectivo}`;
      const msgPublicoBotPuesto = excedioSaldoPuesto
        ? `⚠️ *${nombreUsuario || 'Jugador'}* dispone de ${prefijo}${saldoFmtPuesto} para esta jugada.`
        : undefined;
      const msgPrivadoBotPuesto = excedioSaldoPuesto
        ? `⚠️ Nos agrada tenerlo en el grupo, por favor no exceda su saldo, ajuste el monto de sus jugadas. Usted dispone de ${prefijo}${saldoFmtPuesto}. Muchas gracias.`
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
        montoTexto: montoTextoEfectivo,
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
  const regexInvertido = new RegExp(
    `^(${RE_MONTO_JUGADA})\\s+(?:al?|del?|el)\\s+(\\d{1,2})$`,
    "i"
  );
  const matchInvertido = texto.match(regexInvertido);

  if (matchInvertido) {
    const caballos = [matchInvertido[2]];
    const { monto, montoTexto } = extraerMontoNumerico(matchInvertido[1], saldoDisponible);

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

      const montoTextoEfectivo = excedioSaldoInv
        ? formatearMontoRegional(saldoDisponible)
        : montoTexto;
      const jugadaEstandarizada = `${verboEstandar} 1P ${caballos[0]} ${montoTextoEfectivo}`;
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
        montoTexto: montoTextoEfectivo,
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
    msgPublicoBot: "⚠️¡Por favor, verificar redacción! ¡Gracias!",
    mensajePedagogicoPrivado:
      `⚠️ Hola ${nombreUsuario || "Jugador"}, tu mensaje "${texto}" no pudo procesarse por error de redacción o sintaxis.\n\n` +
      `✅ Ejemplos correctos según las reglas de la sala:\n` +
      `• Puesto (Ganador): "Juego 1P ${ej1} ${montoEj}" (o "Consigo 1P ${ej1} ${montoEj}")\n` +
      `• Nini / Puestos Múltiples: "Juego 2N ${ej1} ${montoEj}" o "Juego 1y2N ${ej1} ${montoEj}"\n` +
      `• Mano a Mano: "Juego ${ej1}x${ej2} 10a8 ${montoEj}" o "Juego ${ej1}x${ej2} ${montoEj}"\n\n` +
      `Los puestos y ninis no admiten gabela o proporción.`,
    msgPrivadoBot:
      `⚠️ Hola ${nombreUsuario || "Jugador"}, tu mensaje "${texto}" no pudo procesarse por error de redacción o sintaxis.\n\n` +
      `✅ Ejemplos correctos según las reglas de la sala:\n` +
      `• Puesto (Ganador): "Juego 1P ${ej1} ${montoEj}" (o "Consigo 1P ${ej1} ${montoEj}")\n` +
      `• Nini / Puestos Múltiples: "Juego 2N ${ej1} ${montoEj}" o "Juego 1y2N ${ej1} ${montoEj}"\n` +
      `• Mano a Mano: "Juego ${ej1}x${ej2} 10a8 ${montoEj}" o "Juego ${ej1}x${ej2} ${montoEj}"\n\n` +
      `Los puestos y ninis no admiten gabela o proporción.`,
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

  // 1. Palabras exactas autorizadas: Se Fue, SF, s fue, cf, cfue, c fue, ce fue
  const regexExacto = /^(se\s*fue|sf|s\s*fue|sfue|sefue|cf|cfue|c\s*fue|ce\s*fue|cefue)$/i;
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

/**
 * Detecta si un mensaje de respuesta (cita) a una propuesta tiene intención de concretarla
 * ("jugaron", "j", "voy", "jugaste", "ponte", "doy", "consigo", etc., o un monto parcial).
 */
export function esIntentoConcrecionOMontoParcial(textoInput: string): boolean {
  const texto = normalizarParadaPremio(String(textoInput || "").trim());
  if (!texto || texto.length > 180) return false;
  const MONTO = "(?:\\d+(?:[\\.,]\\d+)*\\s*(?:k|mil)?|todo)";
  const regexVerboConcrecion = new RegExp(
    `^(?:j|voy|juego|jugue|jugué|jugo|jugó|jugaste|jugaron|jugamos|ponte|consigo|doy|te\\s+doy|te\\s+juego|copiado|pago|entro|tomo|la\\s+tomo|agarro|dame|solo)(?:\\s+(?:con\\s+|por\\s+|a\\s+|de\\s+|hasta\\s+|\\$|bs\\.?\\s*)*(${MONTO}))?$`,
    "i"
  );
  if (regexVerboConcrecion.test(texto)) return true;
  const regexMontoParcial = new RegExp(
    `^(?:con\\s+|por\\s+|solo\\s+|hasta\\s+|\\$|bs\\.?\\s*)*(${MONTO})$`,
    "i"
  );
  return regexMontoParcial.test(texto);
}

export interface ResultadoAmpliacionPropuesta {
  esAmpliacion: boolean;
  modo: 'TODOS' | 'HASTA_MONTO' | null;
  nuevoTope: number | null;
}

/**
 * Detecta frases de ampliación/contramarcha de una propuesta FIFO por parte del proponente
 * (ej. "todos", "jugue con todos", "jugué con todos", "jugaron todos", "van todos", "hasta 8k").
 */
export function evaluarAmpliacionPropuesta(textoInput: string): ResultadoAmpliacionPropuesta {
  const textoLimpio = (textoInput || '')
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '')
    .replace(/[!¡?¿.,;:]/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');

  if (!textoLimpio || textoLimpio.length > 180) {
    return { esAmpliacion: false, modo: null, nuevoTope: null };
  }

  const sinAcentos = textoLimpio
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  if (
    /^(todos|con\s+todos|a\s+todos|(?:jugue|juego|jugo|jugaron|juegan|jugamos|voy|van|entran|doy|consigo)(?:\s+(?:con|a))?\s+todos)$/i.test(
      sinAcentos
    )
  ) {
    return { esAmpliacion: true, modo: 'TODOS', nuevoTope: null };
  }

  const matchMonto = sinAcentos.match(
    /^(?:jugue|juego|jugo|jugaron|juegan|jugamos|voy|van|entran|hasta|tope)(?:\s+con)?(?:\s+todos)?\s*(?:hasta)?\s*\$?\s*(\d+(?:[.,]\d+)?\s*(?:k|mil)?)$/i
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
  moneda?: string,
  codigoSala?: string
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
      moneda,
      codigoSala
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
          moneda,
          codigoSala
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

/**
 *Envoltorios públicos: toda respuesta privada del bot sale con el Código de
 *Sala exacto del tenant, sin alterar las reglas determinísticas del parser.
 */
export function evaluarConcrecionEstricta(
  textoRespuesta: string,
  accionPropuesta: 'JUEGA' | 'CONSIGUE',
  montoDisponiblePropuesta: number,
  saldoDisponibleAceptante: number,
  nombreAceptante?: string,
  moneda?: string,
  codigoSala?: string,
  permitirMontoSuelto = false
): ResultadoConcrecionEstricta {
  const r = evaluarConcrecionEstrictaBase(
    textoRespuesta,
    accionPropuesta,
    montoDisponiblePropuesta,
    saldoDisponibleAceptante,
    nombreAceptante,
    moneda,
    permitirMontoSuelto
  );
  return {
    ...r,
    msgPrivadoBot: r.msgPrivadoBot
      ? mensajeConCodigoSala(r.msgPrivadoBot, codigoSala)
      : r.msgPrivadoBot,
  };
}

export function analizarYEstandarizarJugada(
  textoUsuario: string,
  saldoDisponible: number,
  ejemplaresRetirados: string[] = [],
  maxEjemplarCarrera = 16,
  nombreUsuario?: string,
  moneda?: string,
  codigoSala?: string
): ResultadoAnalisisJugada {
  const r = analizarYEstandarizarJugadaBase(
    textoUsuario,
    saldoDisponible,
    ejemplaresRetirados,
    maxEjemplarCarrera,
    nombreUsuario,
    moneda
  );
  return {
    ...r,
    msgPrivadoBot: r.msgPrivadoBot
      ? mensajeConCodigoSala(r.msgPrivadoBot, codigoSala)
      : r.msgPrivadoBot,
    mensajePedagogicoPrivado: r.mensajePedagogicoPrivado
      ? mensajeConCodigoSala(r.mensajePedagogicoPrivado, codigoSala)
      : r.mensajePedagogicoPrivado,
  };
}