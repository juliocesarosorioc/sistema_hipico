"use client";

import type { ReactNode } from "react";
import { useAuthStore } from "@/store/useAuthStore";

type Props = {
  /** Permiso requerido. Lista = se exigen TODOS. */
  permiso?: string | string[];
  /**
   * Basta con poseer UNO de estos. Se usa cuando hay un permiso de lectura y
   * otro de escritura sobre el mismo módulo (ej. `clientes:ruta_clientes`
   * habilita el botón del menú y `clientes:btn_eliminar` habilita borrar).
   * Si se pasa, `permiso` se ignora.
   */
  algunaDe?: string | string[];
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
 *   <Guard permiso="gestion_jugadas:btn_liquidar">
 *     <Button>Liquidar carrera</Button>
 *   </Guard>
 *
 *   <Guard permiso="taquilla:btn_anular_ticket" disabled>
 *     <Button>Anular ticket</Button>
 *   </Guard>
 *
 * Si el usuario no posee el permiso: renderiza null (o el fallback), o el
 * contenido en estado deshabilitado según cómo se le pase por prop.
 */
export function Guard({ permiso, algunaDe, modo: _modo = "ocultar", disabled, fallback = null, children }: Props) {
  // Se suscribe a `permisos`, `esPrincipal` e `inicializada` para que el botón
  // aparezca o desaparezca en el momento en que cambian los accesos.
  const permisos = useAuthStore((s) => s.permisos);
  const esPrincipal = useAuthStore((s) => s.esPrincipal);
  const inicializada = useAuthStore((s) => s.inicializada);

  // Antes soltaba los hijos en el primer render para no romper la
  // hidratación, y eso dejaba botones y enlaces prohibitedores dibujados
  // hasta que el store terminaba de resolver la sesión. Ahora, mientras la
  // sesión no esté verificada, no se muestra NADA: el acceso va antes de la
  // visualización, que es el orden pedido. AppShell ya impide que se monte el
  // contenido en ese estado; esta segunda barrera cubre los guards sueltos.
  if (!inicializada) return null;

  let permite: boolean;
  if (esPrincipal) {
    // El usuario principal pasa siempre: el maestro nunca le cierra un control.
    permite = true;
  } else {
    const set = new Set(permisos);
    if (algunaDe) {
      // OR: alcanza con uno de los indicados.
      permite = (Array.isArray(algunaDe) ? algunaDe : [algunaDe]).some((p) => set.has(p));
    } else if (Array.isArray(permiso)) {
      // AND: se exigen todas.
      permite = permiso.every((p) => set.has(p));
    } else {
      permite = permiso ? set.has(permiso) : true;
    }
  }
  if (permite) return <>{children}</>;

  const modo = disabled ? "deshabilitar" : _modo;
  if (modo === "deshabilitar") {
    const etiqueta = (algunaDe ?? permiso ?? []).toString().split(",").join(" / ");
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