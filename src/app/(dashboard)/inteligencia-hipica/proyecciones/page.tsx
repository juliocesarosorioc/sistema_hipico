"use client";

import { RutaProtegida } from "@/shared/components/ui/RutaProtegida";
import { ProyeccionesModule } from "@/features/inteligencia/components/ProyeccionesModule";

/**
 * INTELIGENCIA HÍPICA · PROYECCIONES
 *
 * La pantalla operativa que cruza la matriz de carreras del día con la
 * memoria histórica de cada ejemplar y calcula el RANKING DE PROBABILIDAD
 * ACTUARIAL. Desde ahí se abre la pizarra prospectiva Godet & Actuarial con
 * los datos reales de la carrera (no con los valores de ejemplo del modo
 * "previa").
 *
 * La ruta la declara el REGISTRO MAESTRO de capacidades
 * (`inteligencia_hipica:ruta_proyecciones`), así que el middleware y esta
 * misma página deciden con la MISMA fuente.
 */
export default function ProyeccionesPage() {
  return (
    <RutaProtegida>
      <div className="flex h-full w-full flex-col">
        <div className="border-b border-slate-200 bg-white px-6 py-4">
          <h1 className="text-xl font-black text-slate-900">Inteligencia Hípica · Proyecciones</h1>
          <p className="text-sm text-slate-500">
            Probabilidad actuarial por ejemplar: memoria histórica, Índice de Consistencia Godet, Beyer/Speed Rating,
            jinete y entrenador habituales · MICMAC/MACTOR, Bühlmann-Straub, Cox y Kelly Fraccional
          </p>
        </div>
        <div className="flex-1 overflow-auto bg-slate-50 p-6">
          <ProyeccionesModule />
        </div>
      </div>
    </RutaProtegida>
  );
}
