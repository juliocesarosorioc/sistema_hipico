/**
 * Motor de Impresión client-side — paridad con el legacy `js/components/impresion_tablas.js`.
 * Todo se resuelve en el navegador (html2canvas + jsPDF); NO hay backend de Next.
 */
export {
  imprimirTablasPublicadas,
  generarPDF,
  diasDisponibles,
  hipodromosDisponibles,
  filtrarTablas,
  type FormatoImpresion,
  type FiltrosImpresion,
  type ResultadoImpresion,
} from "@/lib/impresion/tablas";
export { imprimirReportePorJugador } from "@/lib/impresion/reporte";

/** Formato de documento (Tablas Publicadas | Reporte por Jugador). */
export type TipoImpresion = "tablas" | "reporte";