/**
 * Procesador y liquidador de jugadas por puestos (P/N)
 * Soporta división de bloques, fraccionamiento 50/50 y nomenclatura p/n con Nulo (reintegro)
 */

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

const NUMERO_MODALIDAD_REGEX = /^(\d+)([pn]?)$/i;

function normalizarNumerosConSlash(texto: string): string {
  return texto
    .replace(/(\d+)\/(\d+)([nN])\b/g, "$1/$2$3")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Paso 0 - Normalización
 * Reemplaza y, -, coma por espacios, normaliza slashes y completa p por defecto
 */
export function normalizarTextoJugadas(textoJugada: string): string {
  if (!textoJugada || typeof textoJugada !== "string") return "";
  
  let s = textoJugada
    .trim()
    // Reemplazar separadores por espacio
    .replace(/[,;\-]/g, " ")
    .replace(/\by\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  
  // Completar p por defecto cuando solo hay número
  const tokens = s.split(/\s+/);
  const normalizados = tokens.map((t) => {
    if (!t) return t;
    // Si es solo número
    if (/^\d+$/.test(t)) {
      return `${t}p`;
    }
    // Si es número con p o n
    const m = t.match(/^(\d+)([pn])?$/i);
    if (m) {
      const num = m[1];
      const letra = m[2]?.toLowerCase() ?? "p";
      return `${num}${letra}`;
    }
    return t;
  });
  
  return normalizarNumerosConSlash(normalizados.join(" "));
}

/**
 * Extraer sólo tokens válidos de jugadas (ignora palabras inválidas)
 */
function extraerTokensJugadas(textoNormalizado: string): string[] {
  if (!textoNormalizado) return [];
  const tokens = textoNormalizado.split(/\s+/);
  const validos: string[] = [];
  for (const t of tokens) {
    if (!t) continue;
    // Acepta Xp, Xn, X/Y, X/Yn, X/Yp, X/Yn
    if (/\d+([pn])?(\/\d+([pn])?)?$/i.test(t)) {
      validos.push(t.toLowerCase());
    }
    // También acepta patrones con /n o /p al final
  }
  return validos;
}

/**
 * Paso 1 y 2 - Procesar jugadas por puestos
 * Divide por bloques, aplica 50/50 en fraccionadas
 */
export function procesarJugadasPuestos(textoJugada: string, montoBase: number): MontosPorModalidad {
  const normalizado = normalizarTextoJugadas(textoJugada);
  const tokens = extraerTokensJugadas(normalizado);
  
  if (tokens.length === 0) {
    return {};
  }
  
  const cantidadBloques = tokens.length;
  const montoPorBloque = cantidadBloques === 0 ? 0 : montoBase / cantidadBloques;
  
  const resultado: MontosPorModalidad = {};
  
  function agregar(modalidad: string, monto: number) {
    if (monto <= 0) return;
    const key = modalidad.toLowerCase();
    resultado[key] = (resultado[key] ?? 0) + monto;
  }
  
  for (const token of tokens) {
    // Tiene slash? Jugada combinada
    if (token.includes("/")) {
      // Extraer patrón X/Y o X/Yn
      const m = token.match(/^(\d+)\/(\d+)([pn])?$/i);
      if (!m) continue;
      const x = parseInt(m[1], 10);
      const y = parseInt(m[2], 10);
      const letraY = m[3]?.toLowerCase(); // puede ser undefined o n/p
      
      const mitad = montoPorBloque / 2;
      
      if (x === y) {
        // Regla: números idénticos X/Xn -> 50% a Xn y 50% a Xp
        const letraYn = letraY ?? "n"; // Por convención, si no indica, en X/X suele usarse n
        agregar(`${y}${letraYn}`, mitad);
        agregar(`${x}p`, mitad);
      } else {
        // Regla: números consecutivos X/Yn -> 50% baja a Xp y 50% va a Yn
        const letraYnFinal = letraY ?? "n";
        agregar(`${x}p`, mitad);
        agregar(`${y}${letraYnFinal}`, mitad);
      }
    } else {
      // Jugada directa
      const m = token.match(/^(\d+)([pn])?$/i);
      if (!m) continue;
      const num = m[1];
      const letra = m[2]?.toLowerCase() ?? "p";
      agregar(`${num}${letra}`, montoPorBloque);
    }
  }
  
  // Redondear a decimales razonables (evitar floating point)
  const resultadoRedondeado: MontosPorModalidad = {};
  for (const [k, v] of Object.entries(resultado)) {
    // Redondear a 2 decimales
    resultadoRedondeado[k] = Math.round(v * 100) / 100;
  }
  
  return resultadoRedondeado;
}

/**
 * Paso 3 - Liquidar ticket por puesto
 */
export function liquidarTicketPuesto(
  modalidad: string,
  puestoOficial: number,
  montoApostado: number
): ResultadoLiquidacion {
  if (!modalidad || montoApostado <= 0 || !Number.isFinite(puestoOficial) || puestoOficial <= 0) {
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
  
  if (tipo === "p") {
    // Nomenclatura "p": Gana si puestoOficial <= num. Pierde si > num
    if (puestoOficial <= num) {
      return {
        estado: "GANADOR",
        montoApostado,
        ganancia: montoApostado,
        reintegro: 0,
      };
    } else {
      return {
        estado: "PERDEDOR",
        montoApostado,
        ganancia: 0,
        reintegro: 0,
      };
    }
  } else {
    // tipo === "n"
    // Gana si puestoOficial < num
    // Nulo si puestoOficial === num (reintegro)
    // Pierde si puestoOficial > num
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
    } else {
      return {
        estado: "PERDEDOR",
        montoApostado,
        ganancia: 0,
        reintegro: 0,
      };
    }
  }
}
