"use client";

import { RutaProtegida } from "@/components/ui/RutaProtegida";
import { SeguridadModule } from "@/components/seguridad/SeguridadModule";

/**
 * Ruta /seguridad — solo visible para quien tenga `administrar_seguridad`.
 * Protección doble: middleware (src/middleware.ts) + guardia de cliente.
 */
export default function SeguridadPage() {
  return (
    <div className="p-4 lg:p-6">
      <RutaProtegida permiso="administrar_seguridad">
        <SeguridadModule />
      </RutaProtegida>
    </div>
  );
}