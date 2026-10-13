"use client";

import React, { useState } from "react";

/**
 * Resultado Preliminar — vista separada (tipo Plano Preliminar) que muestra el
 * PRELIMINAR DE RESULTADOS de la carrera: cabecera con la pizarra de llegada +
 * cada jugada con su veredicto rápido (GANA / PIERDE / PENDIENTE) según el
 * motor, SIN el balance de dinero. Un botón copia el texto para pegarlo en el
 * grupo apenas termina la carrera, antes de liquidar.
 *
 * Sin pizarra cargada (texto vacío) muestra un aviso en vez de un mensaje roto.
 */
export default function PreliminarResultados({ texto }: { texto: string }) {
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
            <span className="rounded-lg bg-emerald-600 px-3 py-1.5 text-[12px] font-bold text-white border border-emerald-700 shadow-sm">
              🏁 Resultado Preliminar
            </span>
            <span className="text-[11px] text-slate-500">
              {vacio
                ? "Cargá la pizarra (Ctrl+Y) para armar el preliminar de resultados."
                : "Veredicto según la pizarra cargada, sin balance de dinero."}
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