"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BetSlip } from "@/features/taquilla/components/BetSlip";
import { BarraCarrerasLiquidadas } from "@/features/gestion/components/BarraCarrerasLiquidadas";
import { PagarCarreraModal } from "@/features/taquilla/components/PagarCarreraModal";
import { RelacionCarrera } from "@/features/taquilla/components/RelacionCarrera";
import { ToggleModalidadTiempo } from "@/features/jugadas/components/ToggleModalidadTiempo";
import { useTaquillaStore } from "@/shared/store/useTaquillaStore";
import { WPS_PLANIFICACION, CLASE_WPS_BLOQUEADA } from "@/features/motores/lib/wps-planificacion";

type Modalidad = "puestos" | "wps" | "remates" | "dupletas";

const MODALIDADES: Array<{ id: Modalidad; label: string }> = [
  { id: "puestos", label: "Puestos" },
  { id: "wps", label: "Win / Place / Show" },
  { id: "remates", label: "Remates" },
  { id: "dupletas", label: "Dupletas" },
];

/**
 * Modalidades que todavía no tienen motor. `dupletas` NO va aquí: el módulo
 * real ya está migrado en /dupleta y esta pestaña era un resto del legacy.
 *
 * `wps` ENTRA acá (PROMPT #4): W.P.S. está 🚧 en planificación y se inactiva
 * para todos los usuarios. La pestaña queda bloqueada abajo; y si igual alguien
 * llega con el enlace viejo `?modalidad=wps`, este panel explica el estado en
 * vez de dejar la carga de jugadas americana operando.
 */
const PENDIENTE: Record<Exclude<Modalidad, "puestos" | "dupletas">, { titulo: string; texto: string }> = {
  remates: {
    titulo: "Remates",
    texto: "RematesEngine en construcción: pote neto recirculante (Paso 4 del plan de migración).",
  },
  wps: {
    titulo: "W.P.S. — Win / Place / Show",
    texto: `${WPS_PLANIFICACION}. Esta modalidad todavía no está habilitada para los usuarios: usá Puestos para tus jugadas de la carrera.`,
  },
};

/** Taquilla — módulo contenedor con selector de modalidades. */
export function TaquillaModule() {
  const [modalidad, setModalidad] = useState<Modalidad>("puestos");
  // Modalidad de TIEMPO (⚡ En Vivo / ⏳ Adelantada) compartida con BetSlip, que
  // es el que realmente registra la jugada: ambos pintan el mismo control y
  // ven el mismo estado.
  const modalidadTiempo = useTaquillaStore((s) => s.modalidadTiempo);
  const setModalidadTiempo = useTaquillaStore((s) => s.setModalidadTiempo);

  // La modalidad se puede preseleccionar por query (?modalidad=wps): era el
  // enlace del menú lateral. Con W.P.S. en planificación, ese enlace ya no
  // existe en el menú y, si alguien igual llega con el link viejo, cae al panel
  // 🚧 de PENDIENTE en vez de a la carga de jugadas.
  useEffect(() => {
    const m = new URLSearchParams(window.location.search).get("modalidad");
    if (m && MODALIDADES.some((x) => x.id === m)) setModalidad(m as Modalidad);
  }, []);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
        <div className="flex flex-wrap items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-700">
          🎟️ Taquilla
          {/* Modalidad de TIEMPO de la barra de carga: refleja y cambia lo que
              BetSlip va a registrar (⚡ en vivo = comportamiento habitual). */}
          <span className="ml-auto normal-case">
            <ToggleModalidadTiempo valor={modalidadTiempo} onChange={setModalidadTiempo} />
          </span>
        </div>

        <div className="flex flex-wrap gap-1.5 border-b border-line pb-3">
          {MODALIDADES.map((m) => {
            const esWps = m.id === "wps";
            const activa = modalidad === m.id;
            return (
              <button
                key={m.id}
                type="button"
                // W.P.S. inactiva para TODOS: sin `disabled` + clases de bloqueo
                // la pestaña seguiría siendo un selector operativo.
                disabled={esWps}
                onClick={() => setModalidad(m.id)}
                aria-pressed={activa}
                title={esWps ? WPS_PLANIFICACION : undefined}
                className={`rounded-lg px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide transition-colors ${
                  activa
                    ? "bg-primary-600 text-white"
                    : "bg-surfaceAlt text-slate-500 hover:bg-surfaceAlt/80 hover:text-slate-700"
                } ${esWps ? CLASE_WPS_BLOQUEADA : ""}`}
              >
                {m.label}
                {esWps ? <span className="ml-1">🚧</span> : null}
              </button>
            );
          })}
        </div>
      </div>

      {modalidad === "puestos" ? (
        <>
          <BarraCarrerasLiquidadas fecha={new Date().toISOString().slice(0, 10)} hipodromo="" />
          <BetSlip />
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