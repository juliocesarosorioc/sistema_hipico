/**
 * ============================================================================
 * EXTRACTOR GACETA VENEZUELA (GACETA HÍPICA LA RINCONADA / VALENCIA)
 * ============================================================================
 * Diferenciación estricta entre Número de Programa / Gualdrapa (N°) y
 * Puesto de Partida (PP Actual y PP Histórico en Retrospecto).
 * Cumple con el estándar de La Rinconada donde en tiros como 1400m o 1500m
 * los puestos libres internos desplazan el PP respecto al N° de gualdrapa.
 */

export interface ActuacionRetrospectoExtraida {
  fecha: string; // YYYY-MM-DD
  carreraNumero?: number;
  distanciaMetros?: number;
  puestoPartidaPP?: number; // PP histórico en la columna del retrospecto
  posicionLlegada?: number;
  pesoBalanzaKg?: number;
  jinete?: string;
  kilosJinete?: number;
  cuerposDiferencia?: number;
  tiempoGanador?: string;
  tiempoEjemplar?: string;
  speedRatingTTC?: number;
  dividendo?: number;
  parcial1000m?: string;
  parcial300m?: string;
  lineaCorridaResumen?: string;
  comentariosCarrera?: string; // Tropiezos: PMal, SMal, TPart, CAfPa, etc.
}

export interface EjemplarGacetaExtraido {
  numeroPrograma: number; // N° oficial de gualdrapa (1..14)
  puestoPistaActual: number; // 🚪 PP actual en el aparato de partidas
  nombre: string;
  stud?: string;
  divisaTexto?: string;
  jinete?: string;
  kilos?: number;
  entrenador?: string;
  pesoHoyKg?: number;
  pesoOptimoKg?: number;
  implementos?: string;
  cambioImplementos?: string;
  morningLine?: number;
  speedRatingTTC?: number;
  estiloInferido?: "E1" | "E2" | "E3";
  actuacionesPrevias: ActuacionRetrospectoExtraida[];
}

export interface CarreraGacetaExtraida {
  reunionNumero?: number;
  carreraNumero: number;
  distanciaMetros: number;
  hipodromo: string;
  hora?: string;
  superficie: "ARENA" | "CESPED";
  esValida5y6: boolean;
  numeroValida5y6?: number;
  ejemplares: EjemplarGacetaExtraido[];
}

/**
 * Normaliza nombres de ejemplares para búsquedas seguras en ih_*
 */
export function normalizarNombreEjemplar(nombre: string): string {
  return nombre
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parsea el encabezado o fila de un ejemplar en la Gaceta Hípica,
 * identificando el Número de Gualdrapa (N°) a la izquierda y el Puesto de Pista (PP)
 * vertical o en el corchete.
 *
 * Ejemplo de líneas de Gaceta Hípica:
 * "1 [PP 6] THE BRONX (USA) 53 Kg - J. Lugo - R. Cartolano"
 * "2 (PP 7) HURACAN JESUS 54 Kg - H. Medina - R. Lanz"
 */
export function parsearLineaParticipanteGaceta(linea: string, indiceDefault: number = 1): {
  numeroPrograma: number;
  puestoPistaActual: number;
  nombre: string;
  kilos?: number;
  jinete?: string;
  entrenador?: string;
} {
  const limpio = linea.trim();

  // 1. Extraer número de programa al inicio
  const matchNum = limpio.match(/^#?(\d{1,2})\b/);
  const numeroPrograma = matchNum ? parseInt(matchNum[1], 10) : indiceDefault;

  // 2. Extraer PP explícito si existe (ej. "[PP 6]", "PP: 6", "PP6", "(PP 8)")
  const matchPP = limpio.match(/\[?\bPP[:\s-]*(\d{1,2})\b\]?/i);
  let puestoPistaActual = matchPP ? parseInt(matchPP[1], 10) : numeroPrograma;

  // 3. Extraer Nombre
  // Remover prefijo de número y PP para aislar el nombre
  let resto = limpio
    .replace(/^#?\d{1,2}\s*/, "")
    .replace(/\[?\bPP[:\s-]*\d{1,2}\b\]?/gi, "")
    .trim();

  // Extraer kilos si vienen (ej. "53 Kg", "54k", "55.5 Kg")
  let kilos: number | undefined;
  const matchKilos = resto.match(/\b(\d{2}(?:\.\d)?)\s*k(?:g|ilos)?\b/i);
  if (matchKilos) {
    kilos = parseFloat(matchKilos[1]);
    resto = resto.replace(matchKilos[0], "").trim();
  }

  // Extraer Jinete y Entrenador si están separados por guiones
  let jinete: string | undefined;
  let entrenador: string | undefined;
  const partes = resto.split(/\s*-\s*/);
  const nombre = partes[0]?.replace(/[()]/g, "").trim() || `EJEMPLAR #${numeroPrograma}`;

  if (partes.length >= 2) jinete = partes[1].trim();
  if (partes.length >= 3) entrenador = partes[2].trim();

  return {
    numeroPrograma,
    puestoPistaActual,
    nombre: normalizarNombreEjemplar(nombre),
    kilos,
    jinete,
    entrenador,
  };
}

/**
 * Parsea una línea de retrospecto histórico de La Rinconada extrayendo el PP histórico.
 * Formato típico:
 * "15/10/2026 C480 445kg 1400 PP 4 (23.1) (72.2) Lleg: 2 a 1 1/2 cpo TPart, corrió adentro"
 */
export function parsearFilaRetrospecto(fila: string): ActuacionRetrospectoExtraida {
  const res: ActuacionRetrospectoExtraida = {
    fecha: "2026-01-01",
  };

  let filaSinFecha = fila;
  // Fecha (DD/MM/AAAA o AAAA-MM-DD)
  const matchFecha = fila.match(/(\d{2})[/-](\d{2})[/-](\d{4})/);
  if (matchFecha) {
    res.fecha = `${matchFecha[3]}-${matchFecha[2]}-${matchFecha[1]}`;
    filaSinFecha = fila.replace(matchFecha[0], "");
  } else {
    const matchIso = fila.match(/(\d{4}-\d{2}-\d{2})/);
    if (matchIso) {
      res.fecha = matchIso[1];
      filaSinFecha = fila.replace(matchIso[0], "");
    }
  }

  // Carrera (ej. C480, C510)
  const matchCarr = filaSinFecha.match(/\bC(\d{2,4})\b/i);
  if (matchCarr) res.carreraNumero = parseInt(matchCarr[1], 10);

  // Distancia (ej. 1200, 1400, 1800m)
  const matchDist = filaSinFecha.match(/\b(800|900|1[0-9]{3}|2[0-4][0-9]{2})\s*m?\b/);
  if (matchDist) res.distanciaMetros = parseInt(matchDist[1], 10);

  // PP Histórico (ej. "PP 4", "PP:4", "PP04")
  const matchPP = fila.match(/\bPP[:\s-]*(\d{1,2})\b/i);
  if (matchPP) res.puestoPartidaPP = parseInt(matchPP[1], 10);

  // Peso balanza (ej. "445kg", "452 k")
  const matchPeso = fila.match(/\b(4\d{2}|5\d{2})\s*k(?:g)?\b/i);
  if (matchPeso) res.pesoBalanzaKg = parseFloat(matchPeso[1]);

  // Posición de llegada (ej. "Lleg: 1", "1°", "2do", "3ro")
  const matchLleg = fila.match(/(?:Lleg:?|º|°)?\s*(\d{1,2})\s*(?:°|º|ero|do|ro|to)?\s*(?:a\s+([\d\s/]+)\s*cpo)?/i);
  if (matchLleg && parseInt(matchLleg[1], 10) <= 20) {
    res.posicionLlegada = parseInt(matchLleg[1], 10);
  }

  // Comentarios tácticos / Tropiezos
  const tropiezosConocidos = ["PMal", "SMal", "TPart", "T800F", "CAfPa", "CAfTC", "TROP", "CLLOR", "CLADR", "ESTORB"];
  const filaUpper = fila.toUpperCase();
  const encontrados: string[] = [];
  for (const t of tropiezosConocidos) {
    if (filaUpper.includes(t.toUpperCase())) encontrados.push(t);
  }
  if (encontrados.length > 0) {
    res.comentariosCarrera = encontrados.join(", ");
  }

  return res;
}
