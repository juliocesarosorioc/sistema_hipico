"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { bandera } from "@/lib/gaceta/padron";

export type OpcionPadron = {
  id: string | number;
  nombre: string;
  nacionalidad: string;
};

type Props = {
  opciones: OpcionPadron[];
  valor: string;
  onChange: (res: { nombre: string; nacionalidad: string; ejemplar_id: string | number | null }) => void;
  /** true cuando el texto actual ya coincide con un ejemplar del padrón. */
  vinculado: boolean;
  placeholder?: string;
};

/**
 * Buscador con autocompletado del Padrón de Ejemplares: filtra por escritura,
 * teclado (↑↓ Enter/Escape) y resuelve cada selección a {nombre, nacionalidad,
 * ejemplar_id}. Permite texto libre (ejemplar aún no registrado → se vincula
 * al guardar el programa).
 */
export function BuscadorPadron({ opciones, valor, onChange, vinculado, placeholder = "Buscar ejemplar en el padrón…" }: Props) {
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState("");
  const [activa, setActiva] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!abierto) setTexto(valor);
  }, [abierto, valor]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setAbierto(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const filtradas = useMemo(() => {
    const q = texto.trim().toUpperCase();
    if (!q) return opciones;
    return opciones.filter((o) => o.nombre.toUpperCase().includes(q));
  }, [opciones, texto]);

  const resolver = (nombre: string) => {
    const exacto = opciones.find((o) => o.nombre.toUpperCase() === nombre.toUpperCase());
    if (exacto) {
      onChange({ nombre: exacto.nombre, nacionalidad: exacto.nacionalidad, ejemplar_id: exacto.id });
      return;
    }
    onChange({ nombre: nombre.toUpperCase(), nacionalidad: "VE", ejemplar_id: null });
  };

  const elegir = (op: OpcionPadron) => {
    onChange({ nombre: op.nombre, nacionalidad: op.nacionalidad, ejemplar_id: op.id });
    setTexto(op.nombre);
    setAbierto(false);
  };

  return (
    <div ref={ref} className="relative min-w-0">
      <input
        value={abierto ? texto : valor}
        onChange={(e) => {
          setTexto(e.target.value);
          setAbierto(true);
          setActiva(0);
          resolver(e.target.value);
        }}
        onFocus={() => {
          setTexto(valor);
          setAbierto(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setAbierto(true);
            setActiva((a) => Math.min(a + 1, filtradas.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActiva((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (filtradas[activa]) elegir(filtradas[activa]);
            else if (texto.trim()) {
              resolver(texto.trim());
              setAbierto(false);
            }
          } else if (e.key === "Escape") {
            setAbierto(false);
          }
        }}
        placeholder={placeholder}
        className={`w-full rounded-lg border bg-surface px-3 py-1.5 text-xs font-bold uppercase text-slate-900 placeholder:font-normal placeholder:text-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${
          vinculado ? "border-success-400" : "border-line"
        }`}
      />
      {abierto && filtradas.length > 0 && (
        <ul className="absolute left-0 right-0 top-full z-30 mt-1 max-h-48 overflow-y-auto rounded-lg border border-line bg-white py-1 shadow-xl">
          {filtradas.map((o, i) => (
            <li key={`${o.id}-${i}`}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  elegir(o);
                }}
                onMouseEnter={() => setActiva(i)}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] font-semibold uppercase transition-colors ${
                  i === activa ? "bg-primary-500/10 text-primary-700" : "text-slate-700"
                }`}
              >
                <span>{bandera(o.nacionalidad)}</span>
                <span className="flex-1 truncate">{o.nombre}</span>
                <span className="text-[9px] font-bold text-slate-400">{o.nacionalidad}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default BuscadorPadron;