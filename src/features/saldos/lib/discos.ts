/**
 * COLORES DE EJEMPLAR — disco por número de caballo.
 *
 * Se comparte entre el ARMADO del reporte (`reporte-carrera.ts`) y la
 * PLANTILLA (`ReporteCarrera.tsx`) para que el número de un ejemplar se pinte
 * siempre con el mismo color, tanto en la llegada como dentro de cada jugada.
 * Vive en su propio módulo para que la plantilla no dependa del armado (y
 * evitar un import circular).
 *
 * Los colores NO viven acá: delega en `shared/lib/horseColors`, la ÚNICA
 * fuente de verdad (gualdrapas oficiales 1..12), igual que Gaceta, Tablas,
 * Marcas y la impresión.
 */

import { getGualdrapaClasses } from "@/shared/lib/horseColors";

/** Clases tailwind del disco de un número de ejemplar (tabla oficial + respaldo). */
export function colorDiscoNumero(num: string | number): string {
  return getGualdrapaClasses(num);
}

/**
 * Números de ejemplar presentes en el texto de una jugada: "5" → ["5"],
 * "3x7" → ["3","7"], "12 13 x 14 15" → ["12","13","14","15"].
 */
export function numerosDeCaballo(caballo: string | null | undefined): string[] {
  return String(caballo ?? "").match(/\d{1,2}/g) ?? [];
}
