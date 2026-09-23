"use client";

import { useTaquillaStore } from "@/store/useTaquillaStore";
import { Button } from "@/components/ui/Button";

const COP = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
});

/** Historial de la sesión — tickets registrados por el operador. */
export function ListaTickets() {
  const tickets = useTaquillaStore((s) => s.tickets);
  const eliminarTicket = useTaquillaStore((s) => s.eliminarTicket);
  const limpiarTickets = useTaquillaStore((s) => s.limpiarTickets);

  const totalInvertido = tickets.reduce((a, t) => a + t.monto, 0);

  return (
    <div className="rounded-2xl border border-line bg-surface">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-600">
          🧾 Tickets de la Sesión ({tickets.length})
        </h3>
        {tickets.length > 0 && (
          <Button variant="ghost" size="sm" onClick={limpiarTickets}>
            Vaciar
          </Button>
        )}
      </div>

      {tickets.length === 0 ? (
        <div className="px-4 py-8 text-center text-[11px] italic text-slate-500">
          Sin tickets registrados aún. Tipea una jugada válida arriba y presiona Registrar Apuesta.
        </div>
      ) : (
        <ul className="divide-y divide-line">
          {tickets
            .slice()
            .sort((a, b) => b.addedAt - a.addedAt)
            .map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid h-7 w-10 shrink-0 place-items-center rounded-md bg-surfaceAlt text-[10px] font-black text-slate-500">
                    #{t.id}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-mono text-[12px] font-bold text-slate-700">{t.comando}</p>
                    <p className="text-[10px] text-slate-500">
                      Gana {COP.format(t.gananciaProyectada)} · casa {COP.format(t.comision)}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-sm font-extrabold text-success-500">{COP.format(t.monto)}</span>
                  <button
                    type="button"
                    onClick={() => eliminarTicket(t.id)}
                    aria-label={`Eliminar ticket ${t.comando}`}
                    className="grid h-7 w-7 place-items-center rounded-lg border border-danger-500/40 bg-danger-500/10 text-[11px] font-bold text-danger-500 transition-colors hover:bg-danger-500 hover:text-white"
                    title="Eliminar ticket (por si te equivocaste al tipear)"
                  >
                    ✕
                  </button>
                </div>
              </li>
            ))}
        </ul>
      )}

      {tickets.length > 0 && (
        <div className="flex items-center justify-between border-t border-line bg-surfaceAlt/40 px-4 py-2.5 rounded-b-2xl">
          <span className="text-[11px] font-semibold text-slate-500">Total invertido</span>
          <span className="text-sm font-extrabold text-success-500">{COP.format(totalInvertido)}</span>
        </div>
      )}
    </div>
  );
}

export default ListaTickets;