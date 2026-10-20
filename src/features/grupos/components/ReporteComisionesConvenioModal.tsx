"use client";

/**
 * ============================================================================
 * ReporteComisionesConvenioModal — liquidación del convenio por convenio
 * ============================================================================
 * El grupo PRINCIPAL coloca las jugadas habilitadas para TODOS los grupos y le
 * paga a cada grupo su % pactado sobre el MONTO DECIDIDO. Este modal lo muestra
 * con exactitud:
 *
 *   · FILTROS: grupo (fijo para un admin de grupo), rango de fechas, hipódromo,
 *     carrera y tipo de jugada (producto del convenio).
 *   · KPIs: volumen jugado, jugadas decididas, % de convenio aplicado y total
 *     de comisión a favor del grupo.
 *   · TABLA DETALLADA: fecha, hipódromo, carrera, cliente, tipo, ejemplares,
 *     estado, monto base, % y comisión.
 *   · ENVÍO/EXPORTACIÓN: WhatsApp, imagen PNG (portapapeles) y Excel.
 *
 * Los textos y matrices son puros (`comisiones-convenio.ts`); el navegador se
 * toca solo en `reporte-comisiones-export.ts`.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/shared/components/ui/Button";
import { Mensaje } from "@/shared/components/ui/Mensaje";
import { emitirToast } from "@/shared/lib/mensajeria";
import {
  CONCEPTOS_CONVENIO,
  agruparPorGrupo,
  formatearDinero,
  hoyLocalISO,
  kpisDeDetalle,
  textoReporteWhatsApp,
  totalesPorMoneda,
  type DetalleJugada,
  type FilaReporte,
  type FiltrosReporte,
  type ProductoConvenio,
} from "@/features/grupos/lib/comisiones-convenio";
import {
  cargarReporteComisiones,
  type ResultadoConvenio,
} from "@/features/grupos/lib/reporte-comisiones";
import {
  copiarImagenReporte,
  copiarTexto,
  descargarCsv,
  descargarExcel,
} from "@/features/grupos/lib/reporte-comisiones-export";
import type { GrupoRow } from "@/features/grupos/lib/grupos";

/** Alias visible de un producto en el filtro (el catálogo usa el rótulo largo). */
const ALIAS_PRODUCTO: Partial<Record<ProductoConvenio, string>> = {
  entre_tercios: "Puestos",
};

const etiquetaProducto = (clave: ProductoConvenio): string => {
  const c = CONCEPTOS_CONVENIO.find((x) => x.clave === clave);
  return ALIAS_PRODUCTO[clave] ?? c?.etiqueta ?? clave;
};

type Props = {
  grupos: GrupoRow[];
  onCerrar: () => void;
  /**
   * Grupo propio cuando entra un admin de grupo: fija el selector y no deja
   * ver los demás convenios. El principal (sin este prop) ve todos.
   */
  grupoFijoId?: string | null;
};

export function ReporteComisionesConvenioModal({ grupos, onCerrar, grupoFijoId }: Props) {
  const hoy = hoyLocalISO();
  const [desde, setDesde] = useState(hoy);
  const [hasta, setHasta] = useState(hoy);
  const [grupoId, setGrupoId] = useState(grupoFijoId ? String(grupoFijoId) : "");
  const [hipodromo, setHipodromo] = useState("");
  const [carrera, setCarrera] = useState("");
  const [producto, setProducto] = useState<ProductoConvenio | "">("");
  const [cargando, setCargando] = useState(false);
  const [filas, setFilas] = useState<FilaReporte[]>([]);
  const [detalle, setDetalle] = useState<DetalleJugada[]>([]);
  const [avisos, setAvisos] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Filtros que se le pasan al LECTOR (para que el detalle venga acotado). El
  // consolidado (filas) sale del rango completo y NO se ve afectado por los
  // filtros de vista (el total a pagar no cambia porque filtres una carrera).
  const filtros: FiltrosReporte = useMemo(
    () => ({
      grupoId: grupoId || undefined,
      hipodromo: hipodromo || undefined,
      carrera: carrera || undefined,
      producto: producto || undefined,
    }),
    [grupoId, hipodromo, carrera, producto]
  );

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    const r: ResultadoConvenio = await cargarReporteComisiones(desde, hasta, grupos, filtros);
    setFilas(r.filas);
    setDetalle(r.detalle ?? []);
    setAvisos(r.avisos);
    setError(r.ok ? null : r.error ?? "No se pudo generar el reporte.");
    setCargando(false);
  }, [desde, hasta, grupos, filtros]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const porGrupo = useMemo(() => agruparPorGrupo(filas), [filas]);
  const totales = useMemo(() => totalesPorMoneda(filas), [filas]);
  const kpis = useMemo(() => kpisDeDetalle(detalle), [detalle]);

  // Nombre del grupo para el encabezado del reporte.
  const nombreGrupo = useMemo(() => {
    if (grupoId) return grupos.find((g) => String(g.id) === grupoId)?.nombre ?? "—";
    if (grupoFijoId) return grupos.find((g) => String(g.id) === String(grupoFijoId))?.nombre ?? "—";
    return "Todos los grupos";
  }, [grupoId, grupoFijoId, grupos]);

  const nombreBase = `COMISIONES-${nombreGrupo}-${desde}_${hasta}`.replace(/\s+/g, "_");

  // Hipódromos y carreras disponibles del detalle (para los datalist).
  const hipodromos = useMemo(
    () => [...new Set(detalle.map((d) => d.hipodromo).filter(Boolean))].sort(),
    [detalle]
  );
  const carreras = useMemo(
    () => [...new Set(detalle.map((d) => d.carrera).filter(Boolean))].sort((a, b) => Number(a) - Number(b)),
    [detalle]
  );

  const enviarWhatsApp = async () => {
    const texto = textoReporteWhatsApp(kpis, detalle, { grupo: nombreGrupo, desde, hasta, moneda: kpis.moneda });
    const copiado = await copiarTexto(texto);
    const url = `https://wa.me/?text=${encodeURIComponent(texto)}`;
    if (typeof window !== "undefined") window.open(url, "_blank", "noopener,noreferrer");
    emitirToast(
      copiado ? "Reporte copiado y abierto en WhatsApp." : "Reporte abierto en WhatsApp.",
      "success"
    );
  };

  const copiarPng = async () => {
    const r = await copiarImagenReporte(kpis, detalle, { grupo: nombreGrupo, desde, hasta }, nombreBase);
    if (r === "copiado") emitirToast("Imagen PNG copiada al portapapeles.", "success");
    else if (r === "descargado") emitirToast("El navegador no permite copiar imágenes: se descargó el PNG.", "info");
    else emitirToast("No se pudo generar la imagen del reporte.", "error");
  };

  const exportarExcel = () => {
    if (!detalle.length) return emitirToast("No hay jugadas para exportar.", "warning");
    if (descargarExcel(detalle, nombreBase)) emitirToast("Excel generado.", "success");
    else emitirToast("No se pudo generar el Excel.", "error");
  };

  const exportarCsv = () => {
    if (!detalle.length) return emitirToast("No hay jugadas para exportar.", "warning");
    if (descargarCsv(detalle, nombreBase)) emitirToast("CSV generado.", "success");
    else emitirToast("No se pudo generar el CSV.", "error");
  };

  const inp =
    "w-full border border-line rounded-lg px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-primary-500 bg-surface";
  const lbl = "mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-600";

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCerrar();
      }}
    >
      <div className="my-8 w-full max-w-6xl overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between bg-slate-800 px-5 py-4 text-xs font-black uppercase tracking-wider text-white">
          <span>
            <span className="mr-2">📈</span> Reporte de comisiones por convenio
          </span>
          <button className="text-slate-300 hover:text-white" onClick={onCerrar} aria-label="Cerrar">
            <span>✕</span>
          </button>
        </div>

        <div className="space-y-4 p-5">
          {/* ---------------- Filtros ---------------- */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            <div className="lg:col-span-2">
              <label className={lbl}>Grupo</label>
              <select
                value={grupoId}
                onChange={(e) => setGrupoId(e.target.value)}
                className={inp + " font-bold"}
                disabled={Boolean(grupoFijoId)}
              >
                {grupoFijoId ? (
                  <option value={String(grupoFijoId)}>
                    {grupos.find((g) => String(g.id) === String(grupoFijoId))?.nombre ?? "Mi grupo"}
                  </option>
                ) : (
                  <>
                    <option value="">Todos los grupos</option>
                    {grupos.map((g) => (
                      <option key={String(g.id)} value={String(g.id)}>
                        {g.nombre}
                        {g.es_principal ? " (principal)" : ""}
                      </option>
                    ))}
                  </>
                )}
              </select>
            </div>
            <div>
              <label className={lbl}>Desde</label>
              <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className={inp} />
            </div>
            <div>
              <label className={lbl}>Hasta</label>
              <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className={inp} />
            </div>
            <div>
              <label className={lbl}>Hipódromo</label>
              <input
                list="comisiones-hipodromos"
                value={hipodromo}
                onChange={(e) => setHipodromo(e.target.value)}
                placeholder="Todos"
                className={inp}
              />
              <datalist id="comisiones-hipodromos">
                {hipodromos.map((h) => (
                  <option key={h} value={h} />
                ))}
              </datalist>
            </div>
            <div>
              <label className={lbl}>Carrera</label>
              <input
                list="comisiones-carreras"
                value={carrera}
                onChange={(e) => setCarrera(e.target.value)}
                placeholder="Todas"
                className={inp}
              />
              <datalist id="comisiones-carreras">
                {carreras.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
            <div className="col-span-2 lg:col-span-3">
              <label className={lbl}>Tipo de jugada</label>
              <select
                value={producto}
                onChange={(e) => setProducto(e.target.value as ProductoConvenio | "")}
                className={inp}
              >
                <option value="">Todas</option>
                {CONCEPTOS_CONVENIO.map((c) => (
                  <option key={c.clave} value={c.clave}>
                    {c.emoji} {etiquetaProducto(c.clave)}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-span-2 flex items-end gap-2 lg:col-span-3">
              <Button variant="outline" size="sm" onClick={() => void cargar()} disabled={cargando}>
                <span className="mr-1">🔄</span> {cargando ? "Calculando…" : "Actualizar"}
              </Button>
            </div>
          </div>

          {/* ---------------- Exportaciones ---------------- */}
          <div className="flex flex-wrap items-center gap-2 border-y border-line py-3">
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Enviar / exportar:</span>
            <Button variant="success" size="sm" onClick={() => void enviarWhatsApp()}>
              <span className="mr-1">📲</span> Enviar al grupo por WhatsApp
            </Button>
            <Button variant="outline" size="sm" onClick={() => void copiarPng()}>
              <span className="mr-1">📸</span> Copiar imagen PNG
            </Button>
            <Button variant="outline" size="sm" onClick={exportarExcel}>
              <span className="mr-1">📊</span> Exportar Excel
            </Button>
            <Button variant="outline" size="sm" onClick={exportarCsv}>
              <span className="mr-1">🧾</span> Exportar CSV
            </Button>
          </div>

          {/* ---------------- KPIs ---------------- */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi titulo="Volumen jugado" valor={formatearDinero(kpis.volumen, kpis.moneda)} color="indigo" />
            <Kpi titulo="Jugadas decididas" valor={`${kpis.decididas}`} extra={`de ${kpis.jugadas}`} color="emerald" />
            <Kpi titulo="% convenio aplicado" valor={`${kpis.pctAplicado}%`} color="amber" />
            <Kpi titulo="Comisión a favor del grupo" valor={formatearDinero(kpis.comision, kpis.moneda)} color="emerald" />
          </div>

          <Mensaje tipo="info">
            El grupo <b>principal</b> coloca las jugadas habilitadas para los jugadores de todos los grupos y le paga a cada
            grupo el <b>% pactado sobre el monto decidido</b>. Lo que ves acá es esa liquidación.
          </Mensaje>

          {error ? <Mensaje tipo="error">{error}</Mensaje> : null}
          {avisos.map((a) => (
            <Mensaje key={a} tipo="warning">
              {a}
            </Mensaje>
          ))}

          {/* ---------------- Totales por moneda (consolidado) ---------------- */}
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
                  Paga el principal ({t.moneda}): {formatearDinero(t.comision, t.moneda)}
                  <span className="ml-2 font-normal text-emerald-600">
                    sobre {formatearDinero(t.monto, t.moneda)} decididos
                  </span>
                </span>
              ))
            )}
          </div>

          {/* ---------------- Tabla detallada de jugadas ---------------- */}
          <div className="overflow-hidden rounded-xl border border-line">
            <div className="flex items-center justify-between bg-slate-100 px-3 py-2">
              <span className="text-xs font-black uppercase tracking-wide text-slate-700">
                Detalle de jugadas
              </span>
              <span className="text-[11px] font-bold text-slate-500">
                {detalle.length} jugada(s){cargando ? " · calculando…" : ""}
              </span>
            </div>
            <div className="max-h-[22rem] overflow-auto">
              <table className="w-full min-w-[880px] text-left text-xs">
                <thead className="sticky top-0 bg-white text-[10px] uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-3 py-1.5">Fecha</th>
                    <th className="px-3 py-1.5">Hipódromo</th>
                    <th className="px-3 py-1.5">Carrera</th>
                    <th className="px-3 py-1.5">Cliente / Jugador</th>
                    <th className="px-3 py-1.5">Tipo de jugada</th>
                    <th className="px-3 py-1.5">Ejemplares</th>
                    <th className="px-3 py-1.5">Estado</th>
                    <th className="px-3 py-1.5 text-right">Monto base</th>
                    <th className="px-3 py-1.5 text-right">%</th>
                    <th className="px-3 py-1.5 text-right">Comisión</th>
                  </tr>
                </thead>
                <tbody>
                  {detalle.length === 0 && !cargando ? (
                    <tr>
                      <td colSpan={10} className="px-3 py-6 text-center text-slate-500">
                        No hay jugadas que liquidar en el rango.
                      </td>
                    </tr>
                  ) : (
                    detalle.map((d, i) => (
                      <tr key={i} className="border-t border-line hover:bg-slate-50">
                        <td className="px-3 py-1.5 text-slate-600">{d.fecha || "—"}</td>
                        <td className="px-3 py-1.5 text-slate-600">{d.hipodromo || "—"}</td>
                        <td className="px-3 py-1.5 text-slate-600">{d.carrera || "—"}</td>
                        <td className="px-3 py-1.5 font-bold text-slate-700">{d.cliente || "—"}</td>
                        <td className="px-3 py-1.5 text-slate-600">{etiquetaProducto(d.producto)}</td>
                        <td className="px-3 py-1.5 text-slate-500">{d.detalle || "—"}</td>
                        <td className="px-3 py-1.5">
                          <span
                            className={`rounded px-1.5 py-0.5 text-[9px] font-black ${
                              d.estado === "PAGADO"
                                ? "bg-emerald-100 text-emerald-700"
                                : d.estado === "ANULADA"
                                  ? "bg-rose-100 text-rose-700"
                                  : "bg-amber-100 text-amber-700"
                            }`}
                          >
                            {d.estado}
                          </span>
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono text-slate-700">
                          {formatearDinero(d.monto, d.moneda)}
                        </td>
                        <td className="px-3 py-1.5 text-right text-slate-500">{d.pct}%</td>
                        <td className="px-3 py-1.5 text-right font-mono font-bold text-emerald-700">
                          {formatearDinero(d.comision, d.moneda)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* ---------------- Consolidado por grupo (lo que paga el principal) ---------------- */}
          {porGrupo.length === 0 && !cargando && !error ? (
            <p className="py-2 text-center text-xs text-slate-500">No hay comisiones que liquidar en el rango.</p>
          ) : (
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
                      A pagar: {formatearDinero(g.comision, g.filas[0]?.moneda ?? "USD")}
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
                            {f.emoji} {etiquetaProducto(f.producto)}
                            <span className="ml-1 text-[10px] text-slate-400">{f.moneda}</span>
                          </td>
                          <td className="px-3 py-1.5 text-right text-slate-500">{f.tickets}</td>
                          <td className="px-3 py-1.5 text-right font-mono text-slate-700">
                            {formatearDinero(f.monto, f.moneda)}
                          </td>
                          <td className="px-3 py-1.5 text-right text-slate-500">{f.pct}%</td>
                          <td className="px-3 py-1.5 text-right font-mono font-bold text-emerald-700">
                            {formatearDinero(f.comision, f.moneda)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Tarjeta KPI del resumen superior. */
function Kpi({
  titulo,
  valor,
  extra,
  color,
}: {
  titulo: string;
  valor: string;
  extra?: string;
  color: "indigo" | "emerald" | "amber";
}) {
  const borde = color === "emerald" ? "border-emerald-200" : color === "amber" ? "border-amber-200" : "border-indigo-200";
  const texto = color === "emerald" ? "text-emerald-700" : color === "amber" ? "text-amber-700" : "text-indigo-700";
  return (
    <div className={`rounded-xl border ${borde} bg-white px-4 py-3`}>
      <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">{titulo}</p>
      <p className={`mt-1 text-lg font-black ${texto}`}>
        {valor}
        {extra ? <span className="ml-1 text-[11px] font-normal text-slate-400">{extra}</span> : null}
      </p>
    </div>
  );
}
