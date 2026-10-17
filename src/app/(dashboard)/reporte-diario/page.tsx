"use client";

import { RutaProtegida } from "@/shared/components/ui/RutaProtegida";
import { ReporteDiarioModule } from "@/features/reportes/components/ReporteDiarioModule";

/**
 * Reporte Diario y por Carrera.
 *
 * La ruta se abre con `general:ruta_saldos` (área de reportes) o, si el maestro
 * ya tiene la capacidad dedicada, con `reporte_diario:ruta_reporte_diario`. El
 * alcance de los DATOS no lo decide esta ruta: lo fuerza la RPC / el RLS.
 */
export default function ReporteDiarioPage() {
  return (
    <RutaProtegida>
      <ReporteDiarioModule />
    </RutaProtegida>
  );
}
