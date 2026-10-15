"use client";

import { useEffect, useMemo, useState } from "react";
import { listarGruposAdmin, type GrupoRow } from "@/lib/grupos";
import {
  construirReporteSemana,
  type CarreraReporte,
  type PlanillaReporte,
} from "@/lib/liquidacion/reportes";
import { armarReporteCarrera } from "@/lib/liquidacion/reporte-carrera";
import { exportarReporteCarreraImagen } from "@/lib/liquidacion/reporte-imagen";
import { grupoActivoVigente } from "@/lib/seguridad/vigente";
import { EmptyState } from "@/shared/components/ui/EmptyState";
import ReporteCarrera, { type ReporteCarreraDatos } from "@/components/saldos/ReporteCarrera";

const toast = (msg: string, tipo: "success" | "warning" | "error" | "info" = "info") =>
  window.dispatchEvent(new CustomEvent("toast", { detail: { msg, tipo } }));

type CarreraElegible = CarreraReporte & { fecha: string; hipodromo: string };

/**
 * SELECTOR DEL REPORTE DE LIQUIDACIÓN — para dónde se imprime.
 *
 * El usuario elige grupo → el motor oficial lee su semana fiscal y se listan
 * las carreras con movimiento (jugadas/tablas/resultados). Al elegir una, se
 * arma la plantilla `ReporteCarrera` con los datos REALES de esa carrera
 * (mismo motor que el consolidado de Saldos: neteo, cruces, comisiones).
 */
export function SelectorReporteCarrera() {
  const [grupos, setGrupos] = useState<GrupoRow[]>([]);
  const [grupoId, setGrupoId] = useState("");
  const [planilla, setPlanilla] = useState<PlanillaReporte | null>(null);
  const [cargando, setCargando] = useState(false);
  const [seleccion, setSeleccion] = useState<CarreraElegible | null>(null);
  const [datos, setDatos] = useState<ReporteCarreraDatos | null>(null);

  useEffect(() => {
    listarGruposAdmin(true)
      .then((gs) => {
        setGrupos(gs);
        const activo = grupoActivoVigente();
        const elegido = (activo && gs.find((g) => String(g.id) === String(activo))) || null;
        const principal = elegido ?? gs.find((g) => g.es_principal) ?? gs[0];
        if (principal?.id != null) setGrupoId(String(principal.id));
      })
      .catch(() => setGrupos([]));
  }, []);

  useEffect(() => {
    const g = grupos.find((x) => String(x.id) === grupoId);
    if (!g) return;
    setCargando(true);
    setSeleccion(null);
    setDatos(null);
    construirReporteSemana(g)
      .then(setPlanilla)
      .finally(() => setCargando(false));
  }, [grupos, grupoId]);

  const carreras = useMemo<CarreraElegible[]>(() => {
    const dias = planilla?.semanales?.dias ?? [];
    const lista: CarreraElegible[] = [];
    for (const dia of dias) {
      for (const h of dia.hipodromos) {
        for (const c of h.carreras) lista.push({ ...c, fecha: dia.fecha, hipodromo: h.nombre });
      }
    }
    return lista;
  }, [planilla]);

  const elegir = (c: CarreraElegible) => {
    setSeleccion(c);
    setDatos(armarReporteCarrera(c));
  };

  const grupoVigente = grupos.find((g) => String(g.id) === grupoId);

  return (
    <div className="flex flex-col gap-4">
      {/* Barra: grupo + rango */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <label className="flex items-center gap-1.5 font-semibold text-slate-600">
          Grupo
          <select
            value={grupoId}
            onChange={(e) => setGrupoId(e.target.value)}
            className="rounded-lg border border-line bg-white px-2 py-1.5 text-xs font-bold text-slate-800 outline-none"
          >
            {grupos.length === 0 && <option value="">— sin grupos —</option>}
            {grupos.map((g) => (
              <option key={String(g.id)} value={String(g.id)}>
                {g.nombre}
              </option>
            ))}
          </select>
        </label>
        {(planilla?.desde || planilla?.hasta) && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 font-mono font-semibold text-slate-500">
            {planilla.desde} → {planilla.hasta}
          </span>
        )}
        {cargando && <span className="animate-pulse font-semibold text-slate-400">cargando…</span>}
        {!cargando && (
          <span className="font-semibold text-slate-500">
            {carreras.length} carrera(s) con movimiento
          </span>
        )}
      </div>

      {/* Lista de carreras disponibles */}
      {carreras.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {carreras.map((c) => {
            const activa =
              seleccion != null &&
              seleccion.fecha === c.fecha &&
              String(seleccion.hipodromo) === String(c.hipodromo) &&
              seleccion.numero === c.numero;
            return (
              <button
                key={`${c.fecha}-${c.hipodromo}-${c.numero}`}
                onClick={() => elegir(c)}
                className={`rounded-full border px-3 py-1 text-[11px] font-bold transition-colors ${
                  activa
                    ? "border-primary-500 bg-primary-500 text-white"
                    : "border-line bg-white text-slate-600 hover:border-primary-400 hover:text-primary-600"
                }`}
                title={`${c.fecha} · ${c.pizarra ?? "sin pizarra"} · ${c.filas.length} fila(s)`}
              >
                🏇 {c.hipodromo.toLowerCase()} · C{c.numero}
                {c.pizarra ? ` — ${c.pizarra}` : ""}
              </button>
            );
          })}
        </div>
      ) : (
        !cargando && (
          <EmptyState
            icono="🏇"
            titulo="Sin carreras con movimiento en la semana fiscal"
            descripcion={`El grupo ${grupoVigente?.nombre ?? ""} no tiene jugadas, tablas o resultados en el ciclo definido. Cargá una carrera y pagala para que aparezca acá.`.trim()}
          />
        )
      )}

      {/* El reporte de la carrera elegida */}
      <div>
        {datos ? (
          <>
            <div className="mb-3 flex max-w-5xl items-center justify-between">
              <p className="text-xs font-semibold text-slate-500">
                Reporte generado con los datos reales de la liquidación ·
              </p>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => {
                    const base = `reporte_liquidacion_${String(seleccion?.hipodromo ?? "carrera")
                      .replace(/[^a-z0-9]+/gi, "_")}_C${seleccion?.numero ?? ""}`;
                    void exportarReporteCarreraImagen("PNG", base).then((ok) =>
                      ok
                        ? toast("Imagen PNG del reporte generada.", "success")
                        : toast("No se pudo capturar el reporte como imagen.", "error")
                    );
                  }}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
                >
                  🖼️ Imagen PNG
                </button>
                <button
                  onClick={() => {
                    const base = `reporte_liquidacion_${String(seleccion?.hipodromo ?? "carrera")
                      .replace(/[^a-z0-9]+/gi, "_")}_C${seleccion?.numero ?? ""}`;
                    void exportarReporteCarreraImagen("JPG", base).then((ok) =>
                      ok
                        ? toast("Imagen JPG del reporte generada.", "success")
                        : toast("No se pudo capturar el reporte como imagen.", "error")
                    );
                  }}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
                >
                  🖼️ Imagen JPG
                </button>
                <button
                  onClick={() => window.print()}
                  className="font-bold text-primary-600 underline underline-offset-2 hover:text-primary-700"
                >
                  Imprimir a PDF
                </button>
              </div>
            </div>
            <ReporteCarrera datos={datos} />
          </>
        ) : (
          <EmptyState
            icono="🎟️"
            titulo="Elegí una carrera para generar el reporte"
            descripcion="Seleccioná una carrera de la lista de arriba: su reporte de liquidación se arma con las jugadas reales, la pizarra de llegada y el resumen Ganan/Pierden."
          />
        )}
      </div>
    </div>
  );
}

export default SelectorReporteCarrera;