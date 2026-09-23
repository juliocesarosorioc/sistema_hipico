"use client";

import { useState } from "react";

/**
 * Barra superior limpia de la SPA (Organismo del layout raíz).
 * Solo notificaciones + cierre de sesión: la navegación vive en el Sidebar izquierdo.
 */
export function Topbar() {
  const [abierto, setAbierto] = useState(false);

  const cerrarSesion = () => {
    try {
      localStorage.removeItem("club_sesion_activa");
    } catch {
      /* sinop */
    }
    window.location.assign("/");
  };

  return (
    <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center justify-end gap-2 border-b border-line bg-surface/90 px-4 backdrop-blur">
      {/* Campana de novedades (auditoría — se cablea a Supabase en fases siguientes) */}
      <div className="relative">
        <button
          type="button"
          aria-label="Novedades del sistema"
          aria-expanded={abierto}
          onClick={() => setAbierto((v) => !v)}
          title="Novedades del sistema"
          className="grid h-9 w-9 place-items-center rounded-full border border-line bg-surface hover:bg-surfaceAlt transition-colors"
        >
          <span className="text-base leading-none">🔔</span>
          <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-red-500" />
        </button>
        {abierto && (
          <div className="absolute right-0 top-11 w-80 overflow-hidden rounded-2xl border border-line bg-white shadow-2xl">
            <div className="bg-slate-800 px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-white">
              <span>🔔 Novedades</span>
            </div>
            <div className="max-h-72 overflow-y-auto p-4 text-center text-[11px] italic text-slate-500">
              Sin actividad reciente por ahora.
            </div>
            <div className="border-t border-line bg-gray-50 px-4 py-2 text-[10px] text-slate-500">
              Actividad reciente del sistema (auditoría)
            </div>
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={cerrarSesion}
        className="inline-flex items-center gap-1.5 rounded-lg border border-danger-500/40 bg-danger-500/10 px-3 py-1.5 text-xs font-bold text-danger-600 transition-colors hover:bg-danger-500 hover:text-white"
      >
        <span>⏻</span>
        <span>Cerrar Sesión</span>
      </button>
    </header>
  );
}

export default Topbar;