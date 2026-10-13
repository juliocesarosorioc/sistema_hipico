/**
 * REPORTE DE CARRERA COMO IMAGEN — captura la plantilla `ReporteCarrera`
 * (el `#reporte-imprimible`) con html2canvas y la descarga como PNG/JPG.
 *
 * Reusa la cadena de captura endurecida de `src/lib/impresion/exportar.ts`
 * (espera de webfonts + saneo del clon): el resultado es la MISMA imagen nítida
 * que se imprimiría, lista para mandar al grupo.
 */
import { capturarNodo, guardarLienzos, type ImgFormato } from "@/lib/impresion/exportar";

/**
 * Captura el reporte visible (`#reporte-imprimible`) y lo descarga como imagen.
 *
 * @param formato "PNG" | "JPG" — formato de descarga.
 * @param nombreBase nombre del archivo sin fecha ni extensión (ej. "reporte_liquidacion_larinconada_C5").
 * @returns true si capturó y descargó; false si no encontró el nodo o falló.
 */
export async function exportarReporteCarreraImagen(
  formato: ImgFormato,
  nombreBase: string
): Promise<boolean> {
  const el = document.getElementById("reporte-imprimible");
  if (!el) return false;
  try {
    const canvas = await capturarNodo(el, 2); // 300dpi efectivos sobre la hoja @150dpi
    await guardarLienzos([canvas], formato, nombreBase);
    return true;
  } catch {
    return false;
  }
}