"use client";

import type { ReactNode } from "react";

type Props = {
  titulo: string;
  icono: string;
  contador?: number;
  abierto: boolean;
  onToggle: () => void;
  children: ReactNode;
  /** Acción extra alineada a la derecha del encabezado (ej. botón verde Imprimir). */
  accion?: ReactNode;
};

/** Bloque desplegable idéntico a las <section> del legacy (header bg-slate-900 + chevron). */
export function SeccionPliegue({ titulo, icono, contador, abierto, onToggle, children, accion }: Props) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-stretch">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={abierto}
          className="flex min-w-0 flex-1 items-center justify-between bg-slate-900 p-3.5 text-sm font-bold uppercase tracking-wider text-white transition-colors hover:bg-slate-800"
        >
          <span className="flex min-w-0 items-center">
            <span className="mr-2">{icono}</span>
            <span className="truncate">{titulo}</span>
            {typeof contador === "number" && (
              <span className="ml-2 rounded-full bg-slate-700 px-2 py-0.5 text-xs font-black">{contador}</span>
            )}
          </span>
          <span className={`ml-2 shrink-0 transition-transform ${abierto ? "rotate-180" : ""}`}>▼</span>
        </button>
        {accion}
      </div>
      {abierto && <div>{children}</div>}
    </section>
  );
}

export default SeccionPliegue;