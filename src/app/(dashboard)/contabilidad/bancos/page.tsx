"use client";

import { RutaProtegida } from "@/components/ui/RutaProtegida";
import { ContabilidadModule } from "@/components/contabilidad/ContabilidadModule";

export default function ContabilidadBancosPage() {
  return (
    <RutaProtegida permiso="acceso_dashboard">
      <ContabilidadModule tabInicial="bancos" />
    </RutaProtegida>
  );
}
