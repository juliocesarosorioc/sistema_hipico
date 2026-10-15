/**
 * COLORES DE EJEMPLAR — disco por número de caballo.
 *
 * Se comparte entre el ARMADO del reporte (`reporte-carrera.ts`) y la
 * PLANTILLA (`ReporteCarrera.tsx`) para que el número de un ejemplar se pinte
 * siempre con el mismo color, tanto en la llegada como dentro de cada jugada.
 * Vive en su propio módulo para que la plantilla no dependa del armado (y
 * evitar un import circular).
 */

/** Clases tailwind del disco por número de ejemplar (1..8 tienen color propio). */
const COLOR_DISCO: Record<number, string> = {
  1: "bg-red-600 text-white",
  2: "bg-blue-600 text-white",
  3: "bg-amber-500 text-white",
  4: "bg-green-600 text-white",
  5: "bg-purple-600 text-white",
  6: "bg-slate-900 text-white",
  7: "bg-orange-500 text-white",
  8: "bg-pink-600 text-white",
};

/** Clases tailwind del disco de un número de ejemplar (con fallback gris). */
export function colorDiscoNumero(num: string | number): string {
  const n = Number(num);
  if (Number.isInteger(n) && n >= 1 && n <= 8) return COLOR_DISCO[n];
  return "bg-slate-400 text-white";
}

/**
 * Números de ejemplar presentes en el texto de una jugada: "5" → ["5"],
 * "3x7" → ["3","7"], "12 13 x 14 15" → ["12","13","14","15"].
 */
export function numerosDeCaballo(caballo: string | null | undefined): string[] {
  return String(caballo ?? "").match(/\d{1,2}/g) ?? [];
}
