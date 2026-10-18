"use client";

import { TablasModule } from "@/features/tablas/components/TablasModule";
import type { StoredTablaFija } from "@/shared/store/useTablasFijasStore";
import type { VentaTablaItem } from "@/features/tablas/components/MonitorTablas";
import type { PizarraResultados } from "@/features/liquidacion/components/CargaResultadosModal";
import { publicarTabla, publicarTablasLote, actualizarTabla, venderTablaFija } from "@/features/tablas/lib/rpc";
import { cerrarTablaFija } from "@/features/tablas/lib/tablas-fijas";
import { guardarPizarraCentral } from "@/features/liquidacion/lib/pizarraCentral";

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
          return { ok: r.ok, id: r.id ?? t.id, error: r.error };
        }}
        persistirLote={async (lote: StoredTablaFija[]) => {
          const r = await publicarTablasLote(lote);
          return { ok: r.ok, okCount: r.okCount, errores: r.errores };
        }}
        persistirEdicion={async (t: StoredTablaFija, patch: Record<string, unknown>) => {
          const r = await actualizarTabla(t.id, patch);
          return r.ok;
        }}
        persistirVenta={async (t: StoredTablaFija, v: VentaTablaItem) => {
          // Sin jugador o sin grupo no hay venta: el ticket necesita ambos para
          // el estado de cuenta y el convenio de comision.
          if (!v.jugador?.id) return { ok: false, error: "Seleccione el jugador que compra." };
          if (!v.grupo?.id) return { ok: false, error: "Seleccione el grupo de venta." };
          const r = await venderTablaFija({
            tablaId: t.id,
            clienteId: String(v.jugador.id),
            grupoId: String(v.grupo.id),
            monto: v.monto,
            cantidad: v.cantidad ?? 1,
            // "TABLA" es la opcion de tabla completa; la RPC espera null.
            ejemplarNumero: v.numero === "TABLA" ? null : v.numero,
          });
          return { ok: r.ok, error: r.error };
        }}
        persistirLiquidacion={async (t: StoredTablaFija, r: PizarraResultados) => {
          // Registro ÚNICO del resultado: pasa por `guardarPizarraCentral`, el
          // mismo camino que usan Gestión de Jugadas y los demás módulos. Además
          // de escribir el central, dispara la liquidación de TODAS las jugadas
          // de la carrera (tablas fijas, marcas, dupletas y taquilla): el pago de
          // la tabla fija viaja con el resultado y aparece en el reporte. Antes
          // este flujo liquidaba la tabla por su cuenta y escribía el central con
          // un `upsertResultadoCentral` propio — una segunda forma de registrar.
          const cen = await guardarPizarraCentral({
            hipodromo: t.hipodromo ?? "",
            carrera: t.carrera ?? 0,
            cargado_por: "TABLAS-FIJAS",
            r,
          });
          if (!cen.ok) return false;

          // Cerrar la tabla para que salga del Monitor.
          const cierre = await cerrarTablaFija(t.hipodromo ?? "", t.carrera ?? 0);
          return cierre.ok;
        }}
      />
    </div>
  );
}