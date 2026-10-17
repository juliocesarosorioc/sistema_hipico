/**
 * PALETA HÍPICA CANÓNICA — GUALDRAPAS OFICIALES 1..12 (ÚNICA fuente de verdad).
 *
 * Todo lo que pinta un número de ejemplar en la app sale de acá: `getHorseColor`
 * (clases Tailwind + hex), `getGualdrapaClasses` (string de clases del chip),
 * `horseBgHex`, los badges de `components/ui/HorseChips.tsx` y —por delegación—
 * `colorDeNumeroGac` (Gaceta/Dupletas), `colorDiscoNumero` (Reporte de Carrera)
 * y `PALETA14`/`col` del motor de impresión. Nada debe tener su propia paleta.
 *
 * Tabla oficial (1..12):
 *   1 Rojo      bg-red-600      · 2 Blanco    bg-white       (borde slate-300)
 *   3 Azul      bg-blue-600     · 4 Amarillo  bg-yellow-400  (texto slate-900)
 *   5 Verde     bg-emerald-600  · 6 Negro     bg-slate-900
 *   7 Marrón    bg-amber-800    · 8 Rosado    bg-pink-500
 *   9 Naranja   bg-orange-600   · 10 Turquesa bg-teal-500
 *   11 Gris     bg-slate-500    · 12 Violeta  bg-purple-700
 *
 * Extensiones que la plataforma ya tenía configuradas:
 *   13 Marrón (mismo de antes) · 14 Burdeos (el `bg-red-900` del respaldo).
 *   15..20 (hasta el tope MAX_N de la plataforma) repiten el ciclo desde 1,
 *   igual que siempre lo hizo la impresión: misma paleta en pantalla y papel.
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

const DICCIONARIO: Record<number, HorseColor> = {
  1: { bg: "bg-red-600", text: "text-white", border: "border-red-700", label: "Rojo", hex: "#dc2626", hexText: "#ffffff" },
  2: {
    bg: "bg-white",
    text: "text-slate-900",
    border: "border-slate-300",
    extra: "border border-slate-300 shadow-sm",
    label: "Blanco",
    hex: "#ffffff",
    hexText: "#0f172a",
  },
  3: { bg: "bg-blue-600", text: "text-white", border: "border-blue-700", label: "Azul", hex: "#2563eb", hexText: "#ffffff" },
  4: { bg: "bg-yellow-400", text: "text-slate-900", border: "border-yellow-500", label: "Amarillo", hex: "#facc15", hexText: "#0f172a" },
  5: { bg: "bg-emerald-600", text: "text-white", border: "border-emerald-700", label: "Verde", hex: "#059669", hexText: "#ffffff" },
  6: { bg: "bg-slate-900", text: "text-white", border: "border-slate-950", label: "Negro", hex: "#0f172a", hexText: "#ffffff" },
  7: { bg: "bg-amber-800", text: "text-white", border: "border-amber-900", label: "Marrón", hex: "#92400e", hexText: "#ffffff" },
  8: { bg: "bg-pink-500", text: "text-white", border: "border-pink-600", label: "Rosado", hex: "#ec4899", hexText: "#ffffff" },
  9: { bg: "bg-orange-600", text: "text-white", border: "border-orange-700", label: "Naranja", hex: "#ea580c", hexText: "#ffffff" },
  10: { bg: "bg-teal-500", text: "text-white", border: "border-teal-600", label: "Turquesa", hex: "#14b8a6", hexText: "#ffffff" },
  11: { bg: "bg-slate-500", text: "text-white", border: "border-slate-600", label: "Gris", hex: "#64748b", hexText: "#ffffff" },
  12: { bg: "bg-purple-700", text: "text-white", border: "border-purple-800", label: "Violeta", hex: "#7e22ce", hexText: "#ffffff" },
  // ── Extensiones ya configuradas en la plataforma (valores previos, sin cambios) ──
  13: { bg: "bg-amber-800", text: "text-white", border: "border-amber-900", label: "Marrón", hex: "#92400e", hexText: "#ffffff" },
  14: { bg: "bg-red-900", text: "text-white", border: "border-red-950", label: "Burdeos", hex: "#7f1d1d", hexText: "#ffffff" },
};

/** Longitud de la paleta antes de repetir (lo que la impresión llamaba "14"). */
const CICLO = 14;
/** Tope de números que existen en la plataforma (MAX_N de las tablas). */
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
  // 15..20 (los que siguen existiendo) repiten la paleta desde 1, igual que
  // hacía el motor de impresión: así pantalla y papel ven el MISMO color.
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
