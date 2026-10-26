"use client";

import { useMemo, useState } from "react";
import { useCarrerasDiaStore } from "@/shared/store/useCarrerasDiaStore";
import { useRegistroCentralOpts } from "@/shared/store/useRegistroCentral";
import { useTablasFijasStore } from "@/shared/store/useTablasFijasStore";
import { useTaquillaStore } from "@/shared/store/useTaquillaStore";
import {
  deduplicarYOrdenarCarrerasLiquidadas,
  formatearItemCarreraLiquidada,
  ordenarCarrerasLiquidadas,
  type ItemCarreraLiquidada,
} from "@/features/gestion/lib/carreras-liquidadas-orden";

export {
  deduplicarYOrdenarCarrerasLiquidadas,
  formatearItemCarreraLiquidada,
  ordenarCarrerasLiquidadas,
  type ItemCarreraLiquidada,
};

function hipoKey(h: unknown): string {
  return String(h ?? "").toUpperCase().replace(/\s+/g, "");
}

type Props = {
  fecha: string;
  hipodromo: string;
  nombreHipodromo?: string;
  carreraActiva?: number | null;
  conteoJugadasActiva?: number;
  pizarraActiva?: string;
  refreshKey?: number;
  itemsExtra?: ItemCarreraLiquidada[];
  abiertoInicial?: boolean;
  onSeleccionarCarrera?: (carrera: number) => void;
  onVerReporteCarrera?: (carrera: number) => void;
};

/**
 * Panel Lateral Derecho Ocultable (Drawer / Aside) de Carreras Liquidadas.
 * - Eliminado de la barra superior.
 * - Cero duplicados: deduplicación estricta por `${fecha}::${hipodromoNormalizado}::${numeroCarrera}`.
 * - Orden cronológico inverso: la carrera liquidada más reciente siempre arriba en el tope,
 *   y la más antigua abajo.
 */
export function BarraCarrerasLiquidadas({
  fecha,
  hipodromo,
  nombreHipodromo,
  carreraActiva,
  conteoJugadasActiva = 0,
  pizarraActiva,
  itemsExtra = [],
  abiertoInicial = false,
  onSeleccionarCarrera,
  onVerReporteCarrera,
}: Props) {
  const [abierto, setAbierto] = useState(abiertoInicial);
  const carrerasDia = useCarrerasDiaStore((s) => s.carreras);
  const tablas = useTablasFijasStore((s) => s.tablas);
  const tickets = useTaquillaStore((s) => s.tickets);
  const { carrerasDe } = useRegistroCentralOpts(fecha);

  const itemsLiquidadas = useMemo(() => {
    const hipo = hipoKey(hipodromo);
    const hipLabel = nombreHipodromo || hipodromo || "Hipódromo";
    const centrales = hipodromo ? carrerasDe(hipodromo) : [];
    const recolectadas: ItemCarreraLiquidada[] = [...itemsExtra];

    for (const c of centrales) {
      const est = String(c.estado ?? "").toLowerCase();
      const ganadores = Array.isArray(c.ganadores) ? c.ganadores.filter(Boolean) : [];
      const esLiq =
        est === "liquidada" ||
        est === "cerrada" ||
        c.aplicado_a_tablas === true ||
        ganadores.length > 0;
      if (!esLiq) continue;
      const numC = Number(c.carrera);
      const jugCount =
        numC === carreraActiva && conteoJugadasActiva > 0
          ? conteoJugadasActiva
          : tickets.filter(
              (tk) =>
                tk.carrera === numC &&
                (!tk.hipodromo || hipoKey(tk.hipodromo) === hipo) &&
                (!tk.fecha || tk.fecha === fecha)
            ).length;
      const cAny = c as Record<string, unknown>;
      recolectadas.push({
        fecha,
        carrera: numC,
        hipodromo: hipLabel,
        pizarra:
          numC === carreraActiva && pizarraActiva
            ? pizarraActiva
            : ganadores.length > 0
              ? ganadores.slice(0, 5).join("-")
              : "Oficial",
        jugadas: jugCount,
        totalJugadas: jugCount,
        liquidada: true,
        liquidada_at: (cAny.liquidada_at ?? cAny.updated_at ?? cAny.created_at ?? null) as string | null,
      });
    }

    for (const r of carrerasDia) {
      if (r.fecha !== fecha) continue;
      if (hipo && hipoKey(r.hipodromo) !== hipo) continue;
      if (String(r.estado ?? "").toLowerCase() !== "liquidada") continue;
      const numC = Number(r.carrera);
      const rAny = r as unknown as Record<string, unknown>;
      recolectadas.push({
        fecha: r.fecha,
        carrera: numC,
        hipodromo: nombreHipodromo || r.hipodromo,
        pizarra: numC === carreraActiva && pizarraActiva ? pizarraActiva : "Liquidada",
        jugadas: numC === carreraActiva ? conteoJugadasActiva : 0,
        totalJugadas: numC === carreraActiva ? conteoJugadasActiva : 0,
        liquidada: true,
        liquidada_at: (rAny.liquidada_at ?? rAny.updated_at ?? null) as string | null,
      });
    }

    for (const t of tablas) {
      if (hipo && hipoKey(t.hipodromo) !== hipo) continue;
      const esCerrada = Boolean(t.cerrada) || String(t.estado ?? "").toLowerCase() === "cerrada";
      if (!esCerrada) continue;
      const numC = Number(t.carrera);
      const tAny = t as unknown as Record<string, unknown>;
      recolectadas.push({
        fecha: t.fecha || fecha,
        carrera: numC,
        hipodromo: hipLabel,
        pizarra: numC === carreraActiva && pizarraActiva ? pizarraActiva : "Cerrada",
        jugadas: numC === carreraActiva ? conteoJugadasActiva : 0,
        totalJugadas: numC === carreraActiva ? conteoJugadasActiva : 0,
        liquidada: true,
        liquidada_at: (tAny.liquidada_at ?? tAny.updated_at ?? t.fecha_creacion ?? null) as string | null,
      });
    }

    return deduplicarYOrdenarCarrerasLiquidadas(recolectadas);
  }, [
    hipodromo,
    nombreHipodromo,
    fecha,
    carrerasDe,
    carrerasDia,
    tablas,
    tickets,
    carreraActiva,
    conteoJugadasActiva,
    pizarraActiva,
    itemsExtra,
  ]);

  return (
    <>
      {/* Pestaña flotante a la derecha para abrir/ocultar el Drawer */}
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        aria-label="Abrir u ocultar panel lateral derecho de carreras liquidadas"
        className="no-print fixed right-0 top-24 z-40 flex items-center gap-1.5 rounded-l-xl border border-r-0 border-emerald-400/80 bg-emerald-950/95 px-3 py-2 text-xs font-black uppercase tracking-wider text-emerald-100 shadow-xl transition hover:bg-emerald-900"
      >
        <span>🏁 Liquidadas ({itemsLiquidadas.length})</span>
        <span className="text-[10px] text-emerald-300">{abierto ? "▶" : "◀"}</span>
      </button>

      {/* Drawer lateral derecho ocultable */}
      <aside
        aria-label="Panel lateral derecho de carreras liquidadas"
        aria-hidden={!abierto}
        className={`no-print fixed bottom-0 right-0 top-[50px] z-40 flex w-80 max-w-[90vw] flex-col border-l border-emerald-500/40 bg-slate-950/95 text-slate-100 shadow-2xl backdrop-blur-md transition-transform duration-200 ease-out ${
          abierto ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between border-b border-slate-800 bg-emerald-950/80 px-4 py-3">
          <div>
            <h3 className="text-xs font-black uppercase tracking-wider text-emerald-300">
              🏁 Carreras Liquidadas ({itemsLiquidadas.length})
            </h3>
            <p className="text-[10px] font-semibold text-emerald-100/75">
              Orden: Más reciente arriba → Más antigua abajo
            </p>
          </div>
          <button
            type="button"
            onClick={() => setAbierto(false)}
            className="rounded-lg border border-white/15 bg-white/5 px-2 py-1 text-xs font-bold text-slate-300 hover:bg-white/10 hover:text-white"
            aria-label="Ocultar panel de carreras liquidadas"
          >
            ✕
          </button>
        </div>

        <div className="bet-slip-scroll flex-1 space-y-2 overflow-y-auto p-3">
          {itemsLiquidadas.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-800 bg-slate-900/60 p-4 text-center text-xs text-slate-400">
              Sin carreras liquidadas aún en esta jornada. Se mostrarán de la más nueva a la más antigua sin duplicados.
            </div>
          ) : (
            itemsLiquidadas.map((it, idx) => {
              const activa = carreraActiva === it.carrera;
              const clave = `${it.fecha ?? fecha}::${it.hipodromo}::${it.carrera}`;
              const totalJug = it.totalJugadas ?? it.jugadas ?? 0;
              return (
                <div
                  key={clave}
                  className={`flex flex-col gap-1.5 rounded-xl border p-2.5 text-xs transition ${
                    activa
                      ? "border-amber-400 bg-emerald-900/80 text-white shadow-md"
                      : "border-slate-800 bg-slate-900/85 text-slate-200 hover:border-emerald-600/60"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => onSeleccionarCarrera?.(it.carrera)}
                      className="text-left font-black text-emerald-300 hover:underline"
                      title={`Seleccionar ${it.carrera}ª carrera liquidada`}
                    >
                      ✅ C{it.carrera} · {it.hipodromo}
                    </button>
                    {idx === 0 && (
                      <span className="rounded-full bg-amber-400/20 px-2 py-0.5 text-[9px] font-black uppercase text-amber-300">
                        Más reciente
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-slate-300">
                    <span>
                      Pizarra: <b className="font-mono text-white">{it.pizarra || "Oficial"}</b>
                    </span>
                    <span>
                      Jugadas: <b className="font-mono text-emerald-300">{totalJug}</b>
                    </span>
                  </div>
                  <div className="flex items-center justify-end gap-1.5 pt-1">
                    <button
                      type="button"
                      onClick={() => onSeleccionarCarrera?.(it.carrera)}
                      className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-[10px] font-bold text-slate-200 hover:bg-slate-700"
                    >
                      Ir a C{it.carrera}
                    </button>
                    {onVerReporteCarrera && (
                      <button
                        type="button"
                        onClick={() => onVerReporteCarrera(it.carrera)}
                        className="rounded-lg bg-amber-400 px-2.5 py-1 text-[10px] font-black uppercase text-slate-950 hover:bg-amber-300"
                      >
                        📊 Ver Reporte
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </aside>
    </>
  );
}

export default BarraCarrerasLiquidadas;
