"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export type OpcionSelect = { value: string; label: string };

type Props = {
  options: OpcionSelect[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Permite escribir un valor libre (hipódromo inexistente en el listado). */
  allowCustom?: boolean;
  /** Texto a mostrar cuando el `value` es un id y el label debe ser otro (p. ej. cliente). */
  displayValue?: string;
  className?: string;
  /** Clases del <input> interno (para compactarlo en grillas densas). */
  inputClassName?: string;
};

/**
 * Selector combinable (Searchable Dropdown / Autocomplete).
 * Reemplaza el <select> tradicional del legacy: filtra por escritura,
 * navegación por teclado (↑↓ Enter/Escape) y permite valor libre.
 */
export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = "Buscar…",
  allowCustom = true,
  displayValue,
  className = "",
  inputClassName = "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm font-bold uppercase text-slate-900 placeholder:font-normal placeholder:text-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500",
}: Props) {
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState("");
  const [activo, setActivo] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!abierto) setTexto(value);
  }, [abierto, value]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setAbierto(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const filtradas = useMemo(() => {
    const q = texto.trim().toUpperCase();
    if (!q) return options;
    return options.filter((o) => o.label.toUpperCase().includes(q));
  }, [options, texto]);

  const elegir = (v: string) => {
    onChange(v);
    setTexto(v);
    setAbierto(false);
  };

  const textoSinMatch = texto.trim() && !filtradas.some((o) => o.label === texto.trim());

  return (
    <div ref={ref} className={`relative ${className}`}>
      <input
        value={abierto ? texto : (displayValue ?? value)}
        onChange={(e) => {
          setTexto(e.target.value);
          setAbierto(true);
          setActivo(0);
          if (allowCustom) onChange(e.target.value.toUpperCase());
        }}
        onFocus={() => {
          setTexto(displayValue ?? value);
          setAbierto(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setAbierto(true);
            setActivo((a) => Math.min(a + 1, filtradas.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActivo((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            const op = filtradas[activo];
            if (op) elegir(op.value);
            else if (allowCustom && texto.trim()) elegir(texto.trim().toUpperCase());
          } else if (e.key === "Escape") {
            setAbierto(false);
          }
        }}
        placeholder={placeholder}
        className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm font-bold uppercase text-slate-900 placeholder:font-normal placeholder:text-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
      />
      {abierto && (filtradas.length > 0 || textoSinMatch) && (
        <ul className="absolute left-0 right-0 top-full z-30 mt-1 max-h-56 overflow-y-auto rounded-lg border border-line bg-white shadow-xl">
          {filtradas.map((o, i) => (
            <li key={o.value}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  elegir(o.value);
                }}
                onMouseEnter={() => setActivo(i)}
                className={`block w-full px-3 py-2 text-left text-xs font-semibold uppercase transition-colors ${
                  i === activo ? "bg-primary-500/10 text-primary-700" : "text-slate-700"
                }`}
              >
                {o.label}
              </button>
            </li>
          ))}
          {textoSinMatch && !allowCustom && (
            <li className="px-3 py-2 text-[10px] italic text-slate-400">Sin coincidencias</li>
          )}
        </ul>
      )}
    </div>
  );
}

export default SearchableSelect;