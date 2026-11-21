"use client";

import { useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

/**
 * Botón / banner para instalar y activar la aplicación web (PWA) en celulares
 * Android (vía `beforeinstallprompt`) y iPhone/iPad (guía rápida de Safari).
 */
export function BotonInstalarPWA({
  variante = "compacto",
}: {
  variante?: "compacto" | "banner-movil";
}) {
  const [eventoInstalacion, setEventoInstalacion] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [esIOS, setEsIOS] = useState(false);
  const [esMovil, setEsMovil] = useState(false);
  const [yaInstalada, setYaInstalada] = useState(false);
  const [mostrarGuiaIOS, setMostrarGuiaIOS] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const enStandalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (enStandalone) {
      setYaInstalada(true);
      return;
    }

    const ua = window.navigator.userAgent || "";
    const ios =
      /iPad|iPhone|iPod/i.test(ua) &&
      !(window as Window & { MSStream?: unknown }).MSStream;
    const movil = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
    setEsIOS(ios);
    setEsMovil(movil);

    const alPrompt = (e: Event) => {
      e.preventDefault();
      setEventoInstalacion(e as BeforeInstallPromptEvent);
    };
    const alInstalada = () => {
      setYaInstalada(true);
      setEventoInstalacion(null);
      setMostrarGuiaIOS(false);
    };

    window.addEventListener("beforeinstallprompt", alPrompt);
    window.addEventListener("appinstalled", alInstalada);
    return () => {
      window.removeEventListener("beforeinstallprompt", alPrompt);
      window.removeEventListener("appinstalled", alInstalada);
    };
  }, []);

  if (yaInstalada) return null;
  if (!eventoInstalacion && !esIOS && !esMovil) return null;

  const manejarClick = async () => {
    if (eventoInstalacion) {
      try {
        await eventoInstalacion.prompt();
        const eleccion = await eventoInstalacion.userChoice;
        if (eleccion.outcome === "accepted") {
          setYaInstalada(true);
          setEventoInstalacion(null);
        }
      } catch {
        // Ignorar si el usuario cancela el prompt nativo
      }
      return;
    }
    setMostrarGuiaIOS(true);
  };

  return (
    <>
      {variante === "banner-movil" ? (
        <div className="md:hidden border-b border-emerald-500/30 bg-emerald-950/70 px-4 py-2 text-xs text-emerald-100 backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-base shrink-0">📲</span>
              <span className="truncate font-semibold">
                Instala la App en tu celular para acceso directo
              </span>
            </div>
            <button
              type="button"
              onClick={manejarClick}
              className="shrink-0 rounded-lg bg-emerald-500 px-3 py-1.5 text-[11px] font-black uppercase tracking-wide text-slate-950 shadow hover:bg-emerald-400 active:scale-95 transition"
            >
              Instalar App
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={manejarClick}
          title="Instalar aplicación web en tu dispositivo"
          className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-2 text-xs font-bold text-emerald-300 hover:bg-emerald-500/25 active:scale-95 transition whitespace-nowrap"
        >
          <span>📲</span>
          <span className="hidden sm:inline">Instalar App</span>
        </button>
      )}

      {mostrarGuiaIOS && (
        <div
          className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onClick={() => setMostrarGuiaIOS(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-slate-700 bg-slate-900 p-5 text-slate-100 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2 mb-3">
              <h3 className="text-sm font-black uppercase tracking-wide text-emerald-400">
                📲 Instalar Sistema Hípico en tu Celular
              </h3>
              <button
                type="button"
                onClick={() => setMostrarGuiaIOS(false)}
                className="rounded-lg px-2 py-1 text-xs text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                ✕
              </button>
            </div>
            {esIOS ? (
              <ol className="space-y-2 text-xs text-slate-300 list-decimal list-inside">
                <li>
                  Pulsa el botón <strong>Compartir</strong> (cuadro con flecha hacia arriba) en la barra de Safari.
                </li>
                <li>
                  Desliza y toca <strong>&ldquo;Añadir a pantalla de inicio&rdquo;</strong>.
                </li>
                <li>
                  Confirma tocando <strong>Añadir</strong> arriba a la derecha.
                </li>
              </ol>
            ) : (
              <ol className="space-y-2 text-xs text-slate-300 list-decimal list-inside">
                <li>
                  Abre el menú del navegador (<strong>⋮</strong> arriba a la derecha en Chrome).
                </li>
                <li>
                  Toca <strong>&ldquo;Instalar aplicación&rdquo;</strong> o <strong>&ldquo;Añadir a pantalla de inicio&rdquo;</strong>.
                </li>
              </ol>
            )}
          </div>
        </div>
      )}
    </>
  );
}
