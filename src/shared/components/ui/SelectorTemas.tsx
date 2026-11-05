"use client";

import { useEffect, useRef, useState } from "react";
import { useTema } from "@/shared/hooks/useTema";
import { type TipoTema } from "@/shared/lib/temas";

export function SelectorTemas({ compacto = false }: { compacto?: boolean }) {
  const { tema, cambiarTema, infoActual, temasDisponibles } = useTema();
  const [abierto, setAbierto] = useState(false);
  const contenedorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const alHacerClicFuera = (e: MouseEvent) => {
      if (contenedorRef.current && !contenedorRef.current.contains(e.target as Node)) {
        setAbierto(false);
      }
    };
    if (abierto) {
      document.addEventListener("mousedown", alHacerClicFuera);
    }
    return () => document.removeEventListener("mousedown", alHacerClicFuera);
  }, [abierto]);

  return (
    <div className="relative inline-block text-left" ref={contenedorRef}>
      {/* Botón Principal Disparador */}
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        title={`Tema actual: ${infoActual.nombre} (${infoActual.subtitulo}). Clic para cambiar tema.`}
        className={`group inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold transition-all shadow-xs backdrop-blur-md ${
          infoActual.esProteccionVisual
            ? "border-amber-600/50 bg-amber-950/40 text-amber-300 hover:bg-amber-900/60"
            : tema === "claro"
            ? "border-slate-300 bg-white/90 text-slate-800 hover:bg-slate-100"
            : "border-slate-700 bg-slate-900/80 text-slate-200 hover:border-slate-500 hover:bg-slate-800"
        }`}
      >
        <span
          className="h-2.5 w-2.5 rounded-full ring-2 ring-white/20 transition-transform group-hover:scale-110"
          style={{ backgroundColor: infoActual.colorAcento }}
        />
        <span className="text-sm">{infoActual.emoji}</span>
        {!compacto && (
          <span className="hidden sm:inline font-semibold tracking-wide">
            {infoActual.nombre}
          </span>
        )}
        <svg
          className={`h-3 w-3 text-slate-400 transition-transform duration-200 ${abierto ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Menú Desplegable con todos los temas */}
      {abierto && (
        <div className="absolute right-0 mt-2 w-72 origin-top-right rounded-2xl border border-slate-700/80 bg-slate-950/95 p-2 shadow-2xl backdrop-blur-xl ring-1 ring-black/50 z-[100] animate-fadeIn">
          <div className="px-3 py-2 border-b border-slate-800/80 flex items-center justify-between">
            <span className="text-[11px] font-black uppercase tracking-wider text-slate-400">
              Personalizar Tema Visual
            </span>
            <span className="text-[10px] text-amber-400 font-bold">6 Estilos</span>
          </div>

          <div className="mt-1 space-y-1">
            {temasDisponibles.map((t) => {
              const seleccionado = t.id === tema;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    cambiarTema(t.id as TipoTema);
                    setAbierto(false);
                  }}
                  className={`w-full flex items-center gap-3 rounded-xl p-2.5 text-left transition-all ${
                    seleccionado
                      ? "bg-slate-800/90 text-white shadow-xs ring-1 ring-white/10"
                      : "text-slate-300 hover:bg-slate-900 hover:text-white"
                  }`}
                >
                  {/* Icono + Paleta */}
                  <div
                    className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border text-base shadow-xs"
                    style={{
                      backgroundColor: t.colorMuestra,
                      borderColor: t.colorBorde,
                    }}
                  >
                    <span>{t.emoji}</span>
                    <span
                      className="absolute -bottom-1 -right-1 h-3 w-3 rounded-full ring-1 ring-black"
                      style={{ backgroundColor: t.colorAcento }}
                    />
                  </div>

                  {/* Textos */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-xs leading-none">
                        {t.nombre}
                      </span>
                      {t.esProteccionVisual && (
                        <span className="rounded bg-amber-500/20 px-1 py-0.2 text-[9px] font-black text-amber-300 border border-amber-500/30">
                          ANTI-FATIGA
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-[10px] text-slate-400 leading-tight truncate">
                      {t.descripcion}
                    </p>
                  </div>

                  {/* Check si está activo */}
                  {seleccionado && (
                    <span className="shrink-0 text-amber-400 font-bold text-sm">
                      ✓
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="mt-2 pt-2 border-t border-slate-800/80 px-2 py-1 text-[10px] text-slate-400 text-center">
            💡 <span className="text-amber-300">Protección Visual</span> reduce la dispersión de luz y halos en pantallas para usuarios con astigmatismo.
          </div>
        </div>
      )}
    </div>
  );
}
