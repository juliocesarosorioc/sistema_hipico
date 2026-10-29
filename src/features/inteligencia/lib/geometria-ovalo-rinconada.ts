/**
 * ============================================================================
 * GEOMETRÍA DEL ÓVALO DE LA RINCONADA (CIRCUITO OFICIAL 1.800M)
 * ============================================================================
 * Proporciona el modelo matemático estricto de la pista:
 * - Circuito cerrado de 1.800 metros:
 *   * Recta final inferior (tribunas): 400m (Meta en X = 720, salida codo izq en X = 360).
 *   * Codo izquierdo (Rinconada): 500m (semicírculo radio medio ≈ 159.155m).
 *   * Recta de enfrente (superior): 400m (de X = 360 a X = 760).
 *   * Primer codo (caballerizas): 500m (semicírculo radio medio ≈ 159.155m).
 *   * Total = 400 + 500 + 400 + 500 = 1.800 metros.
 *
 * - Chutes reglamentarios (recortados a exactamente +50m de la partida):
 *   * Chute de 1.600m (enfrente, superior derecha): partida a 400m de la curva (X = 1.160), límite X = 1.210 (+50m).
 *   * Chute de 800m (recta final, inferior izquierda): partida a 800m de meta (X = -80), límite X = -130 (+50m).
 *
 * - Rayas de distancia (hitos cada 100m, gateras, etc.):
 *   * Estrictamente rectas y perpendiculares entre la baranda interior y la baranda exterior.
 * ============================================================================
 */

export const ANCHO_PISTA = 70.0;
export const CANT_GATERAS = 14;
export const ANCHO_GATERA = ANCHO_PISTA / CANT_GATERAS;

// Coordenadas base (viewBox 0 0 1440 620)
// Centro del óvalo: (X_CENTRO_IZQ + X_CENTRO_DER) / 2 = (360 + 760) / 2 = 560
export const X_CENTRO_IZQ = 360;
export const X_CENTRO_DER = 760;
export const Y_CENTRO = 310;
export const LONG_RECTA = 400.0;                     // Longitud recta de tribunas y recta de enfrente (400m)
export const R_MEDIO = 500.0 / Math.PI;              // ≈ 159.155m (Cada semicírculo mide 500m)
export const R_RIEL = R_MEDIO - ANCHO_PISTA / 2;     // ≈ 124.15m (Riel interior)
export const R_EXTERIOR = R_MEDIO + ANCHO_PISTA / 2; // ≈ 194.15m (Baranda exterior)
export const LONG_SEMICIRCULO = 500.0;               // Cada semicírculo mide exactamente 500m

// SENTENCIA DE LLEGADA / META: En la recta final inferior en X = 720
export const X_META = 720;
export const DIST_SALIDA_CODO_A_META = X_META - X_CENTRO_IZQ; // 360m

// Límite de Chutes (+50m)
export const X_MAX_CHUTE_ENFRENTE = 1210;
export const X_MIN_CHUTE_RECTA_FINAL = -130;

/**
 * Retorna los puntos exactos sobre la baranda interior y baranda exterior
 * para trazar una raya perfectamente recta y perpendicular entre ambas barandas.
 */
export function obtenerHitoDistancia(distanciaRestanteMetros: number): {
  posRiel: { x: number; y: number };
  posExt: { x: number; y: number };
  posLabel: { x: number; y: number };
} {
  const m = Math.max(0, Math.min(1800, distanciaRestanteMetros));

  // 1. Recta Final inferior (0m a 360m): raya recta vertical entre barandas
  if (m <= DIST_SALIDA_CODO_A_META) {
    const x = X_META - m;
    return {
      posRiel: { x, y: Y_CENTRO + R_RIEL },
      posExt: { x, y: Y_CENTRO + R_EXTERIOR },
      posLabel: { x, y: Y_CENTRO + R_EXTERIOR + 14 },
    };
  }

  // 2. Codo Izquierdo (360m a 860m): raya recta radial perpendicular a ambas barandas
  const dEnCodoIzq = m - DIST_SALIDA_CODO_A_META;
  if (dEnCodoIzq <= LONG_SEMICIRCULO) {
    const fraccion = dEnCodoIzq / LONG_SEMICIRCULO;
    const theta = Math.PI / 2 + fraccion * Math.PI;
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);
    return {
      posRiel: { x: X_CENTRO_IZQ + R_RIEL * cosT, y: Y_CENTRO + R_RIEL * sinT },
      posExt: { x: X_CENTRO_IZQ + R_EXTERIOR * cosT, y: Y_CENTRO + R_EXTERIOR * sinT },
      posLabel: { x: X_CENTRO_IZQ + (R_EXTERIOR + 13) * cosT, y: Y_CENTRO + (R_EXTERIOR + 13) * sinT + 3 },
    };
  }

  // 3. Recta de Enfrente superior (860m a 1260m): raya recta vertical entre barandas
  const dEnRectaOpuesta = dEnCodoIzq - LONG_SEMICIRCULO;
  if (dEnRectaOpuesta <= LONG_RECTA) {
    const x = X_CENTRO_IZQ + dEnRectaOpuesta;
    return {
      posRiel: { x, y: Y_CENTRO - R_RIEL },
      posExt: { x, y: Y_CENTRO - R_EXTERIOR },
      posLabel: { x, y: Y_CENTRO - R_EXTERIOR - 8 },
    };
  }

  // 4. Primer Codo / Codo de Caballerizas (1260m a 1760m): raya recta radial perpendicular a ambas barandas
  const dEnPrimerCodo = dEnRectaOpuesta - LONG_RECTA;
  if (dEnPrimerCodo <= LONG_SEMICIRCULO) {
    const fraccion = dEnPrimerCodo / LONG_SEMICIRCULO;
    const phi = -Math.PI / 2 + fraccion * Math.PI;
    const cosP = Math.cos(phi);
    const sinP = Math.sin(phi);
    return {
      posRiel: { x: X_CENTRO_DER + R_RIEL * cosP, y: Y_CENTRO + R_RIEL * sinP },
      posExt: { x: X_CENTRO_DER + R_EXTERIOR * cosP, y: Y_CENTRO + R_EXTERIOR * sinP },
      posLabel: { x: X_CENTRO_DER + (R_EXTERIOR + 13) * cosP, y: Y_CENTRO + (R_EXTERIOR + 13) * sinP + 3 },
    };
  }

  // 5. Salida 1.800m en recta inferior (1760m a 1800m): raya recta vertical entre barandas
  const dResto = dEnPrimerCodo - LONG_SEMICIRCULO;
  const x = X_CENTRO_DER - dResto;
  return {
    posRiel: { x, y: Y_CENTRO + R_RIEL },
    posExt: { x, y: Y_CENTRO + R_EXTERIOR },
    posLabel: { x, y: Y_CENTRO + R_EXTERIOR + 14 },
  };
}

/**
 * Calcula posición (x, y) y ángulo en metros restantes hacia la meta.
 */
export function calcularPosicionEnOvalo(
  distanciaRestanteMetros: number,
  lambdaRiel: number = 0.2,
  distanciaOficialCarrera: number = 1400
): { x: number; y: number; anguloDeg: number; tramo: string } {
  const lambdaClamped = Math.max(0, Math.min(1, lambdaRiel));
  const rEfectivo = R_RIEL + lambdaClamped * ANCHO_PISTA;
  const longSemicirculo = LONG_SEMICIRCULO;

  // CASO A: Chute de 800m (Recta Final inferior hacia la izquierda)
  if (distanciaOficialCarrera <= 850) {
    const x = X_META - distanciaRestanteMetros;
    const y = Y_CENTRO + rEfectivo;
    return { x, y, anguloDeg: 0, tramo: "CHUTE_800M" };
  }

  // CASO B: Chute de Enfrente (1.300m a 1.650m, ej: 1.400m y 1.600m en recta superior derecha)
  const usaChuteEnfrente = distanciaOficialCarrera > 1200 && distanciaOficialCarrera <= 1650;
  if (usaChuteEnfrente && distanciaRestanteMetros > 1200) {
    const dEnChute = distanciaRestanteMetros - 1200;
    const x = X_CENTRO_DER + dEnChute;
    const y = Y_CENTRO - rEfectivo;
    return { x, y, anguloDeg: 180, tramo: "CHUTE_1600M" };
  }

  // CASO C: Recta Final hacia la Meta (0m a 360m de distancia restante)
  if (distanciaRestanteMetros <= DIST_SALIDA_CODO_A_META) {
    const x = X_META - distanciaRestanteMetros;
    const y = Y_CENTRO + rEfectivo;
    return { x, y, anguloDeg: 0, tramo: "RECTA_FINAL" };
  }

  // CASO D: Codo de la Rinconada (extremo izquierdo, 360m a 860m)
  const dEnCodoIzq = distanciaRestanteMetros - DIST_SALIDA_CODO_A_META;
  if (dEnCodoIzq <= longSemicirculo) {
    const fraccion = dEnCodoIzq / longSemicirculo;
    const theta = Math.PI / 2 + fraccion * Math.PI;
    const x = X_CENTRO_IZQ + rEfectivo * Math.cos(theta);
    const y = Y_CENTRO + rEfectivo * Math.sin(theta);
    const anguloDeg = (theta - Math.PI / 2) * (180 / Math.PI);
    return { x, y, anguloDeg, tramo: "CODO_IZQ" };
  }

  // CASO E: Recta de Enfrente (860m a 1.260m)
  const dEnRectaOpuesta = dEnCodoIzq - longSemicirculo;
  if (dEnRectaOpuesta <= LONG_RECTA) {
    const x = X_CENTRO_IZQ + dEnRectaOpuesta;
    const y = Y_CENTRO - rEfectivo;
    return { x, y, anguloDeg: 180, tramo: "RECTA_ENFRENTE" };
  }

  // CASO F: Primer Codo / Codo de Caballerizas (1.260m a 1.760m para carreras de 1.800m)
  const dEnPrimerCodo = dEnRectaOpuesta - LONG_RECTA;
  if (dEnPrimerCodo <= longSemicirculo) {
    const fraccion = dEnPrimerCodo / longSemicirculo;
    const phi = -Math.PI / 2 + fraccion * Math.PI;
    const x = X_CENTRO_DER + rEfectivo * Math.cos(phi);
    const y = Y_CENTRO + rEfectivo * Math.sin(phi);
    const anguloDeg = (180 + (phi + Math.PI / 2) * (180 / Math.PI)) % 360;
    return { x, y, anguloDeg, tramo: "PRIMER_CODO" };
  }

  // CASO G: Tramo de 1.760m a 1.800m (partida en la recta de tribunas hacia el primer codo)
  const dResto = dEnPrimerCodo - longSemicirculo;
  const x = X_CENTRO_DER - dResto;
  const y = Y_CENTRO + rEfectivo;
  return { x, y, anguloDeg: 0, tramo: "SALIDA_1800M" };
}

export type EstiloCarreraSincronizada = "E1" | "E2" | "E3";

export interface InputDinamicaEjemplar {
  numero: number;
  estilo: EstiloCarreraSincronizada | string;
  ordenLlegadaProyectado: number;
  cuerposVentaja: number;
}

export interface EstadoEjemplarSincronizado {
  numero: number;
  distanciaRestante: number;
  distanciaRecorrida: number;
  porcentajeAvanceCentral: number;
  posXCentral: number;
  esLiderActual: boolean;
}

/**
 * Calcula la dinámica de carrera y la sincronía total 1:1 de distancias
 * entre el óvalo exterior y la pista recta central.
 * Ambos trazados leen exactamente la misma variable `distanciaRestante`.
 */
export function calcularDinamicaSincronizadaCarrera(
  progresoPorcentaje: number, // 0 a 100
  distanciaCarreraMetros: number,
  participantes: InputDinamicaEjemplar[]
): EstadoEjemplarSincronizado[] {
  const u = Math.max(0, Math.min(1, progresoPorcentaje / 100));
  const D = distanciaCarreraMetros;

  const resultadosPrevios = participantes.map((p) => {
    const estilo = (p.estilo || "E2").toUpperCase();
    const orden = p.ordenLlegadaProyectado;
    const desfaseFinal = p.cuerposVentaja * 2.4; // 1 cuerpo ≈ 2.4m

    // Variación dinámica según estilo táctico (Puntero E1, Colocado E2, Atropellador E3):
    let deltaEstilo = 0;
    if (estilo === "E1") {
      // Puntero: acelera con violencia al inicio (+16m) y sostiene la punta hasta la recta
      deltaEstilo = 16.0 * Math.sin(Math.PI * u) * Math.max(0, 1 - u * 0.75);
    } else if (estilo === "E3") {
      // Atropellador: corre contenido al inicio (-10m) y remata al entrar a la recta final
      if (u < 0.6) {
        deltaEstilo = -10.0 * Math.sin(Math.PI * (u / 0.6));
      } else {
        const tRemate = (u - 0.6) / 0.4;
        const bonoGanador = orden === 1 ? 4.5 : 0;
        deltaEstilo = -10.0 * Math.cos((Math.PI / 2) * tRemate) + bonoGanador * Math.sin(Math.PI * tRemate);
      }
    } else {
      // E2 Colocado: ritmo sostenido detrás de la velocidad (+4m)
      deltaEstilo = 4.0 * Math.sin(Math.PI * u);
    }

    const margenProgresivo = desfaseFinal * Math.pow(u, 1.4);
    let dRecorrida = u * D + deltaEstilo - margenProgresivo;
    if (u >= 1.0) {
      dRecorrida = D - desfaseFinal;
    } else {
      dRecorrida = Math.max(0, Math.min(D - 0.1, dRecorrida));
    }

    const dRestante = Math.max(0, D - dRecorrida);
    const pctCentral = Math.max(0, Math.min(100, ((D - dRestante) / D) * 100));
    const posXCentral = 35 + (pctCentral / 100) * 480;

    return {
      numero: p.numero,
      distanciaRestante: dRestante,
      distanciaRecorrida: D - dRestante,
      porcentajeAvanceCentral: pctCentral,
      posXCentral,
      esLiderActual: false,
    };
  });

  // Determinar el líder actual en tiempo real (el de menor distancia restante)
  const menorDistancia = Math.min(...resultadosPrevios.map((r) => r.distanciaRestante));
  return resultadosPrevios.map((r) => ({
    ...r,
    esLiderActual: Math.abs(r.distanciaRestante - menorDistancia) < 0.001,
  }));
}

/**
 * Convierte un tiempo en segundos a formato venezolano tradicional de quintos de segundo.
 * En La Rinconada y la Gaceta Hípica: 1 segundo = 5 quintos (cada quinto = 0.2s).
 * Ejemplos:
 *  - 23.2s -> '23"1'
 *  - 46.4s -> '46"2'
 *  - 71.8s -> '1:11"4'
 *  - 84.4s -> '1:24"2'
 *  - 12.6s -> '12"3'
 */
export function formatearTiempoQuintos(segundosDecimal: number): string {
  if (segundosDecimal <= 0 || !Number.isFinite(segundosDecimal)) return '--"--';
  const totalSeg = Math.max(0, segundosDecimal);
  const minutos = Math.floor(totalSeg / 60);
  const segRestantes = totalSeg - minutos * 60;
  const segEnteros = Math.floor(segRestantes);
  const decimas = segRestantes - segEnteros;
  const quintos = Math.min(4, Math.round(decimas * 5));

  const quintosStr = quintos === 0 ? "" : `${quintos}`;
  const segStr = minutos > 0 ? segEnteros.toString().padStart(2, "0") : segEnteros.toString();

  if (minutos > 0) {
    return `${minutos}:${segStr}"${quintosStr}`;
  }
  return `${segStr}"${quintosStr}`;
}

/**
 * Formato digital de cronómetro deportivo: MM:SS.d
 */
export function formatearCronometroDigital(segundosDecimal: number): string {
  if (segundosDecimal <= 0 || !Number.isFinite(segundosDecimal)) return "00:00.0";
  const totalSeg = Math.max(0, segundosDecimal);
  const minutos = Math.floor(totalSeg / 60);
  const seg = totalSeg - minutos * 60;
  const segEnteros = Math.floor(seg);
  const decima = Math.floor((seg - segEnteros) * 10);
  return `${minutos.toString().padStart(2, "0")}:${segEnteros.toString().padStart(2, "0")}.${decima}`;
}

export interface ParcialDetalle {
  id: string;
  distanciaMetros: number;     // 400, 800, 1200, 1600...
  etiqueta: string;            // '1° Parcial (400m)', '2° Parcial (800m)', etc.
  etiquetaCorta: string;       // '400m', '800m'
  tiempoAcumuladoSegundos: number; // Tiempo oficial simulado cuando el puntero pasa
  tiempoQuintos: string;       // ej: 23"1, 46"2
  tiempoDecimal: string;       // ej: 23.2s
  alcanzado: boolean;          // true si el líder ya cruzó este hito
  tiempoActualVisible: string; // congelado si alcanzado, o en progreso
}

export interface RemateDetalle {
  metrosRemate: number;        // Diferencia de metros finales (ej: 200m en 1400m, 300m en 1500m)
  tiempoRemateSegundos: number; // Diferencia de tiempo: tiempoFinal - tiempoUltimo400
  tiempoRemateQuintos: string; // ej: 12"3
  tiempoRemateDecimal: string; // ej: 12.6s
  alcanzado: boolean;
}

export interface CronometrajeCarreraINH {
  distanciaCarrera: number;
  tiempoTranscurridoSegundos: number;
  cronometroDigital: string;
  tiempoTranscurridoQuintos: string;
  parciales400m: ParcialDetalle[];
  remateFinal: RemateDetalle | null;
  tiempoFinalTotalSegundos: number;
  tiempoFinalTotalQuintos: string;
  carreraFinalizada: boolean;
}

/**
 * Calcula los parciales oficiales cada 400 metros y el remate de los últimos metros
 * según el reglamento y práctica oficial de La Rinconada (INH).
 */
export function calcularCronometrajeYParcialesINH(
  distanciaCarreraMetros: number,
  distanciaRecorridaLider: number,
  speedRatingPromedio: number = 85
): CronometrajeCarreraINH {
  const D = Math.max(400, distanciaCarreraMetros);
  const dRec = Math.max(0, Math.min(D, distanciaRecorridaLider));

  // Factor de velocidad según Speed Rating (85 base = 1.0; 90 = 1.015; 80 = 0.985)
  const factorSR = 1.0 + (speedRatingPromedio - 85) * 0.003;

  // Tiempos base por cada tramo de 400m en La Rinconada:
  // 1° 400m: 23.2s (salida de parado del aparato)
  // 2° 400m (400 a 800m): 22.8s (en carrera lanzada)
  // 3° 400m (800 a 1200m): 24.8s (giro de curva / recta)
  // 4° 400m (1200 a 1600m): 26.0s (resistencia)
  // 5° 400m (1600 a 2000m): 27.2s
  const tiemposTramos400 = [23.2, 22.8, 24.8, 26.0, 27.2, 28.0].map((t) => t / factorSR);

  // Generamos los parciales cada 400 metros estrictamente mientras d <= D
  const parciales: ParcialDetalle[] = [];
  let tiempoAcumulado = 0;
  let distAcum = 0;
  let tramoIndex = 0;

  while (distAcum + 400 <= D) {
    distAcum += 400;
    const tTramo = tiemposTramos400[tramoIndex] ?? (27.5 / factorSR);
    tiempoAcumulado += tTramo;
    tramoIndex++;

    const alcanzado = dRec >= distAcum;
    parciales.push({
      id: `parcial-${distAcum}`,
      distanciaMetros: distAcum,
      etiqueta: `${parciales.length + 1}° Parcial (${distAcum}m)`,
      etiquetaCorta: `${distAcum}m`,
      tiempoAcumuladoSegundos: Number(tiempoAcumulado.toFixed(2)),
      tiempoQuintos: formatearTiempoQuintos(tiempoAcumulado),
      tiempoDecimal: `${tiempoAcumulado.toFixed(1)}s`,
      alcanzado,
      tiempoActualVisible: alcanzado ? formatearTiempoQuintos(tiempoAcumulado) : '--"--',
    });
  }

  // Remate de los últimos metros:
  // "los parciales son cada 400 metros, y la diferencia es el remate de los últimos metros"
  const metrosRemate = D - distAcum;
  let tiempoRemate = 0;

  if (metrosRemate > 0) {
    // Velocidad del tramo final (aprox 15.5 m/s ajustado por SR)
    const velocidadFinal = 15.5 * factorSR;
    tiempoRemate = Number((metrosRemate / velocidadFinal).toFixed(2));
  } else if (distAcum === D && parciales.length > 0) {
    // Si la distancia es múltiplo exacto de 400 (ej: 1200m o 1600m), el remate son los últimos 400m
    const ultimoParcial = parciales[parciales.length - 1];
    const penultimoTiempo = parciales.length > 1 ? parciales[parciales.length - 2].tiempoAcumuladoSegundos : 0;
    tiempoRemate = Number((ultimoParcial.tiempoAcumuladoSegundos - penultimoTiempo).toFixed(2));
  }

  const tiempoFinalTotal = Number((tiempoAcumulado + (metrosRemate > 0 ? tiempoRemate : 0)).toFixed(2));
  const carreraFinalizada = dRec >= D;

  // Tiempo transcurrido actual del líder
  let tiempoTranscurrido = 0;
  if (dRec <= 0) {
    tiempoTranscurrido = 0;
  } else if (carreraFinalizada) {
    tiempoTranscurrido = tiempoFinalTotal;
  } else {
    // Interpolación proporcional a lo largo de los tramos
    let dAcumPrev = 0;
    let tAcumPrev = 0;

    for (const p of parciales) {
      if (dRec <= p.distanciaMetros) {
        const fraccionTramo = (dRec - dAcumPrev) / (p.distanciaMetros - dAcumPrev);
        tiempoTranscurrido = tAcumPrev + fraccionTramo * (p.tiempoAcumuladoSegundos - tAcumPrev);
        break;
      }
      dAcumPrev = p.distanciaMetros;
      tAcumPrev = p.tiempoAcumuladoSegundos;
    }

    if (dRec > distAcum && metrosRemate > 0) {
      const fraccionRemate = (dRec - distAcum) / metrosRemate;
      tiempoTranscurrido = tiempoAcumulado + fraccionRemate * tiempoRemate;
    }
  }

  const remateFinal: RemateDetalle | null =
    metrosRemate > 0
      ? {
          metrosRemate,
          tiempoRemateSegundos: tiempoRemate,
          tiempoRemateQuintos: formatearTiempoQuintos(tiempoRemate),
          tiempoRemateDecimal: `${tiempoRemate.toFixed(1)}s`,
          alcanzado: carreraFinalizada,
        }
      : null;

  return {
    distanciaCarrera: D,
    tiempoTranscurridoSegundos: Number(tiempoTranscurrido.toFixed(2)),
    cronometroDigital: formatearCronometroDigital(tiempoTranscurrido),
    tiempoTranscurridoQuintos: formatearTiempoQuintos(tiempoTranscurrido),
    parciales400m: parciales,
    remateFinal,
    tiempoFinalTotalSegundos: tiempoFinalTotal,
    tiempoFinalTotalQuintos: formatearTiempoQuintos(tiempoFinalTotal),
    carreraFinalizada,
  };
}

export interface HitoPistaCentral {
  distanciaRestante: number; // metros hacia la meta
  distanciaRecorrida: number; // metros recorridos desde la salida
  x: number;                  // coordenada x en el viewBox de la pista central (35 a 515)
  esMayor: boolean;           // hito destacado (cada 200m o parcial de 400m)
  esParcial400: boolean;      // hito de 400m (400, 800, 1200, 1600)
  esRemateInicio: boolean;    // inicio del remate final
  etiqueta: string;           // texto de la marca (ej: '1400m', '1200m', '1000m', 'META')
  etiquetaParcial?: string;   // '⏱️ 400m', '⏱️ 800m'
}

/**
 * Genera todos los hitos de distancia a lo largo de la pista central
 * desde la partida hasta la meta, incluyendo las marcas de parciales cada 400m.
 */
export function obtenerHitosPistaCentral(distanciaCarreraMetros: number): HitoPistaCentral[] {
  const D = Math.max(400, distanciaCarreraMetros);
  const hitos: HitoPistaCentral[] = [];
  const paso = 100; // Hito cada 100 metros

  const dUltimo400 = Math.floor(D / 400) * 400;
  const metrosRemate = D - dUltimo400;

  for (let dRest = D; dRest >= 0; dRest -= paso) {
    const dRec = D - dRest;
    const fraccion = dRec / D;
    const x = 35 + fraccion * 480;

    const esParcial400 = dRec > 0 && dRec % 400 === 0 && dRec < D;
    const esRemateInicio = dRec === dUltimo400 && metrosRemate > 0;
    const esMayor = dRest % 200 === 0 || dRest === 0 || dRest === D || esParcial400;

    let etiqueta = `${dRest}m`;
    if (dRest === D) etiqueta = `PP (${D}m)`;
    else if (dRest === 0) etiqueta = `META`;

    let etiquetaParcial: string | undefined;
    if (esParcial400) {
      etiquetaParcial = `⏱️ ${dRec}m`;
    }

    hitos.push({
      distanciaRestante: dRest,
      distanciaRecorrida: dRec,
      x: Number(x.toFixed(2)),
      esMayor,
      esParcial400,
      esRemateInicio,
      etiqueta,
      etiquetaParcial,
    });
  }

  return hitos;
}
