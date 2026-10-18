"use client";

/**
 * ============================================================================
 * ReporteComisionesConvenioModal — "¿cuánto le paga el grupo principal a cada grupo?"
 * ============================================================================
 * Elige un rango de fechas y muestra, por grupo y por producto, el MONTO
 * DECIDIDO vendido y la comisión pactada. El total por moneda es lo que el
 * grupo PRINCIPAL debe pagar a los grupos por las ventas de sus clientes.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/shared/components/ui/Button";
import {
  agruparPorGrupo,
  totalesPorMoneda,
  type FilaReporte,
} from "@/features/grupos/lib/comisiones-convenio";
import { cargarReporteComisiones } from "@/features/grupos/lib/reporte-comisiones";
import type { GrupoRow } from "@/features/grupos/lib/grupos";

const hoy = (): string => new Date().toISOString().slice(0, 10);

const dinero = (n: number, moneda: string): string =>
  `${moneda === "VES" ? "Bs " : "$"}${Number(n || 0).toLocaleString("es-VE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

type Props = { grupos: GrupoRow[]; onCerrar: () => void };

export function ReporteComisionesConvenioModal({ grupos, onCerrar }: Props) {
  const [desde, setDesde] = useState(hoy());
  const [hasta, setHasta] = useState(hoy());
  const [cargando, setCargando] = useState(false);
  const [filas, setFilas] = useState<FilaReporte[]>([]);
  const [avisos, setAvisos] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    const r = await cargarReporteComisiones(desde, hasta, grupos);
    setFilas(r.filas);
    setAvisos(r.avisos);
    setError(r.ok ? null : r.error ?? "No se pudo generar el reporte.");
    setCargando(false);
  }, [desde, hasta, grupos]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const porGrupo = useMemo(() => agruparPorGrupo(filas), [filas]);
  const totales = useMemo(() => totalesPorMoneda(filas), [filas]);

  const inp =
    "w-full border border-line rounded-lg px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-primary-500 bg-surface";

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCerrar();
      }}
    >
      <div className="my-8 w-full max-w-4xl overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between bg-slate-800 px-5 py-4 text-xs font-black uppercase tracking-wider text-white">
          <span>
            <span className="mr-2">📈</span> Reporte de comisiones por convenio
          </span>
          <button className="text-slate-300 hover:text-white" onClick={onCerrar} aria-label="Cerrar">
            <span>✕</span>
          </button>
        </div>

        <div className="space-y-4 p-5">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-600">Desde</label>
              <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className={inp + " w-40"} />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-600">Hasta</label>
              <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className={inp + " w-40"} />
            </div>
            <Button variant="outline" size="sm" onClick={() => void cargar()} disabled={cargando}>
              <span className="mr-1">🔄</span> {cargando ? "Calculando…" : "Actualizar"}
            </Button>
          </div>

          <p className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] leading-snug text-amber-800">
            El grupo <b>principal</b> coloca las jugadas habilitadas para los jugadores de todos los grupos y le paga a
            cada grupo el <b>% pactado sobre el monto decidido</b>. Lo que ves acá es esa liquidación.
          </p>

          {error ? (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-600">{error}</p>
          ) : null}
          {avisos.map((a) => (
            <p key={a} className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
              {a}
            </p>
          ))}

          <div className="flex flex-wrap gap-3">
            {totales.length === 0 ? (
              <span className="rounded-xl border border-line bg-slate-50 px-4 py-2 text-xs font-bold text-slate-500">
                Sin ventas en el rango.
              </span>
            ) : (
              totales.map((t) => (
                <span
                  key={t.moneda}
                  className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs font-black text-emerald-800"
                >
                  Paga el principal ({t.moneda}): {dinero(t.comision, t.moneda)}
                  <span className="ml-2 font-normal text-emerald-600">
                    sobre {dinero(t.monto, t.moneda)} decididos
                  </span>
                </span>
              ))
            )}
          </div>

          {porGrupo.length === 0 && !cargando && !error ? (
            <p className="py-6 text-center text-xs text-slate-500">No hay comisiones que liquidar en el rango.</p>
          ) : null}

          <div className="space-y-3">
            {porGrupo.map((g) => (
              <div key={g.grupoId} className="overflow-hidden rounded-xl border border-line">
                <div className="flex items-center justify-between bg-slate-100 px-3 py-2">
                  <span className="text-xs font-black uppercase tracking-wide text-slate-700">
                    {g.grupo}
                    {g.esPrincipal ? (
                      <span className="ml-2 rounded bg-amber-200 px-1.5 py-0.5 text-[9px] font-black text-amber-800">
                        PRINCIPAL
                      </span>
                    ) : null}
                  </span>
                  <span className="text-xs font-black text-emerald-700">
                    A pagar: {dinero(g.comision, g.filas[0]?.moneda ?? "USD")}
                  </span>
                </div>
                <table className="w-full text-left text-xs">
                  <thead className="bg-white text-[10px] uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="px-3 py-1.5">Concepto</th>
                      <th className="px-3 py-1.5 text-right">Tickets</th>
                      <th className="px-3 py-1.5 text-right">Monto decidido</th>
                      <th className="px-3 py-1.5 text-right">%</th>
                      <th className="px-3 py-1.5 text-right">Comisión</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.filas.map((f) => (
                      <tr key={`${f.producto}-${f.moneda}`} className="border-t border-line">
                        <td className="px-3 py-1.5 font-bold text-slate-700">
                          {f.emoji} {f.etiqueta}
                          <span className="ml-1 text-[10px] text-slate-400">{f.moneda}</span>
                        </td>
                        <td className="px-3 py-1.5 text-right text-slate-500">{f.tickets}</td>
                        <td className="px-3 py-1.5 text-right font-mono text-slate-700">{dinero(f.monto, f.moneda)}</td>
                        <td className="px-3 py-1.5 text-right text-slate-500">{f.pct}%</td>
                        <td className="px-3 py-1.5 text-right font-mono font-bold text-emerald-700">
                          {dinero(f.comision, f.moneda)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
