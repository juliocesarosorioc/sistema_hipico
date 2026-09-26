"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { MATRIZ_CSS, paginasMatrizHTML, cargarMatrizImpresion, cargarResumenImpresion, totalEjemplares, type TablaImpresion, type TablaRespaldo } from "@/lib/impresion/tablas";
import { REPORTE_CSS, paginasReporteHTML, cargarReporteJugadores, resumirReporteJugadores, type JugadorReporte } from "@/lib/impresion/reporte";
import { exportarPaginas, textoWhatsAppMatriz, textoWhatsAppReporte, type ImgFormato } from "@/lib/impresion/exportar";
import { DIM_PAGINA, type Orientacion } from "@/lib/impresion/util";

type TipoReporte = "matriz" | "reporte";
type Paso = "config" | "generar";

type Props = {
  abierto: boolean;
  onCerrar: () => void;
  /** Respaldos ya cargados del Monitor (se usan si la BD no responde). */
  tablasRespaldo?: TablaRespaldo[];
};

function toast(msg: string, tipo: "success" | "warning" | "error" | "info" = "info") {
  window.dispatchEvent(new CustomEvent("toast", { detail: { msg, tipo } }));
}

/**
 * Modal de IMPRESIÓN de Tablas Fijas (Reconstruido desde el legacy
 * monitor_tablas_imprimir + reporte_tablas):
 *  · PASO 1 (Config): tipo (Matriz 15/hoja 5×3 / Reporte Jugador), orientación
 *    de la hoja A4 y filtros hipódromo ↔ día. La carga aquí es LIGERA (solo
 *    metadatos), de modo que nunca se cuelga con mucha información.
 *  · PASO 2 (Generar): al pulsar "🖨️ Generar páginas" se traen SOLO los datos
 *    filtrados (tablas/caballos/montos acotados en la BD) y se muestra el
 *    preview + exportación PNG / PDF y envío por WhatsApp (con plantilla
 *    editable del Centro de WhatsApp).
 */
export function ConfigImpresionModal({ abierto, onCerrar, tablasRespaldo }: Props) {
  const [paso, setPaso] = useState<Paso>("config");
  const [tipo, setTipo] = useState<TipoReporte>("matriz");
  const [orientacion, setOrientacion] = useState<Orientacion>("horizontal");
  const [dia, setDia] = useState<string>("");
  const [hipodromo, setHipodromo] = useState<string>("");
  const [resumen, setResumen] = useState<Array<{ id: string | number; hipodromo: string; carrera: string; fecha: string }>>([]);
  const [carreras, setCarreras] = useState<TablaImpresion[]>([]);
  const [jugadores, setJugadores] = useState<JugadorReporte[]>([]);
  const [fuente, setFuente] = useState<"reales" | "local">("reales");
  const [errorBd, setErrorBd] = useState("");
  const [cargando, setCargando] = useState(false);
  const [exportando, setExportando] = useState("");
  const exportRootRef = useRef<HTMLDivElement>(null);

  const dim = DIM_PAGINA[orientacion];

  // Opciones de filtro derivadas del resumen LIGERO (rápido, sin colgarse).
  const resumenFiltrado = useMemo(
    () =>
      resumen.filter((c) => {
        if (dia && c.fecha.slice(0, 10) !== dia) return false;
        if (hipodromo && c.hipodromo !== hipodromo) return false;
        return true;
      }),
    [resumen, dia, hipodromo]
  );

  const opciones = useMemo(() => {
    const dias = new Set<string>();
    const hipos = new Set<string>();
    const diasPorHipo = new Map<string, Set<string>>();
    const hiposPorDia = new Map<string, Set<string>>();
    for (const c of resumen) {
      const d = c.fecha.slice(0, 10);
      if (!d || !c.hipodromo) continue;
      dias.add(d);
      hipos.add(c.hipodromo);
      if (!diasPorHipo.has(c.hipodromo)) diasPorHipo.set(c.hipodromo, new Set());
      if (!hiposPorDia.has(d)) hiposPorDia.set(d, new Set());
      diasPorHipo.get(c.hipodromo)!.add(d);
      hiposPorDia.get(d)!.add(c.hipodromo);
    }
    return {
      dias: [...dias].sort().reverse(),
      hipos: [...hipos].sort((a, b) => a.localeCompare(b, "es")),
      diasDelHipodromo: (hipo: string) => [...(diasPorHipo.get(hipo) ?? new Set<string>())].sort().reverse(),
      hipodromosDelDia: (diaSel: string) => [...(hiposPorDia.get(diaSel) ?? new Set<string>())].sort((a, b) => a.localeCompare(b, "es")),
    };
  }, [resumen]);

  const diasDisponibles = useMemo(
    () => (hipodromo ? opciones.diasDelHipodromo(hipodromo) : opciones.dias),
    [hipodromo, opciones]
  );
  const hiposDisponibles = useMemo(
    () => (dia ? opciones.hipodromosDelDia(dia) : opciones.hipos),
    [dia, opciones]
  );

  // Cascada bidireccional: limpia el filtro huérfano si el otro lo invalida.
  useEffect(() => {
    if (dia && !diasDisponibles.includes(dia)) setDia("");
    if (hipodromo && !hiposDisponibles.includes(hipodromo)) setHipodromo("");
  }, [diasDisponibles, hiposDisponibles, dia, hipodromo]);

  /** Carga inicial: SOLO el resumen ligero de tablas (metadatos) para el paso Config. */
  useEffect(() => {
    if (!abierto) return;
    let vivo = true;
    setPaso("config");
    setDia("");
    setHipodromo("");
    setErrorBd("");
    setCarreras([]);
    setJugadores([]);
    (async () => {
      const r = await cargarResumenImpresion().catch((e) => ({
        carreras: [],
        fuente: "local" as const,
        error: e instanceof Error ? e.message : String(e),
      }));
      if (!vivo) return;
      setResumen(r.carreras);
      setFuente(r.fuente);
      setErrorBd(r.error || "");
    })();
    return () => {
      vivo = false;
    };
  }, [abierto, tablasRespaldo]);

  /** Generar: trae SOLO los datos filtrados (evita colgarse con data sin filtrar). */
  const generar = useCallback(async () => {
    if (cargando) return;
    setCargando(true);
    setErrorBd("");
    try {
      const [m, rp] = await Promise.all([
        cargarMatrizImpresion(tablasRespaldo, { dia, hipodromo }).catch((e) => ({
          carreras: [] as TablaImpresion[],
          fuente: "local" as const,
          error: e instanceof Error ? e.message : String(e),
        })),
        cargarReporteJugadores({ dia, hipodromo }).catch((e) => ({
          jugadores: [] as JugadorReporte[],
          fuente: "local" as const,
          error: e instanceof Error ? e.message : String(e),
        })),
      ]);
      setCarreras(m.carreras);
      setFuente(m.fuente);
      setErrorBd(m.error || rp.error || "");
      setJugadores(rp.jugadores);
      setPaso("generar");
      if (m.carreras.length === 0 && rp.jugadores.length === 0) {
        toast("No hay resultados con los filtros indicados. Ajusta la selección.", "warning");
      }
    } finally {
      setCargando(false);
    }
  }, [cargando, dia, hipodromo, tablasRespaldo]);

  const filtradasMatriz = useMemo(() => carreras, [carreras]);
  const filtradosJugadores = useMemo(() => jugadores, [jugadores]);

  const html = useMemo(
    () =>
      tipo === "matriz"
        ? paginasMatrizHTML(filtradasMatriz, orientacion)
        : paginasReporteHTML(filtradosJugadores, orientacion),
    [tipo, filtradasMatriz, filtradosJugadores, orientacion]
  );

  const numPaginas = useMemo(() => {
    const sep = tipo === "matriz" ? "class=\"im-pagina\"" : "class=\"imr-ppagina\"";
    const n = html.split(sep).length - 1;
    return Math.max(n, 0);
  }, [html, tipo]);

  const vacio = html.length === 0 || (tipo === "matriz" ? filtradasMatriz.length === 0 : filtradosJugadores.length === 0);

  const escala = Math.min(1, (920 - 24) / dim.w);
  const nTotales =
    tipo === "matriz"
      ? totalEjemplares(filtradasMatriz)
      : resumirReporteJugadores(filtradosJugadores).conVentas;

  const aviso =
    cargando
      ? { cls: "border-amber-300 bg-amber-50 text-amber-800", txt: "Conectando a la base de datos…" }
      : vacio
        ? { cls: "border-amber-300 bg-amber-50 text-amber-800", txt: "No hay resultados con los filtros indicados. Ajuste la selección o genere de nuevo." }
        : errorBd
          ? { cls: "border-amber-300 bg-amber-50 text-amber-800", txt: (fuente === "local" ? "Usando datos locales (sin BD): " : "Aviso: ") + errorBd.slice(0, 120) }
          : {
              cls: "border-emerald-300 bg-emerald-50 text-emerald-700",
              txt:
                tipo === "matriz"
                  ? `Datos reales: ${filtradasMatriz.length} carrera(s) (${nTotales} ejemplares) desde tablas_fijas + tickets_apuestas. ${numPaginas} página(s) A4 (15 por hoja).`
                  : `Datos reales: ${filtradosJugadores.length} entrada(s) (jugadores con ventas) desde tablas_fijas + tickets_apuestas.`,
            };

  const exportar = async (formato: ImgFormato) => {
    if (vacio) {
      toast("No hay páginas para exportar.", "warning");
      return;
    }
    if (!exportRootRef.current) return;
    if (exportando) return;
    setExportando(`Capturando ${formato}…`);
    try {
      await exportarPaginas(
        exportRootRef.current,
        formato,
        tipo === "matriz" ? "tablas_fijas" : "reporte_tablas",
        { orientacion },
        (p) => {
          setExportando(`Página ${p.actual} de ${p.total}…`);
        }
      );
      toast(`${formato} generado (${numPaginas} página(s), ${orientacion === "vertical" ? "vertical" : "horizontal"}).`, "success");
    } catch (e) {
      toast(`Error al exportar ${formato}: ${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      setExportando("");
    }
  };

  const whatsapp = () => {
    if (vacio) {
      toast("No hay datos para enviar.", "warning");
      return;
    }
    if (tipo === "matriz") textoWhatsAppMatriz(filtradasMatriz);
    else textoWhatsAppReporte(filtradosJugadores);
    toast("WhatsApp abierto con el mensaje de tablas (plantilla editable en el Centro de WhatsApp).", "success");
  };

  if (!abierto) return null;

  const btn = (color: string, label: string, onClick: () => void, disabled = false) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[11px] font-black uppercase tracking-wide text-white transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
      style={{ backgroundColor: color }}
    >
      {label}
    </button>
  );

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-3 no-print">
        <div className="flex max-h-[94vh] w-full max-w-[960px] flex-col overflow-hidden rounded-2xl border border-line bg-white shadow-2xl">
          {/* Cabecera */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-slate-900 px-4 py-3 text-white">
            <h3 className="text-sm font-black uppercase tracking-wide">🖨️ Imprimir Tablas Publicadas</h3>
            <div className="flex items-center gap-1.5">
              {(
                [
                  ["matriz", "🧾 Matriz 15/hoja"],
                  ["reporte", "👥 Reporte Jugador"],
                ] as Array<[TipoReporte, string]>
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => {
                    setTipo(k);
                    if (paso === "generar") setPaso("config");
                  }}
                  className={`rounded-lg px-2.5 py-1 text-[10px] font-black uppercase transition-colors ${
                    tipo === k ? "bg-cyan-500 text-white" : "bg-white/10 text-slate-300 hover:bg-white/20"
                  }`}
                >
                  {label}
                </button>
              ))}
              <button type="button" onClick={onCerrar} className="ml-1 rounded-full bg-white/10 px-2.5 py-1 text-sm leading-none text-white hover:bg-white/20">
                ✕
              </button>
            </div>
          </div>

          {/* Filtros y acciones */}
          <div className="flex flex-wrap items-center gap-2 border-b border-line bg-slate-50 px-4 py-2.5">
            {/* Orientación A4 */}
            <div className="flex items-center rounded-lg border border-slate-300 bg-white p-0.5 shadow-sm" title="Orientación de la hoja A4">
              <span className="px-1.5 text-[9px] font-black uppercase tracking-wider text-slate-500">↕ Hoja</span>
              {(
                [
                  ["vertical", "↕ Vertical"],
                  ["horizontal", "↔ Horizontal"],
                ] as Array<[Orientacion, string]>
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => {
                    setOrientacion(k);
                    if (paso === "generar") setPaso("config");
                  }}
                  className={`rounded-md px-2 py-1 text-[10px] font-black uppercase transition-colors ${
                    orientacion === k ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2 py-1 shadow-sm">
              <span className="text-[9px] font-black uppercase tracking-wider text-slate-500">🏛️ Hipódromo</span>
              <select value={hipodromo} onChange={(e) => setHipodromo(e.target.value)} className="max-w-[190px] bg-transparent text-xs font-bold uppercase text-slate-900 focus:outline-none">
                <option value="">TODOS</option>
                {hiposDisponibles.map((h) => (
                  <option key={h} value={h}>{h}</option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2 py-1 shadow-sm">
              <span className="text-[9px] font-black uppercase tracking-wider text-slate-500">📅 Día</span>
              <select value={dia} onChange={(e) => setDia(e.target.value)} className="bg-transparent text-xs font-bold text-slate-900 focus:outline-none">
                <option value="">TODOS</option>
                {diasDisponibles.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            </label>
            {(dia || hipodromo) && (
              <button
                type="button"
                onClick={() => {
                  setDia("");
                  setHipodromo("");
                }}
                className="rounded border border-red-200 bg-red-50 px-2 py-1 text-[10px] font-black uppercase text-red-500 hover:bg-red-100"
              >
                ✕ Limpiar
              </button>
            )}
            <div className="ml-auto flex flex-wrap items-center gap-1.5">
              {paso === "config" ? (
                <button
                  type="button"
                  onClick={() => void generar()}
                  disabled={cargando}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-[11px] font-black uppercase tracking-wide text-white shadow-md transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
                  title="Generar las páginas con los filtros elegidos (solo los datos filtrados)"
                >
                  {cargando ? "Generando…" : "🖨️ Generar páginas"}
                </button>
              ) : (
                <>
                  <span className="text-[9px] font-black uppercase tracking-wider text-slate-400">
                    {exportando ? exportando : `${numPaginas} pág.`}
                  </span>
                  {btn("#25d366", "💬 WhatsApp", whatsapp)}
                  {btn("#2563eb", "🖼️ Imagen PNG", () => void exportar("PNG"), !!exportando)}
                  {btn("#dc2626", "📄 PDF", () => void exportar("PDF"), !!exportando)}
                </>
              )}
            </div>
          </div>

          {/* Aviso */}
          <div className={`border-b px-4 py-2 text-[10px] font-semibold leading-relaxed ${aviso.cls}`}>{aviso.txt}</div>

          {/* Cuerpo: Config (resumen ligero) o Preview */}
          {paso === "config" ? (
            <div className="min-h-0 flex-1 overflow-auto p-4">
              <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-5 text-center">
                <p className="text-xl font-black uppercase tracking-wide text-indigo-700">⚙️ Paso 1 · Opciones</p>
                <p className="mx-auto mt-2 max-w-md text-xs font-semibold text-indigo-600">
                  Elige el tipo de impresión, la orientación y los filtros (hipódromo / día). Solo después de pulsar
                  <b> “Generar páginas”</b> se descarga la información, y únicamente la que corresponde a los filtros —
                  así la impresión nunca se cuelga con demasiados datos.
                </p>
                <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-[11px] font-black uppercase">
                  <span className="rounded-full bg-white px-3 py-1 text-emerald-700 ring-1 ring-emerald-300">
                    🏁 {resumenFiltrado.length} carrera(s) seleccionada(s)
                  </span>
                  <span className="rounded-full bg-white px-3 py-1 text-slate-600 ring-1 ring-slate-300">
                    📅 {diasDisponibles.length} día(s) disponibles
                  </span>
                  <span className="rounded-full bg-white px-3 py-1 text-slate-600 ring-1 ring-slate-300">
                    🏛️ {hiposDisponibles.length} hipódromo(s)
                  </span>
                </div>
                {errorBd && (
                  <p className="mt-3 text-[10px] font-bold text-amber-700">
                    {fuente === "local" ? "Sin conexión a la BD; se usará el respaldo local." : errorBd.slice(0, 140)}
                  </p>
                )}
              </div>

              {/* Mini-vista de lo que se imprimirá */}
              <p className="mb-1 mt-4 text-[10px] font-black uppercase tracking-wider text-slate-400">
                Carreras incluidas en la selección
              </p>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {resumenFiltrado.slice(0, 40).map((c) => (
                  <div key={String(c.id)} className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700">
                    <span className="truncate uppercase">🏛️ {c.hipodromo}</span>
                    <span className="ml-2 shrink-0 rounded bg-slate-800 px-2 py-0.5 text-[10px] font-black text-white">C{c.carrera}</span>
                    <span className="ml-2 shrink-0 text-[10px] font-semibold text-slate-400">{c.fecha.slice(0, 10)}</span>
                  </div>
                ))}
                {resumenFiltrado.length === 0 && (
                  <p className="col-span-full rounded-lg border border-dashed border-slate-300 bg-white p-4 text-center text-xs font-semibold text-slate-400">
                    No hay tablas con los filtros elegidos. Amplía la selección y pulsa Generar.
                  </p>
                )}
                {resumenFiltrado.length > 40 && (
                  <p className="col-span-full text-center text-[10px] font-bold text-slate-400">
                    …y {resumenFiltrado.length - 40} carrera(s) más. Se imprimirán {Math.ceil(resumenFiltrado.length / 15)} página(s) de matriz.
                  </p>
                )}
              </div>
            </div>
          ) : (
            <>
              {/* Preview */}
              <div className="min-h-0 flex-1 overflow-auto bg-slate-800 p-3">
                {numPaginas > 0 ? (
                  <div className="mx-auto rounded-lg shadow-xl" style={{ width: dim.w * escala + 16, height: dim.h * numPaginas * escala + 16 }}>
                    <div
                      style={{ transform: `scale(${escala})`, transformOrigin: "top left", width: dim.w, height: dim.h * numPaginas }}
                      dangerouslySetInnerHTML={{ __html: html }}
                    />
                  </div>
                ) : (
                  <div className="flex items-center justify-center py-24 text-sm font-bold text-slate-300">
                    {cargando ? "Cargando datos…" : "Sin resultados. Ajuste los filtros."}
                  </div>
                )}
              </div>
            </>
          )}

          {/* Pie de navegación */}
          {paso === "generar" && (
            <div className="flex items-center justify-between border-t border-line bg-gray-50 px-4 py-2.5">
              <button
                type="button"
                onClick={() => setPaso("config")}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-[10px] font-black uppercase tracking-wide text-slate-600 hover:bg-slate-100"
              >
                ◀ Atrás (cambiar opciones)
              </button>
              <span className="text-[9px] font-bold uppercase text-slate-400">Los montos no muestran símbolo; la moneda se estipula según el grupo del usuario.</span>
            </div>
          )}
        </div>
      </div>

      {/* Raíz de exportación (fuera de pantalla, sin escala) para html2canvas */}
      <div aria-hidden style={{ position: "absolute", left: "-99999px", top: 0, pointerEvents: "none" }}>
        <style>{tipo === "matriz" ? MATRIZ_CSS : REPORTE_CSS}</style>
      </div>
      <div
        ref={exportRootRef}
        aria-hidden
        className={`${tipo === "matriz" ? "impe-root" : "imr-root"} ${orientacion === "horizontal" ? (tipo === "matriz" ? "im-or-h" : "imr-or-h") : ""}`}
        style={{ position: "absolute", left: "-99999px", top: 0, pointerEvents: "none" }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </>
  );
}

export default ConfigImpresionModal;