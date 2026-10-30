"use client";

import { useEffect } from "react";
import { normalizarTipo } from "@/shared/lib/mensajeria";
import {
  claseMarcoConfirm,
  estiloConfirmar,
  iconoConfirm,
  useConfirmStore,
} from "@/shared/store/useConfirmStore";

/**
 * ============================================================================
 * ConfirmHost — la ÚNICA caja de confirmación de la plataforma
 * ============================================================================
 *
 * Se monta una vez en el shell (AppShell). Dibuja la petición pendiente del
 * `useConfirmStore`, con el estilo de mensajería centralizado y dos botones.
 * Reemplaza a `window.confirm` en todos los módulos.
 */
export function ConfirmHost() {
  const peticion = useConfirmStore((s) => s.peticion);
  const resolver = useConfirmStore((s) => s.resolver);

  // Escape cancela, como el diálogo nativo.
  useEffect(() => {
    if (!peticion) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") resolver(false);
      if (e.key === "Enter") resolver(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [peticion, resolver]);

  if (!peticion) return null;

  const tipo = normalizarTipo(peticion.tipo ?? "warning");

  return (
    <div
      className="no-print fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={peticion.titulo}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) resolver(false);
      }}
    >
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl">
        <div className={`msg ${claseMarcoConfirm[tipo]} rounded-none border-0 border-b`}>
          <span className="msg-icono" aria-hidden="true">
            {iconoConfirm[tipo]}
          </span>
          <span className="msg-texto">
            <span className="msg-titulo">{peticion.titulo}</span>
            <span className="msg-detalle whitespace-pre-line">{peticion.mensaje}</span>
          </span>
        </div>

        <div className="flex items-center justify-end gap-2 p-4">
          <button
            type="button"
            onClick={() => resolver(false)}
            className="rounded-lg border border-line bg-white px-4 py-2 text-xs font-black uppercase tracking-wide text-slate-600 hover:bg-surfaceAlt"
          >
            {peticion.textoCancelar ?? "Cancelar"}
          </button>
          <button
            type="button"
            autoFocus
            onClick={() => resolver(true)}
            className={`rounded-xl px-5 py-2 text-xs sm:text-sm font-black uppercase tracking-wide transition-all shadow-md ${
              /liquidar/i.test(peticion.textoConfirmar ?? "")
                ? "bg-gradient-to-r from-emerald-600 via-green-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-emerald-600/30 ring-4 ring-emerald-400/40 hover:scale-[1.02] active:scale-[0.98]"
                : estiloConfirmar(tipo, peticion.destructivo)
            }`}
          >
            {peticion.textoConfirmar ?? "Confirmar"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConfirmHost;
