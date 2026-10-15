"use client";

import { RutaProtegida } from "@/shared/components/ui/RutaProtegida";
import { ContabilidadModule } from "@/components/contabilidad/ContabilidadModule";

export default function ContabilidadMonedasPage() {
  return (
    <RutaProtegida>
      <ContabilidadModule tabInicial="monedas" />
    </RutaProtegida>
);
}
