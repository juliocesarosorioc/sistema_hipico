/**
 * PALETA HÍPICA CANÓNICA — GUALDRAPAS 1..20 (ÚNICA fuente de verdad).
 *
 * Todo lo que pinta un número de ejemplar en la app sale de acá: `getHorseColor`
 * (clases Tailwind + hex), `getGualdrapaClasses` (string de clases del chip),
 * `horseBgHex`, los badges de `components/ui/HorseChips.tsx` y —por delegación—
 * `colorDeNumeroGac` (Gaceta/Dupletas), `colorDiscoNumero` (Reporte de Carrera)
 * y `PALETA14`/`col` del motor de impresión. Nada debe tener su propia paleta.
 *
 * Codificación unificada (fondo HEX + color del número):
 *   1 Rojo #E74C3C / blanco      · 2 Blanco #FFF / negro
 *   3 Azul #2980B9 / blanco      · 4 Amarillo #F1C40F / negro
 *   5 Verde #27AE60 / blanco     · 6 Negro #2C3E50 / amarillo
 *   7 Naranja #E67E22 / negro    · 8 Rosado #FF69B4 / negro
 *   9 Turquesa #1ABC9C / negro   · 10 Morado #8E44AD / blanco
 *   11 Gris #95A5A6 / rojo       · 12 Verde claro #2ECC71 / negro
 *   13 Marrón #A0522D / blanco   · 14 Vino tinto #922B21 / amarillo
 *   15 Caqui #D4EFDF / negro     · 16 Celeste #5DADE2 / naranja
 *   17 Azul marino #1B4F72 / blanco · 18 Verde bosque #145A32 / amarillo
 *   19 Azul denim #5D6D7E / rojo · 20 Fucsia #C71585 / amarillo
 *   >20 o sin número (PP, V, vacío) → respaldo `bg-slate-700 text-white`.
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
  /** Fondo en hex, para <span style={{ backgroundColor }}> y la impresión. */
  hex: string;
  /** Texto en hex, legible sobre `hex`. */
  hexText: string;
  /** Clases extra del chip (borde visible / sombra) sólo donde hacen falta. */
  extra?: string;
};

export const PALETA_GUALDRAPAS_OFICIAL = {
  1: { hex: "#DC2626", label: "Rojo", textHex: "#ffffff" },
  2: { hex: "#F8FAFC", label: "Blanco", textHex: "#0f172a" },
  3: { hex: "#1D4ED8", label: "Azul Rey", textHex: "#ffffff" },
  4: { hex: "#EAB308", label: "Amarillo", textHex: "#0f172a" },
  5: { hex: "#15803D", label: "Verde", textHex: "#ffffff" },
  6: { hex: "#0F172A", label: "Negro/Oro", textHex: "#facc15" },
  7: { hex: "#EA580C", label: "Anaranjado", textHex: "#ffffff" },
  8: { hex: "#EC4899", label: "Rosado", textHex: "#ffffff" },
  9: { hex: "#06B6D4", label: "Turquesa", textHex: "#0f172a" },
  10: { hex: "#7E22CE", label: "Morado", textHex: "#ffffff" },
  11: { hex: "#64748B", label: "Gris", textHex: "#ffffff" },
  12: { hex: "#65A30D", label: "Verde Lima", textHex: "#ffffff" },
  13: { hex: "#78350F", label: "Marrón", textHex: "#ffffff" },
  14: { hex: "#881337", label: "Vinotinto", textHex: "#facc15" },
} as const;

const DICCIONARIO: Record<number, HorseColor> = {
  1: { bg: "bg-red-600", text: "text-white", border: "border-red-700", label: "Rojo", hex: "#DC2626", hexText: "#ffffff" },
  2: {
    bg: "bg-white",
    text: "text-slate-900",
    border: "border-slate-300",
    extra: "border border-slate-300 shadow-sm",
    label: "Blanco",
    hex: "#F8FAFC",
    hexText: "#0f172a",
  },
  3: { bg: "bg-blue-700", text: "text-white", border: "border-blue-800", label: "Azul Rey", hex: "#1D4ED8", hexText: "#ffffff" },
  4: { bg: "bg-yellow-500", text: "text-slate-900", border: "border-yellow-600", label: "Amarillo", hex: "#EAB308", hexText: "#0f172a" },
  5: { bg: "bg-green-700", text: "text-white", border: "border-green-800", label: "Verde", hex: "#15803D", hexText: "#ffffff" },
  6: { bg: "bg-slate-900", text: "text-yellow-400", border: "border-slate-950", label: "Negro/Oro", hex: "#0F172A", hexText: "#facc15" },
  7: { bg: "bg-orange-600", text: "text-white", border: "border-orange-700", label: "Anaranjado", hex: "#EA580C", hexText: "#ffffff" },
  8: { bg: "bg-pink-500", text: "text-white", border: "border-pink-600", label: "Rosado", hex: "#EC4899", hexText: "#ffffff" },
  9: { bg: "bg-cyan-500", text: "text-slate-900", border: "border-cyan-600", label: "Turquesa", hex: "#06B6D4", hexText: "#0f172a" },
  10: { bg: "bg-purple-700", text: "text-white", border: "border-purple-800", label: "Morado", hex: "#7E22CE", hexText: "#ffffff" },
  11: { bg: "bg-slate-500", text: "text-white", border: "border-slate-600", label: "Gris", hex: "#64748B", hexText: "#ffffff" },
  12: { bg: "bg-lime-600", text: "text-white", border: "border-lime-700", label: "Verde Lima", hex: "#65A30D", hexText: "#ffffff" },
  13: { bg: "bg-amber-900", text: "text-white", border: "border-amber-950", label: "Marrón", hex: "#78350F", hexText: "#ffffff" },
  14: { bg: "bg-rose-900", text: "text-yellow-400", border: "border-rose-950", label: "Vinotinto", hex: "#881337", hexText: "#facc15" },
  15: { bg: "bg-lime-100", text: "text-slate-900", border: "border-lime-200", extra: "border border-slate-300 shadow-sm", label: "Caqui", hex: "#D4EFDF", hexText: "#0f172a" },
  16: { bg: "bg-sky-300", text: "text-orange-700", border: "border-sky-400", label: "Celeste", hex: "#5DADE2", hexText: "#9a3412" },
  17: { bg: "bg-blue-900", text: "text-white", border: "border-blue-950", label: "Azul Marino", hex: "#1B4F72", hexText: "#ffffff" },
  18: { bg: "bg-green-900", text: "text-yellow-400", border: "border-green-950", label: "Verde Bosque", hex: "#145A32", hexText: "#facc15" },
  19: { bg: "bg-slate-500", text: "text-red-700", border: "border-slate-600", label: "Azul Denim", hex: "#5D6D7E", hexText: "#991b1b" },
  20: { bg: "bg-fuchsia-700", text: "text-yellow-400", border: "border-fuchsia-800", label: "Fucsia", hex: "#C71585", hexText: "#facc15" },
};

const CICLO = 20;
/** Tope de números que existen en la plataforma. */
const MAX_GUALDRAPA = 20;

const RESPALDO: HorseColor = {
  bg: "bg-slate-700",
  text: "text-white",
  border: "border-slate-800",
  label: "Sin gualdrapa",
  hex: "#334155",
  hexText: "#ffffff",
};

/** Devuelve el color hípico del número (canónico, con clases Tailwind y hex). */
export function getHorseColor(num: number | string): HorseColor {
  let n = Number(num);
  if (!Number.isFinite(n) || n <= 0) {
    if (typeof num === "string") {
      const limpio = num.trim().toLowerCase();
      const byLabel = Object.entries(DICCIONARIO).find(([, c]) => c.label.toLowerCase() === limpio);
      if (byLabel) return byLabel[1];
    }
    return RESPALDO;
  }
  n = Math.trunc(n);
  if (n > CICLO && n <= MAX_GUALDRAPA) n = ((n - 1) % CICLO) + 1;
  if (n < 1 || n > MAX_GUALDRAPA) return RESPALDO;
  return DICCIONARIO[n] ?? RESPALDO;
}

/**
 * String de clases Tailwind del chip/disco del número (tabla oficial exacta):
 * `bg + texto`, más el borde/sombra del blanco para que no desaparezca sobre
 * paneles blancos. Es lo que usan los discos del Reporte de Carrera.
 */
export function getGualdrapaClasses(num: number | string): string {
  const c = getHorseColor(num);
  return c.extra ? `${c.bg} ${c.text} ${c.extra}` : `${c.bg} ${c.text}`;
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
