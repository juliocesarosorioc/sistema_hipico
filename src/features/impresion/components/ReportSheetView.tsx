"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { exportarPaginas, guardarLienzos, type ImgFormato } from "@/features/impresion/lib/exportar";
import { DIM_PAGINA, type Orientacion } from "@/features/impresion/lib/util";
import { col } from "@/features/impresion/lib/util";

type Density = "estandar" | "compacta" | "ultra";
type Theme = "alto-contraste" | "corporativo";

export type ReportSheetColumn = {
  key: string;
  label: string;
  align?: "left" | "right" | "center";
  format?: (v: any) => string;
  className?: string;
};

export type ReportSheetRow = Record<string, any>;

export type ReportSheetKpi = {
  label: string;
  value: string;
  sub?: string;
  tone?: "emerald" | "rose" | "amber" | "violet" | "slate";
};

export type ReportSheetViewProps = {
  title: string;
  subtitle?: string;
  fecha?: string;
  jornada?: string;
  meta?: string[];
  logo?: string;
  kpis?: ReportSheetKpi[];
  columns?: ReportSheetColumn[];
  rows?: ReportSheetRow[];
  foot?: ReportSheetRow[];
  multiColumn?: boolean;
  showDiscos?: boolean;
  hideToolbar?: boolean;
  className?: string;
};

const TONE: Record<NonNullable<ReportSheetKpi["tone"]>, string> = {
  emerald: "text-emerald-700",
  rose: "text-rose-700",
  amber: "text-amber-700",
  violet: "text-violet-700",
  slate: "text-slate-900",
};

function fmtMoney(v: any) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function ReportSheetView({
  title,
  subtitle,
  fecha,
  jornada,
  meta = [],
  logo,
  kpis = [],
  columns = [],
  rows = [],
  foot = [],
  multiColumn = false,
  showDiscos = false,
  hideToolbar = false,
  className = "",
}: ReportSheetViewProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const [orientacion, setOrientacion] = useState<Orientacion>("vertical");
  const [densidad, setDensidad] = useState<Density>("estandar");
  const [tema, setTema] = useState<Theme>("alto-contraste");
  const [columnas, setColumnas] = useState<1 | 2 | 3>(1);
  const [scale, setScale] = useState(1);
  const [exportando, setExportando] = useState("");
  const dim = DIM_PAGINA[orientacion];

  useEffect(() => {
    const el = sheetRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const parent = el.parentElement;
      if (!parent) return;
      const rect = parent.getBoundingClientRect();
      const pad = 48;
      const availableW = Math.max(280, rect.width - pad);
      const availableH = Math.max(320, rect.height - pad * 2);
      const sx = availableW / dim.w;
      const sy = availableH / dim.h;
      const s = Math.min(1, sx, sy);
      setScale(s > 0 ? s : 1);
    });
    if (el.parentElement) ro.observe(el.parentElement);
    return () => ro.disconnect();
  }, [dim.h, dim.w]);

  const densityVars = useMemo(() => {
    if (densidad === "compacta") return { "--rep-font-size": "9px", "--rep-row-py": "2px", "--rep-row-px": "5px", "--rep-gap": "4px" } as React.CSSProperties;
    if (densidad === "ultra") return { "--rep-font-size": "8px", "--rep-row-py": "1px", "--rep-row-px": "4px", "--rep-gap": "3px" } as React.CSSProperties;
    return { "--rep-font-size": "10px", "--rep-row-py": "3px", "--rep-row-px": "6px", "--rep-gap": "6px" } as React.CSSProperties;
  }, [densidad]);

  const exportar = async (formato: ImgFormato) => {
    if (!rootRef.current) return;
    if (exportando) return;
    setExportando(`Exportando ${formato}…`);
    try {
      await exportarPaginas(rootRef.current, formato, title.replace(/\s+/g, "_").toLowerCase(), { orientacion }, (p) => setExportando(`Página ${p.actual}/${p.total}…`));
    } catch (e) {
      window.dispatchEvent(new CustomEvent("toast", { detail: { msg: e instanceof Error ? e.message : String(e), tipo: "error" } }));
    } finally {
      setExportando("");
    }
  };

  const imprimir = () => {
    window.print();
  };

  return (
    <div className={`flex h-full flex-col ${className}`}>
      {!hideToolbar && (
        <div className="no-print flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
          <div className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white p-0.5 shadow-sm">
            <span className="px-1.5 text-[9px] font-black uppercase tracking-wider text-slate-500">Hoja</span>
            <button type="button" onClick={() => setOrientacion("vertical")} className={`rounded px-2 py-1 text-[10px] font-black uppercase ${orientacion === "vertical" ? "bg-slate-900 text-white" : "text-slate-600"}`}>Vertical</button>
            <button type="button" onClick={() => setOrientacion("horizontal")} className={`rounded px-2 py-1 text-[10px] font-black uppercase ${orientacion === "horizontal" ? "bg-slate-900 text-white" : "text-slate-600"}`}>Horizontal</button>
          </div>
          <div className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white p-0.5 shadow-sm">
            <span className="px-1.5 text-[9px] font-black uppercase tracking-wider text-slate-500">Columnas</span>
            {[1,2,3].map((n) => <button key={n} type="button" onClick={() => setColumnas(n as any)} className={`rounded px-2 py-1 text-[10px] font-black ${columnas === n ? "bg-indigo-600 text-white" : "text-slate-600"}`}>{n}</button>)}
          </div>
          <div className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white p-0.5 shadow-sm">
            <span className="px-1.5 text-[9px] font-black uppercase tracking-wider text-slate-500">Densidad</span>
            <button type="button" onClick={() => setDensidad("estandar")} className={`rounded px-2 py-1 text-[10px] font-black uppercase ${densidad === "estandar" ? "bg-emerald-600 text-white" : "text-slate-600"}`}>Estándar</button>
            <button type="button" onClick={() => setDensidad("compacta")} className={`rounded px-2 py-1 text-[10px] font-black uppercase ${densidad === "compacta" ? "bg-emerald-600 text-white" : "text-slate-600"}`}>Compacta</button>
            <button type="button" onClick={() => setDensidad("ultra")} className={`rounded px-2 py-1 text-[10px] font-black uppercase ${densidad === "ultra" ? "bg-emerald-600 text-white" : "text-slate-600"}`}>Ultra</button>
          </div>
          <div className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white p-0.5 shadow-sm">
            <span className="px-1.5 text-[9px] font-black uppercase tracking-wider text-slate-500">Tema</span>
            <button type="button" onClick={() => setTema("alto-contraste")} className={`rounded px-2 py-1 text-[10px] font-black uppercase ${tema === "alto-contraste" ? "bg-slate-900 text-white" : "text-slate-600"}`}>Alto Contraste</button>
            <button type="button" onClick={() => setTema("corporativo")} className={`rounded px-2 py-1 text-[10px] font-black uppercase ${tema === "corporativo" ? "bg-slate-900 text-white" : "text-slate-600"}`}>Corporativo</button>
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <button type="button" onClick={imprimir} className="rounded-lg bg-slate-900 px-3 py-1.5 text-[10px] font-black uppercase tracking-wide text-white">Imprimir Hoja</button>
            <button type="button" onClick={() => exportar("PNG")} className="rounded-lg bg-blue-600 px-3 py-1.5 text-[10px] font-black uppercase tracking-wide text-white">PNG HD</button>
            <button type="button" onClick={() => exportar("PDF")} className="rounded-lg bg-rose-600 px-3 py-1.5 text-[10px] font-black uppercase tracking-wide text-white">PDF</button>
            {exportando && <span className="text-[9px] font-bold uppercase text-slate-500">{exportando}</span>}
          </div>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto bg-neutral-900/95 p-6">
        <div className="flex h-full w-full items-start justify-center">
          <div ref={sheetRef} style={{ transform: `scale(${scale})`, transformOrigin: "top center" }}>
            <div ref={rootRef} className={`printable-canvas-sheet ${orientacion === "horizontal" ? "is-landscape" : ""} ${tema === "corporativo" ? "rep-corp" : ""}`} style={densityVars}>
              <header className="rep-cabecera-maestra flex items-center gap-3">
                {logo && (
                  <img
                    src={logo}
                    alt={title}
                    crossOrigin="anonymous"
                    referrerPolicy="no-referrer"
                    className="h-12 w-12 object-contain border-0 p-0 m-0 bg-transparent shadow-none"
                  />
                )}
                <div className="rep-titulos flex-1">
                  <div className="rep-titulo">{title}</div>
                  {subtitle && <div className="rep-subtitulo">{subtitle}</div>}
                </div>
                <div className="rep-meta">
                  {fecha && <span className="rep-meta-badge">Fecha {fecha}</span>}
                  {jornada && <span className="rep-meta-badge">Jornada {jornada}</span>}
                  {meta.map((m, i) => <span key={i} className="rep-meta-badge">{m}</span>)}
                </div>
              </header>
              {kpis.length > 0 && (
                <section className="rep-kpi-ribbon">
                  {kpis.map((k, i) => (
                    <article key={i} className="rep-kpi-card">
                      <span className="rep-kpi-label">{k.label}</span>
                      <span className={`rep-kpi-valor ${TONE[k.tone || "slate"]}`}>{k.value}</span>
                      {k.sub && <span className="rep-kpi-sub">{k.sub}</span>}
                    </article>
                  ))}
                </section>
              )}
              <section className={multiColumn && columnas > 1 ? "rep-multi-col" : ""} style={{ columnCount: multiColumn ? columnas : 1 }}>
                <div className="rep-tabla-wrap">
                  <table className="rep-tabla">
                    {columns.length > 0 && (
                      <thead>
                        <tr>
                          {columns.map((c) => <th key={c.key} className={c.align === "left" ? "text-left" : c.align === "center" ? "text-center" : "text-right"}>{c.label}</th>)}
                        </tr>
                      </thead>
                    )}
                    <tbody>
                      {rows.map((r, ri) => (
                        <tr key={ri}>
                          {columns.map((c) => {
                            const v = r[c.key];
                            const val = c.format ? c.format(v) : typeof v === "number" ? fmtMoney(v) : v == null ? "—" : String(v);
                            const cinfo = showDiscos && c.key === "caballo" ? col(String(r.numero || "")) : null;
                            return (
                              <td key={c.key} className={c.align === "left" ? "text-left" : c.align === "center" ? "text-center" : "text-right"}>
                                {cinfo ? <span className="inline-flex items-center gap-1"><span className="rep-disco" style={{ background: cinfo.bg, color: cinfo.fg }}>{r.numero}</span><span className="font-semibold">{val}</span></span> : <span className={c.className || ""}>{val}</span>}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                    {foot.length > 0 && (
                      <tfoot>
                        {foot.map((f, fi) => (
                          <tr key={fi}>
                            {columns.map((c) => {
                              const v = f[c.key];
                              const val = c.format ? c.format(v) : typeof v === "number" ? fmtMoney(v) : v == null ? "" : String(v);
                              return <td key={c.key} className={c.align === "left" ? "text-left" : c.align === "center" ? "text-center" : "text-right"}>{val}</td>;
                            })}
                          </tr>
                        ))}
                      </tfoot>
                    )}
                  </table>
                </div>
              </section>
              <footer className="rep-pie-editorial">
                <span>Comisiones verificadas y recalculadas automáticamente por el sistema</span>
                <span>Página 1 de 1 · {new Date().toLocaleString("es-VE")}</span>
              </footer>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ReportSheetView;
