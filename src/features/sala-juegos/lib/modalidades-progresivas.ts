/**
 * Orden progresivo oficial de modalidades (SSOT de presentación y parser).
 * No altera fórmulas de liquidación: sólo normaliza nomenclatura y orden.
 */

export const ORDEN_10_A_PREMIO = ["10/5", "10/6", "10/7", "10/8", "10/9", "pp"] as const;

export const ORDEN_1_A_2 = [
  "1P",
  "1P y 1/2N",
  "1/2N",
  "1/2N y 2N",
  "2N",
  "2N y 2P",
  "2P",
] as const;

export const ORDEN_2_A_3 = [
  "2P y 2/3N",
  "2/3N",
  "2/3N y 3N",
  "3N",
  "3N y 3P",
  "3P",
] as const;

export const ORDEN_3_A_4 = [
  "3P y 3/4N",
  "3/4N",
  "3/4N y 4N",
  "4N",
  "4N y 4P",
  "4P",
] as const;

export const ORDEN_4_A_5 = [
  "4P y 4/5N",
  "4/5N",
  "4/5N y 5N",
  "5N",
  "5N y 5P",
  "5P",
] as const;

export const ORDEN_MODALIDADES_PROGRESIVO: string[] = [
  ...ORDEN_10_A_PREMIO,
  ...ORDEN_1_A_2,
  ...ORDEN_2_A_3,
  ...ORDEN_3_A_4,
  ...ORDEN_4_A_5,
];

/**
 * Escalera oficial de llegada (SSOT de "nunca desescalonada").
 * El orden es el que el usuario debe respetar al Combinar modalidades en un
 * mismo mensaje; las combinaciones válidas son sólo entre términos contiguos.
 */
export const ORDEN_ESCALERA_OFICIAL: string[] = [
  "10/2",
  "10/3",
  "10/3.5",
  "10/4",
  "10/5",
  "10/5.5",
  "1P",
  "1P y 1/2N",
  "1/2N",
  "1/2N y 2N",
  "2N",
  "2N y 2/2N",
  "2/2N",
  "2/2N y 2P",
  "2P",
  "2P y 2/3N",
  "2/3N",
  "2/3N y 3N",
  "3N",
  "3N y 3P",
  "3P",
];

const ALIASES: Record<string, string> = {
  "A5": "10/5",
  "@5": "10/5",
  "10A2": "10/2",
  "10/2": "10/2",
  "10@2": "10/2",
  "10A3": "10/3",
  "10/3": "10/3",
  "10@3": "10/3",
  "10A3.5": "10/3.5",
  "10/3.5": "10/3.5",
  "10@3.5": "10/3.5",
  "10A4": "10/4",
  "10/4": "10/4",
  "10@4": "10/4",
  "10A5": "10/5",
  "10@5": "10/5",
  "10-5": "10/5",
  "10A5.5": "10/5.5",
  "10/5.5": "10/5.5",
  "10@5.5": "10/5.5",
  "10A6": "10/6",
  "10@6": "10/6",
  "10-6": "10/6",
  "10A7": "10/7",
  "10@7": "10/7",
  "10-7": "10/7",
  "10A8": "10/8",
  "10@8": "10/8",
  "10-8": "10/8",
  "10A9": "10/9",
  "10@9": "10/9",
  "10-9": "10/9",
  "10A10": "pp",
  "10/10": "pp",
  "10@10": "pp",
  "1X1": "pp",
  "A GANADOR": "1P",
  GANADOR: "1P",
  WIN: "1P",
  G: "1P",
  "1Y2N": "1/2N",
  "1/2": "1/2N",
  "2Y2N": "2/2N",
  "2/2N": "2N y 2P",
  "2/2N Y 2P": "2N y 2P",
  "2Y3N": "2/3N",
  "2/3": "2/3N",
  "3/3N": "3N y 3P",
  "3/3N Y 3P": "3N y 3P",
  "3Y4N": "3/4N",
  "3/4": "3/4N",
  "4/4N": "4N y 4P",
  "4/4N Y 4P": "4N y 4P",
  "4Y5N": "4/5N",
  "4/5": "4/5N",
  "5/5N": "5N y 5P",
  "5/5N Y 5P": "5N y 5P",
};

function limpiar(texto: string): string {
  return String(texto ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ")
    .replace(/\s*-\s*/g, "-")
    .replace(/\s+Y\s+/g, " Y ");
}

/** Devuelve la modalidad canónica progresiva, o null si no pertenece al orden oficial. */
export function normalizarModalidadProgresiva(texto: string): string | null {
  const base = limpiar(texto);
  if (!base) return null;
  if (ALIASES[base]) return ALIASES[base];

  const conBarras = base.replace(/^(\d{1,2})A(\d+(?:[.,]\d+)?)$/, "$1/$2").replace(/^(\d{1,2})@(\d+(?:[.,]\d+)?)$/, "$1/$2");
  if (ALIASES[conBarras]) return ALIASES[conBarras];

  const canonical = conBarras.split(" Y ").map((p) => ALIASES[p] || p).join(" y ");
  const found = ORDEN_MODALIDADES_PROGRESIVO.find(
    (m) => m.toUpperCase() === canonical.toUpperCase() || m.toUpperCase().replace(/\s+Y\s+/g, " Y ") === canonical
  );
  return found || null;
}

export function esModalidadProgresiva(texto: string): boolean {
  return normalizarModalidadProgresiva(texto) !== null;
}

/** Peldaños simples de la escalera (sin combinaciones), usados para validar orden. */
export const PASOS_ESCALERA: string[] = [
  "10/2",
  "10/3",
  "10/3.5",
  "10/4",
  "10/5",
  "10/5.5",
  "1P",
  "1/2N",
  "2N",
  "2/2N",
  "2P",
  "2/3N",
  "3N",
  "3P",
];

/** Índice en la escalera oficial, o -1 si la modalidad no pertenece a ella. */
export function indiceEscaleraOficial(texto: string): number {
  const base = limpiar(texto)
    .replace(/^A(\d+(?:[.,]\d+)?)$/, "10/$1")
    .replace(/^@(\d+(?:[.,]\d+)?)$/, "10/$1")
    .replace(/^(\d{1,2})A(\d+(?:[.,]\d+)?)$/, "$1/$2")
    .replace(/^(\d{1,2})@(\d+(?:[.,]\d+)?)$/, "$1/$2")
    .replace(/^(\d)Y(\d)N$/i, "$1/$2N");
  return PASOS_ESCALERA.findIndex((m) => m.toUpperCase() === base.toUpperCase());
}

/**
 * Valida que las modalidades progresivas de un texto respeten el orden de
 * llegada: dentro de una combinación "y" deben ser contiguas y, si el texto
 * trae varias, sus índices no pueden retroceder (nunca desescalonada).
 */
export function validarOrdenEscalera(texto: string): { valido: boolean; motivo?: string } {
  const limpio = limpiar(texto)
    .replace(/\bDEL\s+\d+\b/gi, "")
    .replace(/[#]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const combinadas = limpio.match(/\b(?:10\/\d+(?:[.,]\d+)?|[1-5][\/Y][1-5][PN]?|[1-5][PN])\s+Y\s+(?:10\/\d+(?:[.,]\d+)?|[1-5][\/Y][1-5][PN]?|[1-5][PN])\b/gi) || [];
  const vistas: number[] = [];

  for (const combo of combinadas) {
    const partes = combo.split(/\s+Y\s+/i);
    const idx = partes.map((p) => indiceEscaleraOficial(p));
    if (idx.some((i) => i < 0)) continue;
    if (idx[1] !== idx[0] + 1) {
      return {
        valido: false,
        motivo: `La combinación "${combo}" no respeta el orden de llegada de la escalera.`,
      };
    }
    vistas.push(...idx);
  }

  const sueltas = limpio
    .replace(/\b(?:10\/\d+(?:[.,]\d+)?|[1-5][\/Y][1-5][PN]?|[1-5][PN])\s+Y\s+(?:10\/\d+(?:[.,]\d+)?|[1-5][\/Y][1-5][PN]?|[1-5][PN])\b/gi, "")
    .match(/\b(?:10\/\d+(?:[.,]\d+)?|[1-5][\/Y][1-5][PN]?|[1-5][PN])\b/gi) || [];
  for (const s of sueltas) {
    const i = indiceEscaleraOficial(s);
    if (i >= 0 && !vistas.includes(i)) vistas.push(i);
  }

  for (let k = 1; k < vistas.length; k++) {
    if (vistas[k] < vistas[k - 1]) {
      return { valido: false, motivo: "No se puede jugar de manera desescalonada." };
    }
  }
  return { valido: true };
}

export function indiceModalidadProgresiva(texto: string): number {
  const canon = normalizarModalidadProgresiva(texto);
  if (!canon) return -1;
  return ORDEN_MODALIDADES_PROGRESIVO.findIndex((m) => m === canon);
}

/** Normaliza bloques: 1,2x5 · 1,3,4x2,6 · 1y2x3y4 · Bloque 1-2 contra 5-6. */
export function parsearBloqueEnfrentamiento(
  texto: string
): { ladoA: string[]; ladoB: string[]; texto: string } | null {
  const original = String(texto ?? "").trim();
  const limpio = original.replace(/^bloque\s+/i, "");
  const m = limpio.match(
    /^((?:(?:juego|jugo|jugó|jugue|jugué|consigo|doy|pido|voy|ponte|j)\s+)?(?:de\s+la\s+|la\s+|del\s+|el\s+)?)(.+?)\s*(?:x|vs|contra)\s*(.+)$/i
  );
  if (!m) return null;

  const prefijo = (m[1] || "").trim();
  let bandoB = m[3].trim();
  let monto = "";
  const mMonto = bandoB.match(/^(.*?)(?:\s+(?:con\s+|por\s+|\$|bs\.?|bs\s+)?(\d+(?:[\.,]\d+)?\s*(?:k|mil)?))\s*$/i);
  if (mMonto) {
    bandoB = mMonto[1].trim();
    monto = mMonto[2].trim();
  }
  let proporcion = "";
  const mProp = bandoB.match(/^(.*?)\s*(10\s*[/@a]\s*\d+(?:[.,]\d+)?)\s*$/i);
  if (mProp) {
    bandoB = mProp[1].trim();
    proporcion = mProp[2].replace(/\s/g, "");
  }

  const extraerDigitos = (raw: string) =>
    raw
      .replace(/\b(y|la|del|de|el|#)\b/gi, " ")
      .split(/[\s,.\-/]+/)
      .map((s) => s.trim())
      .filter((s) => /^\d{1,2}$/.test(s));

  const ladoA = extraerDigitos(m[2]);
  const ladoB = extraerDigitos(bandoB);
  if (ladoA.length === 0 || ladoB.length === 0) return null;

  const textoNormalizado = [
    prefijo,
    `${ladoA.join("-")} x ${ladoB.join("-")}`,
    proporcion,
    monto,
  ]
    .filter(Boolean)
    .join(" ");

  return { ladoA, ladoB, texto: textoNormalizado };
}

/** Texto público canónico: "1P del 5", "10/5 del 5", "2N y 2P del 3". */
export function formatearModalidadMensaje(modalidad: string, ejemplar?: string | null): string {
  const canon = normalizarModalidadProgresiva(modalidad) || String(modalidad || "1P").trim().toUpperCase();
  const ej = String(ejemplar ?? "").trim();
  return ej ? `${canon} del ${ej}` : canon;
}

/** Reemplaza etiquetas internas prohibidas en textos visibles al usuario. */
export function limpiarEtiquetasProhibidas(texto: string): string {
  return String(texto ?? "")
    .replace(/\bMATCH\b/gi, "A Premio")
    .replace(/\[10\/10\]/g, "pp")
    .replace(/\b10\s*[/a@]\s*10\b/gi, "pp");
}
