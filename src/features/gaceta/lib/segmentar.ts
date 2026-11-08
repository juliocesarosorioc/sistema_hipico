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
import { numeroDeCarrera, numeroDeValida } from "@/features/gaceta/lib/numeros";

/**
 * Catálogo Canónico de Códigos de Pista y Nombres de Hipódromos
 * Fuente de verdad por encima del nombre del archivo PDF.
 */
export const CATALOGO_TRACKS_GACETA: Record<string, string> = {
  CDX: "CHURCHILL DOWNS",
  CD: "CHURCHILL DOWNS",
  CTX: "CHARLES TOWN",
  CT: "CHARLES TOWN",
  DED: "DELTA DOWNS",
  EVD: "EVANGELINE DOWNS",
  FLX: "FINGER LAKES",
  FL: "FINGER LAKES",
  IND: "HORSESHOE INDIANAPOLIS",
  IG: "HORSESHOE INDIANAPOLIS",
  MNR: "MOUNTAINEER",
  MVR: "MAHONING VALLEY",
  PRX: "PARX RACING",
  PHA: "PARX RACING",
  AQU: "AQUEDUCT",
  BEL: "BELMONT PARK",
  BAQ: "BELMONT AT THE BIG A",
  SAR: "SARATOGA",
  GP: "GULFSTREAM PARK",
  TAM: "TAMPA BAY DOWNS",
  OP: "OAKLAWN PARK",
  KEE: "KEENELAND",
  DMR: "DEL MAR",
  SA: "SANTA ANITA",
  LRL: "LAUREL PARK",
  PIM: "PIMLICO",
  MTH: "MONMOUTH PARK",
  FG: "FAIR GROUNDS",
  HAW: "HAWTHORNE",
  PEN: "PENN NATIONAL",
  WO: "WOODBINE",
  TUP: "TURF PARADISE",
  TP: "TURFWAY PARK",
  LRC: "LOS ALAMITOS",
  ALB: "ALBUQUERQUE",
  SUN: "SUNLAND PARK",
  RP: "REMINGTON PARK",
  RUI: "RUIDOSO DOWNS",
  ZIA: "ZIA PARK",
  WRD: "WILL ROGERS DOWNS",
  ASD: "ASSINIBOIA DOWNS",
  CBY: "CANTERBURY PARK",
  ELP: "ELLIS PARK",
  KD: "KENTUCKY DOWNS",
  KDX: "KENTUCKY DOWNS",
  CNL: "COLONIAL DOWNS",
  PID: "PRESQUE ISLE DOWNS",
  RDM: "RED MILE",
  LRIN: "LA RINCONADA",
  VAL: "VALENCIA",
};

export const NOMBRES_HIPODROMOS_GACETA: Record<string, string> = {
  "CHURCHILL DOWNS": "CHURCHILL DOWNS",
  "HOLLYWOOD CASINO AT CHARLES TOWN": "CHARLES TOWN",
  "HOLLYWOOD AT CHARLES TOWN": "CHARLES TOWN",
  "CHARLES TOWN": "CHARLES TOWN",
  "DELTA DOWNS": "DELTA DOWNS",
  "EVANGELINE DOWNS": "EVANGELINE DOWNS",
  "FINGER LAKES": "FINGER LAKES",
  "HORSESHOE INDIANAPOLIS": "HORSESHOE INDIANAPOLIS",
  "INDIANA GRAND": "HORSESHOE INDIANAPOLIS",
  "MOUNTAINEER CASINO, RACES & RESORT": "MOUNTAINEER",
  "MOUNTAINEER": "MOUNTAINEER",
  "MAHONING VALLEY RACE COURSE": "MAHONING VALLEY",
  "MAHONING VALLEY": "MAHONING VALLEY",
  "PARX RACING": "PARX RACING",
  "PARX": "PARX RACING",
  "PHILADELPHIA PARK": "PARX RACING",
  "AQUEDUCT": "AQUEDUCT",
  "BELMONT PARK": "BELMONT PARK",
  "SARATOGA": "SARATOGA",
  "GULFSTREAM PARK": "GULFSTREAM PARK",
  "TAMPA BAY DOWNS": "TAMPA BAY DOWNS",
  "OAKLAWN PARK": "OAKLAWN PARK",
  "KEENELAND": "KEENELAND",
  "DEL MAR": "DEL MAR",
  "SANTA ANITA": "SANTA ANITA",
  "SANTA ANITA PARK": "SANTA ANITA",
  "LAUREL PARK": "LAUREL PARK",
  "PIMLICO": "PIMLICO",
  "MONMOUTH PARK": "MONMOUTH PARK",
  "FAIR GROUNDS": "FAIR GROUNDS",
  "HAWTHORNE": "HAWTHORNE",
  "PENN NATIONAL": "PENN NATIONAL",
  "WOODBINE": "WOODBINE",
  "TURF PARADISE": "TURF PARADISE",
  "TURFWAY PARK": "TURFWAY PARK",
  "LOS ALAMITOS": "LOS ALAMITOS",
  "ALBUQUERQUE": "ALBUQUERQUE",
  "SUNLAND PARK": "SUNLAND PARK",
  "REMINGTON PARK": "REMINGTON PARK",
  "RUIDOSO DOWNS": "RUIDOSO DOWNS",
  "ZIA PARK": "ZIA PARK",
  "WILL ROGERS DOWNS": "WILL ROGERS DOWNS",
  "ASSINIBOIA DOWNS": "ASSINIBOIA DOWNS",
  "CANTERBURY PARK": "CANTERBURY PARK",
  "ELLIS PARK": "ELLIS PARK",
  "KENTUCKY DOWNS": "KENTUCKY DOWNS",
  "COLONIAL DOWNS": "COLONIAL DOWNS",
  "PRESQUE ISLE DOWNS": "PRESQUE ISLE DOWNS",
  "LA RINCONADA": "LA RINCONADA",
  "HIPODROMO LA RINCONADA": "LA RINCONADA",
  "VALENCIA": "VALENCIA",
  "HIPODROMO DE VALENCIA": "VALENCIA",
};

/** Meses en inglés a 2 dígitos */
const MESES_MAP: Record<string, string> = {
  JAN: "01", JANUARY: "01",
  FEB: "02", FEBRUARY: "02",
  MAR: "03", MARCH: "03",
  APR: "04", APRIL: "04",
  MAY: "05",
  JUN: "06", JUNE: "06",
  JUL: "07", JULY: "07",
  AUG: "08", AUGUST: "08",
  SEP: "09", SEPTEMBER: "09",
  OCT: "10", OCTOBER: "10",
  NOV: "11", NOVEMBER: "11",
  DEC: "12", DECEMBER: "12",
  ENE: "01", ENERO: "01",
  ABR: "04", ABRIL: "04",
  AGO: "08", AGOSTO: "08",
  DIC: "12", DICIEMBRE: "12",
};

/** Convierte distancia en texto americano a metros */
export function convertirDistanciaAMetros(distStr: string): number {
  const d = String(distStr ?? "").trim().toUpperCase();
  if (!d) return 1200;

  // Si ya es un número directo en metros o yardas de Quarter Horse
  const soloNum = parseInt(d.replace(/[^0-9]/g, ""), 10);
  if (d.includes("YDS") || d.includes("Y") || d.includes("YD")) {
    if (soloNum === 220) return 200;
    if (soloNum === 250) return 228;
    if (soloNum === 300) return 272;
    if (soloNum === 330) return 300;
    if (soloNum === 350) return 318;
    if (soloNum === 400) return 364;
    if (soloNum === 440) return 400;
    if (soloNum === 550) return 500;
    if (soloNum > 100 && soloNum < 900) return Math.round(soloNum * 0.9144);
  }

  // Quarter Horse direct metros
  if ([200, 228, 272, 300, 318, 364, 400, 500].includes(soloNum)) {
    return soloNum;
  }

  // Furlongs
  if (d.includes("F") || d.includes("FUR")) {
    if (d.includes("4 1/2") || d.includes("4.5")) return 900;
    if (d.includes("5 1/2") || d.includes("5.5")) return 1100;
    if (d.includes("6 1/2") || d.includes("6.5")) return 1300;
    if (d.includes("7 1/2") || d.includes("7.5")) return 1500;
    if (d.includes("8 1/2") || d.includes("8.5")) return 1700;
    if (d.includes("5")) return 1000;
    if (d.includes("6")) return 1200;
    if (d.includes("7")) return 1400;
    if (d.includes("8")) return 1600;
    if (d.includes("9")) return 1800;
  }

  // Miles
  if (d.includes("1M") || d.includes("1 M") || d.includes("MILE")) {
    if (d.includes("70") || d.includes("70 Y")) return 1670;
    if (d.includes("1/16") || d.includes("1 1/16")) return 1700;
    if (d.includes("1/8") || d.includes("1 1/8")) return 1800;
    if (d.includes("3/16") || d.includes("1 3/16")) return 1900;
    if (d.includes("1/4") || d.includes("1 1/4")) return 2000;
    if (d.includes("1/2") || d.includes("1 1/2")) return 2400;
    return 1600;
  }

  if (soloNum >= 800 && soloNum <= 3200) {
    return soloNum;
  }

  return 1200;
}

/** Estructura de salida del Parser Determinístico */
export type CarreraParseadaNativa = {
  carrera: number;
  hipodromo: string;
  fecha: string;
  hora: string | null;
  distancia: number;
  superficie: "Arena" | "Grama";
  premio?: number;
  ejemplares: Array<{
    numero: string;
    nombre: string;
    pp?: number | string;
    jinete?: string;
    entrenador?: string;
    peso?: number | string;
    ml?: string;
    stud?: string;
    pedigri?: string;
    retirado?: boolean;
    condicionElegibilidad?: "AE" | "MTO" | null;
  }>;
};

/**
 * Parsea una fecha en texto de cabecera como:
 * - "04Nov26" / "04-Nov-2026" / "NOVEMBER 4, 2026" / "11/04/2026" / "2026-11-04"
 */
export function extraerFechaCabecera(texto: string): string | null {
  if (!texto) return null;

  // Formato ISO directo: 2026-11-04
  const mIso = texto.match(/\b(20\d{2})[-/](0[1-9]|1[0-2])[-/](0[1-9]|[12]\d|3[01])\b/);
  if (mIso) return `${mIso[1]}-${mIso[2]}-${mIso[3]}`;

  // Formato compacto de gacetas USA: 04Nov26 o 04Nov2026
  const mCompacto = texto.match(/\b(0[1-9]|[12]\d|3[01])([A-Za-z]{3})(20\d{2}|\d{2})\b/);
  if (mCompacto) {
    const dia = mCompacto[1];
    const mesStr = mCompacto[2].toUpperCase();
    let anio = mCompacto[3];
    if (anio.length === 2) anio = `20${anio}`;
    const mesNum = MESES_MAP[mesStr];
    if (mesNum) return `${anio}-${mesNum}-${dia}`;
  }

  // Formato tipo "NOVEMBER 4, 2026" o "NOV 4 2026"
  const mIngles = texto.match(/\b(JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER|JAN|FEB|MAR|APR|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[,\s]+(0?[1-9]|[12]\d|3[01])[,\s]+(20\d{2})\b/i);
  if (mIngles) {
    const mesNum = MESES_MAP[mIngles[1].toUpperCase()];
    const dia = mIngles[2].padStart(2, "0");
    const anio = mIngles[3];
    if (mesNum) return `${anio}-${mesNum}-${dia}`;
  }

  // Formato tipo "04/11/2026" o "11/04/2026"
  const mSlashes = texto.match(/\b(0?[1-9]|1[0-2])\/(0?[1-9]|[12]\d|3[01])\/(20\d{2})\b/);
  if (mSlashes) {
    return `${mSlashes[3]}-${mSlashes[1].padStart(2, "0")}-${mSlashes[2].padStart(2, "0")}`;
  }

  return null;
}

/**
 * Verifica si un texto tiene la estructura inconfundible de un Jockey o Entrenador
 * (iniciales con punto, sufijos personales como Jr., etc.), para NUNCA colocarlo como nombre de caballo.
 */
export function esNombreJockeyPersona(str: string | null | undefined): boolean {
  if (!str) return false;
  const s = String(str).trim();
  if (s.length < 2) return true;

  // 1. Inicial con punto seguida de apellido o de otra inicial:
  // "I. Ortiz", "I. Ortiz, Jr.", "J. Rosario", "F. Prat", "B. H. Cox", "J.L. Ortiz", "J. R. Velazquez", "R. Capriles"
  if (/^[A-Z]\.\s*[A-Z]/i.test(s)) return true;
  if (/^[A-Z]\.\s*[A-Z]\.\s*[A-Z]/i.test(s)) return true;

  // 2. Iniciales sin punto: "J L Ortiz", "I Ortiz Jr", "J R Velazquez"
  if (/^[A-Z]\s+[A-Z]\s+[A-ZÁÉÍÓÚÑa-záéíóúñ]{3,}/i.test(s)) return true;
  if (/^[A-Z]\s+[A-ZÁÉÍÓÚÑa-záéíóúñ]{3,}\s*(?:Jr|Sr|III|II)\.?$/i.test(s)) return true;

  // 3. Sufijos personales típicos de jockeys/entrenadores
  if (/,\s*Jr\.?$/i.test(s) || /\b(?:Jr|Sr|III|II)\.?$/i.test(s)) return true;

  // 4. Paréntesis con estadísticas de jockeys en Venezuela (ej. "R.Capriles(35)", "L.Funez.Jr.(20)")
  if (/\(\d{1,3}\)$/.test(s)) return true;

  // 5. Palabras clave de rol hípico
  if (/^(?:JOCKEY|TRAINER|OWNER|SIRE|DAM|TR:|JK:|TRAIN:|JOCK:|JIN:|PREP:)[\s:]/i.test(s)) return true;

  // 6. Lista de jockeys y entrenadores hipercomunes de USA y VE si aparecen aislados
  const CONOCIDOS = /^(?:ORTIZ|ROSARIO|PRAT|SAEZ|GAFFALIONE|VELAZQUEZ|CASTELLANO|CARMOUCHE|BAFFERT|PLETCHER|BROWN|COX|ASMUSSEN|MOTT|DIODORO|CAPRILES|LUGO|RODRIGUEZ|HERNANDEZ|LOPEZ|FRANCO|CANCEL|ALVARADO|BERRIOS|RISPOLI|FRESU|BRAVO|LANERIE|LEZCANO|VARGAS|GONZALEZ|CENTENO|SANCHEZ|DE LA CRUZ|ARRIETA|MACHADO|JARAMILLO|MEDINA|CHAVEZ|GUTIERREZ|CASTILLO|MENA|ESPINOZA|DESORMEAUX|GEROUX|BRIDGMOHAN|BEJARANO|BAEZ|BARBOSA|TOLEDO|CONCEPCION|TORREALBA|QUEVEDO|MELEAN|BRICEÑO|SARMIENTO|FUENTES|JIMENEZ|CALDERON|MORALES|PEREZ|RAMIREZ|REYES|SUAREZ)$/i;
  if (CONOCIDOS.test(s)) return true;

  return false;
}

export function resolverHipodromoTexto(texto: string, trackCodeDetectado?: string | null): string {
  if (trackCodeDetectado) {
    const cod = trackCodeDetectado.toUpperCase().trim();
    if (CATALOGO_TRACKS_GACETA[cod]) {
      return CATALOGO_TRACKS_GACETA[cod];
    }
  }

  const upper = texto.toUpperCase();
  for (const [nombre, canonico] of Object.entries(NOMBRES_HIPODROMOS_GACETA)) {
    if (upper.includes(nombre)) {
      return canonico;
    }
  }

  // Búsqueda de códigos aislados en líneas de encabezado
  for (const [cod, canonico] of Object.entries(CATALOGO_TRACKS_GACETA)) {
    const reCod = new RegExp(`\\b${cod}\\b`, "i");
    if (reCod.test(upper.slice(0, 800))) {
      return canonico;
    }
  }

  return "USA";
}

/**
 * PARSER DETERMINÍSTICO NATIVO:
 * Extrae carreras de páginas de gacetas (Daily Racing Form / Retrospectos / Equibase).
 * Funciona de manera no bloqueante, instantánea y sin consumir cuota de IA.
 */
export function parsearPaginaRetrospectosNativo(
  textoPagina: string,
  opciones?: { fechaOverride?: string; hipodromoOverride?: string }
): CarreraParseadaNativa | null {
  if (!textoPagina || textoPagina.trim().length < 50) return null;

  const lineas = textoPagina.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const textoCompleto = lineas.join("\n");

  // 1. Línea maestra de validación:
  // Purse <MONTO> <CODIGO>ENTRIES <NUM_CARRERA>(ST|ND|RD|TH) <TRACK_CODE> <MES> <DIA> <DISTANCIA>
  // ej: "Purse $25,000 DRENTRIES 1ST CDX NOVEMBER 4 6F"
  // ej: "DCENTRIES 2ND CTX"
  // ej: "DMENTRIES 1ST DED"
  // ej: "DMENTRIES 1ST EVD"
  // ej: "DAENTRIES 1ST FLX"
  // ej: "DCENTRIES 1ST IND"
  // ej: "TCENTRIES 1ST MNR"
  // ej: "DCENTRIES 1ST MVR"
  // ej: "DCENTRIES 1ST PRX"
  const reLineaMaestra = /(?:PURSE\s*[\$]?\s*([0-9,.]+)\s*)?([A-Z0-9]+ENTRIES|[A-Z]{2,4}\s*ENTRIES)?\s*(\d{1,2})\s*(?:ST|ND|RD|TH)\s+([A-Z]{2,4})\b/i;
  const matchMaestra = textoCompleto.match(reLineaMaestra);

  // Alternativa de encabezado clásico: "RACE 1", "1ST RACE", "CARRERA 1"
  let numCarrera: number | null = null;
  let trackCode: string | null = null;
  let purseMonto: number | undefined = undefined;

  if (matchMaestra) {
    if (matchMaestra[1]) {
      purseMonto = parseFloat(matchMaestra[1].replace(/,/g, ""));
    }
    numCarrera = parseInt(matchMaestra[3], 10);
    trackCode = matchMaestra[4].toUpperCase();
  } else {
    // Buscar "RACE <N>" o "<N>ST RACE"
    const mRace = textoCompleto.match(/\b(?:RACE|CARRERA)\s*#?\s*(\d{1,2})\b/i) ||
                  textoCompleto.match(/\b(\d{1,2})\s*(?:ST|ND|RD|TH)\s+(?:RACE|CARRERA)\b/i);
    if (mRace) {
      numCarrera = parseInt(mRace[1], 10);
    }
  }

  if (!numCarrera || isNaN(numCarrera) || numCarrera <= 0) {
    return null;
  }

  // 2. Hipódromo
  const hipodromo = opciones?.hipodromoOverride?.trim() ||
    resolverHipodromoTexto(textoCompleto, trackCode);

  // 3. Fecha
  let fecha = opciones?.fechaOverride?.trim() || null;
  if (!fecha) {
    fecha = extraerFechaCabecera(textoCompleto);
  }
  if (!fecha) {
    // Si no viene en la cabecera, usar fecha de hoy en formato ISO
    const hoy = new Date();
    fecha = hoy.toISOString().split("T")[0];
  }

  // 4. Distancia
  let distancia = 1200;
  const mDist = textoCompleto.match(/\b(\d+(?:\s*(?:1\/2|1\/4|3\/4|1\/16|1\/8|3\/16))?\s*(?:F|FUR|FURLONGS|M|MILE|MILES|YDS|YARDS))\b/i) ||
                textoCompleto.match(/\b(\d{3,4})\s*(?:METROS|METERS|M)\b/i);
  if (mDist) {
    distancia = convertirDistanciaAMetros(mDist[1]);
  }

  // 5. Superficie
  let superficie: "Arena" | "Grama" = "Arena";
  if (/\b(?:TURF|GRAMA|INNER TURF|GRASS)\b/i.test(textoCompleto)) {
    superficie = "Grama";
  }

  // 6. Hora de partida
  let hora: string | null = null;
  const mHora = textoCompleto.match(/(?:POST\s*TIME|POST|HORA|PARTIDA)[:\s]*(\d{1,2}:\d{2}\s*(?:AM|PM|A\.M\.|P\.M\.)?)/i) ||
                textoCompleto.match(/\b(\d{1,2}:\d{2}\s*(?:AM|PM|A\.M\.|P\.M\.))\b/i);
  if (mHora) {
    hora = mHora[1].trim();
  }

  // 7. Extracción de Ejemplares (incluyendo AE y MTO)
  const ejemplares: CarreraParseadaNativa["ejemplares"] = [];
  const nombresVistos = new Set<string>();

  // Patrón de ejemplar típico de gacetas americanas:
  // Ej: "1  Flightline (L)  I. Ortiz, Jr.  122  B. Baffert  3-1"
  // Ej: "1A Also Eligible Horse (L) (AE)  54,4  9-5"
  // Ej: "2  Horse Name  Jockey Name  54.4  Trainer  5-2"
  // O líneas con número de gualdrapa al inicio:
  const reEjemplarLinea = /^(\d{1,2}[A-Za-z]?)\s+([A-Z0-9\s'.\-]{3,35}?)(?:\s*\((?:L|FTG|L1|L[0-9]+)\))?(?:\s*\((AE|MTO)\))?(?:\s+([A-Z][a-zA-Z'.\-]+(?:\s+[A-Z][a-zA-Z'.\-]+){1,3}))?\s+(\d{2,3}(?:[.,]\d)?|\d{2,3})\s+(?:.*?\s+)?(\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}|EVEN|[0-9]+(?:\.[0-9]+)?-?[0-9]*)?$/im;

  for (let i = 0; i < lineas.length; i++) {
    const l = lineas[i];

    // Ignorar líneas que sean cabeceras o estadísticas
    if (/^(?:PURSE|RACE|CARRERA|DAILY|EQUICLOUD|COPYRIGHT|PAGE|TABLA|TRACK|POST|WPS|EXACTA|TRIFECTA|SUPERFECTA)/i.test(l)) {
      continue;
    }

    const m = l.match(reEjemplarLinea);
    if (m) {
      const numProg = m[1].trim();
      let nombre = m[2].trim().replace(/\s*\((?:L|AE|MTO)\)/gi, "").trim();
      const condicion = (m[3]?.toUpperCase() as "AE" | "MTO") ||
                        (l.includes("(AE)") ? "AE" : l.includes("(MTO)") ? "MTO" : null);
      let jockey = m[4]?.trim();
      let pesoStr = m[5]?.trim()?.replace(",", ".");
      let pesoNum: number | string | undefined = pesoStr ? parseFloat(pesoStr) : undefined;
      if (typeof pesoNum === "number" && isNaN(pesoNum)) pesoNum = undefined;

      const ml = m[6]?.trim();

      // Buscar Entrenador en la línea
      let entrenador: string | undefined = undefined;
      const mTrainer = l.match(/(?:1[1-2][0-9]|5[0-9][.,][0-9]|5[0-9])\s+([A-Z][a-zA-Z'.\-]+(?:\s+[A-Z][a-zA-Z'.\-]+){1,2})/);
      if (mTrainer && mTrainer[1] && esNombreJockeyPersona(mTrainer[1])) {
        entrenador = mTrainer[1].trim();
      }

      // PROTECCIÓN CRÍTICA: Si el nombre capturado es en realidad un Jockey (ej: "I. Ortiz, Jr." o "J. Rosario")
      if (esNombreJockeyPersona(nombre)) {
        if (jockey && !esNombreJockeyPersona(jockey)) {
          // El orden en la línea venía invertido (Jockey primero, Caballo después)
          const temp = nombre;
          nombre = jockey;
          jockey = temp;
        } else {
          // Descartar falso positivo de jockey como nombre de caballo
          nombre = "";
        }
      }

      const nombreKey = nombre.toUpperCase();
      if (
        nombreKey.length >= 2 &&
        !esNombreJockeyPersona(nombre) &&
        !nombresVistos.has(nombreKey) &&
        !/^(?:PURSE|RACE|TRACK|POST|EXACTA|TRIFECTA|SUPERFECTA)/.test(nombreKey)
      ) {
        nombresVistos.add(nombreKey);
        ejemplares.push({
          numero: numProg,
          nombre,
          pp: parseInt(numProg.replace(/[^0-9]/g, ""), 10) || undefined,
          jinete: jockey || undefined,
          entrenador: entrenador || undefined,
          peso: pesoNum,
          ml: ml || undefined,
          retirado: false,
          condicionElegibilidad: condicion,
        });
      }
    }
  }

  // Si el regex estricto por línea capturó pocos caballos, usamos un analizador de bloques
  if (ejemplares.length < 2) {
    // Buscar bloques del estilo:
    // "1 <NOMBRE>" seguido en la siguiente línea o dentro de 4 líneas de jockey / peso / trainer
    const reNumCaballo = /^(?:#?\s*)?(\d{1,2}[A-Za-z]?)\s+([A-Z][A-Z0-9\s'.\-]{2,30})/gm;
    let mBlock: RegExpExecArray | null;
    while ((mBlock = reNumCaballo.exec(textoCompleto)) !== null) {
      const numProg = mBlock[1].trim();
      const nombre = mBlock[2].trim();
      const nombreKey = nombre.toUpperCase();

      // Descartar falsos positivos comunes y jockeys con iniciales
      if (
        /^(?:PURSE|RACE|CARRERA|FURLONG|CLAIMING|MAIDEN|ALLOWANCE|STAKES|POST|TRACK|COPYRIGHT|PAGE|DAILY)/i.test(nombreKey) ||
        nombreKey.length < 2 ||
        esNombreJockeyPersona(nombre) ||
        nombresVistos.has(nombreKey)
      ) {
        continue;
      }

      // Buscar ML, peso, jockey y entrenador en las cercanías
      const contexto = textoCompleto.slice(mBlock.index, mBlock.index + 250);
      const mML = contexto.match(/\b(\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}|9-5|5-2|3-1|8-1|10-1|12-1|15-1|20-1)\b/);
      const mPeso = contexto.match(/\b(1[1-2][0-9]|5[0-9][.,][0-9]|5[0-9])\b/);
      const condicion = contexto.includes("(AE)") ? "AE" : contexto.includes("(MTO)") ? "MTO" : null;

      let jockeyBlock: string | undefined;
      let trainerBlock: string | undefined;
      const personas = contexto.match(/\b[A-Z]\.\s*[A-Z][a-zA-Z'.\-]+(?:\s+[A-Z][a-zA-Z'.\-]+)?/g);
      if (personas && personas.length > 0) {
        jockeyBlock = personas[0].trim();
        if (personas.length > 1) {
          trainerBlock = personas[1].trim();
        }
      }

      nombresVistos.add(nombreKey);
      ejemplares.push({
        numero: numProg,
        nombre,
        pp: parseInt(numProg.replace(/[^0-9]/g, ""), 10) || undefined,
        jinete: jockeyBlock || undefined,
        entrenador: trainerBlock || undefined,
        peso: mPeso ? parseFloat(mPeso[1].replace(",", ".")) : undefined,
        ml: mML ? mML[1] : undefined,
        retirado: false,
        condicionElegibilidad: condicion,
      });
    }
  }

  // Si no se extrajeron al menos 2 ejemplares limpios o si se coló algún jockey como nombre de caballo,
  // devolver null para delegar la página al LLM Gemini con el prompt fuerte.
  if (ejemplares.length < 2 || ejemplares.some((e) => esNombreJockeyPersona(e.nombre))) {
    return null;
  }

  return {
    carrera: numCarrera,
    hipodromo,
    fecha,
    hora,
    distancia,
    superficie,
    premio: purseMonto,
    ejemplares,
  };
}

/**
 * Procesa un lote de texto por páginas de gaceta con el motor determinístico nativo.
 * Retorna las carreras detectadas y los índices de páginas que necesitan fallback IA.
 */
export function parsearGacetaRetrospectosNativo(
  paginasTexto: string[],
  opciones?: { fechaOverride?: string; hipodromoOverride?: string }
): {
  carreras: CarreraParseadaNativa[];
  paginasParaFallback: Array<{ indicePagina: number; texto: string }>;
} {
  const carreras: CarreraParseadaNativa[] = [];
  const paginasParaFallback: Array<{ indicePagina: number; texto: string }> = [];

  for (let idx = 0; idx < paginasTexto.length; idx++) {
    const textoPagina = paginasTexto[idx];
    const carrera = parsearPaginaRetrospectosNativo(textoPagina, opciones);
    if (carrera && carrera.ejemplares.length >= 2) {
      carreras.push(carrera);
    } else {
      // Si la página tiene contenido significativo y no se pudo parsear determinísticamente
      if (textoPagina && textoPagina.trim().length > 150) {
        paginasParaFallback.push({ indicePagina: idx + 1, texto: textoPagina });
      }
    }
  }

  return { carreras, paginasParaFallback };
}


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
  /^[ \t]*(?:(?:[^\n\r]{0,95}?(?:[-·|:–—/][ \t]*|\b))?(?:(?:(?:\bRACE\b|\bCARRERA\b|\bCARR?\b\.|\bCAR\b)[ \t]*(?:N[º°.]?[ \t]*)?#?[ \t]*([A-Za-z0-9ÁÉÍÓÚÑáéíóúñ]{1,16})\b)|(?:([A-Za-z0-9ÁÉÍÓÚÑáéíóúñºª.]{1,24})[ \t]+(?:\bCARRERA\b|\bCARR?\b\.|\bCAR\b|\bRACE\b)\b)|(?:([0-9]{1,2}(?:[ª°aA]|ra|da|ta|ma|era)?\.?|PRIMERA|SEGUNDA|TERCERA|CUARTA|QUINTA|SEXTA|[1-6]ª?|[1-6]a?|[1-6]ra?)[ \t]+(?:V[AÁ]LIDA|VALIDA)\b)))/gim;

/** Tope de caracteres de un encabezado: suficiente para líneas con hipódromo/hora/distancia. */
const MAX_ENCABEZADO = 240;

/** Tope seguro de caracteres por bloque enviado al LLM para evitar truncamiento o cuelgues. */
const MAX_CHARS_POR_BLOQUE = 9000;
const CHUNK_CHARS_FALLBACK = 6500;

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

    const linea = t.slice(m.index, finLinea === -1 ? t.length : finLinea).trim();
    // En La Rinconada, la línea 1 puede decir "1ª VÁLIDA PARA EL 5 Y 6" y la siguiente "5ª CARRERA - DISTANCIA 1.200 M".
    // Inspeccionamos las primeras 3 líneas del bloque de encabezado (hasta 280 caracteres).
    const bloqueCabecera = t
      .slice(m.index, Math.min(t.length, m.index + 280))
      .split("\n")
      .slice(0, 3)
      .join(" ");

    // Prioriza el número de carrera general que aparezca en la línea completa o bloque de cabecera
    let numero = numeroDeCarrera(linea);
    if (numero == null) {
      numero = numeroDeCarrera(bloqueCabecera);
    }
    if (numero == null) {
      const token = m[1] ?? m[2] ?? "";
      numero = numeroDeCarrera(token);
    }
    // Si la línea es una Válida del 5 y 6 (ej. 1ª Válida) y no trajo número general explícito:
    if (numero == null) {
      const numVal =
        numeroDeValida(linea) ??
        numeroDeValida(bloqueCabecera) ??
        numeroDeValida(m[3] ? `${m[3]} valida` : "");
      if (numVal != null) {
        // En Venezuela (La Rinconada / Valencia), continúa la secuencia correlativa:
        const ultCorteConNum = cortes.slice().reverse().find((c) => c.numero != null);
        if (ultCorteConNum?.numero != null) {
          numero = ultCorteConNum.numero + 1;
        } else {
          // Si no hay carreras previas identificadas, la 1ª Válida se correlaciona con la base típica (4 no válidas):
          numero = 4 + numVal;
        }
      }
    }

    // Si ya había un corte previo muy cercano (< 180 caracteres) sin datos de caballos,
    // significa que es una cabecera que se extiende en dos líneas consecutivas
    // (ej: "1ª VÁLIDA PARA EL 5 Y 6\n5ª CARRERA - DISTANCIA 1.200 METROS").
    // En ese caso, NO se crea una carrera nueva; se actualiza el número de la cabecera actual si aplica.
    if (cortes.length > 0) {
      const ultCorte = cortes[cortes.length - 1];
      const distanciaPrevio = m.index - ultCorte.inicio;
      const textoIntermedio = t.slice(ultCorte.inicio, m.index).trim();
      if (
        distanciaPrevio < 180 &&
        !/\b(?:kg|kgs|jinete|jockey|divisa|stud|pp|\d{3,4}\s*m)\b/i.test(textoIntermedio) &&
        !/^[ \t]*\d{1,2}\s+[A-ZÁÉÍÓÚÑ]/m.test(textoIntermedio)
      ) {
        if (numero != null) {
          ultCorte.numero = numero;
        }
        continue;
      }
    }

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
 * Agrupa los segmentos en bloques de `carrerasPorBloque` (1, 2 o 3).
 *
 * Un segmento demasiado largo (una carrera con muchísimos ejemplares, o un
 * bloque de texto sin encabezado) se queda SOLO en su bloque: partirlo por la
 * mitad cortaría la carrera a la mitad, que es exactamente el defecto que
 * estamos corrigiendo.
 */
function partirTextoLargo(texto: string, maxChunk = CHUNK_CHARS_FALLBACK): string[] {
  const limpio = String(texto ?? "").trim();
  if (limpio.length <= MAX_CHARS_POR_BLOQUE) return [limpio];

  const partes: string[] = [];
  let cursor = 0;
  while (cursor < limpio.length) {
    let fin = Math.min(cursor + maxChunk, limpio.length);
    if (fin < limpio.length) {
      const saltoLinea = limpio.lastIndexOf("\n", fin);
      const espacio = limpio.lastIndexOf(" ", fin);
      if (saltoLinea > cursor + Math.floor(maxChunk * 0.5)) {
        fin = saltoLinea;
      } else if (espacio > cursor + Math.floor(maxChunk * 0.5)) {
        fin = espacio;
      }
    }
    const trozo = limpio.slice(cursor, fin).trim();
    if (trozo) partes.push(trozo);
    cursor = fin;
  }
  return partes.length ? partes : [limpio];
}

export function armarBloques(
  segmentos: SegmentoCarrera[],
  carrerasPorBloque = 3
): BloqueCarrera[] {
  const porBloque = Math.min(3, Math.max(1, Number(carrerasPorBloque) || 2));
  // Los segmentos SIN número (el encabezado del documento) no son una carrera:
  // se anexan al PRIMER bloque como contexto, no cuentan para el tamaño.
  const conNumero = segmentos.filter((s) => s.numero != null);
  const sinNumero = segmentos.filter((s) => s.numero == null);

  const bloques: BloqueCarrera[] = [];
  let grupoActual: SegmentoCarrera[] = [];
  let largoActual = 0;

  const cerrarGrupo = () => {
    if (!grupoActual.length) return;
    const numeros = grupoActual.map((s) => s.numero).filter((n): n is number => n != null);
    const textoGrupo = grupoActual.map((s) => s.texto).join("\n\n");
    if (textoGrupo.length > MAX_CHARS_POR_BLOQUE && grupoActual.length === 1) {
      const subPartes = partirTextoLargo(textoGrupo);
      for (const sp of subPartes) {
        bloques.push({
          indice: bloques.length + 1,
          numeros,
          texto: sp,
        });
      }
    } else {
      bloques.push({
        indice: bloques.length + 1,
        numeros,
        texto: textoGrupo,
      });
    }
    grupoActual = [];
    largoActual = 0;
  };

  for (const seg of conNumero) {
    const largoSeg = seg.texto.length;
    if (
      grupoActual.length >= porBloque ||
      (grupoActual.length > 0 && largoActual + largoSeg > MAX_CHARS_POR_BLOQUE)
    ) {
      cerrarGrupo();
    }
    grupoActual.push(seg);
    largoActual += largoSeg;
  }
  cerrarGrupo();

  // Sin ningún encabezado reconocible: partir el documento en bloques seguros
  // en lugar de enviarlo entero en una sola llamada que se trunca o se cuelga.
  if (!bloques.length) {
    if (!segmentos.length) return [];
    const textoCompleto = segmentos.map((s) => s.texto).join("\n\n");
    const trozos = partirTextoLargo(textoCompleto);
    return trozos.map((t, idx) => ({
      indice: idx + 1,
      numeros: [],
      texto: t,
    }));
  }

  if (sinNumero.length && bloques.length) {
    const textoEncabezadoCompleto = sinNumero.map((s) => s.texto).join("\n\n");
    if (textoEncabezadoCompleto.length <= MAX_CHARS_POR_BLOQUE) {
      bloques[0].texto = `${textoEncabezadoCompleto}\n\n${bloques[0].texto}`;
    } else {
      const trozosEnc = partirTextoLargo(textoEncabezadoCompleto);
      const bloquesEnc: BloqueCarrera[] = trozosEnc.map((t, i) => ({
        indice: i + 1,
        numeros: [],
        texto: t,
      }));
      return [...bloquesEnc, ...bloques].map((b, idx) => ({
        ...b,
        indice: idx + 1,
      }));
    }
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
    const hipoA = String((previa as { hipodromo?: unknown })?.hipodromo ?? "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");
    const hipoB = String((c as { hipodromo?: unknown })?.hipodromo ?? "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");
    const distintoHipodromo = hipoA.length > 0 && hipoB.length > 0 && hipoA !== hipoB;
    if (distintoHipodromo) {
      colisiones.push(c);
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
}
