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

/** Convierte YYYY-MM-DD a DD/MM/AAAA para visualización estricta. */
export function isoToDmy(iso: string | null | undefined): string {
  if (!iso) return "";
  const match = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return String(iso);
  const [, aaaa, mm, dd] = match;
  return `${dd}/${mm}/${aaaa}`;
}

/** Convierte DD/MM/AAAA a YYYY-MM-DD */
export function dmyToIso(dmy: string): string {
  const match = dmy.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/);
  if (!match) return "";
  const [, dd, mm, aaaa] = match;
  const d = parseInt(dd, 10);
  const m = parseInt(mm, 10);
  const y = parseInt(aaaa, 10);
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2100) return "";
  return `${aaaa}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
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
 *  - Formato estricto visible: DD/MM/AAAA (con escritura continua y máscara automática).
 *  - Salida de valor hacia formularios y base de datos: YYYY-MM-DD (ISO).
 *  - Picker popup centralizado con selección directa de:
 *      1. AÑO (dropdown de años)
 *      2. MES (dropdown de meses)
 *      3. DÍA (grilla interactiva)
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

  const [textoVisible, setTextoVisible] = useState(() => isoToDmy(value));
  const [abierto, setAbierto] = useState(false);

  // Fecha de referencia para el selector (Año y Mes mostrados en el popup)
  const hoyIso = hoyIsoLocal();
  const fechaReferencia = value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : hoyIso;
  const [partesRef] = useState(() => {
    const [y, m, d] = fechaReferencia.split("-").map(Number);
    return { anio: y || 2026, mes: (m || 10) - 1, dia: d || 1 };
  });

  const [anioVer, setAnioVer] = useState(partesRef.anio);
  const [mesVer, setMesVer] = useState(partesRef.mes);

  const contenedorRef = useRef<HTMLDivElement>(null);

  // Sincronizar texto visible si cambia `value` desde el exterior
  useEffect(() => {
    setTextoVisible(isoToDmy(value));
    if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const [y, m] = value.split("-").map(Number);
      setAnioVer(y);
      setMesVer(m - 1);
    }
  }, [value]);

  // Cerrar al hacer clic fuera
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

  const handleTextoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let raw = e.target.value.replace(/[^\d]/g, "");
    if (raw.length > 8) raw = raw.slice(0, 8);

    let formateado = raw;
    if (raw.length > 4) {
      formateado = `${raw.slice(0, 2)}/${raw.slice(2, 4)}/${raw.slice(4)}`;
    } else if (raw.length > 2) {
      formateado = `${raw.slice(0, 2)}/${raw.slice(2)}`;
    }

    setTextoVisible(formateado);

    if (raw.length === 8) {
      const iso = dmyToIso(formateado);
      if (iso) {
        emitirCambio(iso);
        const [y, m] = iso.split("-").map(Number);
        setAnioVer(y);
        setMesVer(m - 1);
      }
    } else if (raw.length === 0) {
      emitirCambio("");
    }
  };

  const handleBlur = () => {
    const iso = dmyToIso(textoVisible);
    if (iso) {
      emitirCambio(iso);
      setTextoVisible(isoToDmy(iso));
    } else if (!textoVisible.trim()) {
      emitirCambio("");
    } else if (value) {
      setTextoVisible(isoToDmy(value));
    }
  };

  // Seleccionar fecha desde el popup
  const seleccionarFecha = (iso: string) => {
    setTextoVisible(isoToDmy(iso));
    emitirCambio(iso);
    setAbierto(false);
  };

  // Navegación rápida de meses
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

  // Días del mes a renderizar
  const diasEnMes = new Date(anioVer, mesVer + 1, 0).getDate();
  const primerDiaSemana = new Date(anioVer, mesVer, 1).getDay(); // 0=Dom, 1=Lun...
  // Ajustar a Lunes=0 ... Domingo=6
  const desplazamientoInicio = primerDiaSemana === 0 ? 6 : primerDiaSemana - 1;

  // Generar rango de años (ej: 2020 a 2032)
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
    <div ref={contenedorRef} className="relative flex flex-col gap-1 w-full">
      {label ? (
        <label htmlFor={inputId} className="text-[11px] font-semibold text-slate-600 block">
          {label}
        </label>
      ) : null}

      <div className="relative flex items-center w-full">
        <input
          id={inputId}
          ref={forwardedRef}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          disabled={disabled}
          placeholder={placeholder}
          value={textoVisible}
          onChange={handleTextoChange}
          onBlur={handleBlur}
          className={`w-full rounded-md border border-line bg-surface px-2.5 py-1.5 pr-8 text-[13px] leading-tight text-slate-900 font-medium
            placeholder:text-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500
            disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-slate-400 ${className}`}
          {...rest}
        />

        {/* Botón para abrir consulta de fecha */}
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled}
          onClick={() => {
            if (!disabled) {
              if (!abierto && value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
                const [y, m] = value.split("-").map(Number);
                setAnioVer(y);
                setMesVer(m - 1);
              }
              setAbierto((v) => !v);
            }
          }}
          aria-label="Abrir consulta de fecha (Año, Mes, Día)"
          title="Abrir selector de fecha (Año, Mes, Día)"
          className={`absolute right-1 top-1/2 -translate-y-1/2 p-1 rounded transition-colors disabled:opacity-40 ${
            abierto ? "text-indigo-600 bg-indigo-50" : "text-slate-400 hover:text-indigo-600 hover:bg-slate-100"
          }`}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
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
            {/* Espacios vacíos antes del día 1 */}
            {Array.from({ length: desplazamientoInicio }).map((_, i) => (
              <span key={`vacio-${i}`} className="h-7 w-7" />
            ))}

            {/* Días del mes (1..diasEnMes) */}
            {Array.from({ length: diasEnMes }).map((_, i) => {
              const diaNum = i + 1;
              const isoDia = `${anioVer}-${String(mesVer + 1).padStart(2, "0")}-${String(diaNum).padStart(2, "0")}`;
              const seleccionado = value === isoDia;
              const esHoy = hoyIso === isoDia;

              return (
                <button
                  key={isoDia}
                  type="button"
                  onClick={() => seleccionarFecha(isoDia)}
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

          {/* Barra inferior de atajos: Hoy, Ayer, Limpiar */}
          <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between text-[11px]">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => seleccionarFecha(hoyIsoLocal())}
                className="rounded px-2 py-0.5 font-black text-indigo-600 hover:bg-indigo-50 transition"
              >
                Hoy
              </button>
              <button
                type="button"
                onClick={() => seleccionarFecha(ayerIsoLocal())}
                className="rounded px-2 py-0.5 font-bold text-slate-600 hover:bg-slate-100 transition"
              >
                Ayer
              </button>
              <button
                type="button"
                onClick={() => {
                  setTextoVisible("");
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
