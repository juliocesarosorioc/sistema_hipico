"use client";

import { RutaProtegida } from "@/shared/components/ui/RutaProtegida";
import { ReporteModule } from "@/components/saldos/ReporteModule";
import { SelectorReporteCarrera } from "@/components/saldos/SelectorReporteCarrera";

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

        {/* 2. Reporte de liquidación por carrera (datos REALES).
              Elegís grupo → carrera de la semana fiscal y la plantilla se
              arma con las jugadas liquidadas, la pizarra de llegada y el
              resumen Ganan/Pierden. También se llega acá desde el
              «Ver Reporte de Liquidación» de PagarCarreraModal. */}
        <section className="bg-surfaceAlt p-6 rounded-xl border border-line">
          <div className="flex justify-between items-center mb-4 max-w-5xl mx-auto">
            <div>
              <h2 className="text-lg font-bold leading-tight text-slate-800">
                Reporte de Liquidación por Carrera
              </h2>
              <p className="text-xs leading-tight text-slate-500">
                Carrera cargada y pagada → reporte con sus datos reales.
              </p>
            </div>
            <button
              onClick={() => window.print()}
              className="bg-[#1a3822] text-white px-4 py-2 rounded-md shadow-sm flex items-center gap-2 hover:bg-[#2c5234] transition-colors text-sm font-bold tracking-wide"
            >
              <i className="fas fa-print"></i> Imprimir a PDF
            </button>
          </div>

          <SelectorReporteCarrera />
        </section>

      </div>
    </RutaProtegida>
  );
}