"use client";

import React from "react";
import type { EstadoCarreraGrupo } from "../lib/chat-p2p";
import { obtenerColorGualdrapa } from "../lib/chat-p2p";

interface Props {
  carrera: EstadoCarreraGrupo;
  horaPublicacion?: string;
  esOperadorOAdmin?: boolean;
  onEliminar?: () => void;
  onEjemplarClick?: (num: string | number) => void;
}

export function SalaTarjetaCarreraGrafica({
  carrera,
  horaPublicacion,
  esOperadorOAdmin,
  onEliminar,
  onEjemplarClick,
}: Props) {
  const ejemplares = carrera.ejemplares ?? [];

  return (
    <div className="w-full max-w-md rounded-2xl bg-gradient-to-b from-[#1f2c34] to-[#111b21] border border-[#2a3942] p-3.5 shadow-xl text-white select-none">
      {/* Cabecera de la Tarjeta Gráfica */}
      <div className="flex items-center justify-between border-b border-[#2a3942] pb-2 mb-2.5">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-400 text-lg shadow">
            🏇
          </div>
          <div className="flex flex-col">
            <span className="text-xs font-black uppercase tracking-wider text-emerald-400">
              PROGRAMA OFICIAL DE CARRERA
            </span>
            <span className="text-sm font-extrabold text-white">
              {carrera.hipodromo} · CARRERA {carrera.carrera}
            </span>
          </div>
        </div>

        {/* Solo borrable por Operador */}
        {esOperadorOAdmin && onEliminar && (
          <button
            type="button"
            onClick={onEliminar}
            className="flex h-7 w-7 items-center justify-center rounded-lg bg-red-950/40 text-red-400 hover:bg-red-900/60 transition-colors"
            title="Eliminar tarjeta gráfica (Exclusivo Operador)"
          >
            🗑️
          </button>
        )}
      </div>

      {/* Metadatos: Distancia, Superficie, Estado */}
      <div className="flex items-center justify-between rounded-xl bg-[#202c33]/70 px-3 py-1.5 mb-2.5 text-[11px] font-mono text-[#8696a0]">
        <span>📏 {carrera.distancia || "1200m"}</span>
        <span>🌱 {carrera.superficie || "Arena"}</span>
        <span className="font-bold text-emerald-400">🟢 {carrera.estado}</span>
      </div>

      {/* Lista de Caballos con Gualdrapas Oficiales */}
      <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
        {ejemplares.length > 0 ? (
          ejemplares.map((ej) => {
            const gualdrapa = obtenerColorGualdrapa(ej.numero);
            return (
              <div
                key={ej.numero}
                onClick={() => onEjemplarClick?.(ej.numero)}
                className={`flex items-center justify-between p-2 rounded-xl border border-[#2a3942]/60 bg-[#1a252c] hover:bg-[#22313a] hover:border-[#00a884] transition-all cursor-pointer ${
                  ej.retirado ? "opacity-40 line-through" : ""
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div
                    style={{
                      backgroundColor: gualdrapa.bg,
                      color: gualdrapa.text,
                      borderColor: gualdrapa.border,
                    }}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-mono font-black text-xs shadow border"
                  >
                    {ej.numero}
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="text-xs font-bold truncate text-[#e9edef]">
                      {ej.nombre}
                    </span>
                    <span className="text-[10px] text-[#8696a0] truncate">
                      {ej.jockey || "Jinete"} {ej.peso ? `(${ej.peso} kg)` : ""}
                    </span>
                  </div>
                </div>

                <div className="shrink-0 text-right">
                  <span className="rounded bg-[#111b21] px-2 py-0.5 font-mono text-xs font-black text-[#00a884] tabular-nums">
                    {ej.ml || "3-1"}
                  </span>
                </div>
              </div>
            );
          })
        ) : (
          <div className="p-3 text-center text-xs text-[#8696a0]">
            Ejemplares no precargados para esta carrera.
          </div>
        )}
      </div>

      {/* Pie de foto de la tarjeta */}
      <div className="flex items-center justify-between pt-2 mt-2 border-t border-[#2a3942] text-[10px] text-[#8696a0]">
        <span>Agente IA Oficial · Taquilla Abierta</span>
        <span className="font-mono">{horaPublicacion || "Hoy"}</span>
      </div>
    </div>
  );
}
