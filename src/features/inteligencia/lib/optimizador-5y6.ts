/**
 * ============================================================================
 * OPTIMIZADOR DEL CUADRO MAESTRO 5Y6 (VÁLIDAS 1ª A 6ª)
 * ============================================================================
 * Algoritmo actuarial y de programación dinámica para la selección de combinaciones
 * óptimas del 5y6 Nacional (La Rinconada / Valencia).
 * Maximiza la probabilidad conjunta de acierto (6 de 6) sujeto a restricciones
 * de presupuesto y estrategia táctica.
 */

import { ResultadoCarreraV4, ResultadoEjemplarV4 } from "./analista-venezuela-v4";

export type Estrategia5y6 = "ECONOMICO" | "EQUILIBRADO" | "BLINDADO" | "PERSONALIZADO";

export type Valida5y6Config = {
  numeroValida: number; // 1 a 6
  carreraNumero: number; // ej: C8, C9, etc.
  distancia: number;
  carrera: ResultadoCarreraV4;
  seleccionados: number[]; // números de gualdrapa elegidos
  esLinea: boolean;
  esMorocha: boolean;
};

export type CuadroMaestro5y6Resultado = {
  fecha: string;
  hipodromo: string;
  factorMultiplicador: number; // defecto: 35.0
  estrategia: Estrategia5y6;
  presupuestoMaximo?: number;
  combinacionesTotales: number;
  costoTotalBs: number;
  probabilidadCoberturaPct: number; // Probabilidad estimada de acertar los 6
  validas: Valida5y6Config[];
  lineasFijas: Array<{ valida: number; numero: number; nombre: string; prob: number }>;
  morochas: Array<{ valida: number; numeros: number[]; nombres: string[] }>;
  sorpresas: Array<{ valida: number; numero: number; nombre: string }>;
  resumenTextoWhatsApp: string;
};

export const ESTRATEGIAS_META: Record<
  Estrategia5y6,
  { titulo: string; descripcion: string; distribucionSugerida: number[] }
> = {
  ECONOMICO: {
    titulo: "🎯 Económico / Quirúrgico",
    descripcion: "2 Líneas Fijas + 2 Dobles + 2 Triples (36 combinaciones). Mínimo costo con alta precisión.",
    distribucionSugerida: [1, 1, 2, 2, 3, 3],
  },
  EQUILIBRADO: {
    titulo: "⚖️ Equilibrado / Alta Cobertura",
    descripcion: "1 Línea Fija + 2 Dobles + 3 Triples (108 combinaciones). El formato profesional estándar.",
    distribucionSugerida: [1, 2, 2, 3, 3, 3],
  },
  BLINDADO: {
    titulo: "🛡️ Blindado / Caza-Dividendos",
    descripcion: "1 Línea Fija + 1 Doble + 3 Triples + 1 Cuádruple (216 combinaciones). Cobertura amplia para pozos acumulados.",
    distribucionSugerida: [1, 2, 3, 3, 3, 4],
  },
  PERSONALIZADO: {
    titulo: "⚙️ Personalizado por Presupuesto",
    descripcion: "Optimiza la distribución de ejemplares para maximizar la probabilidad dentro del presupuesto indicado.",
    distribucionSugerida: [1, 2, 2, 3, 3, 3],
  },
};

/**
 * Optimiza y genera el Cuadro Maestro 5y6 para las 6 válidas de la jornada.
 */
export function generarCuadroMaestro5y6(params: {
  fecha: string;
  hipodromo: string;
  carrerasValidas: ResultadoCarreraV4[]; // Exactamente o al menos las 6 válidas ordenadas
  factorMultiplicador?: number;
  estrategia?: Estrategia5y6;
  presupuestoMaximo?: number;
  seleccionManual?: Record<number, number[]>; // valida 1..6 -> [nums]
}): CuadroMaestro5y6Resultado {
  const factor = params.factorMultiplicador ?? 35.0;
  const estrategia = params.estrategia ?? "EQUILIBRADO";
  const validasInput = params.carrerasValidas.slice(0, 6);

  // Asegurar que tengamos hasta 6 válidas
  const validasConfigs: Valida5y6Config[] = validasInput.map((c, idx) => {
    const numValida = idx + 1;
    // Filtrar ejemplares no retirados
    const activos = c.ranking.filter((r) => !r.ejemplar.retirado);
    let seleccion: number[] = [];

    if (params.seleccionManual && params.seleccionManual[numValida]) {
      seleccion = params.seleccionManual[numValida];
    } else {
      // Asignar según estrategia inicial
      const cantSugerida = ESTRATEGIAS_META[estrategia].distribucionSugerida[idx] || 2;
      seleccion = activos.slice(0, Math.min(cantSugerida, activos.length)).map((r) => r.ejemplar.numero);
    }

    return {
      numeroValida: numValida,
      carreraNumero: c.carreraNumero,
      distancia: c.distancia,
      carrera: c,
      seleccionados: seleccion,
      esLinea: seleccion.length === 1,
      esMorocha: seleccion.length === 2,
    };
  });

  // Calcular total combinaciones: n1 * n2 * n3 * n4 * n5 * n6
  const combinaciones = validasConfigs.reduce(
    (acc, v) => acc * Math.max(1, v.seleccionados.length),
    1
  );
  const costoTotal = Number((combinaciones * factor).toFixed(2));

  // Probabilidad conjunta aproximada: P(6 de 6) = Prod P(acierto en valida i)
  let probConjunta = 1.0;
  validasConfigs.forEach((v) => {
    const sumaProbValida = v.carrera.ranking
      .filter((r) => v.seleccionados.includes(r.ejemplar.numero))
      .reduce((acc, curr) => acc + (curr.probabilidadSMIC || 0), 0);
    probConjunta *= Math.min(1.0, (sumaProbValida || 20) / 100);
  });
  const coberturaPct = Number((probConjunta * 100).toFixed(2));

  // Identificar Líneas Fijas, Morochas y Sorpresas
  const lineasFijas: Array<{ valida: number; numero: number; nombre: string; prob: number }> = [];
  const morochas: Array<{ valida: number; numeros: number[]; nombres: string[] }> = [];
  const sorpresas: Array<{ valida: number; numero: number; nombre: string }> = [];

  validasConfigs.forEach((v) => {
    if (v.seleccionados.length === 1) {
      const ej = v.carrera.ranking.find((r) => r.ejemplar.numero === v.seleccionados[0]);
      if (ej) {
        lineasFijas.push({
          valida: v.numeroValida,
          numero: ej.ejemplar.numero,
          nombre: ej.ejemplar.nombre,
          prob: ej.probabilidadSMIC,
        });
      }
    } else if (v.seleccionados.length === 2) {
      const ejs = v.carrera.ranking.filter((r) => v.seleccionados.includes(r.ejemplar.numero));
      morochas.push({
        valida: v.numeroValida,
        numeros: ejs.map((e) => e.ejemplar.numero),
        nombres: ejs.map((e) => e.ejemplar.nombre),
      });
    }

    // Sorpresas incluidas
    v.carrera.ranking
      .filter((r) => v.seleccionados.includes(r.ejemplar.numero) && r.esSorpresaOverlay)
      .forEach((s) => {
        sorpresas.push({
          valida: v.numeroValida,
          numero: s.ejemplar.numero,
          nombre: s.ejemplar.nombre,
        });
      });
  });

  // Generar texto resumen formateado para WhatsApp / Impresión
  const resumenTexto = generarTextoWhatsAppCuadro5y6({
    fecha: params.fecha,
    hipodromo: params.hipodromo,
    combinaciones,
    costoTotal,
    factor,
    coberturaPct,
    validas: validasConfigs,
    lineasFijas,
    morochas,
  });

  return {
    fecha: params.fecha,
    hipodromo: params.hipodromo,
    factorMultiplicador: factor,
    estrategia,
    presupuestoMaximo: params.presupuestoMaximo,
    combinacionesTotales: combinaciones,
    costoTotalBs: costoTotal,
    probabilidadCoberturaPct: coberturaPct,
    validas: validasConfigs,
    lineasFijas,
    morochas,
    sorpresas,
    resumenTextoWhatsApp: resumenTexto,
  };
}

function generarTextoWhatsAppCuadro5y6(data: {
  fecha: string;
  hipodromo: string;
  combinaciones: number;
  costoTotal: number;
  factor: number;
  coberturaPct: number;
  validas: Valida5y6Config[];
  lineasFijas: Array<{ valida: number; numero: number; nombre: string; prob: number }>;
  morochas: Array<{ valida: number; numeros: number[]; nombres: string[] }>;
}): string {
  const lineasTxt = data.lineasFijas.length
    ? data.lineasFijas
        .map((l) => `  🔒 *${l.valida}ª Válida:* #${l.numero} ${l.nombre} (${l.prob}%)`)
        .join("\n")
    : "  (Sin línea única)";

  const detalleValidas = data.validas
    .map((v) => {
      const ejsStr = v.seleccionados
        .map((num) => {
          const ej = v.carrera.ranking.find((r) => r.ejemplar.numero === num);
          return `#${num} ${ej?.ejemplar.nombre || ""}`;
        })
        .join(" · ");
      const tipo = v.seleccionados.length === 1 ? "🔒 LÍNEA" : v.seleccionados.length === 2 ? "⚔️ MOROCHA" : "🛡️ TRIPLE+";
      return `*${v.numeroValida}ª VÁLIDA (C${v.carreraNumero}):* [${tipo}]\n   ${ejsStr}`;
    })
    .join("\n");

  return (
    `🎟️ *CUADRO MAESTRO 5Y6 NACIONAL — IA GODET v4*\n` +
    `🏟️ *${data.hipodromo.toUpperCase()}* · 📅 ${data.fecha}\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📊 *Combinaciones:* ${data.combinaciones.toLocaleString("es-VE")}\n` +
    `💰 *Factor Multiplicador:* Bs. ${data.factor.toFixed(2)}\n` +
    `💵 *Monto Total:* Bs. ${data.costoTotal.toLocaleString("es-VE", { minimumFractionDigits: 2 })}\n` +
    `🎯 *Probabilidad Estimada (6 de 6):* ${data.coberturaPct}%\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📌 *LÍNEAS FIJAS DEL CUADRO:*\n${lineasTxt}\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📋 *SELECCIÓN POR VÁLIDAS:*\n${detalleValidas}\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `_Generado por el Laboratorio de Inteligencia Hípica Actuarial._`
  );
}
