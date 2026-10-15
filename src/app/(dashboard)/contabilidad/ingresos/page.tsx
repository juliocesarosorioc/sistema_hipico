"use client";

import { RutaProtegida } from "@/shared/components/ui/RutaProtegida";
import { ContabilidadModule } from "@/components/contabilidad/ContabilidadModule";

export default function ContabilidadIngresosPage() {
  return (
    <RutaProtegida>
      <ContabilidadModule tabInicial="ingresos" />
    </RutaProtegida>
);
}
