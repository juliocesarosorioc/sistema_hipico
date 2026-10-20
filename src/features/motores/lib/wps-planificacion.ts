/**
 * ============================================================================
 * W.P.S. (Win / Place / Show) — ESTADO "🚧 EN PLANIFICACIÓN"
 * ============================================================================
 *
 * Las jugadas americanas W.P.S. están INACTIVAS para todos los usuarios mientras
 * terminan de planificarse. Este módulo es la ÚNICA fuente de verdad de ese
 * estado en la UI:
 *
 *   · Sidebar          → la entrada queda sin enlace, deshabilitada, con el badge.
 *   · Taquilla         → la pestaña "Win / Place / Show" queda bloqueada.
 *   · BetSlip          → se ocultan los ejemplos "100 W / 100 P / 100 S".
 *   · Reglas de Jugadas→ las filas W.P.S. muestran el badge y sus acciones
 *                        quedan deshabilitadas (sin confirm() ni alert(): ya hay
 *                        una prueba que prohíbe esas llamadas acá).
 *
 * El MOTOR no se toca: `features/motores/lib/wps.ts` sigue completo e intacto
 * (lo usan la pizarra de resultados y los reportes). Solo se decide qué se MUESTRA.
 */

/** Texto completo del badge (títulos, tooltips y pantalla de Reglas). */
export const WPS_PLANIFICACION = "🚧 En Planificación (Próximamente)";

/** Versión corta para chips chicos (Sidebar, pestañas de Taquilla). */
export const WPS_PLANIFICACION_CORTO = "🚧 En Planificación";

/** Texto del aviso cuando se intenta entrar al módulo. */
export const WPS_MENSAJE =
  "🚧 W.P.S. (Win / Place / Show) está en planificación: próximamente se habilita para todos los usuarios.";

/**
 * Clase CSS para dejar un control técnicamente presente pero INERTE: no se puede
 * clickear, no recibe foco y se ve apagado (cumple el `disabled /
 * pointer-events-none opacity-50` del requerimiento).
 */
export const CLASE_WPS_BLOQUEADA =
  "pointer-events-none opacity-50 select-none cursor-not-allowed disabled:pointer-events-none";

/**
 * Nombres que identifican una jugada W.P.S.
 *
 * Se normaliza a mayúsculas quitando puntos/espacios/guiones ("W.P.S." → "WPS",
 * "Win Place Show" → "WINPLACESHOW") y se compara EXACTO contra el conjunto.
 *
 * OJO con "GANADOR": en este sistema es una jugada de taquilla propia (el motor
 * `oficiales.ts` la liquida como `5G` / `GANADOR` con `origen = 'TAQUILLA'` y
 * `productoDeTicket` la clasifica como "entre tercios", NO como wps). Por eso NO
 * entra acá: marcarla 🚧 dejaría sin edición una jugada que sí está en juego.
 */
const WPS_CONOCIDO = new Set([
  "W",
  "P",
  "S",
  "WIN",
  "PLACE",
  "SHOW",
  "WPS",
  "WINPLACESHOW",
  "AMERICANAS",
  "AMERICANASWPS",
  "AMERICANASWP",
]);

/** ¿Este nombre de jugada es una W.P.S.? (catálogo `tipos_jugadas`, comandos, tickets.) */
export function esJugadaWps(nombre: unknown): boolean {
  if (typeof nombre !== "string") return false;
  const normalizado = nombre.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!normalizado) return false;
  return WPS_CONOCIDO.has(normalizado);
}

/**
 * Clase de la fila/lote W.P.S.: igual que `CLASE_WPS_BLOQUEADA`, pensada para
 * envolver un `<tr>` o un bloque completo (en un `<tr>` el `opacity` hereda bien
 * y el `pointer-events-none` evita el clic en sus botones).
 */
export const CLASE_FILA_WPS_BLOQUEADA = "pointer-events-none opacity-50 select-none";
