"use client";

import { useState } from "react";
import { PadronTabla } from "@/components/ejemplares/PadronTabla";
import { GacetaIA } from "@/components/ejemplares/GacetaIA";

const TABS = [
  { id: "padron", label: "📖 Registro de Ejemplares" },
  { id: "gaceta", label: "📰 Carga de Gaceta (IA)" },
];

export function EjemplaresModule() {
  const [tab, setTab] = useState<"padron" | "gaceta">("padron");

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-700">
          🐴 Ejemplares y Gaceta
        </div>
        <div className="flex items-center gap-2">
          <div className="flex overflow-hidden rounded-lg border border-line bg-surface">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id as "padron" | "gaceta")}
                className={`px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider transition-colors ${
                  tab === t.id ? "bg-primary-600 text-white" : "bg-surface text-slate-500 hover:text-slate-700"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {tab === "padron" ? <PadronTabla /> : <GacetaIA />}
    </section>
  );
}

export default EjemplaresModule;