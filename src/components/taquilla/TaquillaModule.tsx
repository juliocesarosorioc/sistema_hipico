"use client";

import Link from "next/link";
import { useState } from "react";
import { BetSlip } from "@/components/taquilla/BetSlip";
import { ListaTickets } from "@/components/taquilla/ListaTickets";
import { PagarCarreraModal } from "@/components/taquilla/PagarCarreraModal";
import { RelacionCarrera } from "@/components/taquilla/RelacionCarrera";

type Modalidad = "puestos" | "wps" | "remates" | "dupletas";

const MODALIDADES: Array<{ id: Modalidad; label: string }> = [
  { id: "puestos", label: "Puestos" },
  { id: "wps", label: "Win / Place / Show" },
  { id: "remates", label: "Remates" },
  { id: "dupletas", label: "Dupletas" },
];

/** Modalidades que todavía no tienen motor. `dupletas` NO va aquí: el módulo
 *  real ya está migrado en /dupleta y esta pestaña era un resto del legacy. */
const PENDIENTE: Record<Exclude<Modalidad, "puestos" | "dupletas" | "wps">, { titulo: string; texto: string }> = {
  remates: {
    titulo: "Remates",
    texto: "RematesEngine en construcción: pote neto recirculante (Paso 4 del plan de migración).",
  },
};

/**
 * Ayuda de la pestaña W/P/S. Lo que el operador tiene que saber antes de vender:
 * cómo se escribe la jugada y de dónde sale el premio.
 */
function AvisoWps() {
  return (
    <div className="rounded-2xl border border-indigo-100 bg-indigo-50/60 p-4 text-[11px] leading-relaxed text-slate-600">
      <p className="text-sm font-bold uppercase tracking-wide text-indigo-700">Americana W / P / S</p>
      <p className="mt-1.5">
        Registra la jugada con la nomenclatura <b>monto + tipo</b>: <code className="font-mono font-bold">100 W</code>{" "}
        (gana), <code className="font-mono font-bold">100 P</code> (place) o{" "}
        <code className="font-mono font-bold">100 S</code> (show), con el ejemplar en la columna CABALLO.
      </p>
      <p className="mt-1.5">
        El pago depende de <b>las dos cosas a la vez</b> —qué se apostó y en qué puesto llegó— así que se liquida con la{" "}
        <b>matriz de dividendos</b> que la casa carga en «Cargar Resultados». Si esa matriz no está cargada, la jugada
        queda <b>pendiente</b>: nunca se cobra $0 ni se marca como perdida por un dato que falta.
      </p>
      <p className="mt-1.5 italic text-slate-500">
        Comisión de la casa 5% sobre el premio bruto, igual que en el resto de modalidades.
      </p>
    </div>
  );
}

/** Taquilla — módulo contenedor con selector de modalidades. */
export function TaquillaModule() {
  const [modalidad, setModalidad] = useState<Modalidad>("puestos");

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
        <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-700">
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
                  : "bg-surfaceAlt text-slate-500 hover:bg-surfaceAlt/80 hover:text-slate-700"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {modalidad === "puestos" ? (
        <>
          <BetSlip />
          <ListaTickets />
          <RelacionCarrera />
          <PagarCarreraModal />
        </>
      ) : modalidad === "wps" ? (
        <>
          {/* W/P/S comparte TODO el flujo de la taquilla: se registra con la
              nomenclatura "100 W" / "100 P" / "100 S", entra a los mismos
              tickets y se liquida con el mismo Pagar Carrera. Lo único propio
              de la modalidad es la matriz de dividendos, que se carga en el
              paso de resultados. */}
          <AvisoWps />
          <BetSlip />
          <ListaTickets />
          <RelacionCarrera />
          <PagarCarreraModal />
        </>
      ) : modalidad === "dupletas" ? (
        <div className="rounded-2xl border border-line bg-surface p-8 text-center">
          <p className="text-sm font-bold text-slate-700">Dupletas</p>
          <p className="mx-auto mt-2 max-w-md text-[11px] leading-relaxed text-slate-500">
            El módulo de Dupletas ya está migrado y vive en su propia pantalla (armado de la cartela,
            fecha y selección de hipódromo).
          </p>
          <Link
            href="/dupleta"
            className="mt-4 inline-block rounded-lg bg-primary-600 px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-white transition-colors hover:bg-primary-700"
          >
            Abrir Dupletas
          </Link>
        </div>
      ) : (
        <div className="rounded-2xl border border-line bg-surface p-8 text-center">
          <p className="text-sm font-bold text-slate-700">{PENDIENTE[modalidad].titulo}</p>
          <p className="mx-auto mt-2 max-w-md text-[11px] leading-relaxed text-slate-500">
            {PENDIENTE[modalidad].texto}
          </p>
          <button
            type="button"
            onClick={() => setModalidad("puestos")}
            className="mt-4 text-[11px] font-bold text-primary-600 hover:text-primary-700"
          >
            ← Volver a Puestos
          </button>
        </div>
      )}
    </section>
  );
}

export default TaquillaModule;