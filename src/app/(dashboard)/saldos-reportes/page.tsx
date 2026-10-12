"use client";

import { RutaProtegida } from "@/components/ui/RutaProtegida";
import { ReporteModule } from "@/components/saldos/ReporteModule";
import ReporteCarrera from "@/components/saldos/ReporteCarrera"; // <-- Importamos la nueva plantilla

export default function SaldosReportesPage() {
  return (
    <RutaProtegida>
      <div className="flex flex-col gap-8 pb-10">
        
        {/* 1. Tu módulo original (No lo tocamos) */}
        <section>
          <ReporteModule />
        </section>

        {/* Separador visual */}
        <div className="h-px bg-slate-300 w-full"></div>

        {/* 2. Plantilla de cierre de carrera.
              Sin datos (producción): muestra el estado vacío. El flujo de
              liquidación le pasa `datos` cuando hay una carrera resuelta. */}
        <section className="bg-surfaceAlt p-6 rounded-xl border border-line">
          <div className="flex justify-between items-center mb-6 max-w-5xl mx-auto">
            <div>
              <h2 className="text-lg font-bold leading-tight text-slate-800">
                Reporte de Liquidación
              </h2>
              <p className="text-xs leading-tight text-slate-500">
                Plantilla que usa Gestión de Jugadas al cerrar una carrera.
              </p>
            </div>
            <button
              onClick={() => window.print()}
              className="bg-[#1a3822] text-white px-4 py-2 rounded-md shadow-sm flex items-center gap-2 hover:bg-[#2c5234] transition-colors text-sm font-bold tracking-wide"
            >
              <i className="fas fa-print"></i> Imprimir a PDF
            </button>
          </div>

          {/* Sin datos de prueba: la plantilla recibe los datos reales por props. */}
          <ReporteCarrera />
        </section>

      </div>
    </RutaProtegida>
  );
}