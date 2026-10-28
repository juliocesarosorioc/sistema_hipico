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

    // Variación dinámica según estilo táctico:
    let deltaEstilo = 0;
    if (estilo === "E1") {
      // Puntero: acelera y saca ventaja inicial (pico en u ≈ 0.35)
      deltaEstilo = 4.5 * Math.sin(Math.PI * u) * Math.max(0, 1 - u * 0.75);
    } else if (estilo === "E3") {
      // Atropellador: corre contenido al inicio (-4m) y remata al final
      if (u < 0.6) {
        deltaEstilo = -4.0 * Math.sin(Math.PI * (u / 0.6));
      } else {
        const tRemate = (u - 0.6) / 0.4;
        const bonoGanador = orden === 1 ? 5.5 : 2.5;
        deltaEstilo = -4.0 * (1 - tRemate) + bonoGanador * Math.sin(Math.PI * tRemate * 0.5);
      }
    } else {
      // E2 Colocado: ritmo sostenido
      deltaEstilo = 1.0 * Math.sin(Math.PI * u);
    }

    const margenProgresivo = desfaseFinal * Math.pow(u, 1.25);
    let dRecorrida = u * D + deltaEstilo - margenProgresivo;
    dRecorrida = Math.max(0, Math.min(D - (u >= 1 ? desfaseFinal : 0), dRecorrida));

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
