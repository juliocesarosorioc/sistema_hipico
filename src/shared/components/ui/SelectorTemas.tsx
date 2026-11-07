"use client";

import { useEffect, useRef, useState } from "react";
import { useTema } from "@/shared/hooks/useTema";
import { type TipoTema } from "@/shared/lib/temas";

export function SelectorTemas({ compacto = true }: { compacto?: boolean }) {
  const { tema, cambiarTema, infoActual, temasDisponibles } = useTema();
  const [abierto, setAbierto] = useState(false);
  const contenedorRef = useRef<HTMLDivElement>(null);
  const [abrirHaciaIzquierda, setAbrirHaciaIzquierda] = useState(true);

  // Detectar inteligentemente si debe desplegarse hacia la izquierda o hacia la derecha según el borde de la pantalla
  useEffect(() => {
    if (!abierto || !contenedorRef.current) return;
    const rect = contenedorRef.current.getBoundingClientRect();
    // Si la distancia del botón al borde izquierdo de la pantalla es menor a 290px
    // y hay más espacio a la derecha, desplegar hacia la derecha (left-0)
    if (rect.right < 290 && window.innerWidth - rect.left >= 280) {
      setAbrirHaciaIzquierda(false);
    } else {
      setAbrirHaciaIzquierda(true);
    }
  }, [abierto]);

  // Cierre al presionar la tecla Escape
  useEffect(() => {
    const alPresionarEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAbierto(false);
    };
    if (abierto) {
      document.addEventListener("keydown", alPresionarEscape);
    }
    return () => document.removeEventListener("keydown", alPresionarEscape);
  }, [abierto]);

  return (
    <div className="relative inline-block text-left" ref={contenedorRef}>
      {/* Botón Principal Disparador */}
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-label={`Tema visual: ${infoActual.nombre}`}
        title={`Tema actual: ${infoActual.nombre} (${infoActual.subtitulo}). Clic para cambiar tema.`}
        className={`group inline-flex h-9 w-9 items-center justify-center rounded-full border text-base transition-all shadow-xs backdrop-blur-md shrink-0 cursor-pointer ${
          infoActual.esProteccionVisual
            ? "border-amber-600/50 bg-amber-950/40 text-amber-300 hover:bg-amber-900/60"
            : tema === "claro"
            ? "border-slate-300 bg-white/90 text-slate-800 hover:bg-slate-100"
            : "border-slate-700 bg-slate-900/80 text-slate-200 hover:border-slate-500 hover:bg-slate-800"
        }`}
      >
        <span className="text-base leading-none select-none transition-transform group-hover:scale-110">
          {infoActual.emoji}
        </span>
      </button>

      {/* Menú Desplegable con todos los temas */}
      {abierto && (
        <>
          {/* Backdrop click-catcher invisible en desktop y sutil en móvil para cerrar con un clic afuera */}
          <div
            className="fixed inset-0 z-[999] bg-black/30 sm:bg-transparent backdrop-blur-[1px] sm:backdrop-blur-none"
            aria-hidden="true"
            onClick={() => setAbierto(false)}
          />

          <div
            className={`
              fixed sm:absolute z-[1000]
              top-14 sm:top-full
              left-3 right-3 sm:inset-x-auto
              ${abrirHaciaIzquierda ? "sm:right-0 sm:left-auto" : "sm:left-0 sm:right-auto"}
              sm:w-72 sm:max-w-xs
              mt-2 rounded-2xl
              border border-[var(--app-border)] bg-[var(--app-surface)] p-2.5 text-[var(--app-text)]
              shadow-2xl backdrop-blur-xl ring-1 ring-white/10
            `}
            style={{
              maxHeight: "calc(100vh - 4.5rem)",
              overflowY: "auto",
            }}
          >
            <div className="px-2.5 py-1.5 border-b border-[var(--app-border)] flex items-center justify-between">
              <span className="text-[10px] font-black uppercase tracking-wider text-[var(--app-text-muted)]">
                Personalizar Tema
              </span>
              <span className="text-[10px] text-amber-400 font-bold">6 Estilos</span>
            </div>

            <div className="mt-1.5 space-y-1">
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
                    className={`w-full flex items-center gap-2.5 rounded-xl p-2 text-left transition-all cursor-pointer ${
                      seleccionado
                        ? "bg-[var(--app-surface-alt)] text-[var(--app-text)] shadow-xs ring-1 ring-[var(--app-accent)] font-bold"
                        : "text-[var(--app-text-muted)] hover:bg-[var(--app-surface-alt)] hover:text-[var(--app-text)]"
                    }`}
                  >
                    {/* Icono + Paleta */}
                    <div
                      className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border text-sm shadow-xs"
                      style={{
                        backgroundColor: t.colorMuestra,
                        borderColor: t.colorBorde,
                      }}
                    >
                      <span>{t.emoji}</span>
                      <span
                        className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-1 ring-black"
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
                          <span className="rounded bg-amber-500/20 px-1 py-0.2 text-[8px] font-black text-amber-300 border border-amber-500/30">
                            ANTI-FATIGA
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-[9.5px] text-slate-400 leading-tight">
                        {t.descripcion}
                      </p>
                    </div>

                    {/* Check si está activo */}
                    {seleccionado ? (
                      <span className="shrink-0 text-amber-400 font-bold text-sm">
                        ✓
                      </span>
                    ) : (
                      <span className="shrink-0 text-slate-600 text-xs">
                        ○
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="mt-2 pt-2 border-t border-[var(--app-border)] px-2 py-0.5 text-[9px] text-[var(--app-text-muted)] text-center">
              💡 <span className="text-amber-300 font-semibold">Protección Visual</span> reduce la fatiga y halos en pantallas.
            </div>
          </div>
        </>
      )}
    </div>
  );
}
