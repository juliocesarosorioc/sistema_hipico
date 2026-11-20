"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/core/supabase";
import { BetSlip, type ContextoCarreraTaquilla } from "@/features/taquilla/components/BetSlip";
import { ListaTickets } from "@/features/taquilla/components/ListaTickets";
import { JugadasAdelantadasTaquilla } from "@/features/taquilla/components/JugadasAdelantadasTaquilla";
import { BarraCarrerasLiquidadas } from "@/features/gestion/components/BarraCarrerasLiquidadas";
import { PagarCarreraModal } from "@/features/taquilla/components/PagarCarreraModal";
import { RelacionCarrera } from "@/features/taquilla/components/RelacionCarrera";
import { ToggleModalidadTiempo } from "@/features/jugadas/components/ToggleModalidadTiempo";
import { useTaquillaStore } from "@/shared/store/useTaquillaStore";
import { hoyLocal } from "@/features/gaceta/lib/programa";
import {
  cargarTicketsDeCarreraBD,
  dedupeTicketsPorId,
  ticketPerteneceACarrera,
  type TicketCarreraRow,
} from "@/features/taquilla/lib/tickets-carrera";
import { WPS_PLANIFICACION, CLASE_WPS_BLOQUEADA } from "@/features/motores/lib/wps-planificacion";

type Modalidad = "puestos" | "remates" | "dupletas";

const MODALIDADES: Array<{ id: Modalidad; label: string }> = [
  { id: "puestos", label: "Puestos" },
  { id: "remates", label: "Remates" },
  { id: "dupletas", label: "Dupletas" },
];

const PENDIENTE: Record<string, { titulo: string; texto: string }> = {
  remates: {
    titulo: "Remates",
    texto: "RematesEngine en construcción: pote neto recirculante (Paso 4 del plan de migración).",
  },
  wps: {
    titulo: "W.P.S. — Win / Place / Show",
    texto: `${WPS_PLANIFICACION}. Modal independiente (disponible desde el menú lateral).`,
  },
};

/** Taquilla — módulo contenedor con selector de modalidades y contexto de carrera activo. */
export function TaquillaModule() {
  const [modalidad, setModalidad] = useState<Modalidad>("puestos");
  const modalidadTiempo = useTaquillaStore((s) => s.modalidadTiempo);
  const setModalidadTiempo = useTaquillaStore((s) => s.setModalidadTiempo);

  // Contexto de carrera activo (compartido): fuente para carga BD, realtime y relación.
  const [contexto, setContexto] = useState<ContextoCarreraTaquilla>(() => ({
    fecha: hoyLocal(),
    hipodromo: "LA RINCONADA",
    carrera: "1",
  }));

  const [ticketsBD, setTicketsBD] = useState<TicketCarreraRow[]>([]);
  const [cargandoBD, setCargandoBD] = useState(false);
  const reqIdRef = useRef(0);

  useEffect(() => {
    const m = new URLSearchParams(window.location.search).get("modalidad");
    if (m && MODALIDADES.some((x) => x.id === m)) setModalidad(m as Modalidad);
  }, []);

  const refrescarTicketsBD = useCallback(async () => {
    const hip = String(contexto.hipodromo || "").trim();
    const car = Number(String(contexto.carrera || "").replace(/[^0-9]/g, "")) || 0;
    if (!hip || !car) {
      setTicketsBD([]);
      return;
    }
    const req = ++reqIdRef.current;
    setCargandoBD(true);
    try {
      const filas = await cargarTicketsDeCarreraBD({
        fecha: contexto.fecha,
        hipodromo: hip,
        carrera: car,
      });
      if (req !== reqIdRef.current) return;
      setTicketsBD(dedupeTicketsPorId(filas));
    } finally {
      if (req === reqIdRef.current) setCargandoBD(false);
    }
  }, [contexto.fecha, contexto.hipodromo, contexto.carrera]);

  useEffect(() => {
    void refrescarTicketsBD();
  }, [refrescarTicketsBD]);

  // Realtime: refleja concreciones/sincronizaciones de Sala y otros cambios en `tickets_apuestas`.
  useEffect(() => {
    const sb = supabase;
    if (!sb) return;
    const hip = String(contexto.hipodromo || "").trim();
    const car = Number(String(contexto.carrera || "").replace(/[^0-9]/g, "")) || 0;
    if (!hip || !car) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const programarRefresco = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void refrescarTicketsBD(), 250);
    };

    const canal = sb
      .channel(`taquilla:tickets:${contexto.fecha}:${hip}:${car}:${Date.now()}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tickets_apuestas" },
        (payload) => {
          const row = (payload.new ?? payload.old ?? {}) as TicketCarreraRow;
          if (!ticketPerteneceACarrera(row, { ...contexto, carrera: car })) return;
          programarRefresco();
        }
      )
      .subscribe((status) => {
        // Fallback: si Realtime no se suscribe (RLS/publication/red), dependemos de
        // eventos locales y refresco periódico; se documenta como limitación de entorno.
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          programarRefresco();
        }
      });

    const onTickets = () => void refrescarTicketsBD();
    window.addEventListener("hipico_tickets_actualizados", onTickets);
    window.addEventListener("hipico:saldos-actualizados", onTickets);
    const intervalo = window.setInterval(() => void refrescarTicketsBD(), 15000);

    return () => {
      if (timer) clearTimeout(timer);
      window.clearInterval(intervalo);
      window.removeEventListener("hipico_tickets_actualizados", onTickets);
      window.removeEventListener("hipico:saldos-actualizados", onTickets);
      void sb.removeChannel(canal);
    };
  }, [contexto.fecha, contexto.hipodromo, contexto.carrera, refrescarTicketsBD]);

  const contextoCarrera = useMemo(
    () => ({ ...contexto, carrera: String(contexto.carrera || "1") }),
    [contexto]
  );

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
        <div className="flex flex-wrap items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-700">
          🎟️ Taquilla
          <span className="ml-auto normal-case">
            <ToggleModalidadTiempo valor={modalidadTiempo} onChange={setModalidadTiempo} />
          </span>
        </div>

        <div className="flex flex-wrap gap-1.5 border-b border-line pb-3">
          {MODALIDADES.map((m) => {
            const esWps = (m.id as string) === "wps";
            const activa = modalidad === m.id;
            return (
              <button
                key={m.id}
                type="button"
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
          <BarraCarrerasLiquidadas
            fecha={String(contexto.fecha || hoyLocal()).slice(0, 10)}
            hipodromo={String(contexto.hipodromo || "")}
          />
          <BetSlip contexto={contextoCarrera} onContextoChange={setContexto} />
          <JugadasAdelantadasTaquilla />
          <ListaTickets ticketsBD={ticketsBD} contexto={contextoCarrera} cargando={cargandoBD} onRefrescar={refrescarTicketsBD} />
          <RelacionCarrera contexto={contextoCarrera} ticketsBD={ticketsBD} />
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