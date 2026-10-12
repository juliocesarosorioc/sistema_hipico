import type { ReactNode } from "react";

type Props = {
  /**
   * Icono que encabeza el estado vacío. Admite un emoji (lo normal en el
   * sistema) o cualquier nodo. Si no se pasa, se usa el ticket gris.
   */
  icono?: ReactNode;
  /** Texto principal, corto y en una sola línea. */
  titulo: string;
  /** Explicación opcional: por qué está vacío y qué hacer para llenarlo. */
  descripcion?: string;
  /** Acción sugerida (un botón "Cargar jugadas", "Publicar tabla"...). */
  accion?: ReactNode;
  /** Versión compacta para tablas dentro de una tarjeta. */
  compacto?: boolean;
  className?: string;
};

/**
 * ============================================================================
 * EMPTY STATE — el estado vacío profesional, en un solo lugar
 * ============================================================================
 *
 * Antes cada módulo resolvía "no hay datos" como podía: una tabla colapsada, un
 * `<p>` gris perdido, o directamente datos de prueba (mocks) para no ver el
 * hueco. Este componente unifica el patrón:
 *
 *   · contenedor centrado, borde punteado sutil, fondo tenue;
 *   · un icono atenuado dentro de un disco claro;
 *   · título en `leading-tight` (interlineado denso del dashboard financiero);
 *   · una explicación opcional y una acción opcional.
 *
 * Es presentacional (sin hooks ni estado): lo usan tanto componentes de cliente
 * como de servidor. La paleta sale del Design System (`border-line`,
 * `bg-surfaceAlt`), así que respeta el tema claro central.
 *
 * Uso:
 *   <EmptyState
 *     icono="🎟️"
 *     titulo="No hay jugadas registradas en esta carrera"
 *     descripcion="Cargá el resultado en Gestión de Jugadas para generarla."
 *   />
 */
export function EmptyState({
  icono = "🎟️",
  titulo,
  descripcion,
  accion,
  compacto = false,
  className = "",
}: Props) {
  return (
    <div
      role="status"
      className={[
        "flex flex-col items-center justify-center text-center",
        compacto ? "gap-2 px-4 py-8" : "gap-3 px-6 py-14",
        "rounded-2xl border border-dashed border-line bg-surfaceAlt/60",
        className,
      ].join(" ")}
    >
      <div
        aria-hidden
        className={[
          "flex items-center justify-center rounded-full bg-surface text-slate-300 shadow-sm ring-1 ring-line",
          compacto ? "h-10 w-10 text-lg" : "h-14 w-14 text-2xl",
        ].join(" ")}
      >
        {icono}
      </div>
      <p
        className={[
          "font-semibold leading-tight text-slate-600",
          compacto ? "text-xs" : "text-sm",
        ].join(" ")}
      >
        {titulo}
      </p>
      {descripcion ? (
        <p className="max-w-md text-xs leading-tight text-slate-400">{descripcion}</p>
      ) : null}
      {accion ? <div className="mt-1">{accion}</div> : null}
    </div>
  );
}

export default EmptyState;
