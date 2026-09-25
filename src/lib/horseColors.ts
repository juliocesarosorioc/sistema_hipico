/**
 * Colores hípicos tradicionales (pupilaje estándar del hipódromo).
 * Diccionario num→clases Tailwind para chips/badges en la UI de Marcas
 * (y reutilizable en Taquilla). El 1 es rojo, el 2 blanco con borde, el 3
 * azul, etc. Números ≥14 caen en un color predefinido de respaldo.
 */

export type HorseColor = {
  /** Clases de fondo del chip. */
  bg: string;
  /** Clases de color de texto del chip. */
  text: string;
  /** Clases de borde del chip (para fondos claros/borde negro). */
  border: string;
  /** Nombre legible (para tooltip/accesibilidad). */
  label: string;
};

const DICCIONARIO: Record<number, HorseColor> = {
  1: { bg: "bg-red-600", text: "text-white", border: "border-red-700", label: "Rojo" },
  2: { bg: "bg-white", text: "text-red-600", border: "border-gray-400", label: "Blanco" },
  3: { bg: "bg-blue-700", text: "text-white", border: "border-blue-800", label: "Azul" },
  4: { bg: "bg-yellow-400", text: "text-black", border: "border-yellow-600", label: "Amarillo" },
  5: { bg: "bg-green-600", text: "text-white", border: "border-green-800", label: "Verde" },
  6: { bg: "bg-black", text: "text-white", border: "border-gray-700", label: "Negro" },
  7: { bg: "bg-orange-500", text: "text-white", border: "border-orange-700", label: "Naranja" },
  8: { bg: "bg-pink-400", text: "text-black", border: "border-pink-600", label: "Rosado" },
  9: { bg: "bg-cyan-400", text: "text-black", border: "border-cyan-600", label: "Celeste" },
  10: { bg: "bg-purple-600", text: "text-white", border: "border-purple-800", label: "Morado" },
  11: { bg: "bg-gray-400", text: "text-black", border: "border-gray-500", label: "Gris" },
  12: { bg: "bg-lime-400", text: "text-black", border: "border-lime-600", label: "Lima" },
  13: { bg: "bg-amber-800", text: "text-white", border: "border-amber-900", label: "Marrón" },
};

const RESPALDO: HorseColor = {
  bg: "bg-red-900",
  text: "text-white",
  border: "border-red-950",
  label: "Maroon",
};

/** Devuelve el color hípico del número. */
export function getHorseColor(num: number | string): HorseColor {
  const n = Number(num);
  if (Number.isFinite(n)) return DICCIONARIO[n] ?? RESPALDO;
  if (typeof num === "string") {
    const limpio = num.trim().toLowerCase();
    const byLabel = Object.entries(DICCIONARIO).find(([, c]) => c.label.toLowerCase() === limpio);
    if (byLabel) return byLabel[1];
  }
  return RESPALDO;
}

/**
 * Parser tolerante: separa una lista de números por / , - espacios (y combos).
 * "2/3 7,4-1" → ["2","3","7","4","1"].
 */
export function parsearNumerosLista(txt?: string | null): string[] {
  return String(txt ?? "")
    .split(/[\s/,;:-]+/)
    .map((s) => s.trim())
    .filter((s) => /^\d+$/.test(s));
}

/**
 * Renderiza una lista como chips coloreados (ej. "2/3/7/1/5" → badges).
 * Devuelve un array de elementos <span> para incrustar en JSX.
 */
export function chipsHorseColor(
  txt?: string | null,
  size: "xs" | "sm" = "sm"
): Array<{ num: number; color: HorseColor; key: number }> {
  return parsearNumerosLista(txt).map((s, i) => ({
    num: Number(s),
    color: getHorseColor(s),
    key: i,
  }));
}