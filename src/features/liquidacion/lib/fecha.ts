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
  return `fecha_carrera.eq.${d},nota_auditoria.ilike.%${d}%,and(fecha_carrera.is.null,fecha_registro.gte.${desde},fecha_registro.lt.${hasta})`;
}

/**
 * Extrae la fecha de la carrera (YYYY-MM-DD) de un ticket de `tickets_apuestas`.
 *
 * Prioridad:
 *   1. `nota_auditoria.fecha_carrera` (todas las RPC de venta la sellan con la
 *      fecha exacta de la carrera, incluso si la columna `fecha_carrera` quedó
 *      nula o fue rellenada con `fecha_registro::date`).
 *   2. Columna `fecha_carrera` / `fecha_evento`.
 *   3. Fecha calendario local de `fecha_registro` como último respaldo.
 */
export function extraerFechaCarreraTicket(row: Record<string, unknown> | null | undefined): string {
  if (!row) return "";
  const rawNota = row.nota_auditoria;
  if (rawNota) {
    if (typeof rawNota === "object") {
      const obj = rawNota as Record<string, unknown>;
      const fc = String(obj.fecha_carrera ?? obj.fecha ?? "").trim().slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(fc)) return fc;
    } else if (typeof rawNota === "string") {
      const m = /"fecha_carrera"\s*:\s*"(\d{4}-\d{2}-\d{2})"/.exec(rawNota);
      if (m?.[1]) return m[1];
      try {
        const parsed = JSON.parse(rawNota) as Record<string, unknown>;
        const fc = String(parsed?.fecha_carrera ?? parsed?.fecha ?? "").trim().slice(0, 10);
        if (/^\d{4}-\d{2}-\d{2}$/.test(fc)) return fc;
      } catch {
        /* ignore */
      }
    }
  }
  const colFc = String(row.fecha_carrera ?? row.fecha_evento ?? "").trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(colFc)) return colFc;

  const reg = String(row.fecha_registro ?? "").trim();
  if (!reg) return "";
  const dt = new Date(reg);
  if (!Number.isNaN(dt.getTime())) {
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, "0");
    const d = String(dt.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return reg.slice(0, 10);
}

/**
 * Confirma si un ticket pertenece efectivamente a la jornada `dia` (YYYY-MM-DD),
 * descartando falsos positivos de `fecha_registro` cuando la jugada se registró
 * otro día para una carrera de otra fecha.
 */
export function perteneceADiaJornada(
  row: Record<string, unknown> | null | undefined,
  dia: string
): boolean {
  const d = String(dia ?? "").trim().slice(0, 10);
  if (!d) return true;
  const fc = extraerFechaCarreraTicket(row);
  return fc === d;
}

/**
 * Días de jornada DISTINTOS de `dia` en los que también hay jugadas de la misma
 * carrera (mismo hipódromo y número). Se usa para detectar el caso que dejaba a
 * una carrera sin cobrar ni pagar:
 *
 *   Una jugada quedó archivada bajo OTRA jornada (`fecha_carrera` corrida un
 *   día, o sellada con la fecha de venta equivocada), así que `filtroDiaJornada`
 *   no la encuentra al liquidar: el motor devolvía «Sin tickets pendientes» en
 *   verde y nadie cobraba ni pagaba (VALENCIA C9, LA RINCONADA C9).
 *
 * Recibe las `fecha_carrera` crudas de los tickets de esa carrera y devuelve,
 * ordenados, los días que NO son `dia` (los que quedaron mal archivados). Es una
 * función PURA: la lectura la hace el llamador.
 */
export function jornadasDesalineadas(
  dia: string,
  fechasDeTickets: Array<string | null | undefined>
): string[] {
  const d = String(dia ?? "").slice(0, 10);
  const otros = new Set<string>();
  for (const f of fechasDeTickets) {
    const iso = String(f ?? "").slice(0, 10);
    if (iso && iso !== d) otros.add(iso);
  }
  return [...otros].sort();
}
