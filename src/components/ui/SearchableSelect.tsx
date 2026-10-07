"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, Ref } from "react";
import {
  aplicarTeclaCombo,
  etiquetaDeValor,
  filtrarOpciones,
  hayTextoLibre,
} from "./searchable-select-teclado";
import type { OpcionSelect } from "./searchable-select-teclado";

export type { OpcionSelect } from "./searchable-select-teclado";

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
  /**
   * Ref al <input> interno, para que quien lo usa pueda enfocarlo o leer lo que
   * está escrito (mandar el foco al primer campo de una grilla, por ejemplo).
   * Antes la prop no existía y quien la pasaba quedaba con el typeScript en
   * error; ahora se combina con el ref interno, así el componente sigue
   * funcionando aunque nadie lo use.
   */
  inputRef?: Ref<HTMLInputElement>;
  /** Deshabilita el campo sin deshabilitar el resto del formulario. */
  disabled?: boolean;
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
  inputRef,
  disabled = false,
}: Props) {
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState("");
  const [activo, setActivo] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const refInterno = useRef<HTMLInputElement>(null);
  const idLista = useId();

  /** Combina el ref interno con el del llamador: los dos reciben el <input>. */
  const setInputRef = (el: HTMLInputElement | null) => {
    refInterno.current = el;
    if (!inputRef) return;
    if (typeof inputRef === "function") inputRef(el);
    else (inputRef as { current: HTMLInputElement | null }).current = el;
  };

  /**
   * Lo que se ve cerrado: la ETIQUETA de la opción elegida, no su `value`.
   * El `value` de un cliente es su id (un código), y mostrar eso en el campo
   * hace creer que el sistema no sabe el nombre del comprador. Si el valor no
   * está en la lista (o es texto libre) se cae al `displayValue` y, en último
   * caso, al propio valor.
   */
  const etiquetaSeleccionada = useMemo(
    () => etiquetaDeValor(options, value, displayValue),
    [displayValue, options, value]
  );

  useEffect(() => {
    if (!abierto) setTexto(etiquetaSeleccionada);
  }, [abierto, etiquetaSeleccionada]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        // Al hacer clic afuera se vuelve a la etiqueta elegida: si el operador
        // estaba escribiendo y se le fue el click, no debe quedar a medias un
        // texto a medio filtrar como si fuera la selección.
        setAbierto(false);
        setTexto(etiquetaSeleccionada);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
    // `etiquetaSeleccionada` se relee al cambiar la selección; antes el cierre
    // desde afuera usaba el valor viejo y dejaba texto desactualizado.
  }, [etiquetaSeleccionada]);

  const filtradas = useMemo(() => filtrarOpciones(options, texto), [options, texto]);

  const elegir = (v: string) => {
    onChange(v);
    // Se guarda la ETIQUETA elegida, no el value: al reabrir el campo tiene que
    // decir el nombre del cliente, no el código con el que se lo identificó.
    setTexto(options.find((o) => o.value === v)?.label ?? v);
    setAbierto(false);
  };

  const textoSinMatch = hayTextoLibre(options, texto);

  /**
   * Teclado del combo. La lógica vive en `searchable-select-teclado.ts`, que es
   * puro y está cubierto por pruebas; acá solo se conecta con el estado de React
   * y se ejecuta lo que esa función decidió.
   */
  const onKeyDownInput = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    const r = aplicarTeclaCombo({
      key: e.key,
      filtradas,
      activo,
      texto,
      allowCustom,
      elegido: null,
      escapado: false,
    });
    if (r.preventDefault) e.preventDefault();
    if (r.abierto !== undefined && r.abierto !== abierto) setAbierto(r.abierto);
    if (r.activoResultante !== undefined) setActivo(r.activoResultante);
    if (r.escapado) {
      // En Escape se descarta lo escrito y se vuelve a la etiqueta elegida: si
      // el operador escribe para buscar y se equivoca, Escape es "cancélalo".
      setTexto(etiquetaSeleccionada);
      refInterno.current?.blur();
      return;
    }
    if (r.elegido != null) elegir(r.elegido);
  };

  return (
    <div ref={ref} className={`relative ${className}`}>
      <input
        ref={setInputRef}
        value={abierto ? texto : etiquetaSeleccionada}
        disabled={disabled}
        onChange={(e) => {
          setTexto(e.target.value);
          setAbierto(true);
          setActivo(0);
          if (allowCustom) onChange(e.target.value.toUpperCase());
        }}
        onFocus={() => {
          setTexto(etiquetaSeleccionada);
          setAbierto(true);
        }}
        onKeyDown={onKeyDownInput}
        placeholder={placeholder}
        role="combobox"
        aria-expanded={abierto}
        aria-autocomplete="list"
        aria-controls={idLista}
        aria-activedescendant={abierto ? `${idLista}-${activo}` : undefined}
        className={inputClassName}
      />
      {abierto && (filtradas.length > 0 || textoSinMatch) && (
        <ul id={idLista} role="listbox" className="absolute left-0 right-0 top-full z-30 mt-1 max-h-56 overflow-y-auto rounded-lg border border-line bg-white shadow-xl">
          {filtradas.map((o, i) => (
            <li key={o.value}>
              <button
                type="button"
                role="option"
                aria-selected={i === activo}
                id={`${idLista}-${i}`}
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