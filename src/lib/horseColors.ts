/**
 * PALETA HÍPICA CANÓNICA (números de ejemplares / gualdrapas).
 *
 * ÚNICA fuente de verdad del color de un número de caballo en toda la app.
 * Antes existían tres paletas distintas para lo mismo:
 *   - esta (`getHorseColor`)                       → clases Tailwind
 *   - `colorDeNumeroGac` en lib/gaceta/ui.ts        → hex, 14 tonos
 *   - `cardColor` local en gestion/GestionJugadas…  → hex, otros valores
 * Eso producía el mismo ejemplar con colores diferentes según el módulo.
 * Ahora `colorDeNumeroGac` delega aquí y el duplicado local se eliminó.
 *
 * Orden pupilaje estándar: 1 rojo, 2 blanco, 3 azul, 4 amarillo, 5 verde,
 * 6 negro, 7 naranja, 8 rosado, 9 celeste, 10 morado, 11 gris, 12 lima,
 * 13 marrón. Los ≥14 caen en el respaldo (maroon) y los no numéricos igual.
 *
 * Para pintar números usa los componentes de `components/ui/HorseChips.tsx`
 * (`HorseBadge` / `ChipField`) o `getHorseColor`; no hardcodees colores.
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
  /** Fondo en hex, para <span style={{ backgroundColor }}>. */
  hex: string;
  /** Texto en hex, legible sobre `hex`. */
  hexText: string;
};

const DICCIONARIO: Record<number, HorseColor> = {
  1: { bg: "bg-red-600", text: "text-white", border: "border-red-700", label: "Rojo", hex: "#dc2626", hexText: "#ffffff" },
  2: { bg: "bg-white", text: "text-red-600", border: "border-gray-400", label: "Blanco", hex: "#ffffff", hexText: "#dc2626" },
  3: { bg: "bg-blue-700", text: "text-white", border: "border-blue-800", label: "Azul", hex: "#1d4ed8", hexText: "#ffffff" },
  4: { bg: "bg-yellow-400", text: "text-black", border: "border-yellow-600", label: "Amarillo", hex: "#facc15", hexText: "#000000" },
  5: { bg: "bg-green-600", text: "text-white", border: "border-green-800", label: "Verde", hex: "#16a34a", hexText: "#ffffff" },
  6: { bg: "bg-black", text: "text-white", border: "border-gray-700", label: "Negro", hex: "#111827", hexText: "#ffffff" },
  7: { bg: "bg-orange-500", text: "text-white", border: "border-orange-700", label: "Naranja", hex: "#f97316", hexText: "#ffffff" },
  8: { bg: "bg-pink-400", text: "text-black", border: "border-pink-600", label: "Rosado", hex: "#f9a8d4", hexText: "#000000" },
  9: { bg: "bg-cyan-400", text: "text-black", border: "border-cyan-600", label: "Celeste", hex: "#22d3ee", hexText: "#000000" },
  10: { bg: "bg-purple-600", text: "text-white", border: "border-purple-800", label: "Morado", hex: "#9333ea", hexText: "#ffffff" },
  11: { bg: "bg-gray-400", text: "text-black", border: "border-gray-500", label: "Gris", hex: "#9ca3af", hexText: "#000000" },
  12: { bg: "bg-lime-400", text: "text-black", border: "border-lime-600", label: "Lima", hex: "#a3e635", hexText: "#000000" },
  13: { bg: "bg-amber-800", text: "text-white", border: "border-amber-900", label: "Marrón", hex: "#92400e", hexText: "#ffffff" },
};

const RESPALDO: HorseColor = {
  bg: "bg-red-900",
  text: "text-white",
  border: "border-red-950",
  label: "Maroon",
  hex: "#7f1d1d",
  hexText: "#ffffff",
};

/** Devuelve el color hípico del número (canónico, con clases Tailwind y hex). */
export function getHorseColor(num: number | string): HorseColor {
  const n = Number(num);
  if (Number.isFinite(n) && n > 0) return DICCIONARIO[n] ?? RESPALDO;
  if (typeof num === "string") {
    const limpio = num.trim().toLowerCase();
    const byLabel = Object.entries(DICCIONARIO).find(([, c]) => c.label.toLowerCase() === limpio);
    if (byLabel) return byLabel[1];
  }
  return RESPALDO;
}

/**
 * Solo el fondo (hex) del número. Atajo para estilos inline.
 * `undefined`/no numérico → gris neutro.
 */
export function horseBgHex(num: unknown): string {
  const n = Number(num);
  if (Number.isFinite(n) && n > 0) return getHorseColor(n).hex;
  return "#94a3b8";
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
  _size: "xs" | "sm" = "sm"
): Array<{ num: number; color: HorseColor; key: number }> {
  return parsearNumerosLista(txt).map((s, i) => ({
    num: Number(s),
    color: getHorseColor(s),
    key: i,
  }));
}
