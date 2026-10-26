"use client";

import { useMemo } from "react";
import { useCarrerasDiaStore } from "@/shared/store/useCarrerasDiaStore";
import { useRegistroCentralOpts } from "@/shared/store/useRegistroCentral";
import { useTablasFijasStore } from "@/shared/store/useTablasFijasStore";
import { useTaquillaStore } from "@/shared/store/useTaquillaStore";

export type ItemCarreraLiquidada = {
  carrera: number;
  hipodromo: string;
  pizarra: string;
  jugadas: number;
};

/**
 * Ordena las carreras liquidadas en estricto orden numérico ascendente (1ª, 2ª, 3ª...)
 * y formatea la etiqueta canónica de la barra delgada.
 */
export function ordenarCarrerasLiquidadas(items: ItemCarreraLiquidada[]): ItemCarreraLiquidada[] {
  const mapa = new Map<string, ItemCarreraLiquidada>();
  for (const it of items) {
    const num = Number(it.carrera);
    if (!Number.isFinite(num) || num <= 0) continue;
    const hip = String(it.hipodromo ?? "").trim() || "HIPÓDROMO";
    const key = `${hip.toUpperCase()}::${num}`;
    const prev = mapa.get(key);
    mapa.set(key, {
      carrera: num,
      hipodromo: hip,
      pizarra: it.pizarra || prev?.pizarra || "Oficial",
      jugadas: Math.max(Number(it.jugadas ?? 0), Number(prev?.jugadas ?? 0)),
    });
  }
  return [...mapa.values()].sort((a, b) => a.carrera - b.carrera);
}

export function formatearItemCarreraLiquidada(it: ItemCarreraLiquidada): string {
  return `✅ C${it.carrera} · ${it.hipodromo} | Pizarra: ${it.pizarra || "—"} | Jugadas: ${it.jugadas}`;
}

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
  onSeleccionarCarrera?: (carrera: number) => void;
  onVerReporteCarrera?: (carrera: number) => void;
};

export function BarraCarrerasLiquidadas({
  fecha,
  hipodromo,
  nombreHipodromo,
  carreraActiva,
  conteoJugadasActiva = 0,
  pizarraActiva,
  itemsExtra = [],
  onSeleccionarCarrera,
  onVerReporteCarrera,
}: Props) {
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
      recolectadas.push({
        carrera: numC,
        hipodromo: hipLabel,
        pizarra:
          numC === carreraActiva && pizarraActiva
            ? pizarraActiva
            : ganadores.length > 0
              ? ganadores.slice(0, 5).join("-")
              : "Oficial",
        jugadas: jugCount,
      });
    }

    for (const r of carrerasDia) {
      if (r.fecha !== fecha) continue;
      if (hipo && hipoKey(r.hipodromo) !== hipo) continue;
      if (String(r.estado ?? "").toLowerCase() !== "liquidada") continue;
      const numC = Number(r.carrera);
      recolectadas.push({
        carrera: numC,
        hipodromo: nombreHipodromo || r.hipodromo,
        pizarra: numC === carreraActiva && pizarraActiva ? pizarraActiva : "Liquidada",
        jugadas: numC === carreraActiva ? conteoJugadasActiva : 0,
      });
    }

    for (const t of tablas) {
      if (hipo && hipoKey(t.hipodromo) !== hipo) continue;
      const esCerrada = Boolean(t.cerrada) || String(t.estado ?? "").toLowerCase() === "cerrada";
      if (!esCerrada) continue;
      const numC = Number(t.carrera);
      recolectadas.push({
        carrera: numC,
        hipodromo: hipLabel,
        pizarra: numC === carreraActiva && pizarraActiva ? pizarraActiva : "Cerrada",
        jugadas: numC === carreraActiva ? conteoJugadasActiva : 0,
      });
    }

    return ordenarCarrerasLiquidadas(recolectadas);
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
    <div
      aria-label="Barra de carreras liquidadas"
      className="flex flex-wrap items-center gap-2 rounded-xl border border-emerald-300/70 bg-emerald-950/90 px-3 py-1.5 text-xs text-emerald-100 shadow-xs"
    >
      <span className="shrink-0 font-black uppercase tracking-wider text-emerald-300">
        🏁 Carreras Liquidadas ({itemsLiquidadas.length}):
      </span>
      {itemsLiquidadas.length === 0 ? (
        <span className="text-[11px] font-medium text-emerald-200/75">
          Sin carreras liquidadas aún en esta jornada (se listarán en orden 1ª, 2ª, 3ª… al liquidar).
        </span>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5 overflow-x-auto">
          {itemsLiquidadas.map((it) => {
            const activa = carreraActiva === it.carrera;
            return (
              <div
                key={`${it.hipodromo}-${it.carrera}`}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] transition ${
                  activa
                    ? "border-amber-300 bg-emerald-800 font-black text-white shadow-xs"
                    : "border-emerald-700/80 bg-emerald-900/70 font-semibold text-emerald-100 hover:bg-emerald-800/80"
                }`}
              >
                <button
                  type="button"
                  onClick={() => onSeleccionarCarrera?.(it.carrera)}
                  className="text-left hover:underline"
                  title={`Ir a ${it.carrera}ª carrera liquidada`}
                >
                  ✅ C{it.carrera} · {it.hipodromo} | Pizarra: <b>{it.pizarra}</b> | Jugadas: <b>{it.jugadas}</b>
                </button>
                {onVerReporteCarrera && (
                  <button
                    type="button"
                    onClick={() => onVerReporteCarrera(it.carrera)}
                    className="ml-1 rounded bg-amber-400 px-1.5 py-0.5 text-[9px] font-black uppercase text-slate-950 hover:bg-amber-300"
                    title="Abrir reporte de esta carrera liquidada"
                  >
                    📊 Reporte
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default BarraCarrerasLiquidadas;
