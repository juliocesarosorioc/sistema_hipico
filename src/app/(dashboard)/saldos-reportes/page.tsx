"use client";

import { RutaProtegida } from "@/components/ui/RutaProtegida";
import { ReporteModule } from "@/components/saldos/ReporteModule";

export default function SaldosReportesPage() {
  return (
    <RutaProtegida>
      <ReporteModule />
    </RutaProtegida>
);
}