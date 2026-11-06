"use client";

/**
 * MODAL 🐎 REALIZAR JUGADA — PORTAL DEL USUARIO
 * ==============================================
 * Presenta en modal las 6 modalidades oficiales del Portal de Clientes
 * (`SeccionJugadasPortal`: Marcas en múltiplo de 6, Tablas Fijas por caballo,
 * Puestos, Remates, Dupletas y Pollas) respetando el control de bloqueo/desbloqueo
 * del Administrador y permitiendo solicitar el desbloqueo cuando corresponda.
 */

import { SeccionJugadasPortal } from "@/features/portal/components/SeccionJugadasPortal";
import type { SesionPortal } from "@/features/portal/lib/portal";

type Props = {
  sesion: SesionPortal;
  onCerrar: () => void;
  onRealizada: () => void;
  /**
   * Se mantiene por compatibilidad con el llamador, pero el botón "Reportar
   * jugada no relacionada" ya no se muestra acá: el portal tiene su propia
   * entrada en el menú lateral.
   */
  onPedirNoRelacionada?: () => void;
};

export function ModalRealizarJugadaUsuario({
  sesion,
  onCerrar,
  onRealizada,
}: Props) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-center overflow-y-auto bg-slate-950/70 p-0 sm:items-center sm:p-5"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCerrar();
      }}
    >
      <div className="flex h-[100dvh] w-full max-w-5xl flex-col overflow-hidden border border-slate-300 bg-slate-100 shadow-2xl sm:my-auto sm:h-auto sm:max-h-[92vh] sm:rounded-2xl">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 bg-slate-900 px-3 py-2 text-white sm:px-5 sm:py-3.5">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="text-lg">🐎</span>
            <div className="min-w-0">
              <h2 className="truncate text-xs font-black uppercase tracking-wider sm:text-sm">
                Registrar Jugada en Línea · Portal de Clientes
              </h2>
              <p className="hidden truncate text-[11px] text-slate-300 sm:block">
                Marcas (múltiplo de 6) · Tablas Fijas (por caballo) · Puestos · Remates · Dupletas · Pollas
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={onCerrar}
              className="rounded-lg bg-white/10 hover:bg-white/20 px-2.5 py-1 text-xs font-bold text-white"
              aria-label="Cerrar"
            >
              ✕ Cerrar
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2 sm:p-4">
          <SeccionJugadasPortal
            sesion={sesion}
            onJugadaRealizada={() => {
              onRealizada();
            }}
          />
        </div>
      </div>
    </div>
  );
}
