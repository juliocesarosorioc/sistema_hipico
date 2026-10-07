"use client";

import { RutaProtegida } from "@/components/ui/RutaProtegida";
import { GruposModule } from "@/components/grupos/GruposModule";

/**
 * Ruta Grupos de Venta y Convenios (clon 1:1 del legacy grupos.html / grupos.js):
 *  - Crear / listar / editar / activar / eliminar grupos de venta (grupos_venta)
 *  - Clientes por grupo (grupo_id principal + pertenencias en clientes_grupos)
 *  - Convenios por tipo de jugada y grupo (convenio_tipo_grupo)
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
