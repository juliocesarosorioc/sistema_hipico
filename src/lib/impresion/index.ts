/**
 * Módulo de IMPRESIÓN de Tablas Fijas — re-exports de la SPA.
 * Reconstruido 1:1 sobre el legacy de imprimir tablas / reporte por jugador:
 *  · src/lib/impresion/util.ts     → utilidades comunes (paleta, fsAuto, fmt)
 *  · src/lib/impresion/tablas.ts   → Matriz 15/hoja (3×5) con datos reales + filtros
 *  · src/lib/impresion/reporte.ts  → Reporte por Jugador / Grupo / Nivel
 *  · src/lib/impresion/exportar.ts → JPG / PNG / PDF / WhatsApp
 */
export * from "@/lib/impresion/util";
export * from "@/lib/impresion/tablas";
export * from "@/lib/impresion/reporte";
export * from "@/lib/impresion/exportar";