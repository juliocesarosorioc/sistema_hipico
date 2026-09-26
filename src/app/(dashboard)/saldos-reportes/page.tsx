"use client";

import { RutaProtegida } from "@/components/ui/RutaProtegida";
import { ReporteModule } from "@/components/saldos/ReporteModule";

export default function SaldosReportesPage() {
  return (
    <RutaProtegida permiso="acceso_dashboard">
      <ReporteModule />
    </RutaProtegida>
  );
}