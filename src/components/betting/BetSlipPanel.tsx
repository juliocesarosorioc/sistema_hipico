"use client";

import { useBetSlipStore } from "@/store/bet-slip";

const COP = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
});

/** Boleto de Apuestas — panel lateral persistente (layout raíz). */
export function BetSlipPanel() {
  const entries = useBetSlipStore((s) => s.entries);
  const total = entries.reduce((a, e) => a + e.total, 0);

  return (
    <aside
      aria-label="Boleto de apuestas"
      className="hidden h-full w-80 shrink-0 flex-col border-l border-slate-800 bg-slate-950/95 md:flex"
    >
      <header className="flex items-center justify-between border-b border-slate-800 px-3 py-2">
        <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
          Boleto
        </span>
        <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-bold text-blue-400">
          {entries.length}
        </span>
      </header>

      {entries.length === 0 ? (
        <p className="px-3 py-8 text-center text-[11px] text-slate-500">
          Boleto vacío.
          <br />
          Toca una cuota para agregar una jugada.
        </p>
      ) : (
        <>
          <ul className="flex-1 space-y-1 overflow-y-auto p-2">
            {entries.map((e) => (
              <li
                key={e.id}
                className="rounded-lg border border-slate-800 bg-slate-900/70 p-2 text-[11px]"
              >
                <p className="font-bold text-slate-200">
                  C{e.carrera} · {e.tipo_jugada}
                </p>
                <p className="text-slate-400">{e.caballo}</p>
                <p className="mt-1 font-bold text-emerald-400">{COP.format(e.total)}</p>
              </li>
            ))}
          </ul>
          <footer className="flex items-center justify-between border-t border-slate-800 px-3 py-2">
            <span className="text-[10px] font-semibold text-slate-500">Total</span>
            <span className="text-sm font-extrabold text-emerald-400">{COP.format(total)}</span>
          </footer>
        </>
      )}
    </aside>
  );
}

export default BetSlipPanel;
