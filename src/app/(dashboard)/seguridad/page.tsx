"use client";

import { RutaProtegida } from "@/components/ui/RutaProtegida";
import SeguridadModule from "@/components/seguridad/SeguridadModule";

/**
 * Ruta /seguridad — el MÓDULO MAESTRO. Solo entra quien tenga la capacidad
 * `seguridad:ruta_seguridad` del registro maestro, que es CRÍTICA: desde ahí
 * se concede o se quita el acceso de todos.
 *
 * Protección doble: el middleware (src/middleware.ts, que lee la misma lista del
 * esquema) y el guardia de cliente (RutaProtegida). El primero evita la
 * descarga de la página; el segundo evita el parpadeo del contenido.
 */
export default function SeguridadPage() {
  return (
    <RutaProtegida>
      <div className="p-4 lg:p-6">
        <SeguridadModule />
      </div>
    </RutaProtegida>
  );
}
