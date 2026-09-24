"use client";

import { useBetSlipStore } from "@/store/bet-slip";

const COP = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
});

/** Boleto de Apuestas — panel lateral persistente (layout raíz), colapsable. */
export function BetSlipPanel() {
  const entries = useBetSlipStore((s) => s.entries);
  const isOpen = useBetSlipStore((s) => s.isOpen);
  const setOpen = useBetSlipStore((s) => s.setOpen);
  const total = entries.reduce((a, e) => a + e.total, 0);

  return (
    <aside
      aria-label="Boleto de apuestas"
      className={`hidden h-full shrink-0 flex-col overflow-hidden border-l border-slate-800 bg-slate-950/95 transition-[width] duration-300 ease-in-out md:flex ${
        isOpen ? "w-80" : "w-10"
      }`}
    >
      {isOpen ? (
        <>
          <header className="flex shrink-0 items-center gap-2 border-b border-slate-800 px-3 py-2">
            <span className="flex-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">
              Boleto
            </span>
            <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-bold text-blue-400">
              {entries.length}
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              title="Ocultar boleto"
              aria-label="Ocultar boleto"
              className="grid h-6 w-6 place-items-center rounded-md border border-slate-800 bg-slate-900/70 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-100"
            >
              <span className="text-sm leading-none">›</span>
            </button>
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
              <footer className="flex shrink-0 items-center justify-between border-t border-slate-800 px-3 py-2">
                <span className="text-[10px] font-semibold text-slate-500">Total</span>
                <span className="text-sm font-extrabold text-emerald-400">
                  {COP.format(total)}
                </span>
              </footer>
            </>
          )}
        </>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          title="Mostrar boleto"
          aria-label="Mostrar boleto"
          className="flex h-full w-full flex-col items-center gap-2 overflow-hidden py-3 text-slate-400 transition-colors hover:text-slate-100"
        >
          <span
            className="mt-1 text-sm font-bold uppercase tracking-widest text-slate-500"
            style={{ writingMode: "vertical-rl" }}
          >
            Boleto
          </span>
          <span className="rounded-full bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-bold text-blue-400">
            {entries.length}
          </span>
          <span className="text-sm leading-none">‹</span>
        </button>
      )}
    </aside>
  );
}

export default BetSlipPanel;
