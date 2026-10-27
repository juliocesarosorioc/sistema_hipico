/**
 * Procesador y liquidador de jugadas por puestos (P/N)
 * Delegado a la Única Fuente de Verdad (SSOT): `@/features/motores/lib/puestos`
 */
import {
  parsearNomenclatura,
  validarPuesto,
  evaluarPuestoPorPosicion,
  type Nomenclatura,
} from "@/features/motores/lib/puestos";

export { validarPuesto, evaluarPuestoPorPosicion };

export type MontosPorModalidad = Record<string, number>;

export interface LineaProcesada {
  modalidad: string;
  monto: number;
  bloque: number;
}

export interface ResultadoLiquidacion {
  estado: "GANADOR" | "PERDEDOR" | "NULO";
  montoApostado: number;
  ganancia: number; // 0 si pierde o nulo, montoApostado si gana (sin dividendos por ahora)
  reintegro: number; // montoApostado si NULO, 0 en otro caso
}

function normalizarNumerosConSlash(texto: string): string {
  return texto
    .replace(/(\d+)\/(\d+)([nN])\b/g, "$1/$2$3")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Paso 0 - Normalización
 * Reemplaza y, -, coma por espacios, normaliza slashes y completa p por defecto (prohibiendo 1n).
 */
export function normalizarTextoJugadas(textoJugada: string): string {
  if (!textoJugada || typeof textoJugada !== "string") return "";

  const s = textoJugada
    .trim()
    .replace(/[,;\-]/g, " ")
    .replace(/\by\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  const tokens = s.split(/\s+/);
  const normalizados = tokens.map((t) => {
    if (!t) return t;
    if (/^\d+$/.test(t)) {
      return `${t}p`;
    }
    const m = t.match(/^(\d+)([pn])?$/i);
    if (m) {
      const num = m[1];
      const letra = m[2]?.toLowerCase() ?? "p";
      // Regla 1: 1N está prohibido
      if (num === "1" && letra === "n") return "";
      return `${num}${letra}`;
    }
    return t;
  }).filter(Boolean);

  return normalizarNumerosConSlash(normalizados.join(" "));
}

function acumularNomenclatura(nom: Nomenclatura, monto: number, destino: MontosPorModalidad) {
  if (monto <= 0) return;
  if (nom.bloques && nom.bloques.length > 0) {
    const share = monto / nom.bloques.length;
    for (const sub of nom.bloques) {
      acumularNomenclatura(sub, share, destino);
    }
    return;
  }
  if (nom.puesto == null) return;
  // Regla 1: 1N no existe
  if (nom.puesto === 1 && nom.esNini) return;
  const key = `${nom.puesto}${nom.esNini ? "n" : "p"}`;
  destino[key] = (destino[key] ?? 0) + monto;
}

/**
 * Paso 1 y 2 - Procesar jugadas por puestos
 * Usa el parser SSOT (`parsearNomenclatura`) cuando es una expresión canónica
 * (Individual, Combinada 50/50 o Bloque en Escalera 75/25 · 25/75).
 */
export function procesarJugadasPuestos(textoJugada: string, montoBase: number): MontosPorModalidad {
  if (!textoJugada || montoBase <= 0) return {};
  const val = validarPuesto(textoJugada);
  if (val.ok) {
    const nom = parsearNomenclatura(textoJugada);
    if (nom) {
      const resultadoSSOT: MontosPorModalidad = {};
      acumularNomenclatura(nom, montoBase, resultadoSSOT);
      for (const k of Object.keys(resultadoSSOT)) {
        resultadoSSOT[k] = Math.round(resultadoSSOT[k] * 100) / 100;
      }
      return resultadoSSOT;
    }
  }

  // Prohibición estricta de 1N (Regla 1)
  if (/(?:^|[^0-9])1\s*n(?![a-z])/i.test(textoJugada)) {
    return {};
  }

  const normalizado = normalizarTextoJugadas(textoJugada);
  const tokens = normalizado
    .split(/\s+/)
    .filter((t) => t && /\d+([pn])?([\/y]\d+([pn])?)?$/i.test(t));

  if (tokens.length === 0) return {};

  const montoPorBloque = montoBase / tokens.length;
  const resultado: MontosPorModalidad = {};

  for (const token of tokens) {
    const nomToken = parsearNomenclatura(token);
    if (nomToken) {
      acumularNomenclatura(nomToken, montoPorBloque, resultado);
    }
  }

  const resultadoRedondeado: MontosPorModalidad = {};
  for (const [k, v] of Object.entries(resultado)) {
    resultadoRedondeado[k] = Math.round(v * 100) / 100;
  }
  return resultadoRedondeado;
}

/**
 * Paso 3 - Liquidar ticket por puesto (delegado al SSOT `puestos.ts`)
 */
export function liquidarTicketPuesto(
  modalidad: string,
  puestoOficial: number,
  montoApostado: number,
  nCorredores?: number
): ResultadoLiquidacion {
  if (!modalidad || montoApostado <= 0 || !Number.isFinite(puestoOficial) || puestoOficial <= 0) {
    return {
      estado: "PERDEDOR",
      montoApostado,
      ganancia: 0,
      reintegro: 0,
    };
  }

  const v = validarPuesto(modalidad, nCorredores);
  if (!v.ok) {
    // Si falló por falta de riesgo bilateral (nCorredores), se anula con reintegro; si es sintaxis inválida (1N), pierde/rechaza
    if (typeof nCorredores === "number" && v.minimoCorredores && nCorredores < v.minimoCorredores) {
      return {
        estado: "NULO",
        montoApostado,
        ganancia: 0,
        reintegro: montoApostado,
      };
    }
    return {
      estado: "PERDEDOR",
      montoApostado,
      ganancia: 0,
      reintegro: 0,
    };
  }

  const m = modalidad.toLowerCase().match(/^(\d+)([pn])$/);
  if (!m) {
    return {
      estado: "PERDEDOR",
      montoApostado,
      ganancia: 0,
      reintegro: 0,
    };
  }

  const num = parseInt(m[1], 10);
  const tipo = m[2]; // 'p' o 'n'
  if (num === 1 && tipo === "n") {
    return {
      estado: "PERDEDOR",
      montoApostado,
      ganancia: 0,
      reintegro: 0,
    };
  }

  if (tipo === "p") {
    if (puestoOficial <= num) {
      return {
        estado: "GANADOR",
        montoApostado,
        ganancia: montoApostado,
        reintegro: 0,
      };
    }
    return {
      estado: "PERDEDOR",
      montoApostado,
      ganancia: 0,
      reintegro: 0,
    };
  }

  if (puestoOficial < num) {
    return {
      estado: "GANADOR",
      montoApostado,
      ganancia: montoApostado,
      reintegro: 0,
    };
  } else if (puestoOficial === num) {
    return {
      estado: "NULO",
      montoApostado,
      ganancia: 0,
      reintegro: montoApostado,
    };
  }
  return {
    estado: "PERDEDOR",
    montoApostado,
    ganancia: 0,
    reintegro: 0,
  };
}
