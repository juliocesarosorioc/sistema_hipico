/**
 * Rango UTC que cubre un día calendario LOCAL.
 *
 * `tickets_apuestas.fecha_registro` es un timestamptz en UTC (el momento de la
 * venta), no una fecha local. Filtrar con `.eq("fecha_registro", "2026-09-20")`
 * no trae nada, y usar `.like("2026-09-20%")` solo acierta mientras no pase
 * de las 20:00 en Venezuela, porque el prefijo ISO pasa al día siguiente.
 *
 * La forma correcta es una ventana [inicio, fin) calculada desde la medianoche
 * local. `new Date("2026-09-20T00:00:00")` sin Z se interpreta en hora local
 * del navegador, así que esto sirve para cualquier zona horaria sin tener que
 * hardcodear el offset.
 */
export function ventanaDiaLocal(dia: string): { desde: string; hasta: string } {
  const diaLimpio = String(dia ?? "").slice(0, 10);
  const inicio = new Date(`${diaLimpio}T00:00:00`);
  if (Number.isNaN(inicio.getTime())) {
    return { desde: `${diaLimpio}T00:00:00.000Z`, hasta: `${diaLimpio}T23:59:59.999Z` };
  }
  const fin = new Date(inicio);
  fin.setDate(fin.getDate() + 1);
  return { desde: inicio.toISOString(), hasta: fin.toISOString() };
}

/**
 * Expresión para `.or(...)` de PostgREST que acota un DÍA DE JORNADA.
 *
 * El día de una jugada es la fecha de la CARRERA, no la de la venta:
 *   · `fecha_carrera` (date) la sella el trigger `trg_tickets_fecha_carrera`
 *     (sql/fecha_carrera_tickets.sql) desde `nota_auditoria.fecha_carrera`, que
 *     es lo que escriben TODOS los RPC de venta.
 *   · `fecha_registro` es el instante de la venta (timestamptz).
 *
 * Filtrar por `fecha_registro` (como se hacía en el reporte, la liquidación y la
 * re-liquidación) dejaba afuera una jugada cargada hoy para una carrera de ayer,
 * y al revés: el reporte salía vacío y la carrera quedaba sin acreditar. Es el
 * mismo criterio que ya usan Marcas y Tablas.
 *
 * Las filas heredadas sin `fecha_carrera` caen a la ventana local de la venta,
 * para no perder las migradas.
 */
export function filtroDiaJornada(dia: string): string {
  const d = String(dia ?? "").slice(0, 10);
  const { desde, hasta } = ventanaDiaLocal(d);
  return `fecha_carrera.eq.${d},and(fecha_carrera.is.null,fecha_registro.gte.${desde},fecha_registro.lt.${hasta})`;
}
