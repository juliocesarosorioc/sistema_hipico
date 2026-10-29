"use client";

import React, { useState, useEffect, useRef, forwardRef, useId } from "react";

export interface DateInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> {
  value?: string; // Formato ISO YYYY-MM-DD
  onChange?: (e: { target: { value: string; name?: string } }) => void;
  onFechaChange?: (isoDate: string) => void;
  label?: string;
  hint?: string;
}

const NOMBRES_MESES = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

const DIAS_SEMANA_CORTOS = ["Lu", "Ma", "Mi", "Ju", "Vi", "Sá", "Do"];

/** Convierte YYYY-MM-DD a partes { dia, mes, anio } */
function descomponerIso(iso: string | null | undefined): { dia: string; mes: string; anio: string } {
  if (!iso) return { dia: "", mes: "", anio: "" };
  const match = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return { dia: "", mes: "", anio: "" };
  const [, aaaa, mm, dd] = match;
  return { dia: dd, mes: mm, anio: aaaa };
}

/** Convierte partes a ISO YYYY-MM-DD */
function componerIso(dia: string, mes: string, anio: string): string {
  const d = parseInt(dia, 10);
  const m = parseInt(mes, 10);
  const y = parseInt(anio, 10);
  if (
    !d || !m || !y ||
    d < 1 || d > 31 ||
    m < 1 || m > 12 ||
    y < 1900 || y > 2100
  ) {
    return "";
  }
  return `${String(y)}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Hoy en formato ISO local */
function hoyIsoLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dia}`;
}

/** Ayer en formato ISO local */
function ayerIsoLocal(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dia}`;
}

/**
 * DateInput (Modelo Centralizado de Consulta y Selección de Fecha)
 *
 *  - Formato estricto visible segmentado: [ DD ] / [ MM ] / [ AAAA ]
 *  - Al pararse en el día y teclear 2 dígitos, salta automáticamente al mes, y luego al año.
 *  - Nunca se sale del selector ni pierde el foco.
 *  - Salida de valor hacia formularios y base de datos: YYYY-MM-DD (ISO).
 *  - Popup flotante con selección directa de:
 *      1. AÑO (dropdown de años)
 *      2. MES (dropdown de meses)
 *      3. DÍA (grilla interactiva de días)
 *      4. Atajos rápidos: Hoy, Ayer, Limpiar.
 */
export const DateInput = forwardRef<HTMLInputElement, DateInputProps>(function DateInput(
  {
    value = "",
    onChange,
    onFechaChange,
    label,
    hint,
    id,
    className = "",
    disabled,
    name,
    placeholder = "DD/MM/AAAA",
    ...rest
  },
  forwardedRef
) {
  const reactId = useId();
  const inputId = id ?? (label ? label.toLowerCase().replace(/[^a-z0-9]+/g, "-") : reactId);

  // Estados de los 3 segmentos
  const partesIniciales = descomponerIso(value);
  const [dia, setDia] = useState(partesIniciales.dia);
  const [mes, setMes] = useState(partesIniciales.mes);
  const [anio, setAnio] = useState(partesIniciales.anio);

  // Popup de selector Año/Mes/Día
  const [abierto, setAbierto] = useState(false);

  // Referencias a los inputs para salto automático de foco
  const diaRef = useRef<HTMLInputElement>(null);
  const mesRef = useRef<HTMLInputElement>(null);
  const anioRef = useRef<HTMLInputElement>(null);
  const contenedorRef = useRef<HTMLDivElement>(null);

  // Asignar forwardedRef a diaRef si existe
  useEffect(() => {
    if (!forwardedRef) return;
    if (typeof forwardedRef === "function") {
      forwardedRef(diaRef.current);
    } else {
      (forwardedRef as React.MutableRefObject<HTMLInputElement | null>).current = diaRef.current;
    }
  }, [forwardedRef]);

  // Sincronizar si cambia `value` externamente
  useEffect(() => {
    const p = descomponerIso(value);
    setDia(p.dia);
    setMes(p.mes);
    setAnio(p.anio);
    if (p.anio && p.mes) {
      setAnioVer(Number(p.anio));
      setMesVer(Number(p.mes) - 1);
    }
  }, [value]);

  // Año y Mes mostrados en el popup
  const hoyIso = hoyIsoLocal();
  const fechaRefIso = value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : hoyIso;
  const [anioVer, setAnioVer] = useState(() => Number(fechaRefIso.slice(0, 4)) || 2026);
  const [mesVer, setMesVer] = useState(() => (Number(fechaRefIso.slice(5, 7)) || 10) - 1);

  // Cerrar al hacer clic fuera del componente
  useEffect(() => {
    if (!abierto) return;
    const handleClickFuera = (ev: MouseEvent) => {
      if (contenedorRef.current && !contenedorRef.current.contains(ev.target as Node)) {
        setAbierto(false);
      }
    };
    document.addEventListener("mousedown", handleClickFuera);
    return () => document.removeEventListener("mousedown", handleClickFuera);
  }, [abierto]);

  const emitirCambio = (nuevoIso: string) => {
    if (onFechaChange) {
      onFechaChange(nuevoIso);
    }
    if (onChange) {
      onChange({ target: { value: nuevoIso, name } });
    }
  };

  // Evalúa y emite si los tres campos están completos
  const evaluarEmision = (d: string, m: string, a: string) => {
    if (!d && !m && !a) {
      emitirCambio("");
      return;
    }
    if (d.length === 2 && m.length === 2 && a.length === 4) {
      const iso = componerIso(d, m, a);
      if (iso) {
        emitirCambio(iso);
        setAnioVer(Number(a));
        setMesVer(Number(m) - 1);
      }
    }
  };

  // Manejo de entrada en DÍA
  const handleDiaChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, "");
    if (raw.length > 2) return;

    // Si escribe un dígito > 3 (ej: 4, 5, 6, 7, 8, 9), auto-anteponer 0 y saltar a mes
    if (raw.length === 1 && Number(raw) >= 4) {
      const dAuto = `0${raw}`;
      setDia(dAuto);
      evaluarEmision(dAuto, mes, anio);
      mesRef.current?.focus();
      mesRef.current?.select();
      return;
    }

    setDia(raw);
    evaluarEmision(raw, mes, anio);

    // Al escribir 2 dígitos, salta automáticamente al mes sin salirse del selector
    if (raw.length === 2) {
      mesRef.current?.focus();
      mesRef.current?.select();
    }
  };

  // Manejo de entrada en MES
  const handleMesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, "");
    if (raw.length > 2) return;

    // Si escribe un dígito >= 2 (ej: 2, 3..9), auto-anteponer 0 y saltar a año
    if (raw.length === 1 && Number(raw) >= 2) {
      const mAuto = `0${raw}`;
      setMes(mAuto);
      evaluarEmision(dia, mAuto, anio);
      anioRef.current?.focus();
      anioRef.current?.select();
      return;
    }

    setMes(raw);
    evaluarEmision(dia, raw, anio);

    // Al escribir 2 dígitos, salta automáticamente al año
    if (raw.length === 2) {
      anioRef.current?.focus();
      anioRef.current?.select();
    }
  };

  // Manejo de entrada en AÑO
  const handleAnioChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, "");
    if (raw.length > 4) return;
    setAnio(raw);
    evaluarEmision(dia, mes, raw);
  };

  // Navegación por teclado (Backspace y flechas)
  const handleDiaKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowRight" || e.key === "/") {
      e.preventDefault();
      mesRef.current?.focus();
      mesRef.current?.select();
    }
  };

  const handleMesKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !mes) {
      e.preventDefault();
      diaRef.current?.focus();
      diaRef.current?.select();
    } else if (e.key === "ArrowLeft") {
      const target = e.currentTarget;
      if (target.selectionStart === 0) {
        e.preventDefault();
        diaRef.current?.focus();
        diaRef.current?.select();
      }
    } else if (e.key === "ArrowRight" || e.key === "/") {
      e.preventDefault();
      anioRef.current?.focus();
      anioRef.current?.select();
    }
  };

  const handleAnioKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !anio) {
      e.preventDefault();
      mesRef.current?.focus();
      mesRef.current?.select();
    } else if (e.key === "ArrowLeft") {
      const target = e.currentTarget;
      if (target.selectionStart === 0) {
        e.preventDefault();
        mesRef.current?.focus();
        mesRef.current?.select();
      }
    }
  };

  // Pegar fecha completa en cualquiera de los campos
  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const texto = e.clipboardData.getData("text").trim();
    // DD/MM/AAAA o DD-MM-AAAA
    let m = texto.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (m) {
      e.preventDefault();
      const d = m[1].padStart(2, "0");
      const me = m[2].padStart(2, "0");
      const a = m[3];
      setDia(d);
      setMes(me);
      setAnio(a);
      evaluarEmision(d, me, a);
      return;
    }
    // YYYY-MM-DD
    m = texto.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) {
      e.preventDefault();
      const a = m[1];
      const me = m[2];
      const d = m[3];
      setDia(d);
      setMes(me);
      setAnio(a);
      evaluarEmision(d, me, a);
    }
  };

  // Seleccionar fecha desde el popup modal
  const seleccionarDesdePopup = (iso: string) => {
    const p = descomponerIso(iso);
    setDia(p.dia);
    setMes(p.mes);
    setAnio(p.anio);
    emitirCambio(iso);
    setAbierto(false);
  };

  // Navegación rápida de meses en popup
  const mesAnterior = () => {
    if (mesVer === 0) {
      setMesVer(11);
      setAnioVer((a) => a - 1);
    } else {
      setMesVer((m) => m - 1);
    }
  };

  const mesSiguiente = () => {
    if (mesVer === 11) {
      setMesVer(0);
      setAnioVer((a) => a + 1);
    } else {
      setMesVer((m) => m + 1);
    }
  };

  // Días del mes a renderizar en popup
  const diasEnMes = new Date(anioVer, mesVer + 1, 0).getDate();
  const primerDiaSemana = new Date(anioVer, mesVer, 1).getDay();
  const desplazamientoInicio = primerDiaSemana === 0 ? 6 : primerDiaSemana - 1;

  // Rango de años
  const anioActual = new Date().getFullYear();
  const opcionesAnios: number[] = [];
  for (let a = anioActual - 5; a <= anioActual + 5; a++) {
    opcionesAnios.push(a);
  }
  if (!opcionesAnios.includes(anioVer)) {
    opcionesAnios.push(anioVer);
    opcionesAnios.sort((a, b) => a - b);
  }

  return (
    <div ref={contenedorRef} className="relative inline-flex flex-col gap-0.5 w-auto max-w-full">
      {label ? (
        <label htmlFor={inputId} className="text-[11px] font-semibold text-slate-600 block">
          {label}
        </label>
      ) : null}

      {/* Contenedor unificado: DÍA / MES / AÑO con bordes limpios y botón calendario */}
      <div
        className={`relative inline-flex items-center justify-between rounded-md border border-line bg-surface px-1.5 py-0.5 text-xs text-slate-900 font-medium
          focus-within:ring-2 focus-within:ring-primary-500 focus-within:border-primary-500
          disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-slate-400 ${className}`}
      >
        <div className="flex items-center">
          {/* Campo DÍA */}
          <input
            id={inputId}
            ref={diaRef}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={2}
            autoComplete="off"
            disabled={disabled}
            placeholder="DD"
            value={dia}
            onChange={handleDiaChange}
            onKeyDown={handleDiaKeyDown}
            onPaste={handlePaste}
            onFocus={(e) => e.target.select()}
            className="w-[1.25rem] text-center bg-transparent outline-none font-bold text-slate-900 placeholder:text-slate-400 p-0 text-xs"
            {...rest}
          />

          <span className="text-slate-400 font-bold select-none px-0.5 text-[11px]">/</span>

          {/* Campo MES */}
          <input
            ref={mesRef}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={2}
            autoComplete="off"
            disabled={disabled}
            placeholder="MM"
            value={mes}
            onChange={handleMesChange}
            onKeyDown={handleMesKeyDown}
            onPaste={handlePaste}
            onFocus={(e) => e.target.select()}
            className="w-[1.25rem] text-center bg-transparent outline-none font-bold text-slate-900 placeholder:text-slate-400 p-0 text-xs"
          />

          <span className="text-slate-400 font-bold select-none px-0.5 text-[11px]">/</span>

          {/* Campo AÑO */}
          <input
            ref={anioRef}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={4}
            autoComplete="off"
            disabled={disabled}
            placeholder="AAAA"
            value={anio}
            onChange={handleAnioChange}
            onKeyDown={handleAnioKeyDown}
            onPaste={handlePaste}
            onFocus={(e) => e.target.select()}
            className="w-[2.25rem] text-center bg-transparent outline-none font-bold text-slate-900 placeholder:text-slate-400 p-0 text-xs"
          />
        </div>

        {/* Botón calendario para abrir consulta emergente de Año, Mes y Día */}
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled}
          onClick={() => {
            if (!disabled) {
              if (!abierto && anio && mes) {
                setAnioVer(Number(anio) || 2026);
                setMesVer((Number(mes) || 10) - 1);
              }
              setAbierto((v) => !v);
            }
          }}
          aria-label="Abrir consulta de fecha (Año, Mes, Día)"
          title="Abrir selector de fecha (Año, Mes, Día)"
          className={`ml-1 shrink-0 p-0.5 rounded transition-colors disabled:opacity-40 flex items-center justify-center ${
            abierto ? "text-indigo-600 bg-indigo-50" : "text-slate-400 hover:text-indigo-600 hover:bg-slate-100"
          }`}
        >
          <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
        </button>
      </div>

      {hint ? <span className="text-[10px] font-normal text-slate-500">{hint}</span> : null}

      {/* POPUP CENTRALIZADO: SELECTOR DE AÑO, MES Y DÍA */}
      {abierto && (
        <div
          className="absolute z-50 left-0 top-full mt-1 w-72 rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl animate-in fade-in zoom-in-95 duration-100"
          style={{ minWidth: "280px" }}
        >
          {/* Cabecera: Selectores de AÑO y MES */}
          <div className="flex items-center justify-between gap-1 mb-2.5 pb-2 border-b border-slate-100">
            <button
              type="button"
              onClick={mesAnterior}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 transition active:scale-95"
              title="Mes anterior"
            >
              ◀
            </button>

            {/* Selector de Mes */}
            <select
              value={mesVer}
              onChange={(e) => setMesVer(Number(e.target.value))}
              className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-black text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {NOMBRES_MESES.map((nombre, idx) => (
                <option key={nombre} value={idx}>
                  {nombre}
                </option>
              ))}
            </select>

            {/* Selector de Año */}
            <select
              value={anioVer}
              onChange={(e) => setAnioVer(Number(e.target.value))}
              className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-black text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {opcionesAnios.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={mesSiguiente}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 transition active:scale-95"
              title="Mes siguiente"
            >
              ▶
            </button>
          </div>

          {/* Días de la semana */}
          <div className="grid grid-cols-7 gap-1 text-center mb-1">
            {DIAS_SEMANA_CORTOS.map((d) => (
              <span key={d} className="text-[10px] font-black text-slate-400">
                {d}
              </span>
            ))}
          </div>

          {/* Grilla de Días */}
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: desplazamientoInicio }).map((_, i) => (
              <span key={`vacio-${i}`} className="h-7 w-7" />
            ))}

            {Array.from({ length: diasEnMes }).map((_, i) => {
              const diaNum = i + 1;
              const isoDia = `${anioVer}-${String(mesVer + 1).padStart(2, "0")}-${String(diaNum).padStart(2, "0")}`;
              const seleccionado = value === isoDia;
              const esHoy = hoyIso === isoDia;

              return (
                <button
                  key={isoDia}
                  type="button"
                  onClick={() => seleccionarDesdePopup(isoDia)}
                  className={`flex h-7 w-7 items-center justify-center rounded-lg text-xs font-bold transition ${
                    seleccionado
                      ? "bg-indigo-600 text-white font-black shadow-md scale-105"
                      : esHoy
                      ? "bg-amber-100 text-amber-900 border border-amber-300 font-black hover:bg-amber-200"
                      : "text-slate-700 hover:bg-slate-100 hover:text-slate-900"
                  }`}
                >
                  {diaNum}
                </button>
              );
            })}
          </div>

          {/* Barra inferior: Hoy, Ayer, Limpiar */}
          <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between text-[11px]">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => seleccionarDesdePopup(hoyIsoLocal())}
                className="rounded px-2 py-0.5 font-black text-indigo-600 hover:bg-indigo-50 transition"
              >
                Hoy
              </button>
              <button
                type="button"
                onClick={() => seleccionarDesdePopup(ayerIsoLocal())}
                className="rounded px-2 py-0.5 font-bold text-slate-600 hover:bg-slate-100 transition"
              >
                Ayer
              </button>
              <button
                type="button"
                onClick={() => {
                  setDia("");
                  setMes("");
                  setAnio("");
                  emitirCambio("");
                  setAbierto(false);
                }}
                className="rounded px-1.5 py-0.5 font-bold text-rose-600 hover:bg-rose-50 transition"
              >
                Limpiar
              </button>
            </div>
            <button
              type="button"
              onClick={() => setAbierto(false)}
              className="rounded px-2 py-0.5 font-black text-slate-400 hover:text-slate-700"
            >
              Cerrar ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
});

export default DateInput;
