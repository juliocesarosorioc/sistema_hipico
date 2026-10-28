"use client";

import React, { useState, useEffect, useRef, forwardRef } from "react";

export interface DateInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> {
  value?: string; // Formato ISO YYYY-MM-DD
  onChange?: (e: { target: { value: string; name?: string } }) => void;
  onFechaChange?: (isoDate: string) => void;
  label?: string;
  hint?: string;
}

/**
 * Convierte YYYY-MM-DD a DD/MM/AAAA para visualización.
 */
function isoToDmy(iso: string | null | undefined): string {
  if (!iso) return "";
  const match = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return String(iso);
  const [, aaaa, mm, dd] = match;
  return `${dd}/${mm}/${aaaa}`;
}

/**
 * Convierte DD/MM/AAAA a YYYY-MM-DD
 */
function dmyToIso(dmy: string): string {
  const match = dmy.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/);
  if (!match) return "";
  const [, dd, mm, aaaa] = match;
  const d = parseInt(dd, 10);
  const m = parseInt(mm, 10);
  const y = parseInt(aaaa, 10);
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2100) return "";
  return `${aaaa}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

/**
 * DateInput (Señalador y selector continuo de fecha)
 *
 * Permite escribir continuamente con el teclado desde el día hasta el año (DD/MM/AAAA),
 * insertando automáticamente las barras '/' de separación a medida que el usuario teclea
 * (ejemplo: escribir 28102026 produce de inmediato 28/10/2026 y sincroniza 2026-10-28).
 * También incluye un botón de calendario para seleccionar con selector gráfico si se prefiere.
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
  const [textoVisible, setTextoVisible] = useState(() => isoToDmy(value));
  const hiddenDateRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTextoVisible(isoToDmy(value));
  }, [value]);

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

  const abrirCalendarioNativo = () => {
    if (hiddenDateRef.current && !disabled) {
      if ("showPicker" in HTMLInputElement.prototype) {
        try {
          hiddenDateRef.current.showPicker();
        } catch {
          hiddenDateRef.current.focus();
        }
      } else {
        hiddenDateRef.current.focus();
      }
    }
  };

  const inputId = id ?? (label ? label.toLowerCase().replace(/[^a-z0-9]+/g, "-") : undefined);

  return (
    <div className="flex flex-col gap-1 w-full">
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

        <button
          type="button"
          tabIndex={-1}
          disabled={disabled}
          onClick={abrirCalendarioNativo}
          aria-label="Abrir calendario"
          className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-primary-600 p-1 rounded transition-colors disabled:opacity-40"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
        </button>

        <input
          ref={hiddenDateRef}
          type="date"
          value={value}
          disabled={disabled}
          onChange={(e) => {
            const v = e.target.value;
            setTextoVisible(isoToDmy(v));
            emitirCambio(v);
          }}
          className="sr-only pointer-events-none absolute -bottom-2 -left-2 h-0 w-0 opacity-0"
          tabIndex={-1}
          aria-hidden="true"
        />
      </div>

      {hint ? <span className="text-[10px] font-normal text-slate-500">{hint}</span> : null}
    </div>
  );
});

export default DateInput;
