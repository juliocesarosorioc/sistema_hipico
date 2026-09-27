"use client";

import { useEffect, useState } from "react";
import { PadronTabla } from "@/components/ejemplares/PadronTabla";
import { GacetaIA } from "@/components/ejemplares/GacetaIA";
import { CargaPrograma } from "@/components/ejemplares/CargaPrograma";
import { CarrerasDiaModule } from "@/components/carreras/CarrerasDiaModule";

type TabId = "padron" | "gaceta" | "programa" | "carreras";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "padron", label: "📖 Registro de Ejemplares" },
  { id: "gaceta", label: "📰 Carga de Gaceta (IA)" },
  { id: "programa", label: "📅 Carga de Programa" },
  { id: "carreras", label: "🏁 Carreras del Día" },
];

const ES_TAB = (v: string | null): v is TabId =>
  v === "padron" || v === "gaceta" || v === "programa" || v === "carreras";

export function EjemplaresModule() {
  const [tab, setTab] = useState<TabId>("padron");

  // El botón "Pegar desde Gaceta" de Tablas Fijas llega con ?tab=gaceta y
  // /carreras redirige con ?tab=carreras: ambos son el mismo módulo.
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (ES_TAB(t)) setTab(t);
  }, []);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-700">
          🐴 Ejemplares, Gaceta y Carreras
        </div>
        <div className="flex overflow-x-auto rounded-lg border border-line bg-surface">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider transition-colors ${
                tab === t.id ? "bg-primary-600 text-white" : "bg-surface text-slate-500 hover:text-slate-700"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === "padron" ? (
        <PadronTabla />
      ) : tab === "gaceta" ? (
        <GacetaIA />
      ) : tab === "programa" ? (
        <CargaPrograma />
      ) : (
        <CarrerasDiaModule />
      )}
    </section>
  );
}

export default EjemplaresModule;