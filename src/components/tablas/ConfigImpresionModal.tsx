"use client";

import { useEffect, useMemo, useState } from "react";
import { useTablasFijasStore } from "@/store/useTablasFijasStore";
import {
  imprimirTablasPublicadas,
  imprimirReportePorJugador,
  diasDisponibles,
  hipodromosDisponibles,
  type FiltrosImpresion,
  type FormatoImpresion,
  type ResultadoImpresion,
} from "@/lib/impresion";
import { Button } from "@/components/ui/Button";

const toast = (msg: string, tipo: "success" | "warning" | "error" | "info" = "info") =>
  window.dispatchEvent(new CustomEvent("toast", { detail: { msg, tipo } }));

type Props = {
  abierto: boolean;
  onCerrar: () => void;
};

/**
 * Configuración de Impresión de Tablas — réplica del modal legacy
 * (html/tablas.html #modalConfigImpresion): Hipódromo + Día + Tipo de
 * documento (Tablas Publicadas / Reporte por Jugador) + Formato (PDF/JPG/PNG).
 * Se imprime SIEMPRE lo que está en el store (última versión de valores),
 * sin recargar. La captura es cliente-side (html2canvas + jsPDF).
 */
export function ConfigImpresionModal({ abierto, onCerrar }: Props) {
  const tablas = useTablasFijasStore((s) => s.tablas);

  const [hipodromo, setHipodromo] = useState("");
  const [dia, setDia] = useState("");
  const [tipo, setTipo] = useState<"tablas" | "reporte">("tablas");
  const [trabajando, setTrabajando] = useState<"PDF" | "JPG" | "PNG" | null>(null);

  useEffect(() => {
    if (abierto) {
      setHipodromo("");
      setDia("");
      setTipo("tablas");
      setTrabajando(null);
    }
  }, [abierto]);

  const dias = useMemo(() => diasDisponibles(tablas), [tablas]);
  const hipodromos = useMemo(() => hipodromosDisponibles(tablas), [tablas]);

  const totalAbiertas = tablas.filter((t) => !t.cerrada).length;

  const generar = async (formato: FormatoImpresion) => {
    setTrabajando(formato);
    const filtros: FiltrosImpresion = { hipodromo: hipodromo || undefined, dia: dia || undefined };
    let r: ResultadoImpresion;
    try {
      r =
        tipo === "tablas"
          ? await imprimirTablasPublicadas(tablas, formato, filtros)
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
              Día (fecha del programa):
            </label>
            <select
              value={dia}
              onChange={(e) => setDia(e.target.value)}
              disabled={trabajando !== null}
              className="w-full border border-slate-300 rounded-lg p-2.5 text-sm font-black bg-white outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50"
            >
              <option value="">Todos los días...</option>
              {dias.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            {dia && hipodromo ? (
              <p className="text-[10px] text-emerald-600 font-bold mt-1">
                Se imprimirán {tipo === "tablas" ? `${tablas.filter((t) => !t.cerrada && t.hipodromo === hipodromo && (t.fecha_creacion || t.fecha)?.slice(0, 10) === dia).length} tabla(s)` : "las entradas"} de {hipodromo} · {dia}
              </p>
            ) : null}
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
            <p className="text-[10px] text-slate-400 mt-2 italic">
              Los valores se usan tal cual están en pantalla (última versión), sin recargar la base de datos.
            </p>
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