"use client";

import { RutaProtegida } from "@/shared/components/ui/RutaProtegida";
import { GruposModule } from "@/features/grupos/components/GruposModule";

/**
 * Ruta Grupos de Venta y Convenios (clon 1:1 del legacy grupos.html / grupos.js):
 *  - Crear / listar / editar / activar / eliminar grupos de venta (grupos_venta)
 *  - Convenios por tipo de jugada y grupo (convenio_tipo_grupo)
 *  - Banquero por modalidad (banquero_convenio)
 *
 * La capacidad la deduce RutaProtegida del registro maestro: grupos:ruta_grupos.
 */
export default function GruposPage() {
  return (
    <RutaProtegida>
      <div className="p-4 lg:p-6">
        <GruposModule />
      </div>
    </RutaProtegida>
  );
}
