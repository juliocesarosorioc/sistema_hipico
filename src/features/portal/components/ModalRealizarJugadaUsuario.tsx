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
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-3 sm:p-5 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCerrar();
      }}
    >
      <div className="my-auto w-full max-w-5xl rounded-2xl bg-slate-100 shadow-2xl overflow-hidden border border-slate-300 max-h-[92vh] flex flex-col">
        <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-900 px-5 py-3.5 text-white shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-lg">🐎</span>
            <div>
              <h2 className="text-sm font-black uppercase tracking-wider">
                Registrar Jugada en Línea · Portal de Clientes
              </h2>
              <p className="text-[11px] text-slate-300">
                Marcas (múltiplo de 6) · Tablas Fijas (por caballo) · Puestos · Remates · Dupletas · Pollas
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
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

        <div className="p-4 overflow-y-auto flex-1">
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
