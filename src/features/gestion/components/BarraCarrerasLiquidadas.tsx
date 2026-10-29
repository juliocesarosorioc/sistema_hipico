"use client";

import { useEffect, useMemo, useState } from "react";
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

function normalizarFechaISO(f: unknown): string {
  if (!f) return "";
  const s = String(f).trim();
  if (s.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(s)) {
    return s.slice(0, 10);
  }
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10);
  }
  return s.slice(0, 10);
}

function formatearFechaDDMMAAAA(iso: string): string {
  if (!iso || iso.length < 10) return iso || "";
  const partes = iso.slice(0, 10).split("-");
  if (partes.length === 3) {
    return `${partes[2]}/${partes[1]}/${partes[0]}`;
  }
  return iso;
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
  onSeleccionarItem?: (item: ItemCarreraLiquidada) => void;
};

/**
 * Panel Lateral Derecho Ocultable (Drawer) de Carreras Liquidadas.
 * - Filtro ESTRICTO: Solo muestra las carreras del día consultado (`fecha`).
 * - Formato de Lista Simplificada: filas compactas y limpias sin tarjetas invasivas.
 * - Ubicación ergonómica no invasiva: botón flotante anclado en la esquina inferior derecha
 *   (`bottom-5 right-5`) para evitar quedar atravesado sobre las áreas de trabajo,
 *   tablas de apuestas o selectores de cabecera.
 * - Deduplicación estricta y orden cronológico inverso (la más reciente en el tope).
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
  onSeleccionarItem,
}: Props) {
  const [abierto, setAbierto] = useState(abiertoInicial);
  const carrerasDia = useCarrerasDiaStore((s) => s.carreras);
  const tablas = useTablasFijasStore((s) => s.tablas);
  const tickets = useTaquillaStore((s) => s.tickets);
  const { carrerasDe } = useRegistroCentralOpts(fecha);

  // Cerrar con Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && abierto) {
        setAbierto(false);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [abierto]);

  const fechaObjetivo = useMemo(() => normalizarFechaISO(fecha), [fecha]);

  const itemsLiquidadas = useMemo(() => {
    const hipo = hipoKey(hipodromo);
    const hipLabel = nombreHipodromo || hipodromo || "Hipódromo";
    const centrales = hipodromo ? carrerasDe(hipodromo) : [];
    const recolectadas: ItemCarreraLiquidada[] = [];

    // 1. Items extra (filtrados estrictamente al día consultado)
    for (const it of itemsExtra) {
      if (!it) continue;
      const fItem = normalizarFechaISO(it.fecha);
      if (fechaObjetivo && fItem && fItem !== fechaObjetivo) continue;
      recolectadas.push({
        ...it,
        fecha: fItem || fechaObjetivo,
      });
    }

    // 2. Registro Central (filtradas estrictamente al día consultado)
    for (const c of centrales) {
      const fC = normalizarFechaISO((c as { fecha?: unknown }).fecha);
      if (fechaObjetivo && fC && fC !== fechaObjetivo) continue;

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
                (!tk.fecha || normalizarFechaISO(tk.fecha) === fechaObjetivo)
            ).length;
      const cAny = c as Record<string, unknown>;
      recolectadas.push({
        fecha: fechaObjetivo || fC,
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

    // 3. Carreras del Día del store (filtradas estrictamente al día consultado)
    for (const r of carrerasDia) {
      const fR = normalizarFechaISO(r.fecha);
      if (fechaObjetivo && fR !== fechaObjetivo) continue;
      if (hipo && hipoKey(r.hipodromo) !== hipo) continue;
      if (String(r.estado ?? "").toLowerCase() !== "liquidada") continue;

      const numC = Number(r.carrera);
      const rAny = r as unknown as Record<string, unknown>;
      recolectadas.push({
        fecha: fR || fechaObjetivo,
        carrera: numC,
        hipodromo: nombreHipodromo || r.hipodromo,
        pizarra: numC === carreraActiva && pizarraActiva ? pizarraActiva : "Liquidada",
        jugadas: numC === carreraActiva ? conteoJugadasActiva : 0,
        totalJugadas: numC === carreraActiva ? conteoJugadasActiva : 0,
        liquidada: true,
        liquidada_at: (rAny.liquidada_at ?? rAny.updated_at ?? null) as string | null,
      });
    }

    // 4. Tablas fijas cerradas (filtradas estrictamente al día consultado)
    for (const t of tablas) {
      const fT = normalizarFechaISO(t.fecha || t.fecha_creacion);
      if (fechaObjetivo && fT !== fechaObjetivo) continue;
      if (hipo && hipoKey(t.hipodromo) !== hipo) continue;
      const esCerrada = Boolean(t.cerrada) || String(t.estado ?? "").toLowerCase() === "cerrada";
      if (!esCerrada) continue;

      const numC = Number(t.carrera);
      const tAny = t as unknown as Record<string, unknown>;
      recolectadas.push({
        fecha: fT || fechaObjetivo,
        carrera: numC,
        hipodromo: hipLabel,
        pizarra: numC === carreraActiva && pizarraActiva ? pizarraActiva : "Cerrada",
        jugadas: numC === carreraActiva ? conteoJugadasActiva : 0,
        totalJugadas: numC === carreraActiva ? conteoJugadasActiva : 0,
        liquidada: true,
        liquidada_at: (tAny.liquidada_at ?? tAny.updated_at ?? t.fecha_creacion ?? null) as string | null,
      });
    }

    // 5. Deduplicación y filtro final por fecha objetivo
    const deduplicadas = deduplicarYOrdenarCarrerasLiquidadas(recolectadas);
    if (!fechaObjetivo) return deduplicadas;

    return deduplicadas.filter((it) => {
      const f = normalizarFechaISO(it.fecha);
      return !f || f === fechaObjetivo;
    });
  }, [
    hipodromo,
    nombreHipodromo,
    fechaObjetivo,
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
      {/* Botón flotante ergonómico en la esquina inferior derecha (no queda atravesado en el área de trabajo) */}
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        aria-label="Abrir u ocultar panel de carreras liquidadas del día"
        className={`no-print fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-black uppercase tracking-wider shadow-2xl backdrop-blur-md transition-all duration-200 hover:scale-105 active:scale-95 ${
          abierto
            ? "border-amber-400 bg-amber-500 text-slate-950 ring-2 ring-amber-400/50 shadow-amber-950/40"
            : itemsLiquidadas.length > 0
              ? "border-emerald-400/60 bg-emerald-950/95 text-emerald-100 ring-2 ring-emerald-500/30 hover:bg-emerald-900 shadow-emerald-950/50"
              : "border-slate-700 bg-slate-900/95 text-slate-300 ring-1 ring-white/10 hover:bg-slate-800"
        }`}
      >
        <span className="text-sm">🏁</span>
        <span>Liquidadas</span>
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-black ${
            abierto
              ? "bg-slate-950 text-amber-300"
              : itemsLiquidadas.length > 0
                ? "bg-emerald-500/25 text-emerald-300"
                : "bg-slate-800 text-slate-400"
          }`}
        >
          {itemsLiquidadas.length}
        </span>
        <span className="text-[10px] opacity-75">{abierto ? "✕" : "▲"}</span>
      </button>

      {/* Backdrop sutil semitransparente para cerrar al hacer clic afuera */}
      {abierto && (
        <div
          onClick={() => setAbierto(false)}
          className="no-print fixed inset-0 z-30 bg-black/40 backdrop-blur-[2px] transition-opacity"
          aria-hidden="true"
        />
      )}

      {/* Drawer lateral derecho ocultable */}
      <aside
        aria-label="Panel lateral derecho de carreras liquidadas del día"
        aria-hidden={!abierto}
        className={`no-print fixed bottom-0 right-0 top-0 z-40 flex w-84 max-w-[92vw] flex-col border-l border-emerald-500/40 bg-slate-950/95 text-slate-100 shadow-2xl backdrop-blur-lg transition-transform duration-200 ease-out ${
          abierto ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Cabecera del Drawer */}
        <div className="flex items-center justify-between border-b border-slate-800 bg-emerald-950/85 px-4 py-3">
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-base">🏁</span>
              <h3 className="text-xs font-black uppercase tracking-wider text-emerald-300">
                Carreras Liquidadas ({itemsLiquidadas.length})
              </h3>
            </div>
            <p className="mt-0.5 text-[10px] font-bold text-emerald-200/80">
              📅 Jornada: {formatearFechaDDMMAAAA(fechaObjetivo) || "Hoy"} · Solo del día
            </p>
          </div>
          <button
            type="button"
            onClick={() => setAbierto(false)}
            className="rounded-lg border border-white/20 bg-white/10 px-2.5 py-1 text-xs font-bold text-slate-200 hover:bg-white/20 hover:text-white"
            aria-label="Cerrar panel de carreras liquidadas"
          >
            ✕
          </button>
        </div>

        {/* Subtítulo informativo */}
        <div className="flex items-center justify-between border-b border-slate-800/80 bg-slate-900/60 px-4 py-1.5 text-[10px] text-slate-400">
          <span>Orden: Más reciente arriba</span>
          <span className="font-semibold text-emerald-400">● Solo del día</span>
        </div>

        {/* Lista Simplificada */}
        <div className="bet-slip-scroll flex-1 divide-y divide-slate-800/80 overflow-y-auto p-2">
          {itemsLiquidadas.length === 0 ? (
            <div className="m-2 rounded-xl border border-dashed border-slate-800 bg-slate-900/40 p-6 text-center text-xs text-slate-400">
              <span className="mb-2 block text-2xl">⏱️</span>
              <p className="font-bold text-slate-300">Sin carreras liquidadas en este día</p>
              <p className="mt-1 text-[11px] text-slate-400">
                Fecha consultada: <b className="text-emerald-400">{formatearFechaDDMMAAAA(fechaObjetivo) || "—"}</b>
              </p>
            </div>
          ) : (
            itemsLiquidadas.map((it, idx) => {
              const activa = carreraActiva === it.carrera;
              const clave = `${it.fecha ?? fechaObjetivo}::${it.hipodromo}::${it.carrera}`;
              const totalJug = it.totalJugadas ?? it.jugadas ?? 0;
              return (
                <div
                  key={clave}
                  onClick={() => {
                    onSeleccionarItem?.(it);
                    onSeleccionarCarrera?.(it.carrera);
                  }}
                  className={`group flex cursor-pointer items-center justify-between gap-3 rounded-lg p-2.5 transition-all ${
                    activa
                      ? "border-l-4 border-l-amber-400 bg-emerald-900/80 text-white shadow-md ring-1 ring-emerald-500/40"
                      : "border-l-4 border-l-transparent text-slate-200 hover:bg-slate-900/90"
                  }`}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSeleccionarItem?.(it);
                      onSeleccionarCarrera?.(it.carrera);
                    }
                  }}
                  title={`Clic para consultar Carrera ${it.carrera}`}
                >
                  {/* Badge de carrera y datos */}
                  <div className="flex min-w-0 flex-1 items-center gap-2.5">
                    <div
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xs font-black shadow-sm ${
                        activa
                          ? "bg-amber-400 font-black text-slate-950 ring-2 ring-amber-300"
                          : "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/30 group-hover:bg-emerald-500/30"
                      }`}
                    >
                      C{it.carrera}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate text-xs font-bold text-slate-100">
                          {it.hipodromo}
                        </span>
                        {idx === 0 && (
                          <span className="rounded-full bg-amber-400/20 px-1.5 py-0.2 text-[9px] font-black uppercase text-amber-300">
                            Reciente
                          </span>
                        )}
                        {activa && (
                          <span className="rounded-full bg-emerald-400/25 px-1.5 py-0.2 text-[9px] font-black uppercase text-emerald-200">
                            Activa
                          </span>
                        )}
                      </div>

                      <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-400">
                        <span>
                          Pizarra: <b className="font-mono font-bold text-emerald-300">{it.pizarra || "Oficial"}</b>
                        </span>
                        <span className="text-slate-600">•</span>
                        <span>
                          <b className="font-mono text-slate-300">{totalJug}</b> jug
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Acciones compactas */}
                  <div className="flex shrink-0 items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      onClick={() => {
                        onSeleccionarItem?.(it);
                        onSeleccionarCarrera?.(it.carrera);
                      }}
                      className="rounded-md border border-slate-700 bg-slate-800/90 px-2 py-1 text-[10px] font-bold text-slate-200 hover:bg-slate-700 hover:text-white"
                      title={`Ir a Carrera ${it.carrera}`}
                    >
                      Ir
                    </button>
                    {onVerReporteCarrera && (
                      <button
                        type="button"
                        onClick={() => {
                          onSeleccionarItem?.(it);
                          onVerReporteCarrera(it.carrera);
                        }}
                        className="rounded-md bg-amber-400 px-2 py-1 text-[10px] font-black uppercase text-slate-950 shadow-sm hover:bg-amber-300"
                        title="Ver reporte detallado de liquidación"
                      >
                        📊
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
