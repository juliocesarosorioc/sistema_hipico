/**
 * ============================================================================
 * MODALIDAD DE TIEMPO DE LA JUGADA — ⚡ EN VIVO vs ⏳ ADELANTADA
 * ============================================================================
 *
 * Módulo PURO (sin I/O ni React): la definición de la modalidad de tiempo, la
 * lectura tolerante del flag y el filtro segmentado del Reporte de Liquidación.
 *
 * NO confundir con `banquero_cliente.modalidad` ni con `nota_auditoria.modalidad`
 * (que es el TIPO de producto: PUESTO/DUPLETA/…) ni con la "parada adelantada"
 * de liquidación de `ReporteCarrera`. Acá el atributo es `es_adelantada` y solo
 * contesta UNA pregunta: ¿la jugada se cargó ANTES (adelantada) o DURANTE (en
 * vivo) la carrera?
 *
 * Persistencia: `tickets_apuestas.es_adelantada` y `polla_ventas.es_adelantada`
 * (sql/jugadas_adelantadas.sql). La escritura vive en `marcar-adelantadas.ts`.
 */

/** Modalidad de tiempo de UNA jugada. */
export type ModalidadTiempo = "EN_VIVO" | "ADELANTADA";

/**
 * Opciones del filtro segmentado del Reporte de Liquidación.
 * `TODAS` = sin filtro (comportamiento histórico del reporte).
 */
export type FiltroModalidadTiempo = "TODAS" | ModalidadTiempo;

/** Por defecto TODO sigue siendo en vivo: nadie que no marque nada cambia de comportamiento. */
export const MODALIDAD_POR_DEFECTO: ModalidadTiempo = "EN_VIVO";

/** Badge distintivo que se pone junto a la jugada adelantada. */
export const BADGE_ADELANTADA = "⏳ ADELANTADA";

/** Etiquetas del toggle de carga (compartidas por Taquilla, Marcas, Tablas, Dupletas y Remates). */
export const ETIQUETA_EN_VIVO = "⚡ En Vivo";
export const ETIQUETA_ADELANTADA = "⏳ Jugada Adelantada";

/** Título del grupo accesible del toggle. */
export const TITULO_TOGGLE = "Modalidad de tiempo de la jugada";

export type OpcionFiltroModalidad = {
  id: FiltroModalidadTiempo;
  etiqueta: string;
};

/** Opciones del control segmentado, en el orden en que se muestran. */
export const OPCIONES_FILTRO: ReadonlyArray<OpcionFiltroModalidad> = [
  { id: "TODAS", etiqueta: "Todas" },
  { id: "EN_VIVO", etiqueta: "⚡ Solo En Vivo" },
  { id: "ADELANTADA", etiqueta: "⏳ Solo Adelantadas" },
];

/** Lo que cualquier fila traída de `tickets_apuestas` puede traer consigo. */
export type FilaConModalidad = {
  es_adelantada?: unknown;
  modalidad_tiempo?: unknown;
  nota_auditoria?: unknown;
};

function esVerdadero(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const t = v.trim().toUpperCase();
    return t === "TRUE" || t === "T" || t === "SI" || t === "SÍ" || t === "ADELANTADA" || t === "1";
  }
  if (typeof v === "number") return v === 1;
  return false;
}

/**
 * `nota_auditoria` es TEXT en la base y llega como string; a veces llega ya
 * parseada. Devuelve el objeto o `null` si no había nada que parsear (nunca
 * tira: es una lectura defensiva de auditoría).
 */
export function notaAuditoriaDe(nota: unknown): Record<string, unknown> | null {
  if (nota && typeof nota === "object" && !Array.isArray(nota)) {
    return nota as Record<string, unknown>;
  }
  if (typeof nota === "string") {
    const t = nota.trim();
    if (!t.startsWith("{")) return null;
    try {
      const p: unknown = JSON.parse(t);
      if (p && typeof p === "object" && !Array.isArray(p)) return p as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Lee `es_adelantada` de una fila venga como venga:
 *   · `es_adelantada` booleano/ texto (columna real, camino normal);
 *   · `modalidad_tiempo` (por si algún día se guarda el enum en vez del booleano);
 *   · `nota_auditoria` (jsonb) con el flag embebido (respaldo si la columna no
 *     existe todavía porque no se corrió la migración);
 *   · todo lo demás → `false` = EN VIVO.
 *
 * Tolerante a cualquier cosa: nunca tira excepción (se llama por fila dentro de
 * los reportes).
 */
export function esAdelantadaDe(fila: FilaConModalidad | null | undefined): boolean {
  if (!fila) return false;

  if ("es_adelantada" in fila && fila.es_adelantada !== null && fila.es_adelantada !== undefined) {
    return esVerdadero(fila.es_adelantada);
  }

  if (typeof fila.modalidad_tiempo === "string") {
    return fila.modalidad_tiempo.trim().toUpperCase() === "ADELANTADA";
  }

  const nota = notaAuditoriaDe(fila.nota_auditoria);
  if (nota) {
    if (nota.es_adelantada !== undefined && nota.es_adelantada !== null) {
      return esVerdadero(nota.es_adelantada);
    }
    if (typeof nota.modalidad_tiempo === "string") {
      return String(nota.modalidad_tiempo).trim().toUpperCase() === "ADELANTADA";
    }
  }

  return false;
}

/**
 * ¿Pasa la fila por el filtro segmentado del reporte?
 * `TODAS` no filtra nada; `EN_VIVO` se queda con las que NO están adelantadas;
 * `ADELANTADA` solo con las marcadas.
 */
export function pasaFiltroModalidad(
  fila: FilaConModalidad | null | undefined,
  filtro: FiltroModalidadTiempo | null | undefined
): boolean {
  if (!filtro || filtro === "TODAS") return true;
  const adelantada = esAdelantadaDe(fila);
  return filtro === "ADELANTADA" ? adelantada : !adelantada;
}

/**
 * Estado del par de botones del toggle: cuál de los dos se pinta como activo.
 */
export function toggleActiva(modalidad: ModalidadTiempo, opcion: ModalidadTiempo): boolean {
  return (modalidad ?? MODALIDAD_POR_DEFECTO) === opcion;
}

/**
 * Clase CSS del botón del toggle según esté activo o no (segmentado, sin
 * botones redondos sueltos: se ve como dos mitades de una misma píldora).
 */
export function claseBotonToggle(activo: boolean): string {
  return [
    "px-3 py-1.5 text-[11px] font-bold transition",
    activo
      ? "bg-amber-500 text-slate-950 shadow-sm"
      : "bg-transparent text-slate-400 hover:bg-white/5 hover:text-slate-200",
  ].join(" ");
}
