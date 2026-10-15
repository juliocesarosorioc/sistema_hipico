"use client";

import React, { useState } from "react";

/**
 * Plano Preliminar (Ctrl+Q desde Gestión de Jugadas).
 *
 * Muestra el PLANO DE JUGADAS (formato TERCIOS, plantilla 1) construido con
 * las jugadas en sesión de la taquilla: 🐎 … 🐎 en la cabecera, jugadas
 * numeradas ("1) Juega X 2Y2N (3) con 6.000,00 da Y") y el pie del plano
 * referencial. Sin jugadas cargadas muestra un aviso en vez de un plano roto.
 */
export default function PlanoPreliminar({ texto }: { texto: string }) {
  const [copiado, setCopiado] = useState(false);

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1500);
    } catch {
      /* sin permiso de portapapeles: se ignora */
    }
  };

  const vacio = !texto.trim();

  return (
    <div className="min-h-screen bg-[#f8fafc] font-sans p-4">
      <div className="mx-auto max-w-3xl">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="rounded-lg bg-[#facc15] px-3 py-1.5 text-[12px] font-bold text-yellow-900 border border-yellow-400 shadow-sm">
              📄 Generar Preliminar
            </span>
            <span className="text-[11px] text-slate-500">
              {vacio
                ? "Aún no hay jugadas cargadas para esta carrera."
                : "Plano construido con las jugadas en sesión."}
            </span>
          </div>
          <button
            type="button"
            onClick={copiar}
            disabled={vacio}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-[12px] font-bold text-slate-700 shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-40"
          >
            {copiado ? "✅ Copiado" : "📋 Copiar Texto"}
          </button>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <pre className="max-h-[75vh] overflow-y-auto whitespace-pre-wrap p-4 font-mono text-[13px] leading-[1.6] text-slate-800">
            {texto}
          </pre>
        </div>
      </div>
    </div>
  );
}