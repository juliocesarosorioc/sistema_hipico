"use client";

import { useEffect, useMemo, useState } from "react";
import {
  cargarTablasImpresion,
  filtrarTablas,
  imprimirTablasPublicadas,
  imprimirReportePorJugador,
  type CargaImpresion,
  type FiltrosImpresion,
  type FormatoImpresion,
  type ResultadoImpresion,
} from "@/lib/impresion";
import type { StoredTablaFija } from "@/store/useTablasFijasStore";
import { Button } from "@/components/ui/Button";

const toast = (msg: string, tipo: "success" | "warning" | "error" | "info" = "info") =>
  window.dispatchEvent(new CustomEvent("toast", { detail: { msg, tipo } }));

type Props = {
  abierto: boolean;
  onCerrar: () => void;
};

export function ConfigImpresionModal({ abierto, onCerrar }: Props) {
  const [tablas, setTablas] = useState<StoredTablaFija[]>([]);
  const [bloqueadoRLS, setBloqueadoRLS] = useState(false);
  const [hipodromo, setHipodromo] = useState("");
  const [dia, setDia] = useState("");
  const [tipo, setTipo] = useState<"tablas" | "reporte">("tablas");
  const [trabajando, setTrabajando] = useState<"PDF" | "JPG" | "PNG" | null>(null);

  useEffect(() => {
    if (!abierto) return;
    setHipodromo("");
    setDia("");
    setTipo("tablas");
    setTrabajando(null);
    let vivo = true;
    cargarTablasImpresion().then((c: CargaImpresion) => {
      if (!vivo) return;
      setTablas(c.tablas);
      setBloqueadoRLS(c.rls);
    });
    return () => {
      vivo = false;
    };
  }, [abierto]);

  // FILTRO EN CASCADA (datos frescos de Supabase, NO del store desactualizado).
  const filtradas = useMemo(() => filtrarTablas(tablas, { hipodromo: hipodromo || undefined, dia: dia || undefined }), [tablas, hipodromo, dia]);

  const diasEvento = useMemo(() => {
    const set = new Set<string>();
    tablas.forEach((t) => {
      if (hipodromo && t.hipodromo !== hipodromo) return;
      const d = String(t.fecha_creacion || t.fecha || "").slice(0, 10);
      if (d) set.add(d);
    });
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [tablas, hipodromo]);

  const hipodromos = useMemo(() => {
    const set = new Set<string>();
    tablas.forEach((t) => {
      if (dia && String(t.fecha_creacion || t.fecha || "").slice(0, 10) !== dia) return;
      if (t.hipodromo) set.add(t.hipodromo);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, "es"));
  }, [tablas, dia]);

  const generar = async (formato: FormatoImpresion) => {
    setTrabajando(formato);
    const filtros: FiltrosImpresion = { hipodromo: hipodromo || undefined, dia: dia || undefined };

    let r: ResultadoImpresion;
    try {
      // Tablas: SIEMPRE recarga la última versión de valores desde Supabase
      // (modelo legacy) y aplica los filtros aquí mismo. Reporte: lee tickets.
      r =
        tipo === "tablas"
          ? await imprimirTablasPublicadas(formato, filtros)
          : await imprimirReportePorJugador(formato, filtros);
      if (r.ok) toast(`Documento generado: ${r.archivo}`);
      else toast(r.error || "No se pudo generar el documento.", "error");
    } catch (e) {
      toast(`Error generando el documento: ${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      setTrabajando(null);
    }
  };

  return (
    <div
      className={`fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 transition-opacity ${
        abierto ? "opacity-100" : "pointer-events-none opacity-0"
      }`}
      onClick={abierto ? onCerrar : undefined}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-slate-800 text-white p-4 flex justify-between items-center shrink-0">
          <h3 className="text-sm font-black uppercase tracking-wider">
            <span className="text-emerald-400 mr-2">🖨</span> Configurar Impresión de Tablas
          </h3>
          <button
            type="button"
            onClick={onCerrar}
            disabled={trabajando !== null}
            className="text-white/70 hover:text-white disabled:opacity-40"
          >
            ✕
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1 uppercase tracking-wider">
              Hipódromo:
            </label>
            <select
              value={hipodromo}
              onChange={(e) => setHipodromo(e.target.value)}
              disabled={trabajando !== null}
              className="w-full border border-slate-300 rounded-lg p-2.5 text-sm font-black bg-white outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50"
            >
              <option value="">Todos los hipódromos...</option>
              {hipodromos.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1 uppercase tracking-wider">
              Día <span className="text-slate-400 font-normal text-[10px]">(Día exacto de la carrera)</span>:
            </label>
            <select
              value={dia}
              onChange={(e) => setDia(e.target.value)}
              disabled={trabajando !== null}
              className="w-full border border-slate-300 rounded-lg p-2.5 text-sm font-black bg-white outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50"
            >
              <option value="">Todas las fechas...</option>
              {diasEvento.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            {dia && hipodromo ? (
              <p className="text-[10px] text-emerald-600 font-bold mt-1">
                Se imprimirán {tipo === "tablas" ? `${filtradas.length} tabla(s)` : "las entradas"} de {hipodromo} · {dia}
              </p>
            ) : (
              <p className="text-[10px] text-slate-400 mt-1">
                {tipo === "tablas" ? `${filtradas.length} tabla(s) en estado "Abierta" con los filtros actuales.` : "El reporte procesa tickets_apuestas."}
              </p>
            )}
            {bloqueadoRLS && (
              <p className="mt-1 rounded-lg border border-red-200 bg-red-50 px-2 py-1.5 text-[10px] font-bold text-red-600">
                ⚠ La impresión necesita permiso de lectura (RLS). Ejecute en Supabase: sql/crear_rpc_club_listar_tablas_fijas_publicadas.sql
              </p>
            )}
          </div>
          <div className="pt-3 border-t border-slate-200">
            <label className="block text-xs font-bold text-slate-700 mb-2 uppercase tracking-wider">
              Tipo de documento:
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={trabajando !== null}
                onClick={() => setTipo("tablas")}
                className={`py-2.5 rounded-lg text-xs font-black uppercase tracking-wide transition-colors flex items-center justify-center gap-2 ${
                  tipo === "tablas"
                    ? "bg-emerald-600 text-white"
                    : "bg-slate-200 text-slate-700 hover:bg-slate-300"
                } disabled:opacity-50`}
              >
                ▦ Tablas Publicadas
              </button>
              <button
                type="button"
                disabled={trabajando !== null}
                onClick={() => setTipo("reporte")}
                className={`py-2.5 rounded-lg text-xs font-black uppercase tracking-wide transition-colors flex items-center justify-center gap-2 ${
                  tipo === "reporte"
                    ? "bg-emerald-600 text-white"
                    : "bg-slate-200 text-slate-700 hover:bg-slate-300"
                } disabled:opacity-50`}
              >
                ▤ Reporte por Jugador
              </button>
            </div>
            <p className="text-[10px] text-slate-400 mt-2 italic">
              El documento se genera con el nuevo diseño (tarjetas por carrera / resumen jugador-grupo-nivel).
            </p>
          </div>
          <div className="pt-3 border-t border-slate-200">
            <label className="block text-xs font-bold text-slate-700 mb-2 uppercase tracking-wider">
              Formato de salida:
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(["PDF", "JPG", "PNG"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  disabled={trabajando !== null}
                  onClick={() => generar(f)}
                  className={`py-3 rounded-lg text-xs font-black transition-colors flex flex-col items-center gap-1 ${
                    f === "PDF"
                      ? "bg-slate-800 text-white hover:bg-slate-900"
                      : f === "JPG"
                        ? "bg-emerald-600 text-white hover:bg-emerald-700"
                        : "bg-indigo-600 text-white hover:bg-indigo-700"
                  } disabled:opacity-60`}
                >
                  {trabajando === f ? (
                    <span className="inline-block w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  ) : (
                    <>
                      <span className="text-lg">{f === "PDF" ? "▟" : f === "JPG" ? "▧" : "▨"}</span>
                      {f}
                    </>
                  )}
                </button>
              ))}
            </div>
          </div>
          <div className="pt-2">
            <Button onClick={onCerrar} variant="outline" className="w-full bg-slate-200 text-slate-700 hover:bg-slate-300" disabled={trabajando !== null}>
              Cerrar
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}