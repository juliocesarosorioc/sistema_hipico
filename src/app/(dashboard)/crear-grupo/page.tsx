"use client";

import { RutaProtegida } from "@/shared/components/ui/RutaProtegida";
import { CreacionGruposModule } from "@/components/grupos/CreacionGruposModule";

/**
 * Ruta de Creación de Grupos (NIVEL 0 → 3).
 * Módulo exclusivo del super administrador: crea el grupo (grupos_venta), el
 * administrador de la banca y sus operadores en una sola operación.
 *
 * La puerta de la ruta es `seguridad:ruta_seguridad` (solo administradores) y
 * el módulo exige `esPrincipal` para funcionar: josorioc lo ve, el resto ve el
 * estado vacío "Solo el super administrador".
 */
export default function CrearGrupoPage() {
  return (
    <RutaProtegida>
      <div className="p-4 lg:p-6">
        <CreacionGruposModule />
      </div>
    </RutaProtegida>
  );
}