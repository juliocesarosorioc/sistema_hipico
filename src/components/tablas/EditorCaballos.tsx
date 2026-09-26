"use client";

import { useState } from "react";
import { OPCIONES_NACIONALIDAD, type EjemplarTabla } from "@/lib/tablas/tipos";
import { colorDeNumero, textoDeNumero } from "@/lib/tablas/tipos";

/**
 * Grid compacto para CORREGIR las tablas (ejemplares): nº, nombre,
 * nacionalidad, valor y retirado — la base de los modales de edición
 * del Monitor (tabla publicada) y del Ensamblaje (borrador).
 */
type Props = {
  caballos: EjemplarTabla[];
  onChange: (indice: number, patch: Partial<EjemplarTabla>) => void;
  onQuitar?: (indice: number) => void;
  onAgregar?: (caballo: EjemplarTabla) => void;
};

const inp =
  "w-full rounded border border-slate-300 bg-white px-1.5 py-1 text-xs font-bold text-slate-900 outline-none focus:border-indigo-400";

export function EditorCaballos({ caballos, onChange, onQuitar, onAgregar }: Props) {
  const [nuevoNum, setNuevoNum] = useState("");
  const [nuevoNom, setNuevoNom] = useState("");
  const [nuevaNac, setNuevaNac] = useState("VE");
  const [nuevoValor, setNuevoValor] = useState("");

  const agregar = () => {
    const nombre = nuevoNom.trim().toUpperCase();
    if (!nombre) {
      window.dispatchEvent(new CustomEvent("toast", { detail: { msg: "Escriba el nombre del ejemplar para añadirlo.", tipo: "warning" } }));
      return;
    }
    onAgregar?.({ numero: nuevoNum.trim(), nombre, nacionalidad: nuevaNac, valor_ejemplar: nuevoValor.trim() });
    setNuevoNum("");
    setNuevoNom("");
    setNuevaNac("VE");
    setNuevoValor("");
  };

  return (
    <div className="space-y-1">
      <div className="grid grid-cols-[2.5rem_1fr_4.5rem_4.5rem_1.75rem] gap-1">
        <span className="text-[9px] font-black uppercase tracking-wider text-slate-400">Nº</span>
        <span className="text-[9px] font-black uppercase tracking-wider text-slate-400">Ejemplar</span>
        <span className="text-[9px] font-black uppercase tracking-wider text-slate-400">Nac.</span>
        <span className="text-[9px] font-black uppercase tracking-wider text-slate-400">Valor</span>
        <span className="text-[9px] font-black uppercase tracking-wider text-slate-400">Ret.</span>
      </div>
      {caballos.length === 0 && (
        <p className="rounded border border-dashed border-slate-300 p-3 text-center text-[11px] font-semibold text-slate-400">
          Sin ejemplares. Añádelos abajo.
        </p>
      )}
      {caballos.map((c, i) => (
        <div key={i} className="grid grid-cols-[2.5rem_1fr_4.5rem_4.5rem_1.75rem] items-center gap-1">
          <input
            type="text"
            inputMode="numeric"
            value={String(c.numero ?? "")}
            onChange={(e) => onChange(i, { numero: e.target.value })}
            placeholder="Nº"
            className={`${inp} text-center font-black`}
            style={{ backgroundColor: colorDeNumero(c.numero), color: textoDeNumero(c.numero) }}
          />
          <input type="text" value={String(c.nombre ?? "")} onChange={(e) => onChange(i, { nombre: e.target.value.toUpperCase() })} placeholder="Nombre del ejemplar" className={inp} />
          <select value={String(c.nacionalidad ?? "VE")} onChange={(e) => onChange(i, { nacionalidad: e.target.value })} className={inp}>
            {OPCIONES_NACIONALIDAD.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <input type="text" inputMode="decimal" value={c.valor_ejemplar != null ? String(c.valor_ejemplar) : ""} onChange={(e) => onChange(i, { valor_ejemplar: e.target.value })} placeholder="—" className={`${inp} text-right font-black`} />
          <div className="flex items-center justify-center gap-0.5">
            <input type="checkbox" checked={Boolean(c.retirado)} onChange={(e) => onChange(i, { retirado: e.target.checked })} className="h-4 w-4 accent-red-600" title="Marcar como retirado" />
            {onQuitar && (
              <button type="button" onClick={() => onQuitar(i)} className="px-0.5 text-red-400 hover:text-red-600" title="Quitar ejemplar">
                🗑️
              </button>
            )}
          </div>
        </div>
      ))}
      {onAgregar && (
        <div className="grid grid-cols-[2.5rem_1fr_4.5rem_4.5rem_1.75rem] gap-1 pt-1.5">
          <input type="text" inputMode="numeric" value={nuevoNum} onChange={(e) => setNuevoNum(e.target.value)} placeholder="Nº" className={`${inp} text-center font-black`} />
          <input type="text" value={nuevoNom} onChange={(e) => setNuevoNom(e.target.value)} onKeyDown={(e) => e.key === "Enter" && agregar()} placeholder="Nuevo ejemplar…" className={inp} />
          <select value={nuevaNac} onChange={(e) => setNuevaNac(e.target.value)} className={inp}>
            {OPCIONES_NACIONALIDAD.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <input type="text" inputMode="decimal" value={nuevoValor} onChange={(e) => setNuevoValor(e.target.value)} placeholder="—" className={`${inp} text-right font-black`} />
          <button type="button" onClick={agregar} className="rounded bg-indigo-600 text-xs font-black text-white hover:bg-indigo-700" title="Añadir ejemplar">
            ＋
          </button>
        </div>
      )}
      <span className="block text-right text-[9px] font-bold text-slate-400">
        ✏️ La moneda de la tabla se estipula según el grupo (no se muestra símbolo en la edición ni impresión).
      </span>
    </div>
  );
}