"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, Ref } from "react";
import {
  aplicarTeclaCombo,
  etiquetaDeValor,
  filtrarOpciones,
  hayTextoLibre,
} from "@/shared/components/ui/searchable-select-teclado";
import type { OpcionSelect } from "@/shared/components/ui/searchable-select-teclado";
import { Flag } from "@/shared/components/ui/BanderaPais";

export type { OpcionSelect } from "@/shared/components/ui/searchable-select-teclado";

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
  /**
   * Tema OSCURO para modales editoriales (fondo slate-900). Pinta el campo y la
   * lista en la paleta del modal para que el desplegable no sea un parche
   * blanco dentro de una tarjeta oscura. Por defecto, claro (compatibilidad con
   * las pantallas de fondo blanco que ya lo usan).
   */
  temaOscuro?: boolean;
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
  inputClassName,
  inputRef,
  disabled = false,
  temaOscuro = false,
}: Props) {
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState("");
  const [activo, setActivo] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const refInterno = useRef<HTMLInputElement>(null);
  const idLista = useId();

  // Paleta del campo y de la lista: una sola decisión por tema, no estilos
  // sueltos en cada uso. El llamador puede pisar el campo con `inputClassName`.
  const claseCampo =
    inputClassName ??
    (temaOscuro
      ? "modal-campo font-bold normal-case"
      : "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm font-bold normal-case text-slate-900 placeholder:font-normal placeholder:text-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500");
  const claseLista = temaOscuro
    ? "absolute left-0 right-0 top-full z-30 mt-1 max-h-56 overflow-y-auto rounded-lg border border-slate-700 bg-slate-950 shadow-2xl shadow-black/60"
    : "absolute left-0 right-0 top-full z-30 mt-1 max-h-56 overflow-y-auto rounded-lg border border-line bg-white shadow-xl";

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
        className={claseCampo}
      />
      {abierto && (filtradas.length > 0 || textoSinMatch) && (
        <ul id={idLista} role="listbox" className={claseLista}>
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
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold normal-case transition-colors ${
                  i === activo
                    ? temaOscuro
                      ? "bg-amber-400/15 text-amber-200"
                      : "bg-primary-500/10 text-primary-700"
                    : temaOscuro
                      ? "text-slate-200"
                      : "text-slate-700"
                }`}
              >
                {/* Bandera del país y logo del hipódromo: contexto visual antes
                    del nombre, para elegir sin leer renglón por renglón. */}
                {o.pais ? <Flag nac={o.pais} size={14} withName={false} /> : null}
                {o.logo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={o.logo}
                    alt=""
                    className="h-4 w-4 shrink-0 rounded object-contain"
                  />
                ) : null}
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
              </button>
            </li>
          ))}
          {textoSinMatch && !allowCustom && (
            <li className={`px-3 py-2 text-[10px] italic ${temaOscuro ? "text-slate-500" : "text-slate-400"}`}>
              Sin coincidencias
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

export default SearchableSelect;