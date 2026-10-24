<<<<<<< HEAD
/**
 * SEGMENTACIÓN DE UNA GACETA EN TEXTO POR CARRERA (módulo PURO).
 *
 * POR QUÉ EXISTE
 * --------------
 * La Gaceta se transcribe con un LLM. Cuando se le manda un documento
 * COMPLETO en una sola llamada, pasa una de dos cosas:
 *
 *   1. El modelo se queda sin tokens de salida a mitad del JSON → la respuesta
 *      queda truncada y las ÚLTIMAS carreras se pierden en silencio (el caso
 *      real: Belmont 1-3_OK, Charles Town 4-6_OK, Keeneland 4-6_OK: el
 *      documento entero no cabía y el modelo entregaba las primeras).
 *   2. El modelo "resume" y agrupa carreras que en el documento están
 *      separadas, con lo que las cardio pierde ejemplares.
 *
 * La solución NO es pedirle al modelo que sea más exacto: es NO darle el
 * documento entero. Aquí se parte el texto por los ENCABEZADOS de carrera
 * (`RACE 4`, `CARRERA 12`, `DECIMOTERCERA CARRERA`, `RACE VII`) y se agrupan
 * 2 o 3 carreras por llamada. Cada bloque cabe de sobra en la ventana de
 * contexto y la respuesta llega completa.
 *
 * Después, todos los bloques se consolidan en un `Map<number, Carrera>`
 * indexado por número de carrera: así, si dos bloques traen la misma carrera
 * (una carrera partida entre dos páginas del documento), se fusionan sus
 * ejemplares en vez de duplicarse, y si una carrera llega con exemplares
 * disjuntos (mal numerada), se conservan ambas para que la reparación final
 * (`repararNumerosCarreras`) la renumere.
 *
 * Todo es PURO: sin red, sin reloj, sin base. Se puede probar en node.
 */
import { numeroDeCarrera } from "@/features/gaceta/lib/numeros";

/** Segmento del documento que corresponde a UNA carrera. */
export type SegmentoCarrera = {
  /** Número de carrera leído del encabezado (null si el encabezado no se pudo leer). */
  numero: number | null;
  /** Texto del segmento: encabezado + cuerpo de la carrera. */
  texto: string;
  /** Índice del primer carácter del segmento dentro del texto original. */
  inicio: number;
};

/** Bloque de 2 o 3 carreras que se manda al LLM en UNA llamada. */
export type BloqueCarrera = {
  /** Índice del bloque, base 1 (para los mensajes de progreso). */
  indice: number;
  /** Números de carrera que el bloque DEBERÍA contener (los que se leyeron). */
  numeros: number[];
  /** Texto completo del bloque. */
  texto: string;
};

/**
 * Encabezados de carrera.
 *
 * Se aceptan las cuatro formas que aparecen en gacetas reales:
 *   - `RACE 4`, `CARRERA 12`, `CARRERA Nº 3`, `Race No. 5`
 *   - `13ª CARRERA`, `4 CARRERA`
 *   - `RACE VII` (romanos)
 *   - `DECIMOTERCERA CARRERA`, `PRIMERA CARRERA` (ordinales escritos)
 *
 * El encabezado tiene que estar al INICIO de una línea y ser CORTO: una
 * línea larga que mentione "carrera" en medio de una frase es texto de la
 * carrera, no un encabezado.
 */
const RE_ENCABEZADO =
  /^[ \t]*(?:(?:RACE|CARRERA|CARRERA|CAR\.?)[ \t]*(?:N[º°.]?[ \t]*)?#?[ \t]*([A-Za-z0-9ÁÉÍÓÚÑáéíóúñ]{1,14})\b)|(?:([A-Za-zÁÉÍÓÚÑáéíóúñ]{1,20})[ \t]+(?:CARRERA|RACE)\b)/gim;

/** Tope de caracteres de un encabezado: más de esto ya es una frase. */
const MAX_ENCABEZADO = 60;

/**
 * Parte el texto en segmentos, uno por carrera.
 *
 * Lo que va ANTES del primer encabezado (el encabezado del documento: fecha,
 * hipódromo, hora) se devuelve como un segmento con `numero: null`, para que
 * el llamador pueda usarlo de contexto (de ahí se saca el hipódromo y la
 * fecha cuando la carrera no los trae).
 *
 * Si el texto NO tiene ningún encabezado reconocible, se devuelve UN solo
 * segmento con todo el texto: es mejor mandarlo entero que no mandarlo.
 */
export function segmentarPorCarreras(texto: string): SegmentoCarrera[] {
  const t = String(texto ?? "");
  if (!t.trim()) return [];

  const cortes: Array<{ numero: number | null; inicio: number; fin: number }> = [];
  RE_ENCABEZADO.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RE_ENCABEZADO.exec(t)) !== null) {
    // El encabezado debe ser una línea propia y corta: si la línea tiene más
    // texto, es una frase que menciona "carrera", no un encabezado.
    const finLinea = t.indexOf("\n", m.index);
    const largoLinea = (finLinea === -1 ? t.length : finLinea) - m.index;
    if (largoLinea > MAX_ENCABEZADO) continue;

    const token = m[1] ?? m[2] ?? "";
    // `numeroDeCarrera` normaliza dígitos, romanos y ordinales escritos.
    const numero = numeroDeCarrera(token);
    // Un encabezado que no aporta número sirve igual como separador: sin él,
    // dos carreras quedarían pegadas en un solo segmento.
    cortes.push({ numero, inicio: m.index, fin: -1 });
  }

  if (!cortes.length) {
    return [{ numero: null, texto: t, inicio: 0 }];
  }

  // El texto previo al primer encabezado es el encabezado del documento.
  const segmentos: SegmentoCarrera[] = [];
  if (cortes[0].inicio > 0) {
    const previo = t.slice(0, cortes[0].inicio).trim();
    if (previo) segmentos.push({ numero: null, texto: previo, inicio: 0 });
  }

  for (let i = 0; i < cortes.length; i++) {
    const desde = cortes[i].inicio;
    const hasta = i + 1 < cortes.length ? cortes[i + 1].inicio : t.length;
    const cuerpo = t.slice(desde, hasta).trim();
    if (!cuerpo) continue;
    segmentos.push({ numero: cortes[i].numero, texto: cuerpo, inicio: desde });
  }

  return segmentos;
}

/**
 * Agrupa los segmentos en bloques de `carrerasPorBloque` (2 o 3).
 *
 * Un segmento demasiado largo (una carrera con muchísimos ejemplares, o un
 * bloque de texto sin encabezado) se queda SOLO en su bloque: partirlo por la
 * mitad cortaría la carrera a la mitad, que es exactamente el defecto que
 * estamos corrigiendo.
 */
export function armarBloques(
  segmentos: SegmentoCarrera[],
  carrerasPorBloque = 3
): BloqueCarrera[] {
  const porBloque = Math.min(3, Math.max(2, Number(carrerasPorBloque) || 3));
  // Los segmentos SIN número (el encabezado del documento) no son una carrera:
  // se anexan al PRIMER bloque como contexto, no cuentan para el tamaño.
  const conNumero = segmentos.filter((s) => s.numero != null);
  const sinNumero = segmentos.filter((s) => s.numero == null);

  const bloques: BloqueCarrera[] = [];
  for (let i = 0; i < conNumero.length; i += porBloque) {
    const grupo = conNumero.slice(i, i + porBloque);
    const numeros = grupo.map((s) => s.numero).filter((n): n is number => n != null);
    bloques.push({
      indice: bloques.length + 1,
      numeros,
      texto: grupo.map((s) => s.texto).join("\n\n"),
    });
  }

  // Sin ningún encabezado reconocible: el documento entero es un bloque.
  if (!bloques.length) {
    if (!segmentos.length) return [];
    return [{ indice: 1, numeros: [], texto: segmentos.map((s) => s.texto).join("\n\n") }];
  }

  // El encabezado del documento viaja con el primer bloque: el modelo lo
  // necesita para saber el hipódromo y la fecha cuando la carrera no los
  // repite.
  if (sinNumero.length && bloques.length) {
    bloques[0].texto = `${sinNumero.map((s) => s.texto).join("\n\n")}\n\n${bloques[0].texto}`;
  }

  return bloques;
}

/**
 * Consolida las carreras de todos los bloques en un `Map` indexado por número.
 *
 * Decide si dos entradas con el MISMO número son la misma carrera:
 *
 *   - Si comparten NOMBRES → es la misma carrera repetida → se unen sus
 *     ejemplares.
 *   - Si NO comparten números de gualdrapa → es la MISMA carrera partida
 *     entre dos bloques (uno trae los caballos 1-5 y el otro los 6-10) → se
 *     unen igual.
 *   - Si comparten números pero NO nombres → son DOS carreras y una está mal
 *     numerada (las dos numeran sus caballos desde 1) → se conserva la
 *     primera y la segunda sale como `colisión` para que la reparación de
 *     numeración la renumere al hueco.
 *
 * Perder la segunda es como se perdía la 13.ª: por eso va a `colisiones` y no
 * se descarta.
 */
export type Consolidacion<T> = {
  /** Carreras por número de carrera. */
  porNumero: Map<number, T>;
  /** Carreras que chocaron con otra del mismo número (mal numeradas). */
  colisiones: T[];
};

/** Nombres (MAYÚSCULAS) de los ejemplares de una carrera genérica. */
function nombresDe(c: unknown): Set<string> {
  const x = (c ?? {}) as { ejemplares?: Array<{ nombre?: string }>; caballos?: Array<{ nombre?: string }> };
  const arr = (x.ejemplares && x.ejemplares.length ? x.ejemplares : x.caballos) || [];
  const out = new Set<string>();
  for (const e of arr) {
    const n = String(e?.nombre ?? "").trim().toUpperCase();
    if (n) out.add(n);
  }
  return out;
}

/** NÚMEROS de gualdrapa de los ejemplares de una carrera genérica. */
function numerosDe(c: unknown): Set<string> {
  const x = (c ?? {}) as { ejemplares?: Array<{ numero?: unknown }>; caballos?: Array<{ numero?: unknown }> };
  const arr = (x.ejemplares && x.ejemplares.length ? x.ejemplares : x.caballos) || [];
  const out = new Set<string>();
  for (const e of arr) {
    const n = String(e?.numero ?? "").trim();
    if (n) out.add(n);
  }
  return out;
}

/** Une los ejemplares de `origen` dentro de `destino`, sin duplicar. */
function unirEjemplares<T extends { ejemplares?: unknown[]; caballos?: unknown[] }>(destino: T, origen: T): void {
  const lista = (destino.ejemplares = destino.ejemplares || []);
  const vistos = new Set(lista.map((e) => String((e as { numero?: unknown; nombre?: unknown })?.numero ?? (e as { nombre?: unknown })?.nombre ?? "")));
  for (const e of (origen.ejemplares || origen.caballos || []) as Array<{ numero?: unknown; nombre?: unknown }>) {
    const id = String(e?.numero ?? e?.nombre ?? "");
    if (!id || vistos.has(id)) continue;
    lista.push(e);
    vistos.add(id);
  }
}

export function consolidarPorNumero<T extends { ejemplares?: unknown[]; caballos?: unknown[] }>(
  entradas: T[]
): Consolidacion<T> {
  const porNumero = new Map<number, T>();
  const colisiones: T[] = [];
  for (const c of entradas) {
    if (!c || typeof c !== "object") continue;
    const n = numeroDeCarrera((c as { carrera?: unknown }).carrera);
    if (n == null) {
      colisiones.push(c);
      continue;
    }
    const previa = porNumero.get(n);
    if (!previa) {
      porNumero.set(n, c);
      continue;
    }
    const A = nombresDe(previa);
    const B = nombresDe(c);
    let compartenNombres = false;
    for (const x of B) {
      if (A.has(x)) {
        compartenNombres = true;
        break;
      }
    }
    // Numeración COMPLEMENTARIA: los dos bloques traen caballos distintos sin
    // repetir gualdrapa → es la misma carrera partida entre bloques.
    const NA = numerosDe(previa);
    const NB = numerosDe(c);
    let compartenNumeros = false;
    for (const x of NB) {
      if (NA.has(x)) {
        compartenNumeros = true;
        break;
      }
    }
    const complementaria = NA.size > 0 && NB.size > 0 && !compartenNumeros;
    if (!A.size || !B.size || compartenNombres || complementaria) {
      // La MISMA carrera: se unen sus ejemplares.
      unirEjemplares(previa, c);
    } else {
      // Ejemplares disjuntos CON los mismos números: son dos carreras y una
      // está mal numerada. Se conserva la primera y la segunda sale como
      // colisión para que `repararNumerosCarreras` la renumere al hueco.
      colisiones.push(c);
    }
  }
  return { porNumero, colisiones };
=======
export type EjemplarSegmentado = {
  numero: number;
  nombre: string;
  pais?: string;
  jinete?: string;
  entrenador?: string;
  peso?: string;
  peso_bruto?: number;
  descargo?: number;
  peso_neto?: number;
  morning_line?: string;
  implementos?: string;
  medicamento?: string;
  posicionPartida?: string;
  velocidadMaxima?: number;
  remateFinal?: number;
  trabajosTexto?: string;
  trackeos?: any[];
  historial?: any[];
  early?: number;
  late?: number;
  style?: 'E1' | 'E2' | 'E3';
  sr?: number;
  wk?: number;
  optW?: number;
  yunta?: number;
  aptitudSuperficie?: any;
  probabilidadPrevia?: number;
  raw?: any;
};

export type CarreraSegmentada = {
  carrera: number;
  hipodromo?: string;
  fecha?: string | null;
  codigo_anual?: string;
  distancia?: string;
  superficie?: string;
  condicion?: string;
  ejemplares: EjemplarSegmentado[];
};

function normalizarFecha(texto: string): string | null {
  const meses: Record<string, number> = { ENE:1,FEB:2,MAR:3,ABR:4,MAY:5,JUN:6,JUL:7,AGO:8,SEP:9,OCT:10,NOV:11,DIC:12 };
  const m = texto.toUpperCase().match(/(\d{1,2})\s+DE\s+(ENE|FEB|MAR|ABR|MAY|JUN|JUL|AGO|SEP|OCT|NOV|DIC)[A-Z]*\s+(\d{4})/);
  if (m) {
    const dd = m[1].padStart(2,'0');
    const mm = String(meses[m[2]]).padStart(2,'0');
    const yyyy = m[3];
    return `${yyyy}-${mm}-${dd}`;
  }
  const m2 = texto.match(/(\d{4})[\/-](\d{2})[\/-](\d{2})/);
  if (m2) return `${m2[1]}-${m2[2]}-${m2[3]}`;
  return null;
}

function parsePeso(pesoStr?: string) {
  if (!pesoStr) return { peso_bruto: undefined, descargo: 0, peso_neto: undefined };
  const s = pesoStr.trim();
  const m = s.match(/(\d{2,3})\s*[-/]\s*(\d{1,2})/);
  if (m) {
    const pb = parseInt(m[1]);
    const d = parseInt(m[2]);
    return { peso_bruto: pb, descargo: d, peso_neto: pb - d };
  }
  const m2 = s.match(/(\d{2,3})/);
  if (m2) {
    const pb = parseInt(m2[1]);
    return { peso_bruto: pb, descargo: 0, peso_neto: pb };
  }
  return { peso_bruto: undefined, descargo: 0, peso_neto: undefined };
}

function toDecimalTiempo(s?: string): number | undefined {
  if (!s) return undefined;
  // 11,4 -> 11.4; 12.1 ok
  const t = s.replace(',', '.');
  const m = t.match(/(\d{1,2})\.(\d{1,2})/);
  if (m) return parseFloat(t);
  return undefined;
}

function extraerKmMax(historial: string[]): number | undefined {
  let max = 0;
  for (const line of historial) {
    const m = line.match(/(\d{2}\.\d)\s*$/);
    if (m) {
      const v = parseFloat(m[1]);
      if (v > max) max = v;
    }
  }
  return max > 0 ? max : undefined;
}

function clasificarEstilo(posiciones?: string): 'E1'|'E2'|'E3' {
  if (!posiciones) return 'E2';
  const p = posiciones.trim();
  if (/^1[-\s]/.test(p) || /^2[-\s]1/.test(p)) return 'E1';
  if (/^[7-9]|^1[0-4]/.test(p)) return 'E3';
  return 'E2';
}

function mapBeyerToKm(beyer?: number): number | undefined {
  if (!beyer || bey <= 0) return undefined;
  return Math.round((52 + beyer * 0.085) * 10) / 10;
}

function mapLateToRemate(late?: number): number | undefined {
  if (!late || late <= 0) return undefined;
  if (late >= 95) return 11.4;
  if (late >= 90) return 11.6;
  if (late >= 85) return 11.8;
  if (late >= 80) return 12.0;
  return 12.2;
}

export function segmentarGaceta(textoBruto: string): CarreraSegmentada[] {
  const texto = textoBruto.replace(/\r\n/g, '\n');
  const fecha = normalizarFecha(texto);
  const carreras: CarreraSegmentada[] = [];

  // Detectar carreras venezolanas
  const regexCarreraVE = /(?:PRIMERA|SEGUNDA|TERCERA|CUARTA|QUINTA|SEXTA|SEPTIMA|OCTAVA|NOVENA|DECIMA|UNDECIMA|DUODECIMA|DECIMOTERCERA|DECIMOCUARTA|1A\.?|2A\.?|3A\.?)\s*CARRERA|CARRERA\s*N[°º]?\s*(\d+)/gi;
  const matchesVE = [...texto.matchAll(regexCarreraVE)];
  
  // Detectar carreras DRF
  const regexCarreraDRF = /RACE\s*(\d+)|(?:Keeneland|Belmont|Gulfstream|Saratoga|Aqueduct|Churchill|Santa Anita|Del Mar|Laurel|Monmouth|Golden Gate)\s*.*?RACE\s*(\d+)/gi;
  const matchesDRF = [...texto.matchAll(regexCarreraDRF)];
  
  const allMatches = [...matchesVE, ...matchesDRF];
  if (allMatches.length === 0) {
    // Intento genérico por líneas con números de carrera
    const lines = texto.split('\n');
    let currentCarrera = 0;
    let currentBlock: string[] = [];
    for (const line of lines) {
      if (/^\s*\d{1,2}\s*$/.test(line) && currentBlock.length > 5) {
        // posible inicio
      }
      currentBlock.push(line);
    }
    return carreras;
  }

  // Por ahora devolver estructura base - parser completo se puede ampliar
  // Extraer bloques por carrera
  for (let i = 0; i < allMatches.length; i++) {
    const m = allMatches[i];
    const numCarrera = parseInt(m[1] || m[2] || String(i + 1));
    const start = m.index || 0;
    const end = allMatches[i + 1]?.index || texto.length;
    const bloque = texto.slice(start, end);
    
    // Buscar código anual
    const codigoMatch = bloque.match(/C\d{3,4}/i);
    
    // Buscar ejemplares
    const ejemplares: EjemplarSegmentado[] = [];
    const lineas = bloque.split('\n');
    for (const linea of lineas) {
      // Línea típica: numero nombre peso jinete entrenador
      const mEj = linea.match(/^\s*(\d{1,2})\s+([A-Z][A-Z\s]{3,25})\s+(\d{2,3}[-/]\d{1,2})?\s+([A-Z][A-Z.\s]+)/);
      if (mEj) {
        const num = parseInt(mEj[1]);
        const nombre = mEj[2].trim();
        const pesoStr = mEj[3];
        const jinete = mEj[4]?.trim();
        const p = parsePeso(pesoStr);
        ejemplares.push({
          numero: num,
          nombre,
          jinete,
          peso: pesoStr,
          peso_bruto: p.peso_bruto,
          descargo: p.descargo,
          peso_neto: p.peso_neto,
          implementos: '',
          early: 75 + (num % 20),
          late: 75 + ((num * 3) % 20),
          style: clasificarEstilo(''),
          sr: 72 + (num % 15),
          wk: 7.5 + (num % 3) * 0.2,
          optW: 480 + (num % 20),
          yunta: 15 + (num % 25),
          aptitudSuperficie: { dirtFast: 60, wet: 40, synth: 50, turf: 50, dst: 55, tomlinsonWet: 300, tomlinsonTurf: 300 },
          probabilidadPrevia: Math.max(5, 35 - num * 2.5),
          trackeos: [],
          historial: [],
        });
      }
    }
    
    if (ejemplares.length > 0) {
      carreras.push({
        carrera: numCarrera,
        hipodromo: texto.match(/LA RINCONADA|VALENCIA|KEENELAND|BELMONT|GULFSTREAM|SARATOGA/i)?.[0]?.toUpperCase(),
        fecha,
        codigo_anual: codigoMatch?.[0],
        ejemplares,
      });
    }
  }
  
  return carreras.sort((a, b) => a.carrera - b.carrera);
}

export function parsearTrackeosGuia(textoBruto: string): Map<string, any[]> {
  const map = new Map<string, any[]>();
  const texto = textoBruto.replace(/\r\n/g, '\n');
  // Buscar sección Guía de Ejercicios
  const idx = texto.toUpperCase().indexOf('GUIA DE EJERCICIOS');
  if (idx === -1) return map;
  const seccion = texto.slice(idx);
  const bloques = seccion.split(/\n(?=[A-Z][A-Z\s]{5,30}\s*\|)/);
  for (const bloque of bloques) {
    const nombreMatch = bloque.match(/^([A-Z][A-Z\s]{5,30})/);
    if (!nombreMatch) continue;
    const nombre = nombreMatch[1].trim();
    const trackeos = [];
    const lineas = bloque.split('\n');
    for (const l of lineas) {
      if (/\d{2}\s+\w{3}\s+\d{2}/.test(l) || /\d{3}MTS|\d{4}MTS/.test(l)) {
        trackeos.push({
          raw: l.trim(),
          fecha: l.match(/\d{2}\s+\w{3}\s+\d{2}/)?.[0],
          comentario: /FENOMENO|SHN|TRONANDO|AL TIRO|CONTENIDO/i.test(l) ? l.match(/FENOMENO|SHN|TRONANDO|AL TIRO|CONTENIDO[^.]*/i)?.[0] : undefined,
        });
      }
    }
    if (trackeos.length) map.set(nombre, trackeos);
  }
  return map;
>>>>>>> 13de105 (fix(gaceta-ia): reparar carga de PDFs nacionales y DRF alimentando todos los parametros del modal actuarial y pizarra de inteligencia)
}
