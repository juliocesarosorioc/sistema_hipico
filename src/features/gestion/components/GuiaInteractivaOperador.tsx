"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { PASOS_TOUR_OPERADOR, type PasoTourOperador } from "@/features/gestion/lib/tour-operador-config";
import { Button } from "@/shared/components/ui/Button";

type Props = {
  abierto: boolean;
  onCerrar: () => void;
  nombreOperador?: string;
};

interface BoundingBox {
  top: number;
  left: number;
  width: number;
  height: number;
}

export function GuiaInteractivaOperador({ abierto, onCerrar, nombreOperador }: Props) {
  const [pasoIndex, setPasoIndex] = useState(0);
  const [targetBox, setTargetBox] = useState<BoundingBox | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const paso: PasoTourOperador = PASOS_TOUR_OPERADOR[pasoIndex] || PASOS_TOUR_OPERADOR[0];
  const total = PASOS_TOUR_OPERADOR.length;
  const pct = Math.round(((pasoIndex + 1) / total) * 100);

  // Calcula la posición y dimensiones del elemento enfocado
  const actualizarPosicionSpotlight = useCallback(() => {
    if (!paso.selector) {
      setTargetBox(null);
      return;
    }
    const el = document.querySelector(paso.selector) as HTMLElement | null;
    if (el) {
      const rect = el.getBoundingClientRect();
      // Pequeño margen alrededor del elemento para que respire
      const padding = 6;
      setTargetBox({
        top: Math.max(0, rect.top - padding),
        left: Math.max(0, rect.left - padding),
        width: rect.width + padding * 2,
        height: rect.height + padding * 2,
      });
    } else {
      setTargetBox(null);
    }
  }, [paso.selector]);

  // Al cambiar de paso, hace scroll suave hacia el elemento y recalcula spotlight
  useEffect(() => {
    if (!abierto) return;

    if (paso.selector) {
      const el = document.querySelector(paso.selector) as HTMLElement | null;
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
      }
    }

    const timer = setTimeout(() => {
      actualizarPosicionSpotlight();
    }, 250);

    const onScrollResize = () => {
      actualizarPosicionSpotlight();
    };

    window.addEventListener("scroll", onScrollResize, { passive: true });
    window.addEventListener("resize", onScrollResize);

    return () => {
      clearTimeout(timer);
      window.removeEventListener("scroll", onScrollResize);
      window.removeEventListener("resize", onScrollResize);
    };
  }, [abierto, pasoIndex, paso.selector, actualizarPosicionSpotlight]);

  // Atajos de teclado: Flechas para avanzar/retroceder, Esc para salir
  useEffect(() => {
    if (!abierto) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCerrar();
      } else if (e.key === "ArrowRight") {
        avanzar();
      } else if (e.key === "ArrowLeft") {
        retroceder();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [abierto, pasoIndex, total]);

  if (!abierto) return null;

  const avanzar = () => {
    if (pasoIndex < total - 1) {
      setPasoIndex((i) => i + 1);
    } else {
      onCerrar();
    }
  };

  const retroceder = () => {
    if (pasoIndex > 0) {
      setPasoIndex((i) => i - 1);
    }
  };

  // Determinar posición sugerida de la tarjeta flotante
  const tarjetaEnTop = targetBox && targetBox.top > window.innerHeight / 2;

  return (
    <div className="fixed inset-0 z-[120] overflow-hidden select-none">
      {/* ── OVERLAY OSCURO CON EFECTO SPOTLIGHT ── */}
      {targetBox ? (
        /* Spotlight dinámico sobre el elemento enfocado */
        <div
          className="fixed pointer-events-none transition-all duration-300 ease-out rounded-2xl border-2 border-amber-400 ring-4 ring-amber-400/60"
          style={{
            top: `${targetBox.top}px`,
            left: `${targetBox.left}px`,
            width: `${targetBox.width}px`,
            height: `${targetBox.height}px`,
            // La sombra gigante oscurece absolutamente todo el resto de la pantalla excepto esta ventana
            boxShadow: "0 0 0 9999px rgba(2, 6, 23, 0.88), 0 0 45px rgba(251, 191, 36, 0.65)",
          }}
        >
          {/* Marcador pulsante en la esquina del elemento destacado */}
          <span className="absolute -top-3 -right-3 flex h-7 w-7 items-center justify-center rounded-full bg-amber-400 text-slate-950 font-black text-xs shadow-lg animate-bounce">
            {paso.num}
          </span>
        </div>
      ) : (
        /* Fondo oscuro completo si el elemento no se encuentra o no tiene selector */
        <div className="fixed inset-0 bg-slate-950/88 backdrop-blur-xs transition-opacity duration-300 pointer-events-auto" />
      )}

      {/* ── TARJETA EXPLICATIVA FLOTANTE E INTERACTIVA ── */}
      <div
        className="fixed inset-x-0 bottom-3 sm:bottom-6 z-[130] flex justify-center px-3 sm:px-6 pointer-events-none"
        style={{
          top: tarjetaEnTop ? "1rem" : undefined,
          bottom: tarjetaEnTop ? undefined : "1rem",
        }}
      >
        <div
          ref={cardRef}
          className="pointer-events-auto w-full max-w-2xl rounded-3xl border border-slate-700 bg-slate-900/95 text-white shadow-2xl backdrop-blur-md overflow-hidden flex flex-col transition-all duration-200 animate-in fade-in zoom-in-95 max-h-[85vh]"
        >
          {/* Barra superior de progreso y control */}
          <div className="bg-slate-950 px-4 py-3 sm:px-6 sm:py-3.5 border-b border-slate-800 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-600/30 text-indigo-400 font-black text-base border border-indigo-500/30">
                {paso.icono}
              </span>
              <div>
                <span className="inline-block rounded-md bg-amber-400/20 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-amber-300 border border-amber-400/30">
                  {paso.badge} · {pasoIndex + 1} de {total}
                </span>
                <p className="text-xs font-bold text-slate-300 hidden sm:block">
                  Guía Operativa del Sistema Hípico
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-[11px] font-mono text-slate-400 font-bold hidden sm:inline">
                {pct}%
              </span>
              <button
                type="button"
                onClick={onCerrar}
                title="Cerrar Guía (Esc)"
                className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white transition"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Barra de progreso visual */}
          <div className="h-1 w-full bg-slate-800">
            <div
              className="h-full bg-gradient-to-r from-indigo-500 via-amber-400 to-emerald-400 transition-all duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>

          {/* Cuerpo informativo con scroll interno seguro */}
          <div className="p-4 sm:p-5 overflow-y-auto space-y-3.5">
            <div>
              <h3 className="text-base sm:text-lg font-black tracking-tight text-white flex items-center gap-2">
                <span>{paso.titulo}</span>
              </h3>
              <p className="text-xs font-semibold text-slate-300 mt-0.5">
                {paso.subtitulo}
              </p>
            </div>

            {/* Puntos explicativos */}
            <div className="space-y-1.5 rounded-2xl bg-slate-950/60 p-3 sm:p-3.5 border border-slate-800/80 text-xs sm:text-[13px] leading-relaxed text-slate-200">
              {paso.explicacion.map((p, idx) => (
                <p key={idx} className="flex items-start gap-2">
                  <span className="text-amber-400 font-bold shrink-0">•</span>
                  <span>{p}</span>
                </p>
              ))}
            </div>

            {/* Acciones paso a paso */}
            <div className="rounded-2xl bg-indigo-950/40 p-3 sm:p-3.5 border border-indigo-800/40 text-xs">
              <span className="font-black text-indigo-300 uppercase tracking-wide flex items-center gap-1.5 mb-1.5">
                <span>📋</span> ¿Qué hacer en esta sección?
              </span>
              <ul className="space-y-1 text-slate-300">
                {paso.acciones.map((acc, idx) => (
                  <li key={idx} className="flex items-start gap-1.5">
                    <span className="text-indigo-400 font-bold">{idx + 1}.</span>
                    <span>{acc}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Tip profesional */}
            <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-2.5 sm:p-3 flex items-start gap-2 text-xs text-amber-200">
              <span className="text-amber-400 text-sm shrink-0">💡</span>
              <div>
                <b className="text-amber-300">Tip de Taquilla:</b> {paso.tip}
              </div>
            </div>
          </div>

          {/* Barra de navegación inferior */}
          <div className="bg-slate-950 px-4 py-3 sm:px-6 sm:py-3 border-t border-slate-800 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={onCerrar}
              className="text-xs font-bold text-slate-400 hover:text-slate-200 px-2 py-1 transition"
            >
              Salir de la Guía
            </button>

            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={retroceder}
                disabled={pasoIndex === 0}
                className="text-xs border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700 disabled:opacity-30"
              >
                ◀ Anterior
              </Button>

              <Button
                size="sm"
                onClick={avanzar}
                className="text-xs font-black bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 hover:from-amber-400 hover:to-amber-500 shadow-md"
              >
                {pasoIndex === total - 1 ? "✅ Finalizar Recorrido" : "Siguiente ▶"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default GuiaInteractivaOperador;
