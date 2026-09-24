"use client";

import { useState } from "react";
import { colorDeNumero, textoDeNumero, parseNum, OPCIONES_NACIONALIDAD, type DraftCarrera, type EjemplarTabla } from "@/lib/tablas/tipos";

type Props = {
  draft: DraftCarrera;
  onChange: (d: DraftCarrera) => void;
  onPublicar: (d: DraftCarrera) => void;
  onQuitar: (uid: string) => void;
};

/**
 * Tarjeta de "Carreras en el Ensamblaje" — clon 1:1 de js/tablas.js crearCardCarrera:
 * cabecera de color con hipódromo/carrera/distancia/superficie/monto, ejemplares
 * numerados editables y pie con suma de la tabla + Publicar/Quitar.
 */
export function TarjetaEnsamblaje({ draft, onChange, onPublicar, onQuitar }: Props) {
  const [nuevoNum, setNuevoNum] = useState("");
  const [nuevoNom, setNuevoNom] = useState("");
  const [nuevaNac, setNuevaNac] = useState("VE");
  const [nuevoValor, setNuevoValor] = useState("");

  const suma = draft.caballos.reduce((a, c) => a + (parseNum(c.valor_ejemplar) || 0), 0);

  const set = (patch: Partial<DraftCarrera>) => onChange({ ...draft, ...patch });

  const setCaballo = (i: number, patch: Partial<EjemplarTabla>) =>
    set({ caballos: draft.caballos.map((c, j) => (j === i ? { ...c, ...patch } : c)) });

  const quitarCaballo = (i: number) => set({ caballos: draft.caballos.filter((_, j) => j !== i) });

  const agregarEjemplar = () => {
    const nombre = nuevoNom.trim().toUpperCase();
    if (!nombre) {
      window.dispatchEvent(new CustomEvent("toast", { detail: { msg: "Escriba el nombre del ejemplar para añadirlo.", tipo: "warning" } }));
      return;
    }
    set({ caballos: [...draft.caballos, { numero: nuevoNum.trim(), nombre, nacionalidad: nuevaNac, valor_ejemplar: nuevoValor.trim() }] });
    setNuevoNum("");
    setNuevoNom("");
    setNuevoValor("");
  };

  const chipCls = "rounded px-1 py-px text-[9px] font-bold leading-none";
  const inpHeader = "rounded px-1 py-px font-bold outline-none bg-white/20 text-white placeholder:text-white/50";

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-indigo-200 bg-white shadow-sm">
      {/* Cabecera color (legacy bg-indigo-600 #4f46e5) */}
      <div className="bg-indigo-600 px-1.5 py-px text-white">
        <div className="flex items-center justify-between gap-1 leading-none">
          <input
            type="text"
            value={draft.hipodromo}
            onChange={(e) => set({ hipodromo: e.target.value.toUpperCase() })}
            placeholder="Hipódromo"
            className={`${inpHeader} min-w-0 flex-1 text-[11px] uppercase`}
          />
          <span className="flex items-center gap-0.5 whitespace-nowrap text-xs font-black leading-none">
            🏁 C
            <input
              type="number"
              value={draft.carrera}
              onChange={(e) => set({ carrera: e.target.value })}
              placeholder="N°"
              className={`${inpHeader} w-7 text-center`}
            />
          </span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1 leading-none">
          <span className={`${chipCls} inline-flex items-center bg-white/20`}>
            📏 <input type="number" value={draft.distancia} onChange={(e) => set({ distancia: e.target.value })} placeholder="m" className="ml-1 w-10 rounded bg-transparent text-center font-black outline-none text-white placeholder:text-white/40" />
            m
          </span>
          <select
            value={draft.superficie}
            onChange={(e) => set({ superficie: e.target.value })}
            className={`${chipCls} bg-white/20 uppercase text-white`}
          >
            {["ARENA", "CESPED", "FANGO", "TAPETA", "OTRA"].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="mt-0.5 flex items-center justify-between rounded px-1.5 py-px leading-none bg-white/20">
          <span className="text-[8px] font-black uppercase tracking-wider opacity-90">💰 Monto a Pagar / Tabla</span>
          <span className="flex items-center gap-0.5 text-sm font-black leading-none">
            $<input type="number" step="0.01" value={draft.premio} onChange={(e) => set({ premio: e.target.value })} className="w-14 rounded bg-transparent text-right font-black outline-none text-white placeholder:text-white/40" />
          </span>
        </div>
      </div>

      {/* Subetiqueta ejemplares */}
      <div className="flex items-center justify-between px-1.5 pb-0.5 pt-1 text-[9px] font-black uppercase tracking-wider text-slate-400 leading-none">
        <span>🐴 Ejemplares</span>
        <span className="rounded-full bg-slate-100 px-1.5 text-[9px] font-black text-slate-600">{draft.caballos.length}</span>
      </div>

      {/* Lista de ejemplares */}
      <div className="flex-1 space-y-px px-1 py-px">
        {draft.caballos.length === 0 && (
          <p className="px-1 py-1 text-[11px] italic text-slate-400">Sin ejemplares registrados.</p>
        )}
        {draft.caballos.map((c, i) => {
          const nac = (c.nacionalidad || "VE").trim().toUpperCase();
          return (
            <div key={i} className="grid items-center rounded border border-slate-200 bg-slate-50 px-1 py-px" style={{ gridTemplateColumns: "1.75rem 1fr 3.25rem auto" }}>
              <span
                className="flex h-7 w-7 shrink-0 flex-none items-center justify-center text-center text-[10px] font-bold"
                style={{ backgroundColor: colorDeNumero(c.numero), color: textoDeNumero(c.numero) }}
              >
                {c.numero}
              </span>
              <span className="min-w-0 truncate px-1 text-[11px] font-bold uppercase text-slate-800">{c.nombre}</span>
              <input
                type="text"
                inputMode="decimal"
                value={String(c.valor_ejemplar ?? "")}
                onChange={(e) => setCaballo(i, { valor_ejemplar: e.target.value })}
                placeholder={nac === "VE" ? "valor" : undefined}
                className="w-14 rounded border border-slate-300 px-1 py-px text-right text-[11px] font-black text-blue-700 outline-none"
              />
              <button type="button" onClick={() => quitarCaballo(i)} className="px-1 text-red-400 hover:text-red-600" title="Quitar ejemplar">
                🗑️
              </button>
            </div>
          );
        })}
      </div>

      {/* Añadir ejemplar */}
      <div className="space-y-1 border-t border-slate-200 bg-slate-50 px-2 py-1.5">
        <div className="flex items-center gap-1">
          <input type="text" inputMode="numeric" value={nuevoNum} onChange={(e) => setNuevoNum(e.target.value)} placeholder="Nº" className="w-9 shrink-0 rounded-md border border-slate-300 py-1 text-center text-[14px] font-black outline-none" />
          <input type="text" value={nuevoNom} onChange={(e) => setNuevoNom(e.target.value)} onKeyDown={(e) => e.key === "Enter" && agregarEjemplar()} placeholder="Ejemplar nuevo" className="min-w-0 flex-1 rounded border border-slate-300 px-1.5 py-1 text-sm font-bold uppercase outline-none" />
          <select value={nuevaNac} onChange={(e) => setNuevaNac(e.target.value)} className="shrink-0 rounded border border-slate-300 px-1 py-1 text-xs font-bold uppercase outline-none">
            {OPCIONES_NACIONALIDAD.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <input type="text" inputMode="decimal" value={nuevoValor} onChange={(e) => setNuevoValor(e.target.value)} placeholder="$" className="w-14 shrink-0 rounded border border-slate-300 px-1 py-1 text-right text-sm font-black text-blue-700 outline-none" />
          <button type="button" onClick={agregarEjemplar} className="shrink-0 rounded-md bg-indigo-600 px-2 py-1 text-xs text-white hover:bg-indigo-700" title="Añadir ejemplar">
            ＋
          </button>
        </div>
      </div>

      {/* Suma de la tabla */}
      <div className="flex items-center justify-between border-t border-slate-200 bg-white px-1.5 py-0.5">
        <span className="text-[9px] font-black uppercase tracking-wider text-slate-400 leading-none">🧮 Suma de la Tabla</span>
        <span className="text-xs font-black text-indigo-700">$ {suma.toLocaleString("es-VE", { maximumFractionDigits: 2 })}</span>
      </div>

      {/* Acciones */}
      <div className="flex gap-2 border-t border-slate-200 bg-white px-3 py-2">
        <button type="button" onClick={() => onPublicar(draft)} className="flex-1 rounded-lg bg-emerald-600 py-2 text-xs font-black uppercase tracking-wide text-white shadow transition-colors hover:bg-emerald-700">
          💾 Publicar
        </button>
        <button type="button" onClick={() => onQuitar(draft.uid)} className="rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-600 transition-colors hover:bg-red-100" title="Quitar esta carrera del ensamblaje">
          ✕
        </button>
      </div>
    </div>
  );
}

export default TarjetaEnsamblaje;