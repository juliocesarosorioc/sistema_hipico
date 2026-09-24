"use client";

import { useEffect, useState } from "react";
import { useTablasFijasStore, type StoredTablaFija } from "@/store/useTablasFijasStore";
import type { TablaFijaRow } from "@/lib/tablas-fijas";
import { useTaquillaStore } from "@/store/useTaquillaStore";
import { EnsamblajeTabla } from "@/components/tablas/EnsamblajeTabla";
import { MonitorTablas, type VentaTablaItem } from "@/components/tablas/MonitorTablas";
import type { PizarraResultados } from "@/components/liquidacion/CargaResultadosModal";

type Props = {
  /** Devuelve el id real de Supabase (o null si falla). El contenedor reemplaza el id del store. */
  persistirPublicacion?: (t: StoredTablaFija) => Promise<string | number | null>;
  persistirEdicion?: (t: StoredTablaFija, patch: Record<string, unknown>) => Promise<boolean>;
  persistirVenta?: (t: StoredTablaFija, v: VentaTablaItem) => Promise<boolean>;
  persistirLiquidacion?: (t: StoredTablaFija, r: PizarraResultados) => Promise<boolean>;
};

/**
 * Módulo Tablas Fijas — contenedor con pestañas [Ensamblaje | Monitor].
 * Mantiene la caché reactiva en Zustand (useTablasFijasStore): al liquidar,
 * marcarCerrada() hace desaparecer la tarjeta del Monitor sin recargar.
 */
export function TablasModule(props: Props) {
  const { persistirPublicacion, persistirEdicion, persistirVenta, persistirLiquidacion } = props;
  const [tab, setTab] = useState<"ensamblaje" | "monitor">("ensamblaje");
  const tablas = useTablasFijasStore((s) => s.tablas);
  const setTablas = useTablasFijasStore((s) => s.setTablas);
  const marcarCerrada = useTablasFijasStore((s) => s.marcarCerrada);
  const agregarTicket = useTaquillaStore((s) => s.agregarTicket);

  useEffect(() => {
    if (tab === "monitor") refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const refresh = async () => {
    const { listarTablasPublicadas } = await import("@/lib/tablas/rpc");
    const filas = await listarTablasPublicadas();
    if (filas.length) setTablas(filas);
  };

  const publicar = async (tabla: TablaFijaRow) => {
    const id = persistirPublicacion ? await persistirPublicacion(tabla as StoredTablaFija) : (tabla as StoredTablaFija).id;
    if (id == null) return false;
    setTablas([...tablas.filter((t) => String(t.id) !== String(tabla.id)), { ...tabla, id } as StoredTablaFija]);
    return true;
  };

  const vender = async (v: VentaTablaItem) => {
    const tabla = tablas.find((t) => String(t.id) === String(v.tablaId));
    if (!tabla) return;
    const base = (tabla.premio_recalculado ?? 0) * v.monto;
    agregarTicket({
      comando: `TABLA ${tabla.hipodromo} C${tabla.carrera} ${v.nombre === "TABLA COMPLETA" ? "TABLA COMPLETA" : `N${v.numero} ${v.nombre}`}`,
      monto: v.monto,
      gananciaProyectada: base,
      comision: base * 0.05,
    });
    if (persistirVenta) await persistirVenta(tabla, v);
    setTablas(
      tablas.map((t) =>
        String(t.id) === String(v.tablaId)
          ? { ...t, cantidad_vendida: (t.cantidad_vendida ?? 0) + v.monto }
          : t
      )
    );
  };

  const liquidar = async (tabla: StoredTablaFija, r: PizarraResultados) => {
    if (persistirLiquidacion) {
      const ok = await persistirLiquidacion(tabla, r);
      if (ok) marcarCerrada(tabla.hipodromo ?? "", tabla.carrera ?? 0);
    } else {
      marcarCerrada(tabla.hipodromo ?? "", tabla.carrera ?? 0);
    }
  };

  const editar = async (tabla: StoredTablaFija, patch: Record<string, unknown>) => {
    if (persistirEdicion) {
      const ok = await persistirEdicion(tabla, patch);
      if (ok) setTablas(tablas.map((t) => (String(t.id) === String(tabla.id) ? { ...t, ...patch } : t)));
    } else {
      setTablas(tablas.map((t) => (String(t.id) === String(tabla.id) ? { ...t, ...patch } : t)));
    }
  };

  return (
    <div className="space-y-4">
      <div className="no-print flex items-center gap-2 border-b border-line pb-3">
        {(["ensamblaje", "monitor"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded-full px-4 py-1.5 text-xs font-black uppercase transition-colors ${
              tab === t ? "bg-slate-900 text-white" : "bg-line/60 text-slate-600 hover:bg-line"
            }`}
          >
            {t === "ensamblaje" ? "🔧 Ensamblaje" : "📊 Monitor"}
          </button>
        ))}
      </div>

      {tab === "ensamblaje" ? <EnsamblajeTabla onPublicar={publicar} /> : <MonitorTablas tablas={tablas} onVender={vender} onLiquidar={liquidar} onEditar={editar} />}
    </div>
  );
}

export default TablasModule;