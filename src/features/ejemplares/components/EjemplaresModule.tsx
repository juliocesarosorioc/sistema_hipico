"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PadronTabla } from "@/features/ejemplares/components/PadronTabla";
import { GacetaIA } from "@/features/ejemplares/components/GacetaIA";
import { CargaPrograma } from "@/features/ejemplares/components/CargaPrograma";
import { CarrerasDiaModule } from "@/features/carreras/components/CarrerasDiaModule";
import { ModalAnalisisActuarialGodet } from "@/features/ejemplares/components/ModalAnalisisActuarialGodet";
import { leerPadron, type EjemplarPadron } from "@/features/gaceta/lib/padron";

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
  const [abrirGodet, setAbrirGodet] = useState(false);
  const [tab, setTab] = useState<TabId>("padron");
  const [padron, setPadron] = useState<EjemplarPadron[]>([]);

  // El botón "Pegar desde Gaceta" de Tablas Fijas llega con ?tab=gaceta y
  // /carreras redirige con ?tab=carreras: ambos son el mismo módulo.
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (ES_TAB(t)) setTab(t);
  }, []);

  // El padrón alimenta la pizarra Godet: sin ejemplares cargados no hay con
  // qué proyectar, y el modal se abriría en blanco.
  const cargarPadron = useCallback(async () => {
    const res = await leerPadron();
    if (res.ok) setPadron(res.data);
  }, []);

  useEffect(() => {
    void cargarPadron();
  }, [cargarPadron]);

  const ejemplaresGodet = useMemo(
    () =>
      padron.map((p, i) => ({
        numero: i + 1,
        nombre: p.nombre,
        stud: p.nacionalidad,
      })),
    [padron]
  );

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-700">
          🐴 Ejemplares, Gaceta y Carreras
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setAbrirGodet(true)}
            disabled={false}
            title={
              ejemplaresGodet.length === 0
                ? "Carga el padrón de ejemplares para poder proyectar."
                : "Abrir la pizarra prospectiva Godet y actuarial."
            }
            className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-amber-500 to-yellow-400 px-3 py-1.5 text-[11px] font-black uppercase tracking-wider text-slate-900 shadow-sm transition-colors hover:from-amber-400 hover:to-yellow-300 disabled:cursor-not-allowed disabled:opacity-40"
          >
            🧭 Análisis Godet
          </button>
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

      {/* Pizarra prospectiva Godet & Actuarial sobre el padrón de ejemplares. */}
      <ModalAnalisisActuarialGodet
        abierto={abrirGodet}
        onCerrar={() => setAbrirGodet(false)}
        ejemplares={ejemplaresGodet}
      />
    </section>
  );
}

export default EjemplaresModule;