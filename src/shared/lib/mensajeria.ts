/**
 * ============================================================================
 * MENSAJERÍA — núcleo puro (testeable en node)
 * ============================================================================
 *
 * Una sola definición de los tipos de mensaje de la plataforma, para que el
 * ToastHost, el modal de confirmación y los avisos inline pinten SIEMPRE igual.
 * El color vive en `globals.css` (clases `.msg-*`); acá queda qué tipo existe,
 * qué ícono lleva y qué etiqueta se le muestra al operador.
 *
 *   SUCCESS → Éxito / Liquidado / Guardado
 *   WARNING → Advertencia / Pendiente / Rezagada
 *   ERROR   → Error / Anulada / Rechazo
 *   INFO    → Información / Proceso / Edición
 *
 * Los nombres viejos ("success" | "warning" | "error" | "info") siguen siendo
 * los mismos que recibía el CustomEvent "toast", así que nada que ya emitía
 * toasts se rompe: solo cambia cómo se ve.
 */

export const TIPOS_MENSAJE = ["success", "warning", "error", "info"] as const;

export type TipoMensaje = (typeof TIPOS_MENSAJE)[number];

/** Ícono de cada tipo (el badge del componente lo pinta). */
export const ICONO_MENSAJE: Record<TipoMensaje, string> = {
  success: "✅",
  warning: "⚠️",
  error: "🚫",
  info: "ℹ️",
};

/** Etiqueta corta del tipo, para lectores de pantalla y encabezados. */
export const ETIQUETA_MENSAJE: Record<TipoMensaje, string> = {
  success: "Éxito",
  warning: "Advertencia",
  error: "Error",
  info: "Información",
};

/** Clase CSS del marco según el tipo (definida en globals.css). */
export const CLASE_MENSAJE: Record<TipoMensaje, string> = {
  success: "msg-success",
  warning: "msg-warning",
  error: "msg-error",
  info: "msg-info",
};

/** Normaliza cualquier valor recibido de un evento a un tipo válido. */
export function normalizarTipo(valor: unknown): TipoMensaje {
  const v = String(valor ?? "").trim().toLowerCase();
  return (TIPOS_MENSAJE as readonly string[]).includes(v) ? (v as TipoMensaje) : "info";
}

/** ¿El valor es un tipo de mensaje válido? */
export function esTipoMensaje(valor: unknown): valor is TipoMensaje {
  return (TIPOS_MENSAJE as readonly string[]).includes(String(valor ?? "").trim().toLowerCase());
}

/**
 * Emite un toast global. Es el ÚNICO camino para avisar algo efímero: el
 * `ToastHost` (montado una vez por pantalla) lo escucha por el CustomEvent.
 * Se exporta acá para no repetir `window.dispatchEvent(new CustomEvent(...))`
 * en cada módulo, que era lo que dejaba variaciones de estilo y de tipo.
 */
export function emitirToast(msg: string, tipo: TipoMensaje = "info"): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("toast", { detail: { msg, tipo: normalizarTipo(tipo) } }));
}

/**
 * Emite el evento global de "logos actualizados". Las pantallas que pintan el
 * logo de un hipódromo o de un grupo lo escuchan para releerlo al instante,
 * sin recargar la página.
 */
export function emitirLogosActualizados(detalle?: { hipodromoId?: string; grupoId?: string }): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("logos-updated", { detail: detalle ?? {} }));
}
