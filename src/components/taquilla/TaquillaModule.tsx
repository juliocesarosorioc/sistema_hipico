"use client";

import { useState } from "react";
import { BetSlip } from "@/components/taquilla/BetSlip";

type Modalidad = "puestos" | "wps" | "remates" | "dupletas";

const MODALIDADES: Array<{ id: Modalidad; label: string }> = [
  { id: "puestos", label: "Puestos" },
  { id: "wps", label: "Win / Place / Show" },
  { id: "remates", label: "Remates" },
  { id: "dupletas", label: "Dupletas" },
];

const PENDIENTE: Record<Exclude<Modalidad, "puestos">, { titulo: string; texto: string }> = {
  wps: {
    titulo: "Win / Place / Show",
    texto: "Ganador, Place y Show liquidan contra dividendos oficiales de la carrera (Fase siguiente del plan).",
  },
  remates: {
    titulo: "Remates",
    texto: "RematesEngine en construcción: pote neto recirculante (Paso 4 del plan de migración).",
  },
  dupletas: {
    titulo: "Dupletas",
    texto: "DupletasEngine en construcción: acertar el 1er lugar en 2 carreras consecutivas (Paso 4 del plan).",
  },
};

/** Taquilla — módulo contenedor con selector de modalidades. */
export function TaquillaModule() {
  const [modalidad, setModalidad] = useState<Modalidad>("puestos");

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
        <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-200">
          🎟️ Taquilla
        </div>

        <div className="flex flex-wrap gap-1.5 border-b border-line pb-3">
          {MODALIDADES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setModalidad(m.id)}
              aria-pressed={modalidad === m.id}
              className={`rounded-lg px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide transition-colors ${
                modalidad === m.id
                  ? "bg-primary-600 text-white"
                  : "bg-surfaceAlt text-slate-400 hover:bg-surfaceAlt/80 hover:text-slate-200"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {modalidad === "puestos" ? (
        <BetSlip />
      ) : (
        <div className="rounded-2xl border border-line bg-surface p-8 text-center">
          <p className="text-sm font-bold text-slate-300">{PENDIENTE[modalidad].titulo}</p>
          <p className="mx-auto mt-2 max-w-md text-[11px] leading-relaxed text-slate-500">
            {PENDIENTE[modalidad].texto}
          </p>
          <button
            type="button"
            onClick={() => setModalidad("puestos")}
            className="mt-4 text-[11px] font-bold text-primary-400 hover:text-primary-300"
          >
            ← Volver a Puestos
          </button>
        </div>
      )}
    </section>
  );
}

export default TaquillaModule;