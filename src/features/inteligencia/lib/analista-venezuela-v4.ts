/**
 * ============================================================================
 * MOTOR ANALISTA VENEZUELA v4 (MACTOR + SMIC + ACTUARIO DE 22 FACTORES)
 * ============================================================================
 * Laboratorio analítico autónomo para hipódromos venezolanos (La Rinconada / Valencia).
 * Integra los 22 factores estructurales de Gaceta Hípica y Tomatiempos INH,
 * con soporte para análisis Anticipado y análisis En Vivo (Factor de Pista,
 * Línea de Carrera, Peso Previo y Tendencia de la Tarde).
 */

export type EstiloCarrera = "E1" | "E2" | "E3"; // E1: Puntero, E2: Stalker/Colocado, E3: Rematador
export type FactorPista = "NORMAL" | "LIGERA" | "PESADA" | "FANGOSA";
export type LineaPista = "RIEL" | "CENTRO" | "AFUERA" | "COMPROMETIDO";

export type EjercicioTomatiempo = {
  distancia: number; // metros
  tiempo: string; // ej: "38.2"
  remate?: string; // ej: "12.1"
  calificacion: "E" | "MB" | "B" | "R"; // Excelente, Muy Bien, Bien, Regular
  observacion?: string; // ej: "VOLANDO EN SILLA", "POR CENTRO DE CANCHA"
};

export type EjemplarAnalisisV4 = {
  id: string;
  numero: number;
  nombre: string;
  puestoPista: number; // PP actual en el partidor
  puestoPistaAnterior?: number; // PP en su carrera anterior
  tropiezosAnteriores?: string[]; // ej: ["PMal", "TPart", "CAfPa"]
  historialPP?: Array<{ puestoPista: number; speedRatingTTC?: number; distancia?: number; tropiezo?: string }>;
  jinete: string;
  kilos: number;
  jineteAnterior?: string;
  entrenador: string;
  stud?: string;
  haras?: string;
  divisaTexto?: string; // ej: "C. AZUL M. ROJAS G. AMARILLA"
  morningLine: number;
  dividendoEstimado?: number;
  speedRatingTTC: number; // 0 - 100
  varianzaTTC?: number;
  estilo: EstiloCarrera;
  actuacionesPrevias: number;
  diasSinCorrer: number;
  // Pesos
  pesoOptimoKg: number;
  pesoHoyKg?: number | null; // Opcional el día de la carrera
  // Implementos
  implementos?: string; // ej: "BB, LA, V"
  cambioImplementos?: string; // ej: "+Gr, -CC"
  // Sinergias
  efectividadJineteEntrenador: number; // 0.0 a 1.0
  efectividadStudEntrenador?: number;
  // Desempeño por tramos
  tendenciaTramoFinal: "SE_MANTIENE" | "AFLOJA" | "ATROPELLA";
  // En vivo opcional
  lineaPistaEstimada?: LineaPista | null;
  retirado?: boolean;
  // Tomatiempos
  ultimoTraqueo?: EjercicioTomatiempo;
};

export type TendenciaTarde = {
  activa: boolean;
  factorPista: FactorPista;
  varianteSegundos: number; // ej: -0.6s rápida, +1.2s pesada
  carrilDominante: "RIEL" | "CENTRO" | "AFUERA";
  estiloDominante: EstiloCarrera;
  bonoPuntos: number; // 2.2 a 3.0 pts
};

export type ResultadoEjemplarV4 = {
  ejemplar: EjemplarAnalisisV4;
  scoreGodetTotal: number;
  probabilidadSMIC: number; // %
  ordenLlegadaProyectado: number;
  cuerposVentaja: number;
  favorecidoTendenciaTarde: boolean;
  bonoPesoOptimo: boolean;
  alertaPeso: boolean;
  deltaPesoKg: number | null;
  esLinea5y6: boolean;
  esMorocha5y6: boolean;
  esSorpresaOverlay: boolean;
  badges: string[];
  detallesFactores: Record<string, number>;
};

export type ResultadoCarreraV4 = {
  carreraId?: string;
  hipodromo: string;
  carreraNumero: number;
  distancia: number;
  fecha: string;
  esValida5y6: boolean;
  numeroValida5y6?: number;
  ranking: ResultadoEjemplarV4[];
  escenarioDominanteSMIC: {
    codigo: string;
    titulo: string;
    descripcion: string;
    probabilidadPct: number;
  };
  tendenciaTardeAplicada: boolean;
  lineaRecomendada5y6?: ResultadoEjemplarV4;
  morochaRecomendada5y6?: [ResultadoEjemplarV4, ResultadoEjemplarV4];
  sorpresaRecomendada5y6?: ResultadoEjemplarV4;
};

/**
 * Colores oficiales de gualdrapa reglamentaria (CLOTH #1 al #16)
 */
export const COLORES_GUALDRAPA: Record<number, { bg: string; text: string; nombreColor: string; border: string }> = {
  1: { bg: "#DC2626", text: "#FFFFFF", nombreColor: "Rojo", border: "#991B1B" },
  2: { bg: "#FFFFFF", text: "#0F172A", nombreColor: "Blanco", border: "#94A3B8" },
  3: { bg: "#2563EB", text: "#FFFFFF", nombreColor: "Azul", border: "#1D4ED8" },
  4: { bg: "#FACC15", text: "#000000", nombreColor: "Amarillo", border: "#CA8A04" },
  5: { bg: "#16A34A", text: "#FFFFFF", nombreColor: "Verde", border: "#15803D" },
  6: { bg: "#09090B", text: "#FFFFFF", nombreColor: "Negro", border: "#27272A" },
  7: { bg: "#EA580C", text: "#FFFFFF", nombreColor: "Naranja", border: "#C2410C" },
  8: { bg: "#F472B6", text: "#000000", nombreColor: "Rosado", border: "#DB2777" },
  9: { bg: "#06B6D4", text: "#000000", nombreColor: "Turquesa", border: "#0891B2" },
  10: { bg: "#9333EA", text: "#FFFFFF", nombreColor: "Morado", border: "#7E22CE" },
  11: { bg: "#94A3B8", text: "#000000", nombreColor: "Gris", border: "#64748B" },
  12: { bg: "#84CC16", text: "#000000", nombreColor: "Lima", border: "#65A30D" },
  13: { bg: "#78350F", text: "#FFFFFF", nombreColor: "Marrón", border: "#451A03" },
  14: { bg: "#881337", text: "#FFFFFF", nombreColor: "Granate", border: "#4C0519" },
  15: { bg: "#D97706", text: "#FFFFFF", nombreColor: "Kaki", border: "#B45309" },
  16: { bg: "#B45309", text: "#FFFFFF", nombreColor: "Cobre", border: "#78350F" },
};

/**
 * Evalúa los 22 factores estructurales y tácticos de un ejemplar.
 */
export function evaluarEjemplarV4(
  e: EjemplarAnalisisV4,
  distanciaCarrera: number,
  tendenciaTarde?: TendenciaTarde,
  factorPistaEnVivo?: FactorPista
): ResultadoEjemplarV4 {
  const factores: Record<string, number> = {};
  const badges: string[] = [];

  // F1. Base Speed Rating TTC (0 - 45 pts)
  const baseSpeed = Math.max(0, Math.min(100, e.speedRatingTTC));
  factores["F1_SpeedRating"] = Number((baseSpeed * 0.42).toFixed(2));

  // F2. Morning Line & Valor Cuota (0 - 8 pts)
  if (e.morningLine > 0 && e.morningLine <= 2.5) {
    factores["F2_FavoritoML"] = 7.5;
    badges.push("⭐️ Favorito ML");
  } else if (e.morningLine <= 4.0) {
    factores["F2_FavoritoML"] = 5.0;
  } else if (e.morningLine >= 10.0) {
    factores["F2_FavoritoML"] = 2.0;
  } else {
    factores["F2_FavoritoML"] = 3.5;
  }

  // F3. Sinergia Yunta Jinete/Entrenador (0 - 10 pts)
  const yunta = e.efectividadJineteEntrenador || 0;
  factores["F3_YuntaJE"] = Number((yunta * 10).toFixed(2));
  if (yunta >= 0.28) {
    badges.push("🔥 Yunta Peligrosa");
  }

  // F4. Condición y Descanso (0 - 6 pts)
  const sc = e.diasSinCorrer;
  if (sc >= 14 && sc <= 35) {
    factores["F4_DescansoOptimo"] = 5.8;
    badges.push("⏱️ En Distancia & Fresco");
  } else if (sc > 35 && sc <= 70) {
    factores["F4_DescansoOptimo"] = 4.0;
  } else if (sc > 90) {
    factores["F4_DescansoOptimo"] = 2.5; // Reaparecida
    badges.push("⚠️ Reaparece");
  } else {
    factores["F4_DescansoOptimo"] = 3.5;
  }

  // F5. Peso Físico vs. Peso Óptimo Ganador (0 - 6 pts)
  let bonoPeso = false;
  let alertaPeso = false;
  let deltaPeso: number | null = null;

  if (typeof e.pesoHoyKg === "number" && e.pesoHoyKg > 0 && e.pesoOptimoKg > 0) {
    deltaPeso = Number((e.pesoHoyKg - e.pesoOptimoKg).toFixed(1));
    const absDelta = Math.abs(deltaPeso);
    if (absDelta <= 2.5) {
      factores["F5_PesoBalanza"] = 5.5; // Peso Óptimo (+1.9 pts base extra)
      bonoPeso = true;
      badges.push("⚖️ Peso Óptimo");
    } else if (absDelta >= 7.0) {
      factores["F5_PesoBalanza"] = 1.0; // Penalización
      alertaPeso = true;
      badges.push(`⚠️ Alerta Peso (${deltaPeso > 0 ? "+" : ""}${deltaPeso}kg)`);
    } else {
      factores["F5_PesoBalanza"] = 3.5;
    }
  } else {
    // Si no se suministra el peso hoy (modo anticipado o sin pesar), asigna peso neutro del óptimo
    factores["F5_PesoBalanza"] = 4.0;
  }

  // F6. Puesto de Pista (PP) Biomecánico y Táctico (0 - 8 pts)
  // Evalúa: Rendimiento por franja (Interior 1-4, Medio 5-9, Exterior 10-14),
  // y cambio favorable respecto al PP anterior (ΔPP y tropiezos superados).
  const pp = e.puestoPista;
  let puntosPP = 3.5;

  // Rendimiento base según la distancia
  if (distanciaCarrera >= 1600 && pp <= 4) {
    puntosPP = 4.8;
  } else if (distanciaCarrera <= 1200 && pp >= 6 && pp <= 11) {
    puntosPP = 4.5;
  } else if (distanciaCarrera >= 1300 && distanciaCarrera <= 1500 && pp >= 5 && pp <= 10) {
    puntosPP = 4.6;
  }

  // Bonificación por corrección de tropiezo en PP previo:
  // Si partió mal encajonado en PP 1-2 en su anterior y hoy sale por un puesto limpio (PP 5-11)
  const tropiezos = e.tropiezosAnteriores ?? [];
  const tuvoProblemasInternos = tropiezos.some((t) => ["PMAL", "SMAL", "TPART", "T800F"].includes(t.toUpperCase()));
  if (e.puestoPistaAnterior && e.puestoPistaAnterior <= 2 && tuvoProblemasInternos && pp >= 5 && pp <= 11) {
    puntosPP += 1.5;
    badges.push("🚪 PP Aliviado (+1.5)");
  }

  // Bonificación en tiros de 2 o 4 curvas (1800m a 2400m) si corrió abierto desde PP 12-14
  // y hoy mejora a un puesto interno/medio (PP 1-7) ahorrando terreno en el primer codo:
  const corrioAbierto = tropiezos.some((t) => ["CAFPA", "CAFTC"].includes(t.toUpperCase()));
  if (distanciaCarrera >= 1800 && e.puestoPistaAnterior && e.puestoPistaAnterior >= 12 && corrioAbierto && pp <= 7) {
    puntosPP += 1.8;
    badges.push("🎯 Ahorro de Curva PP 1-7 (+1.8)");
  }

  factores["F6_PuestoPista"] = Number(Math.min(8.0, puntosPP).toFixed(2));

  // F7. Estilo y Tren de Carrera (0 - 7 pts)
  if (e.estilo === "E1") {
    factores["F7_Estilo"] = 5.5;
  } else if (e.estilo === "E2") {
    factores["F7_Estilo"] = 6.2; // Versatilidad
  } else {
    factores["F7_Estilo"] = 5.0;
  }

  // F8. Tramo Final y Remate (0 - 6 pts)
  if (e.tendenciaTramoFinal === "ATROPELLA") {
    factores["F8_Remate"] = 5.8;
  } else if (e.tendenciaTramoFinal === "SE_MANTIENE") {
    factores["F8_Remate"] = 4.8;
  } else {
    factores["F8_Remate"] = 2.5;
  }

  // F9. Implementos (0 - 4 pts)
  if (e.cambioImplementos && (e.cambioImplementos.includes("+") || e.cambioImplementos.includes("-"))) {
    factores["F9_Implementos"] = 3.8;
    badges.push(`🔧 ${e.cambioImplementos}`);
  } else {
    factores["F9_Implementos"] = 2.5;
  }

  // F10. Matriz de Tomatiempos INH (0 - 8 pts)
  if (e.ultimoTraqueo) {
    const cal = e.ultimoTraqueo.calificacion;
    if (cal === "E") {
      factores["F10_Tomatiempos"] = 7.8;
      badges.push("🚀 Volando en Traqueos (E)");
    } else if (cal === "MB") {
      factores["F10_Tomatiempos"] = 6.5;
      badges.push("💨 Muy Bien en Silla (MB)");
    } else if (cal === "B") {
      factores["F10_Tomatiempos"] = 4.8;
    } else {
      factores["F10_Tomatiempos"] = 3.0;
    }
  } else {
    factores["F10_Tomatiempos"] = 3.5;
  }

  // F11 & F12. En Vivo: Factor de Pista y Sesgo de Línea
  const pistaActual = factorPistaEnVivo || tendenciaTarde?.factorPista || "NORMAL";
  let factorPistaPuntos = 3.0;
  if (pistaActual === "LIGERA" && e.estilo === "E1") {
    factorPistaPuntos = 4.5;
  } else if (pistaActual === "PESADA" && e.estilo === "E3") {
    factorPistaPuntos = 4.8;
  }
  factores["F11_PistaEnVivo"] = factorPistaPuntos;

  // F13. ⚡ TENDENCIA DE LA TARDE (Bono de +2.2 a +3.0 pts)
  let favorecidoTendencia = false;
  if (tendenciaTarde && tendenciaTarde.activa) {
    const estiloCoincide = e.estilo === tendenciaTarde.estiloDominante;
    const carrilCoincide =
      (tendenciaTarde.carrilDominante === "RIEL" && pp <= 3) ||
      (tendenciaTarde.carrilDominante === "CENTRO" && pp >= 4 && pp <= 7) ||
      (tendenciaTarde.carrilDominante === "AFUERA" && pp >= 8);

    if (estiloCoincide || carrilCoincide) {
      favorecidoTendencia = true;
      const bono = Number(tendenciaTarde.bonoPuntos.toFixed(2));
      factores["F13_TendenciaTarde"] = bono;
      badges.push("⚡ FAVORECIDO POR TENDENCIA DE LA TARDE");
    } else {
      factores["F13_TendenciaTarde"] = 0;
    }
  }

  // Puntuación Godet Agregada
  const scoreTotal = Number(
    Object.values(factores)
      .reduce((acc, curr) => acc + curr, 0)
      .toFixed(2)
  );

  return {
    ejemplar: e,
    scoreGodetTotal: scoreTotal,
    probabilidadSMIC: 0, // Se calcula al normalizar en el conjunto de la carrera
    ordenLlegadaProyectado: 1,
    cuerposVentaja: 0,
    favorecidoTendenciaTarde: favorecidoTendencia,
    bonoPesoOptimo: bonoPeso,
    alertaPeso: alertaPeso,
    deltaPesoKg: deltaPeso,
    esLinea5y6: false,
    esMorocha5y6: false,
    esSorpresaOverlay: false,
    badges,
    detallesFactores: factores,
  };
}

/**
 * Proyecta la carrera completa con todos sus inscritos, calculando probabilidades SMIC,
 * ventajas en cuerpos y escenarios dominantes.
 */
export function simularCarreraV4(params: {
  hipodromo: string;
  carreraNumero: number;
  distancia: number;
  fecha: string;
  esValida5y6?: boolean;
  numeroValida5y6?: number;
  ejemplares: EjemplarAnalisisV4[];
  tendenciaTarde?: TendenciaTarde;
  factorPistaEnVivo?: FactorPista;
}): ResultadoCarreraV4 {
  const activos = params.ejemplares.filter((e) => !e.retirado);
  const evaluados = activos.map((e) =>
    evaluarEjemplarV4(e, params.distancia, params.tendenciaTarde, params.factorPistaEnVivo)
  );

  // Ordenar por score Godet decreciente
  evaluados.sort((a, b) => b.scoreGodetTotal - a.scoreGodetTotal);

  // Normalización Softmax / Proporcional de probabilidades SMIC
  const scoresExp = evaluados.map((item) => Math.exp((item.scoreGodetTotal - 50) / 10));
  const sumaExp = scoresExp.reduce((a, b) => a + b, 0);

  evaluados.forEach((item, idx) => {
    const prob = Number(((scoresExp[idx] / (sumaExp || 1)) * 100).toFixed(1));
    item.probabilidadSMIC = prob;
    item.ordenLlegadaProyectado = idx + 1;
  });

  // Ventaja en cuerpos respecto al siguiente competidor
  for (let i = 0; i < evaluados.length; i++) {
    if (i < evaluados.length - 1) {
      const diffScore = evaluados[i].scoreGodetTotal - evaluados[i + 1].scoreGodetTotal;
      evaluados[i].cuerposVentaja = Number(Math.max(0.25, (diffScore * 0.45)).toFixed(2));
    } else {
      evaluados[i].cuerposVentaja = 0;
    }
  }

  // Identificar Línea, Morochas y Sorpresas de 5y6
  if (evaluados.length > 0) {
    const primero = evaluados[0];
    const segundo = evaluados[1];

    if (primero.probabilidadSMIC >= 38.0 && primero.cuerposVentaja >= 2.0) {
      primero.esLinea5y6 = true;
      primero.badges.push("🔒 LÍNEA FIJA 5Y6");
    } else if (segundo && primero.probabilidadSMIC + segundo.probabilidadSMIC >= 55.0) {
      primero.esMorocha5y6 = true;
      segundo.esMorocha5y6 = true;
      primero.badges.push("⚔️ MOROCHA DE SEGURIDAD");
      segundo.badges.push("⚔️ MOROCHA DE SEGURIDAD");
    }

    // Sorpresa / Overlay (buen speed rating pero dividendo alto)
    const sorpresas = evaluados.filter(
      (ev) => ev.ejemplar.morningLine >= 8.0 && ev.probabilidadSMIC >= 12.0
    );
    if (sorpresas.length > 0) {
      sorpresas[0].esSorpresaOverlay = true;
      sorpresas[0].badges.push("💣 LANCE DE BUEN DIVIDENDO");
    }
  }

  // Escenario Dominante SMIC según composición de velocistas y rematadores
  const punteros = evaluados.filter((e) => e.ejemplar.estilo === "E1").length;
  const rematadores = evaluados.filter((e) => e.ejemplar.estilo === "E3").length;

  let escenario = {
    codigo: "H3_RITMO_HONRADO",
    titulo: "H3 · Ritmo Honrado Equilibrado",
    descripcion: "Parciales regulares donde la clase y el rating TTC deciden la victoria en la recta final.",
    probabilidadPct: 48,
  };

  if (punteros >= 3) {
    escenario = {
      codigo: "H1_TREN_SUICIDA",
      titulo: "H1 · Tren Violento en Punta",
      descripcion: "Pelea feroz entre los velocistas desgastará a los punteros, beneficiando la atropellada.",
      probabilidadPct: Math.min(85, 35 + punteros * 10),
    };
  } else if (punteros <= 1 && evaluados.length >= 4) {
    escenario = {
      codigo: "H2_PASO_FALSO",
      titulo: "H2 · Paso Falso / Punta Libre",
      descripcion: "El puntero dominará sin oposición y tendrá pulmón para venirse de tiro a tiro.",
      probabilidadPct: 62,
    };
  }

  const linea = evaluados.find((e) => e.esLinea5y6);
  const morocha = evaluados.filter((e) => e.esMorocha5y6).slice(0, 2) as [ResultadoEjemplarV4, ResultadoEjemplarV4];
  const sorpresa = evaluados.find((e) => e.esSorpresaOverlay);

  return {
    hipodromo: params.hipodromo,
    carreraNumero: params.carreraNumero,
    distancia: params.distancia,
    fecha: params.fecha,
    esValida5y6: Boolean(params.esValida5y6),
    numeroValida5y6: params.numeroValida5y6,
    ranking: evaluados,
    escenarioDominanteSMIC: escenario,
    tendenciaTardeAplicada: Boolean(params.tendenciaTarde?.activa),
    lineaRecomendada5y6: linea,
    morochaRecomendada5y6: morocha.length === 2 ? morocha : undefined,
    sorpresaRecomendada5y6: sorpresa,
  };
}

// Diccionario de colores comunes en las divisas del hipismo venezolano
export const MAPA_COLORES_DIVISA: Record<string, string> = {
  BLANCO: "#FFFFFF",
  BLANCA: "#FFFFFF",
  BLANCAS: "#FFFFFF",
  NEGRO: "#0F172A",
  NEGRA: "#0F172A",
  NEGRAS: "#0F172A",
  AZUL: "#1D4ED8",
  AZULES: "#1D4ED8",
  CELESTE: "#38BDF8",
  ROJO: "#DC2626",
  ROJA: "#DC2626",
  ROJAS: "#DC2626",
  AMARILLO: "#EAB308",
  AMARILLA: "#EAB308",
  AMARILLAS: "#EAB308",
  VERDE: "#16A34A",
  VERDES: "#16A34A",
  NARANJA: "#EA580C",
  MORADO: "#9333EA",
  MORADA: "#9333EA",
  GRIS: "#64748B",
  ROSADO: "#EC4899",
  ROSADA: "#EC4899",
  TURQUESA: "#06B6D4",
  MARRON: "#78350F",
  ORO: "#CA8A04",
  VINO: "#881337",
  GRANATE: "#881337",
};

export function extraerColorDivisa(texto: string, porDefecto: string): string {
  const limpio = texto.toUpperCase();
  for (const [palabra, hex] of Object.entries(MAPA_COLORES_DIVISA)) {
    if (limpio.includes(palabra)) {
      return hex;
    }
  }
  return porDefecto;
}

/**
 * Interpreta la especificación de divisa tradicional venezolana:
 * "C. [Color] M. [Color] G. [Color]"
 */
export function interpretarDivisaCMG(texto?: string): {
  colorCamisa: string;
  colorMangas: string;
  colorGorro: string;
} {
  if (!texto) {
    return { colorCamisa: "#3B82F6", colorMangas: "#FFFFFF", colorGorro: "#EF4444" };
  }

  const upper = texto.toUpperCase();
  let camisa = "#3B82F6";
  let mangas = "#FFFFFF";
  let gorro = "#EF4444";

  const regexC = /(?:C\.|CAMISA|CUERPO)[:\s]+([^,;MG]+)/i;
  const regexM = /(?:M\.|MANGAS)[:\s]+([^,;CG]+)/i;
  const regexG = /(?:G\.|GORRA|GORRO)[:\s]+([^,;CM]+)/i;

  const matchC = upper.match(regexC);
  const matchM = upper.match(regexM);
  const matchG = upper.match(regexG);

  if (matchC) camisa = extraerColorDivisa(matchC[1], "#3B82F6");
  if (matchM) mangas = extraerColorDivisa(matchM[1], "#FFFFFF");
  if (matchG) gorro = extraerColorDivisa(matchG[1], "#EF4444");

  if (!matchC && !matchM && !matchG) {
    camisa = extraerColorDivisa(upper, "#3B82F6");
    mangas = camisa;
    gorro = extraerColorDivisa(upper, "#EF4444");
  }

  return { colorCamisa: camisa, colorMangas: mangas, colorGorro: gorro };
}

/**
 * Evalúa el factor biomecánico del Puesto de Partida (PP Actual vs. PP Histórico vs. N° Programa)
 */
export function evaluarFactorPuestoPartida(
  puestoPistaActual: number,
  distanciaCarrera: number,
  puestoPistaAnterior?: number,
  tropiezosAnteriores?: string[]
): {
  zonaAparato: "INTERIOR" | "MEDIO" | "EXTERIOR";
  puntosPP: number;
  bonoAlivio: boolean;
  bonoCurvaAhorro: boolean;
  descripcion: string;
} {
  const zonaAparato =
    puestoPistaActual <= 4 ? "INTERIOR" : puestoPistaActual <= 9 ? "MEDIO" : "EXTERIOR";

  let puntosPP = 3.5;
  if (distanciaCarrera >= 1600 && puestoPistaActual <= 4) puntosPP = 4.8;
  else if (distanciaCarrera <= 1200 && puestoPistaActual >= 6 && puestoPistaActual <= 11) puntosPP = 4.5;
  else if (distanciaCarrera >= 1300 && distanciaCarrera <= 1500 && puestoPistaActual >= 5 && puestoPistaActual <= 10) puntosPP = 4.6;

  let bonoAlivio = false;
  let bonoCurvaAhorro = false;
  const trop = (tropiezosAnteriores ?? []).map((t) => t.toUpperCase());

  // Alivio de tropiezos internos
  if (
    puestoPistaAnterior &&
    puestoPistaAnterior <= 2 &&
    trop.some((t) => ["PMAL", "SMAL", "TPART", "T800F"].includes(t)) &&
    puestoPistaActual >= 5 &&
    puestoPistaActual <= 11
  ) {
    puntosPP += 1.5;
    bonoAlivio = true;
  }

  // Ahorro de curva en tiros largos
  if (
    distanciaCarrera >= 1800 &&
    puestoPistaAnterior &&
    puestoPistaAnterior >= 12 &&
    trop.some((t) => ["CAFPA", "CAFTC"].includes(t)) &&
    puestoPistaActual <= 7
  ) {
    puntosPP += 1.8;
    bonoCurvaAhorro = true;
  }

  const descripciones: string[] = [`Zona ${zonaAparato} (PP ${puestoPistaActual})`];
  if (bonoAlivio) descripciones.push("Mejora sustancial: sale de encajonamiento previo (+1.5)");
  if (bonoCurvaAhorro) descripciones.push("Ahorro de terreno en 1er codo (+1.8)");

  return {
    zonaAparato,
    puntosPP: Number(Math.min(8.0, puntosPP).toFixed(2)),
    bonoAlivio,
    bonoCurvaAhorro,
    descripcion: descripciones.join(" · "),
  };
}
