"use client";

import { RutaProtegida } from "@/components/ui/RutaProtegida";
import { ContabilidadModule } from "@/components/contabilidad/ContabilidadModule";

export default function ContabilidadPage() {
  return (
    <RutaProtegida permiso="acceso_dashboard">
      <ContabilidadModule />
    </RutaProtegida>
  );
}
