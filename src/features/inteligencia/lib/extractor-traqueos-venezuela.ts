/**
 * ============================================================================
 * EXTRACTOR TRAQUEOS VENEZUELA (GACETA HÍPICA + BOLETÍN TOMATIEMPOS INH)
 * ============================================================================
 * Parsea y califica ejercicios, briseos, galopes de desahogo y pasadas de
 * La Rinconada y Valencia:
 * - Conversión de quintos de segundo (ej: 36" 4 -> 36.8s; 11" 2 -> 11.4s).
 * - Detección de distancias (400m a 1800m), vueltas (2V), aparato (del apto.).
 * - Detección de líneas de pista (POR CENTRO DE CANCHA, POR EL RIEL, POR FUERA).
 * - Detección de implementos probados (+GR, -BB, +OT).
 * - Cálculo de Índice de Calidad de Workout (1.0 a 10.0).
 */

export interface TraqueoDetalladoExtraido {
  nombreEjemplar: string;
  nombreNormalizado: string;
  distanciaMetros: number;
  tiempoTexto: string;
  tiempoDecimalSegundos: number;
  remateTexto?: string;
  remateDecimalSegundos?: number;
  segundaVuelta: boolean; // (2V)
  salioDelAparato: boolean; // (del apto.)
  paradaDesahogoTexto?: string; // ej: "paró en 76.2 en 1000m"
  modalidad?: "EP" | "ES" | "SS" | "RDE" | "COMODO"; // En pelo, En silla, Sin silla, etc.
  lineaCancha?: "CENTRO" | "RIEL" | "AFUERA";
  implementosProbados?: string; // ej: "+GR", "-BB"
  comentario: string;
  calificacion: "E" | "MB" | "B" | "R"; // Excelente, Muy Bien, Bien, Regular
  indiceCalidadWorkout: number; // 1.0 a 10.0
}

/**
 * Convierte una expresión en segundos y quintos a segundos decimales.
 * Ejemplos:
 * '36" 4' -> 36 + 4*0.2 = 36.8
 * '65" 1' -> 65 + 1*0.2 = 65.2
 * '11" 2' -> 11 + 2*0.2 = 11.4
 * '38.2'  -> 38.2
 */
export function convertirTiempoQuintosADecimal(textoTiempo: string): number {
  if (!textoTiempo) return 0;
  const matchQuinto = textoTiempo.match(/(\d{1,3})["'\s]+(\d)/);
  if (matchQuinto) {
    const seg = parseInt(matchQuinto[1], 10);
    const quintos = parseInt(matchQuinto[2], 10);
    return Number((seg + quintos * 0.2).toFixed(2));
  }
  const matchDec = textoTiempo.match(/(\d{1,3}(?:\.\d{1,2})?)/);
  if (matchDec) {
    return parseFloat(matchDec[1]);
  }
  return 0;
}

/**
 * Calcula el índice de calidad del traqueo (1.0 a 10.0) y su calificación (E, MB, B, R)
 * según el tiempo por cada 200m, la solidez del remate y la semántica del informe.
 */
export function calcularCalidadWorkout(
  distancia: number,
  tiempoSeg: number,
  remateSeg?: number,
  comentario: string = "",
  segundaVuelta: boolean = false
): { calificacion: "E" | "MB" | "B" | "R"; indiceCalidad: number } {
  if (distancia <= 0 || tiempoSeg <= 0) {
    return { calificacion: "B", indiceCalidad: 5.0 };
  }

  // Ritmo promedio cada 200m (furlong pace)
  const pace200m = tiempoSeg / (distancia / 200);

  let basePuntos = 6.0;
  // En La Rinconada, ritmos bajo 12.3s por cada 200m son destacados
  if (pace200m <= 12.0) basePuntos += 2.5;
  else if (pace200m <= 12.4) basePuntos += 1.8;
  else if (pace200m <= 12.8) basePuntos += 1.0;
  else if (pace200m >= 13.8) basePuntos -= 1.5;

  // Remate final en los últimos 200m
  if (remateSeg && remateSeg > 0) {
    if (remateSeg <= 11.4) basePuntos += 1.8; // Tronando / Volando
    else if (remateSeg <= 12.0) basePuntos += 1.0;
    else if (remateSeg >= 13.0) basePuntos -= 1.0;
  }

  // Semántica positiva de Tomatiempos
  const cUp = comentario.toUpperCase();
  if (cUp.includes("TRONANDO") || cUp.includes("VOLANDO") || cUp.includes("ESPECTACULAR") || cUp.includes("DE LO MEJOR")) {
    basePuntos += 1.2;
  }
  if (cUp.includes("COMODO") || cUp.includes("FACIL") || cUp.includes("EN LAS MANOS")) {
    basePuntos += 0.5;
  }
  if (segundaVuelta || cUp.includes("2V") || cUp.includes("SEGUNDA VUELTA")) {
    basePuntos += 0.6; // Excelente fondo físico
  }
  if (cUp.includes("CANSADO") || cUp.includes("AGOTADO") || cUp.includes("AFLOJO")) {
    basePuntos -= 2.0;
  }

  const indiceCalidad = Math.max(1.0, Math.min(10.0, Number(basePuntos.toFixed(1))));

  let calificacion: "E" | "MB" | "B" | "R" = "B";
  if (indiceCalidad >= 8.5) calificacion = "E";
  else if (indiceCalidad >= 7.2) calificacion = "MB";
  else if (indiceCalidad >= 5.0) calificacion = "B";
  else calificacion = "R";

  return { calificacion, indiceCalidad };
}

/**
 * Parsea una línea de texto individual de "TRAQUEOS LA RINCONADA" o "TOMATIEMPOS INH".
 *
 * Ejemplos admitidos:
 * "EXCITE (USA) 600 en 36\" 4 (11\" 3), espectacular."
 * "BENICIA (ARG) 1.000 en 65\" 4 (11\" 2), tronando en la raya. (2V). SS."
 * "PROMETHEUS 600 en 38\" 4 (11\" 2), volando en los finales."
 * "SHAWORD (USA) 1.000 en 65\" 1 (12\" 1), terminando de lo mejor. (2V)."
 * "THE BRONX 1000 en 64.2 con 12.0 paró en 77.4 del apto. ES."
 */
export function parsearLineaTraqueo(linea: string): TraqueoDetalladoExtraido | null {
  const limpio = linea.trim();
  if (!limpio || limpio.length < 10) return null;

  // 1. Extraer nombre del ejemplar al inicio (antes de los metros)
  // Admite nombres compuestos y sufijos de país: "EXCITE (USA)", "BENICIA (ARG)", "MR. CONNOLLY"
  const matchDist = limpio.match(/\b(400|500|600|700|800|900|1\.?000|1000|1\.?200|1200|1\.?400|1400|1\.?600|1600)\b/);
  if (!matchDist) return null;

  const indexDist = matchDist.index || 0;
  const nombreRaw = limpio.substring(0, indexDist).trim();
  const nombreEjemplar = nombreRaw.replace(/[()]/g, "").trim();
  if (!nombreEjemplar) return null;

  const distanciaMetros = parseInt(matchDist[1].replace(".", ""), 10);
  const despuesDistancia = limpio.substring(indexDist + matchDist[0].length);

  // 2. Tiempo principal cronometrado (ej: "en 36\" 4", "en 65\" 1", "en 64.2")
  const matchTiempo = despuesDistancia.match(/(?:en\s+)?(\d{1,3}(?:["'\s]+\d|\.\d{1,2}))/i);
  const tiempoTexto = matchTiempo ? matchTiempo[1].trim() : "";
  const tiempoDecimalSegundos = convertirTiempoQuintosADecimal(tiempoTexto);

  // 3. Remate (ej: "(11\" 2)", "(12\" 1)", "con 12.0", "remate 11.3")
  const matchRemate = despuesDistancia.match(/(?:\(|\bcon\s+|\bremate\s+)(\d{1,2}(?:["'\s]+\d|\.\d{1,2}))\)?/i);
  let remateTexto: string | undefined;
  let remateDecimalSegundos: number | undefined;
  if (matchRemate) {
    remateTexto = matchRemate[1].trim();
    remateDecimalSegundos = convertirTiempoQuintosADecimal(remateTexto);
  }

  // 4. Parada de desahogo (ej: "paró en 76.2", "paró en 1.000 en 68\" 2")
  let paradaDesahogoTexto: string | undefined;
  const matchParo = despuesDistancia.match(/par[oó]\s+en\s+([^,.;)]+)/i);
  if (matchParo) {
    paradaDesahogoTexto = `paró en ${matchParo[1].trim()}`;
  }

  // 5. Segunda vuelta (2V), aparato (del apto)
  const segundaVuelta = /\(2V\)|SEGUNDA\s+VUELTA/i.test(limpio);
  const salioDelAparato = /del\s+apto\.?|aparato/i.test(limpio);

  // 6. Modalidad (EP, ES, SS, RDE)
  let modalidad: "EP" | "ES" | "SS" | "RDE" | "COMODO" | undefined;
  if (/\bSS\b/i.test(limpio)) modalidad = "SS";
  else if (/\bES\b/i.test(limpio)) modalidad = "ES";
  else if (/\bEP\b/i.test(limpio)) modalidad = "EP";
  else if (/\bRDE\b/i.test(limpio)) modalidad = "RDE";

  // 7. Línea de cancha (CENTRO, RIEL, AFUERA)
  let lineaCancha: "CENTRO" | "RIEL" | "AFUERA" | undefined;
  if (/CENTRO\s+DE\s+CANCHA/i.test(limpio)) lineaCancha = "CENTRO";
  else if (/POR\s+EL\s+RIEL|ADENTRO/i.test(limpio)) lineaCancha = "RIEL";
  else if (/POR\s+FUERA|AFUERA/i.test(limpio)) lineaCancha = "AFUERA";

  // 8. Implementos probados (+GR, -BB, etc.)
  const matchImp = limpio.match(/([+-](?:GR|BB|LA|V|M|OT|CC|P))/i);
  const implementosProbados = matchImp ? matchImp[1].toUpperCase() : undefined;

  // 9. Comentario del tomatiempo
  // Lo que queda tras los números
  let comentario = despuesDistancia
    .replace(/(?:en\s+)?\d{1,3}(?:["'\s]+\d|\.\d{1,2})/, "")
    .replace(/\(?\d{1,2}(?:["'\s]+\d|\.\d{1,2})\)?/, "")
    .replace(/par[oó]\s+en\s+[^,.;)]+/i, "")
    .replace(/\(2V\)/gi, "")
    .replace(/\b(?:SS|ES|EP|RDE)\b/gi, "")
    .replace(/[(),]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!comentario) comentario = "Ejercicio regular de mantenimiento";

  const { calificacion, indiceCalidad } = calcularCalidadWorkout(
    distanciaMetros,
    tiempoDecimalSegundos,
    remateDecimalSegundos,
    comentario,
    segundaVuelta
  );

  return {
    nombreEjemplar,
    nombreNormalizado: nombreEjemplar
      .toUpperCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Z0-9\s]/g, "")
      .replace(/\s+/g, " ")
      .trim(),
    distanciaMetros,
    tiempoTexto,
    tiempoDecimalSegundos,
    remateTexto,
    remateDecimalSegundos,
    segundaVuelta,
    salioDelAparato,
    paradaDesahogoTexto,
    modalidad,
    lineaCancha,
    implementosProbados,
    comentario,
    calificacion,
    indiceCalidadWorkout: indiceCalidad,
  };
}
