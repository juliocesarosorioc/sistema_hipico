"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { listarGruposAdmin, type GrupoRow } from "@/features/grupos/lib/grupos";
import {
  construirReporteSemana,
  type CarreraReporte,
  type PlanillaReporte,
} from "@/features/liquidacion/lib/reportes";
import { armarReporteCarrera } from "@/features/liquidacion/lib/reporte-carrera";
import { logosFrescosDeCarrera } from "@/features/liquidacion/lib/logos-reporte";
import { exportarReporteCarreraImagen } from "@/features/liquidacion/lib/reporte-imagen";
import { grupoActivoVigente } from "@/features/seguridad/lib/vigente";
import { EmptyState } from "@/shared/components/ui/EmptyState";
import ReporteCarrera, { type ReporteCarreraDatos } from "@/features/saldos/components/ReporteCarrera";
import {
  BarraCarrerasLiquidadas,
  type ItemCarreraLiquidada,
} from "@/features/gestion/components/BarraCarrerasLiquidadas";

const toast = (msg: string, tipo: "success" | "warning" | "error" | "info" = "info") =>
  window.dispatchEvent(new CustomEvent("toast", { detail: { msg, tipo } }));

type CarreraElegible = CarreraReporte & { fecha: string; hipodromo: string };

/**
 * SELECTOR DEL REPORTE DE LIQUIDACIÓN — para dónde se imprime.
 *
 * El usuario elige grupo → el motor oficial lee su semana fiscal y se listan
 * las carreras con movimiento (jugadas/tablas/resultados) en el menú lateral
 * derecho (`BarraCarrerasLiquidadas`), eliminando la sección de botones que
 * aparecía arriba.
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

  const elegir = useCallback(
    async (c: CarreraElegible) => {
      setSeleccion(c);
      const frescos = await logosFrescosDeCarrera({
        hipodromo: c.hipodromo,
        grupoId,
        gruposYaLeidos: grupos,
      });
      const g = grupos.find((x) => String(x.id) === grupoId);
      setDatos(
        armarReporteCarrera(c, g?.nombre, undefined, {
          liquidada: Boolean(c.pizarra),
          logoHipodromo: frescos.logoHipodromo,
          logoGrupo: frescos.logoGrupo,
        })
      );
    },
    [grupoId, grupos]
  );

  // Auto-seleccionar la carrera más reciente al cargar la semana
  useEffect(() => {
    if (!seleccion && carreras.length > 0) {
      void elegir(carreras[carreras.length - 1]);
    }
  }, [carreras, elegir, seleccion]);

  const itemsLiquidadas = useMemo<ItemCarreraLiquidada[]>(() => {
    return carreras.map((c) => ({
      fecha: c.fecha,
      carrera: c.numero,
      hipodromo: c.hipodromo,
      pizarra: c.pizarra || "En Riesgo",
      jugadas: c.filas.length,
      totalJugadas: c.filas.length,
      liquidada: true,
    }));
  }, [carreras]);

  const grupoVigente = grupos.find((g) => String(g.id) === grupoId);

  return (
    <div className="relative flex flex-col gap-4">
      {/* Barra: grupo + selector compacto + rango (sin la lista de píldoras superior) */}
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

        {carreras.length > 0 && (
          <label className="flex items-center gap-1.5 font-semibold text-slate-600">
            Carrera
            <select
              value={
                seleccion
                  ? `${seleccion.fecha}::${seleccion.hipodromo}::${seleccion.numero}`
                  : ""
              }
              onChange={(e) => {
                const found = carreras.find(
                  (c) => `${c.fecha}::${c.hipodromo}::${c.numero}` === e.target.value
                );
                if (found) void elegir(found);
              }}
              className="rounded-lg border border-line bg-white px-2 py-1.5 text-xs font-bold text-slate-800 outline-none"
            >
              {carreras.map((c) => (
                <option
                  key={`${c.fecha}::${c.hipodromo}::${c.numero}`}
                  value={`${c.fecha}::${c.hipodromo}::${c.numero}`}
                >
                  {c.fecha} · {c.hipodromo} · C{c.numero}
                  {c.pizarra ? ` (${c.pizarra})` : " (Preliminar)"}
                </option>
              ))}
            </select>
          </label>
        )}

        {(planilla?.desde || planilla?.hasta) && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 font-mono font-semibold text-slate-500">
            {planilla.desde} → {planilla.hasta}
          </span>
        )}
        {cargando && <span className="animate-pulse font-semibold text-slate-400">cargando…</span>}
        {!cargando && (
          <span className="font-semibold text-slate-500">
            {carreras.length} carrera(s) con movimiento · Menú lateral derecho 🏁 Liquidadas
          </span>
        )}
      </div>

      {/* Menú lateral derecho donde se visualizan las carreras que ya han sido liquidadas */}
      <BarraCarrerasLiquidadas
        fecha={seleccion?.fecha ?? planilla?.hasta ?? ""}
        hipodromo={seleccion?.hipodromo ?? ""}
        carreraActiva={seleccion?.numero ?? null}
        itemsExtra={itemsLiquidadas}
        onSeleccionarCarrera={(num) => {
          const found =
            carreras.find(
              (c) =>
                c.numero === num &&
                (!seleccion?.hipodromo || c.hipodromo === seleccion.hipodromo)
            ) || carreras.find((c) => c.numero === num);
          if (found) void elegir(found);
        }}
        onVerReporteCarrera={(num) => {
          const found =
            carreras.find(
              (c) =>
                c.numero === num &&
                (!seleccion?.hipodromo || c.hipodromo === seleccion.hipodromo)
            ) || carreras.find((c) => c.numero === num);
          if (found) void elegir(found);
        }}
        onSeleccionarItem={(it) => {
          const found =
            carreras.find(
              (c) =>
                c.numero === it.carrera &&
                String(c.hipodromo).trim().toUpperCase() ===
                  String(it.hipodromo).trim().toUpperCase() &&
                (!it.fecha || c.fecha === it.fecha)
            ) || carreras.find((c) => c.numero === it.carrera);
          if (found) void elegir(found);
        }}
      />

      {!cargando && carreras.length === 0 && (
        <EmptyState
          icono="🏇"
          titulo="Sin carreras con movimiento en la semana fiscal"
          descripcion={`El grupo ${grupoVigente?.nombre ?? ""} no tiene jugadas, tablas o resultados en el ciclo definido. Cargá una carrera y pagala para que aparezca acá.`.trim()}
        />
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
            descripcion="Seleccioná una carrera en el menú de la derecha (🏁 Liquidadas) o en el selector superior para ver el reporte de jugadas."
          />
        )}
      </div>
    </div>
  );
}

export default SelectorReporteCarrera;
