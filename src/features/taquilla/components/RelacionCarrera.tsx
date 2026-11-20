"use client";

import { useEffect, useMemo, useState } from "react";
import { CLUB_NOMBRE, waLink } from "@/features/whatsapp/lib/whatsapp";
import { nombreHipodromoParaMostrar } from "@/features/hipodromos/lib/nombre";
import {
  cargarJugadasDeCarrera,
  relacionJugadas,
  type MetaCarrera,
} from "@/features/impresion/lib/reportGenerator";
import type { ContextoCarreraTaquilla } from "@/features/taquilla/components/BetSlip";
import type { TicketCarreraRow } from "@/features/taquilla/lib/tickets-carrera";

const toast = (msg: string, tipo: "success" | "warning" | "error" | "info" = "info") =>
  window.dispatchEvent(new CustomEvent("toast", { detail: { msg, tipo } }));

type Props = {
  /** Contexto activo de la carrera (se sincroniza con la barra de carga). */
  contexto?: ContextoCarreraTaquilla;
  /** Tickets vivos de la carrera (para conteo/preview de disponibilidad). */
  ticketsBD?: TicketCarreraRow[];
};

/**
 * "Copiar Relación": arma la Relación de Jugadas (pre-carrera) de la carrera
 * registrada en tickets_apuestas con su modelo Juega/Consigue, y la copia al
 * portapapeles o la abre en WhatsApp con el pie estricto.
 */
export function RelacionCarrera({ contexto, ticketsBD }: Props) {
  const [hipodromo, setHipodromo] = useState("");
  const [carrera, setCarrera] = useState("");
  const [retirados, setRetirados] = useState("");
  const [trabajando, setTrabajando] = useState(false);

  // Sincroniza con la carrera activa para reflejar las jugadas (incluidas las de Sala).
  useEffect(() => {
    if (!contexto) return;
    if (contexto.hipodromo) setHipodromo(String(contexto.hipodromo).toUpperCase());
    if (contexto.carrera) setCarrera(String(contexto.carrera));
  }, [contexto?.hipodromo, contexto?.carrera]);

  const registrados = useMemo(() => (ticketsBD ?? []).filter(Boolean).length, [ticketsBD]);

  const armar = async (): Promise<string> => {
    const hip = hipodromo.trim().toUpperCase();
    const car = carrera.trim() || "1";
    if (!hip) {
      toast("Indicá el hipódromo de la carrera.", "warning");
      throw new Error("hipódromo vacío");
    }
    const jugadas = await cargarJugadasDeCarrera({
      hipodromo: hip,
      carrera: car,
      soloPendientes: true,
    });
    if (jugadas.length === 0) {
      toast("No hay jugadas pendientes registradas para esa carrera.", "info");
    }
    const meta: MetaCarrera = {
      grupo: CLUB_NOMBRE,
      fecha: contexto?.fecha ? new Date(`${contexto.fecha}T12:00:00`) : new Date(),
      hipodromo: nombreHipodromoParaMostrar(hip),
      carrera: car,
      retirados: retirados.trim() || undefined,
    };
    return relacionJugadas(meta, jugadas);
  };

  const copiar = async () => {
    setTrabajando(true);
    try {
      const txt = await armar();
      await navigator.clipboard.writeText(txt);
      toast("Relación de Jugadas copiada.", "success");
    } catch {
      /* toast ya mostrado si aplica */
    } finally {
      setTrabajando(false);
    }
  };

  const abrirWhatsApp = async () => {
    setTrabajando(true);
    try {
      const txt = await armar();
      window.open(waLink("", txt), "_blank", "noopener,noreferrer");
    } catch {
      /* toast ya mostrado si aplica */
    } finally {
      setTrabajando(false);
    }
  };

  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <h3 className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-600">
        📋 Relación de Jugadas (pre-carrera)
      </h3>
      <p className="mb-3 text-[11px] text-slate-500">
        Genera la relación a partir de las jugadas registradas en la carrera (manuales y
        concretadas en Sala).{" "}
        {registrados > 0 ? (
          <span className="font-semibold text-slate-700">Registradas en esta carrera: {registrados}.</span>
        ) : null}
      </p>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold text-slate-500">Hipódromo</span>
          <input
            value={hipodromo}
            onChange={(e) => setHipodromo(e.target.value)}
            placeholder="LA RINCONADA"
            className="h-8 w-44 rounded-lg border border-line bg-white px-2 text-xs text-slate-700"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold text-slate-500">Carrera</span>
          <input
            value={carrera}
            onChange={(e) => setCarrera(e.target.value)}
            placeholder="1"
            className="h-8 w-16 rounded-lg border border-line bg-white px-2 text-xs text-slate-700"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold text-slate-500">Retirados</span>
          <input
            value={retirados}
            onChange={(e) => setRetirados(e.target.value)}
            placeholder="NINGUNO"
            className="h-8 w-36 rounded-lg border border-line bg-white px-2 text-xs text-slate-700"
          />
        </label>

        <button
          type="button"
          onClick={() => void copiar()}
          disabled={trabajando}
          className="h-8 rounded-lg border border-primary-500/30 bg-primary-50 px-3 text-[11px] font-bold text-primary-700 hover:bg-primary-100 disabled:opacity-60"
        >
          Copiar relación
        </button>
        <button
          type="button"
          onClick={() => void abrirWhatsApp()}
          disabled={trabajando}
          className="h-8 rounded-lg bg-emerald-600 px-3 text-[11px] font-bold text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          WhatsApp
        </button>
      </div>
    </div>
  );
}

export default RelacionCarrera;
