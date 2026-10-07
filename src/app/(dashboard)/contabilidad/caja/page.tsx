"use client";

import { RutaProtegida } from "@/components/ui/RutaProtegida";
import { ContabilidadModule } from "@/components/contabilidad/ContabilidadModule";

// La capacidad la deduce el propio RutaProtegida del registro maestro,
// según la ruta: contabilidad:ruta_caja.
export default function ContabilidadCajaPage() {
  return (
    <RutaProtegida>
      <ContabilidadModule tabInicial="caja" />
    </RutaProtegida>
  );
}
