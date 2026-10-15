"use client";

import { RutaProtegida } from "@/shared/components/ui/RutaProtegida";
import { ContabilidadModule } from "@/features/contabilidad/components/ContabilidadModule";

export default function ContabilidadIngresosPage() {
  return (
    <RutaProtegida>
      <ContabilidadModule tabInicial="ingresos" />
    </RutaProtegida>
);
}
