"use client";

import { useCallback, useEffect, useState } from "react";
import { listarGruposAdmin, type GrupoRow } from "@/lib/grupos";
import {
  construirReporteSemana,
  resumirReporte,
  type PlanillaReporte,
  type ReporteSemana,
} from "@/lib/liquidacion/reportes";
import { etiquetaDia } from "@/lib/liquidacion/semana";
import { hoyLocal } from "@/lib/gaceta/programa";
import { ToastHost } from "@/components/ui/ToastHost";

const fmtMonto = (n: number) => n.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function Signo({ v, vacio }: { v: number | null; vacio?: boolean }) {
  if (v === null) {
    return <span className="text-gray-400 font-medium">—</span>;
  }
  if (v === 0) {
    return <span className="text-gray-500 font-bold">0,00</span>;
  }
  const cls = v > 0 ? "text-green-600" : "text-red-600";
  return <span className={`font-bold ${cls}`}>{v > 0 ? "+" : ""}{fmtMonto(v)}</span>;
}

function TotalBadge({ v, small }: { v: number; small?: boolean }) {
  const cls = v < 0 ? "bg-red-500 text-white" : v > 0 ? "bg-green-600 text-white" : "bg-gray-400 text-white";
  return (
    <span className={`rounded px-2 py-0.5 font-bold ${cls} ${small ? "text-[10px]" : "text-xs"}`}>
      {fmtMonto(v)} USD
    </span>
  );
}

export function ReporteModule() {
  const [grupos, setGrupos] = useState<GrupoRow[]>([]);
  const [grupoId, setGrupoId] = useState<string>("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [planilla, setPlanilla] = useState<PlanillaReporte | null>(null);
  const [cargando, setCargando] = useState(false);
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());

  const alternar = useCallback((k: string) => {
    setAbiertos((prev) => {
      const s = new Set(prev);
      if (s.has(k)) s.delete(k);
      else s.add(k);
      return s;
    });
  }, []);

  useEffect(() => {
    listarGruposAdmin(true)
      .then((gs) => {
        setGrupos(gs);
        const principal = gs.find((g) => g.es_principal) ?? gs[0];
        if (principal?.id != null) setGrupoId(String(principal.id));
      })
      .catch(() => setGrupos([]));
  }, []);

  const cargar = useCallback(async () => {
    const g = grupos.find((x) => String(x.id) === grupoId);
    if (!g) return;
    setCargando(true);
    const r = await construirReporteSemana(g, {
      desde: desde || undefined,
      hasta: hasta || undefined,
    });
    setPlanilla(r);
    setCargando(false);
  }, [grupos, grupoId, desde, hasta]);

  useEffect(() => {
    if (grupoId) cargar();
  }, [grupoId, cargar]);

  const rpt: ReporteSemana | null = planilla?.semanales ?? null;
  const resumen = resumirReporte(rpt);
  const hoy = hoyLocal();

  return (
    <div className="p-4 max-w-5xl mx-auto min-h-screen bg-gray-100 font-sans text-sm">
      {/* CABECERA */}
      <div className="bg-blue-800 text-white p-3 rounded-t-lg shadow">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xl">📊</span>
          <h1 className="font-bold text-lg">Saldos Consolidados — Semana Fiscal</h1>
          {cargando && <span className="text-blue-200 text-xs animate-pulse">cargando…</span>}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <select
              value={grupoId}
              onChange={(e) => setGrupoId(e.target.value)}
              className="rounded border border-blue-700 bg-blue-900 px-2 py-1 text-sm text-white"
            >
              {grupos.map((g) => (
                <option key={String(g.id)} value={String(g.id)}>
                  {g.nombre ?? "Grupo"}
                </option>
              ))}
            </select>
            <input
              type="date"
              value={desde}
              onChange={(e) => setDesde(e.target.value)}
              className="rounded border border-blue-700 bg-blue-900 px-2 py-1 text-sm text-white"
              title="Desde (vacío = inicio de la semana fiscal)"
            />
            <span className="text-blue-200">→</span>
            <input
              type="date"
              value={hasta}
              onChange={(e) => setHasta(e.target.value)}
              className="rounded border border-blue-700 bg-blue-900 px-2 py-1 text-sm text-white"
              title="Hasta (vacío = fin de la semana fiscal)"
            />
            <button
              onClick={cargar}
              disabled={cargando}
              className="rounded bg-emerald-500 px-3 py-1 text-sm font-bold hover:bg-emerald-400 disabled:opacity-50"
            >
              Generar
            </button>
          </div>
        </div>
        {planilla && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded bg-blue-900 border border-blue-700 px-2 py-0.5 font-mono">
              {planilla.desde} → {planilla.hasta}
            </span>
            <span className="text-blue-200">·</span>
            <span>Días: <b>{resumen.dias}</b></span>
            <span>Hipódromos: <b>{resumen.hipodromos}</b></span>
            <span>Carreras: <b>{resumen.carreras}</b></span>
            <span>Tickets: <b>{resumen.tickets}</b></span>
            {resumen.cruces > 0 && <span>🔀 Cruces: <b>{resumen.cruces}</b></span>}
            {rpt && (
              <span className="ml-auto font-bold">
                Total semana: <TotalBadge v={rpt.totalSemana} />
              </span>
            )}
          </div>
        )}
      </div>

      {/* CONTENIDO */}
      <div className="bg-white border border-t-0 border-gray-300 rounded-b-lg shadow-sm">
        {planilla?.error && (
          <div className="mx-2 mt-2 rounded border border-red-300 bg-red-50 px-3 py-2 text-red-700 text-xs">
            Error al generar el reporte: {planilla.error}
          </div>
        )}

        {!rpt && !planilla?.error && (
          <div className="p-8 text-center text-gray-400 text-sm">
            {cargando ? "Consultando saldos consolidados…" : "Sin actividad de tickets en el rango consultado."}
          </div>
        )}

        {rpt?.dias.map((dia) => {
          const abiertoDia = !abiertos.has(`D-${dia.fecha}`);
          const fechaLegible = new Date(dia.fecha + "T12:00:00");
          const nombreDia = etiquetaDia(fechaLegible.getDay() === 0 ? 7 : fechaLegible.getDay());
          const esHoy = dia.fecha === hoy;
          return (
            <div key={dia.fecha} className="pb-3">
              {/* CABECERA DEL DÍA */}
              <button
                onClick={() => alternar(`D-${dia.fecha}`)}
                className="w-full flex items-center justify-between bg-gray-800 text-white px-3 py-2 font-bold hover:bg-gray-700"
              >
                <span className="flex items-center gap-2">
                  <span className={`inline-block h-2 w-2 rounded-full ${abiertoDia ? "bg-emerald-400" : "bg-gray-500"}`} />
                  {dia.fecha} · {nombreDia}
                  {esHoy && <span className="rounded bg-amber-400 text-black px-1.5 text-[10px] uppercase">Hoy</span>}
                </span>
                <span className="flex items-center gap-2">
                  {dia.hipodromos.length} hipódromo(s) · <TotalBadge v={dia.totalDia} />
                </span>
              </button>

              {abiertoDia &&
                dia.hipodromos.map((hipo) => {
                  const abiertoHipo = !abiertos.has(`H-${dia.fecha}-${hipo.nombre}`);
                  return (
                    <div key={hipo.nombre} className="mx-2 mt-2">
                      {/* HIPÓDROMO */}
                      <button
                        onClick={() => alternar(`H-${dia.fecha}-${hipo.nombre}`)}
                        className="w-full flex items-center justify-between bg-blue-50 border border-blue-200 rounded px-3 py-1.5 text-sm font-bold text-blue-900 hover:bg-blue-100"
                      >
                        <span>🏇 {hipo.nombre}</span>
                        <span className="flex items-center gap-2">
                          {hipo.carreras.length} carrera(s) · <TotalBadge v={hipo.subtotal} small />
                        </span>
                      </button>

                      {abiertoHipo &&
                        hipo.carreras.map((carrera) => (
                          <div key={carrera.numero} className="mt-1.5 rounded border border-gray-300 overflow-hidden shadow-sm">
                            <div className="bg-blue-50 border-b border-gray-300 px-2 py-1.5 flex justify-between items-center text-gray-800">
                              <div className="font-bold">
                                Carrera {carrera.numero}
                                {carrera.pizarra && (
                                  <span className="ml-2 font-mono text-xs text-gray-500">
                                    Pizarra: <b className="text-black">{carrera.pizarra}</b>
                                  </span>
                                )}
                              </div>
                              <TotalBadge v={carrera.subtotal} small />
                            </div>
                            <table className="w-full text-left border-collapse">
                              <thead>
                                <tr className="border-b border-gray-200 bg-gray-50 text-gray-600 text-[11px] uppercase">
                                  <th className="py-1 px-2 w-24">Rol</th>
                                  <th className="py-1 px-2">Jugada</th>
                                  <th className="py-1 px-2 w-20 text-center">Caballo</th>
                                  <th className="py-1 px-2">Cliente</th>
                                  <th className="py-1 px-2 w-24 text-right">Monto</th>
                                  <th className="py-1 px-2 w-28 text-right">Resultado</th>
                                </tr>
                              </thead>
                              <tbody>
                                {carrera.filas.map((f) => (
                                  <tr
                                    key={f.id}
                                    className={`border-b border-gray-100 last:border-0 hover:bg-gray-50 ${f.rol === "CRUCE" ? "bg-amber-50" : ""}`}
                                  >
                                    <td className="py-1 px-2">
                                      {f.rol === "CRUCE" ? (
                                        <span className="bg-amber-500 text-white text-[10px] uppercase font-bold px-2 py-0.5 rounded-full">
                                          🔀 {f.rol}
                                        </span>
                                      ) : (
                                        <span className="bg-gray-500 text-white text-[10px] uppercase font-bold px-2 py-0.5 rounded-full">
                                          {f.rol}
                                        </span>
                                      )}
                                    </td>
                                    <td className="py-1 px-2 font-medium text-gray-800">
                                      {f.jugada}
                                      {f.esPareo && (
                                        <span className="ml-1 rounded bg-blue-600 text-white text-[9px] font-bold px-1 py-0.5">
                                          PP
                                        </span>
                                      )}
                                    </td>
                                    <td className="py-1 px-2 text-center font-bold text-gray-700">{f.caballo || "—"}</td>
                                    <td className="py-1 px-2 text-gray-500 text-xs">{f.cliente}</td>
                                    <td className="py-1 px-2 text-right text-gray-600">{f.monto > 0 ? fmtMonto(f.monto) : ""}</td>
                                    <td className="py-1 px-2 text-right">
                                      <Signo v={f.resultado} vacio={f.rol === "CRUCE"} />
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ))}
                    </div>
                  );
                })}
            </div>
          );
        })}

        {/* TOTAL DEL DÍA SUMARIO + FOOTER */}
        {rpt && rpt.dias.length > 0 && (
          <>
            {rpt.dias.map((dia) => (
              <div key={dia.fecha} className="mx-2 mt-3 bg-red-100 border border-red-200 text-red-800 px-3 py-2 rounded flex justify-between font-bold items-center shadow-sm">
                <span className="flex items-center">📉 Total apuestas de <b className="ml-1 font-mono text-xs">{dia.fecha}</b>:</span>
                <span>{fmtMonto(dia.totalDia)} USD</span>
              </div>
            ))}
            <div className={`px-3 py-3 border-t flex justify-between font-bold text-sm ${rpt.totalSemana < 0 ? "bg-red-600 text-white" : "bg-green-700 text-white"}`}>
              <span>📊 TOTAL DE LA SEMANA ({rpt.inicio} → {rpt.fin})</span>
              <span>{rpt.totalSemana >= 0 ? "+" : ""}{fmtMonto(rpt.totalSemana)} USD</span>
            </div>
          </>
        )}

        <div className="bg-gray-50 p-3 border-t border-gray-300 text-center text-[10px] text-gray-500">
          ✨ Reporte de saldos consolidados · motor oficial (NINI, PP, PAREO, TABLAS, MARCAS, CRUCE NETO) · rango = ciclo fiscal del grupo
        </div>
      </div>

      <ToastHost />
    </div>
  );
}

export default ReporteModule;