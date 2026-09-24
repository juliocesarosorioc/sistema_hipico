"use client";

import { TablasModule } from "@/components/tablas/TablasModule";
import type { StoredTablaFija } from "@/store/useTablasFijasStore";
import type { VentaTablaItem } from "@/components/tablas/MonitorTablas";
import type { PizarraResultados } from "@/components/liquidacion/CargaResultadosModal";
import { publicarTabla, actualizarTabla, registrarVenta, guardarPizarraCarrera } from "@/lib/tablas/rpc";
import { cerrarTablaFija } from "@/lib/tablas-fijas";

/**
 * Ruta Tablas Fijas — integración con Supabase y Zustand:
 *  - publicar  → upsert en tablas_fijas (estado 'Abierta') + refresh de caché
 *  - editar    → UPDATE de solo columnas seguras
 *  - vender    → ticket en useTaquillaStore + contador cantidad_vendida
 *  - liquidar  → guarda la pizarra (8 posiciones + dead heat) y cierra la
 *                tabla en BD; marcarCerrada() la quita del Monitor en vivo.
 */
export default function TablasFijasPage() {
  return (
    <div className="p-4 lg:p-6">
      <TablasModule
        persistirPublicacion={async (t: StoredTablaFija) => {
          const r = await publicarTabla(t);
          return r.ok ? (r.id ?? t.id) : null;
        }}
        persistirEdicion={async (t: StoredTablaFija, patch: Record<string, unknown>) => {
          const r = await actualizarTabla(t.id, patch);
          return r.ok;
        }}
        persistirVenta={async (t: StoredTablaFija, v: VentaTablaItem) => {
          const r = await registrarVenta(t.id, v.monto);
          return r.ok;
        }}
        persistirLiquidacion={async (t: StoredTablaFija, r: PizarraResultados) => {
          await guardarPizarraCarrera({
            hipodromo: t.hipodromo,
            carrera: t.carrera,
            pizarra: r.pizarra as unknown as Record<string, unknown>,
          });
          const cierre = await cerrarTablaFija(t.hipodromo ?? "", t.carrera ?? 0);
          return cierre.ok;
        }}
      />
    </div>
  );
}