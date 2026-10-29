"use client";

import React from "react";
import type { OpcionSemanaPortal } from "@/features/portal/lib/semanas-portal";

type Props = {
  semanaSeleccionada: OpcionSemanaPortal | null;
  semanaActual: OpcionSemanaPortal;
  opciones: OpcionSemanaPortal[];
  verTodoHistorico: boolean;
  onSeleccionarSemana: (sem: OpcionSemanaPortal) => void;
  onToggleTodoHistorico: () => void;
  onIrSemanaActual: () => void;
  onAnterior: () => void;
  onSiguiente: () => void;
  tieneSiguiente: boolean;
};

export function BarraConsultaSemanaPortal({
  semanaSeleccionada,
  semanaActual,
  opciones,
  verTodoHistorico,
  onSeleccionarSemana,
  onToggleTodoHistorico,
  onIrSemanaActual,
  onAnterior,
  onSiguiente,
  tieneSiguiente,
}: Props) {
  const esActual = !verTodoHistorico && semanaSeleccionada?.key === semanaActual.key;

  return (
    <div className="rounded-2xl border border-line bg-white p-3 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        {/* Lado izquierdo: Título e indicador de semana */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-50 text-base leading-none text-indigo-700">
              📅
            </span>
            <span className="text-[11px] font-black uppercase tracking-wider text-slate-600">
              Consulta Semanal:
            </span>
          </div>

          {/* Badge de estado actual vs anterior */}
          {verTodoHistorico ? (
            <span className="rounded-full bg-slate-900 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-white">
              📚 Histórico Completo
            </span>
          ) : esActual ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-emerald-800">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Semana Actual (En Curso)
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-amber-800">
              <span>⏮️</span> Semana Anterior
            </span>
          )}
        </div>

        {/* Lado derecho: Controles de navegación y selector */}
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Botón semana anterior */}
          <button
            type="button"
            onClick={onAnterior}
            title="Ver semana anterior"
            className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-black text-slate-700 hover:bg-slate-100 active:scale-95 transition"
          >
            <span>◀</span>
            <span className="hidden sm:inline">Anterior</span>
          </button>

          {/* Selector desplegable de semanas */}
          <select
            value={verTodoHistorico ? "TODO" : (semanaSeleccionada?.key ?? semanaActual.key)}
            onChange={(e) => {
              const val = e.target.value;
              if (val === "TODO") {
                onToggleTodoHistorico();
              } else {
                const encontrada = opciones.find((op) => op.key === val);
                if (encontrada) onSeleccionarSemana(encontrada);
              }
            }}
            className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-indigo-300"
          >
            {opciones.map((op) => (
              <option key={op.key} value={op.key}>
                {op.esActual ? `⭐ ${op.label}` : op.label}
              </option>
            ))}
            <option value="TODO">📚 Ver Todo el Histórico (Sin filtro de semana)</option>
          </select>

          {/* Botón semana siguiente */}
          <button
            type="button"
            onClick={onSiguiente}
            disabled={!tieneSiguiente || verTodoHistorico}
            title={tieneSiguiente ? "Ver semana siguiente" : "Ya estás en la semana actual"}
            className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-black text-slate-700 hover:bg-slate-100 active:scale-95 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <span className="hidden sm:inline">Siguiente</span>
            <span>▶</span>
          </button>

          {/* Botón rápido para volver a Semana Actual si no está en ella */}
          {(!esActual || verTodoHistorico) && (
            <button
              type="button"
              onClick={onIrSemanaActual}
              title="Volver a la semana en curso"
              className="rounded-lg bg-indigo-600 px-2.5 py-1.5 text-xs font-black text-white hover:bg-indigo-500 shadow-sm transition"
            >
              Semana Actual
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
