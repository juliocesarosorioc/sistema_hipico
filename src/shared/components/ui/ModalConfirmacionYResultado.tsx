"use client";

import { useEffect } from "react";
import { useInteraccionOperadorStore } from "@/shared/store/useInteraccionOperadorStore";

export function ModalConfirmacionYResultado() {
  const confirmacion = useInteraccionOperadorStore((s) => s.confirmacionActiva);
  const resultado = useInteraccionOperadorStore((s) => s.resultadoActivo);
  const confirmarAccion = useInteraccionOperadorStore((s) => s.confirmarAccion);
  const cancelarAccion = useInteraccionOperadorStore((s) => s.cancelarAccion);
  const aceptarResultado = useInteraccionOperadorStore((s) => s.aceptarResultado);

  useEffect(() => {
    if (!confirmacion && !resultado) return;
    const onKey = (e: KeyboardEvent) => {
      if (resultado) {
        if (e.key === "Enter" || e.key === "Escape") {
          e.preventDefault();
          aceptarResultado();
        }
        return;
      }
      if (confirmacion) {
        if (e.key === "Escape") {
          e.preventDefault();
          cancelarAccion();
        } else if (e.key === "Enter") {
          e.preventDefault();
          confirmarAccion();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmacion, resultado, confirmarAccion, cancelarAccion, aceptarResultado]);

  if (!confirmacion && !resultado) return null;

  if (confirmacion) {
    const colorBorde =
      confirmacion.variante === "danger"
        ? "border-red-500/60"
        : confirmacion.variante === "warning"
          ? "border-amber-500/60"
          : "border-indigo-500/60";
    const colorBtn =
      confirmacion.variante === "danger"
        ? "bg-red-600 hover:bg-red-500 text-white"
        : confirmacion.variante === "warning"
          ? "bg-amber-500 hover:bg-amber-400 text-slate-950"
          : "bg-indigo-600 hover:bg-indigo-500 text-white";

    return (
      <div
        className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-xs"
        role="dialog"
        aria-modal="true"
        onClick={cancelarAccion}
      >
        <div
          className={`w-full max-w-md rounded-2xl border-2 ${colorBorde} bg-slate-900 p-5 text-slate-100 shadow-2xl`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-3 flex items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
            <h3 className="text-sm font-black uppercase tracking-wide text-amber-300">
              ⚠️ {confirmacion.titulo}
            </h3>
            <button
              type="button"
              onClick={cancelarAccion}
              aria-label="Cerrar"
              className="rounded-lg px-2 py-1 text-xs font-black text-slate-400 hover:bg-slate-800 hover:text-white"
            >
              ✕
            </button>
          </div>
          <p className="text-xs font-semibold leading-relaxed text-slate-200">{confirmacion.mensaje}</p>
          {confirmacion.detalle && (
            <div className="mt-2.5 rounded-xl border border-slate-800 bg-slate-950/80 p-2.5 font-mono text-[11px] text-slate-300">
              {confirmacion.detalle}
            </div>
          )}
          <div className="mt-4 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={cancelarAccion}
              className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-bold text-slate-300 hover:bg-slate-700"
            >
              {confirmacion.textoCancelar ?? "Cancelar (Esc)"}
            </button>
            <button
              type="button"
              onClick={confirmarAccion}
              className={`rounded-lg px-4 py-1.5 text-xs font-black ${colorBtn}`}
            >
              {confirmacion.textoConfirmar ?? "✅ Confirmar (Enter)"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (resultado) {
    const tipo = resultado.tipo ?? "success";
    const badgeColor =
      tipo === "error"
        ? "border-red-500/60 text-red-300"
        : tipo === "warning"
          ? "border-amber-500/60 text-amber-300"
          : "border-emerald-500/60 text-emerald-300";

    return (
      <div
        className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-xs"
        role="alertdialog"
        aria-modal="true"
        onClick={aceptarResultado}
      >
        <div
          className={`w-full max-w-md rounded-2xl border-2 ${badgeColor} bg-slate-900 p-5 text-slate-100 shadow-2xl`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-3 flex items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
            <h3 className="text-sm font-black uppercase tracking-wide text-emerald-300">
              {resultado.titulo}
            </h3>
            <button
              type="button"
              onClick={aceptarResultado}
              aria-label="Cerrar"
              className="rounded-lg px-2 py-1 text-xs font-black text-slate-400 hover:bg-slate-800 hover:text-white"
            >
              ✕
            </button>
          </div>
          <p className="text-xs font-semibold leading-relaxed text-slate-200">{resultado.mensaje}</p>
          {resultado.detalle && (
            <div className="mt-2.5 max-h-40 overflow-y-auto rounded-xl border border-slate-800 bg-slate-950/80 p-2.5 font-mono text-[11px] whitespace-pre-wrap text-slate-300">
              {resultado.detalle}
            </div>
          )}
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={aceptarResultado}
              className="rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-black text-white shadow hover:bg-emerald-500"
            >
              ✅ Aceptar / Entendido (Enter)
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

export default ModalConfirmacionYResultado;
