"use client";

import type { ReactNode } from "react";
import { hasPermission } from "@/store/useAuthStore";

type Props = {
  /** Permiso requerido. Lista = se exigen TODOS. */
  permiso: string | string[];
  /**
   * Comportamiento cuando NO se tiene el permiso:
   *  - "ocultar"      → renderiza `fallback` (null por defecto): el botón desaparece.
   *  - "deshabilitar" → renderiza los hijos envueltos con aria-disabled + opacidad
   *                     (no clickeables). Equivalente a pasar `disabled`.
   */
  modo?: "ocultar" | "deshabilitar";
  /** Alias de `modo="deshabilitar"` (directiva del requerimiento). */
  disabled?: boolean;
  fallback?: ReactNode;
  children: ReactNode;
};

/**
 * Componente Guardia atómico de RBAC sobre la UI. Uso:
 *
 *   <Guard permiso="liquidar_carrera">
 *     <Button>Liquidar carrera</Button>
 *   </Guard>
 *
 *   <Guard permiso="anular_ticket" disabled>
 *     <Button>Anular ticket</Button>
 *   </Guard>
 *
 * Si el usuario no posee el permiso: renderiza null (o el fallback), o el
 * contenido en estado deshabilitado según cómo se le pase por prop.
 */
export function Guard({ permiso, modo: _modo = "ocultar", disabled, fallback = null, children }: Props) {
  const permite = hasPermission(permiso);
  if (permite) return <>{children}</>;

  const modo = disabled ? "deshabilitar" : _modo;
  if (modo === "deshabilitar") {
    const etiqueta = Array.isArray(permiso) ? permiso.join(", ") : permiso;
    return (
      <span
        aria-disabled="true"
        title={`Permiso requerido: ${etiqueta}`}
        className="inline-flex cursor-not-allowed select-none opacity-40"
      >
        {children}
      </span>
    );
  }
  return <>{fallback}</>;
}

export default Guard;