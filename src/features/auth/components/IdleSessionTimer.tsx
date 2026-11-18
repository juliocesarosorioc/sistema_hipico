"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { cerrarSesionYRedirigir } from "@/features/auth/lib/sesion";

export const EVENTO_ACTIVIDAD_SALA = "hipico:actividad-sala";

/** Señal explícita de actividad desde acciones de la Sala (además de los eventos DOM). */
export function notificarActividadSala(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(EVENTO_ACTIVIDAD_SALA));
}

interface PropsIdleSessionTimer {
  timeoutMs?: number;
  warningMs?: number;
}

/**
 * Cierre automático por inactividad con cronómetro regresivo en el último minuto.
 * Por defecto: 300.000 ms totales y aviso a los 60.000 ms restantes.
 */
export function IdleSessionTimer({
  timeoutMs = 300000,
  warningMs = 60000,
}: PropsIdleSessionTimer) {
  const pathname = usePathname();
  const [restanteMs, setRestanteMs] = useState(timeoutMs);
  const [mostrarAviso, setMostrarAviso] = useState(false);
  const [cerrando, setCerrando] = useState(false);
  const [montado, setMontado] = useState(false);

  const ultimaActividadRef = useRef<number>(Date.now());
  const avisoRef = useRef<boolean>(false);
  const cerrandoRef = useRef<boolean>(false);

  const esRutaPublica = pathname === "/login" || pathname === "/verificacion";

  useEffect(() => {
    setMontado(true);
    ultimaActividadRef.current = Date.now();
  }, []);

  const reiniciar = useCallback(() => {
    ultimaActividadRef.current = Date.now();
    setRestanteMs(timeoutMs);
    avisoRef.current = false;
    setMostrarAviso(false);
  }, [timeoutMs]);

  const cerrar = useCallback(async () => {
    if (cerrandoRef.current) return;
    cerrandoRef.current = true;
    setCerrando(true);
    await cerrarSesionYRedirigir("inactividad");
  }, []);

  useEffect(() => {
    if (esRutaPublica) return;

    const alInteractuar = () => {
      // Con el modal abierto solo sirve el botón explícito de confirmación.
      if (avisoRef.current) return;
      reiniciar();
    };

    const eventos = [
      "mousedown",
      "keydown",
      "touchstart",
      "scroll",
      EVENTO_ACTIVIDAD_SALA,
    ];
    eventos.forEach((ev) =>
      window.addEventListener(ev, alInteractuar, { passive: true })
    );

    const intervalo = window.setInterval(() => {
      if (cerrandoRef.current) return;
      const restante = Math.max(
        0,
        timeoutMs - (Date.now() - ultimaActividadRef.current)
      );
      setRestanteMs(restante);
      if (restante <= warningMs) {
        if (!avisoRef.current) {
          avisoRef.current = true;
          setMostrarAviso(true);
        }
      }
      if (restante <= 0) void cerrar();
    }, 250);

    return () => {
      eventos.forEach((ev) => window.removeEventListener(ev, alInteractuar));
      window.clearInterval(intervalo);
    };
  }, [cerrar, esRutaPublica, reiniciar, timeoutMs, warningMs]);

  useEffect(() => {
    if (!mostrarAviso) return;
    const alPulsar = (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        reiniciar();
      }
    };
    window.addEventListener("keydown", alPulsar);
    return () => window.removeEventListener("keydown", alPulsar);
  }, [mostrarAviso, reiniciar]);

  if (!montado || esRutaPublica || !mostrarAviso) return null;

  const segundos = Math.ceil(restanteMs / 1000);
  const cronometro = `${String(Math.floor(segundos / 60)).padStart(2, "0")}:${String(
    segundos % 60
  ).padStart(2, "0")}`;

  return createPortal(
    <div
      role="alertdialog"
      aria-modal="true"
      className="fixed inset-0 z-[99999] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center text-slate-900 shadow-2xl">
        <div className="mb-3 text-4xl">⏳</div>
        <h2 className="text-lg font-black tracking-tight text-slate-900">
          Sesión por finalizar
        </h2>
        <p className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-slate-600">
          Por seguridad, tu sesión se cerrará automáticamente por inactividad.
        </p>
        <div
          aria-live="polite"
          className="my-5 font-mono text-5xl font-black tabular-nums text-amber-600"
        >
          {cronometro}
        </div>
        <button
          type="button"
          autoFocus
          disabled={cerrando}
          onClick={reiniciar}
          className="w-full rounded-xl bg-[#008069] px-4 py-3 text-sm font-black text-white hover:bg-[#006d56] disabled:opacity-50"
        >
          Seguir en la Sala
        </button>
      </div>
    </div>,
    document.body
  );
}

export default IdleSessionTimer;
