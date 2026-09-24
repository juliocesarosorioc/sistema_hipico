"use client";

import { RutaProtegida } from "@/components/ui/RutaProtegida";
import { GruposModule } from "@/components/grupos/GruposModule";

/**
 * Ruta Grupos de Venta y Convenios (clon 1:1 del legacy grupos.html / grupos.js):
 *  - Crear / listar / editar / activar / eliminar grupos de venta (grupos_venta)
 *  - Clientes por grupo (grupo_id principal + pertenencias en clientes_grupos)
 *  - Convenios por tipo de jugada y grupo (convenio_tipo_grupo)
 */
export default function GruposPage() {
  return (
    <RutaProtegida permiso="gestionar_clientes">
      <div className="p-4 lg:p-6">
        <GruposModule />
      </div>
    </RutaProtegida>
  );
}