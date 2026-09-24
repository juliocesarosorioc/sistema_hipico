"use client";

import { useState } from "react";
import { CLUB_NOMBRE, waLink } from "@/lib/whatsapp";
import {
  cargarJugadasDeCarrera,
  relacionJugadas,
  type MetaCarrera,
} from "@/lib/reportGenerator";

const toast = (msg: string, tipo: "success" | "warning" | "error" | "info" = "info") =>
  window.dispatchEvent(new CustomEvent("toast", { detail: { msg, tipo } }));

/**
 * "Copiar Relación": arma la Relación de Jugadas (pre-carrera) de la carrera
 * registrada en tickets_apuestas con su modelo Juega/Consigue, y la copia al
 * portapapeles o la abre en WhatsApp con el pie estricto.
 */
export function RelacionCarrera() {
  const [hipodromo, setHipodromo] = useState("");
  const [carrera, setCarrera] = useState("");
  const [retirados, setRetirados] = useState("");
  const [trabajando, setTrabajando] = useState(false);

  const armar = async (): Promise<string> => {
    const hip = hipodromo.trim().toUpperCase();
    const car = carrera.trim();
    if (!hip || !car) {
      toast("Indica Hipódromo y N° de Carrera.", "warning");
      return "";
    }
    setTrabajando(true);
    try {
      const jugadas = await cargarJugadasDeCarrera({
        hipodromo: hip,
        carrera: car,
        soloPendientes: true,
      });
      if (jugadas.length === 0) {
        toast("No hay jugadas pendientes para esta carrera.", "warning");
        return "";
      }
      const meta: MetaCarrera = {
        grupo: CLUB_NOMBRE,
        hipodromo: hip,
        carrera: car,
        retirados: retirados.trim(),
      };
      return relacionJugadas(meta, jugadas);
    } finally {
      setTrabajando(false);
    }
  };

  const copiar = async () => {
    const texto = await armar();
    if (!texto) return;
    try {
      await navigator.clipboard.writeText(texto);
      toast("Relación de jugadas copiada al portapapeles.", "success");
    } catch {
      toast("No se pudo copiar la relación.", "error");
    }
  };

  const abrir = async () => {
    const texto = await armar();
    if (!texto) return;
    window.open(waLink("", texto), "_blank");
    toast("WhatsApp abierto con la relación.", "success");
  };

  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-600">
          🧾 Copiar Relación (jugadas de la carrera)
        </h3>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-[10px] font-semibold text-slate-600">
          Hipódromo
          <input
            value={hipodromo}
            onChange={(e) => setHipodromo(e.target.value)}
            placeholder="LA RINCONADA"
            className="rounded-lg border border-line bg-surface px-2.5 py-2 text-xs font-bold uppercase text-slate-900 placeholder:font-normal"
          />
        </label>
        <label className="flex flex-col gap-1 text-[10px] font-semibold text-slate-600">
          Carrera N°
          <input
            value={carrera}
            onChange={(e) => setCarrera(e.target.value)}
            type="number"
            min={1}
            placeholder="4"
            className="rounded-lg border border-line bg-surface px-2.5 py-2 text-xs font-bold text-slate-900"
          />
        </label>
        <label className="flex flex-col gap-1 text-[10px] font-semibold text-slate-600">
          Retirados
          <input
            value={retirados}
            onChange={(e) => setRetirados(e.target.value)}
            placeholder="2, 5 → NO HUBO si vacío"
            className="rounded-lg border border-line bg-surface px-2.5 py-2 text-[11px] font-semibold text-slate-900"
          />
        </label>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={copiar}
          disabled={trabajando}
          className="rounded-lg bg-primary-600 px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-white transition-colors hover:bg-primary-700 disabled:opacity-50"
        >
          {trabajando ? "Generando…" : "📋 Copiar Relación"}
        </button>
        <button
          type="button"
          onClick={abrir}
          disabled={trabajando}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
        >
          💬 Abrir WhatsApp
        </button>
      </div>
    </div>
  );
}

export default RelacionCarrera;