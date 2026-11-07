"use client";

import React, { useState, useEffect } from "react";
import type { SaldoPrivado, EstadoCarreraGrupo } from "../lib/chat-p2p";

interface Props {
  carreraActiva: EstadoCarreraGrupo;
  saldo: SaldoPrivado | null;
  nombreUsuario: string;
  nombreSala?: string;
  nombreGrupo?: string;
  esOperadorOAdmin?: boolean;
  tamanoLetra: number;
  onCambiarTamanoLetra: (tamano: number) => void;
  onTogglePanelDerecho: () => void;
  panelDerechoAbierto: boolean;
  onToggleEstadoCarrera?: () => void;
  onCambiarNumeroCarrera?: (carrera: number) => void;
  onCerrarSesion: () => void;
}

export function SalaHeaderWallet({
  carreraActiva,
  saldo,
  nombreUsuario,
  nombreSala,
  nombreGrupo,
  esOperadorOAdmin,
  tamanoLetra,
  onCambiarTamanoLetra,
  onTogglePanelDerecho,
  panelDerechoAbierto,
  onToggleEstadoCarrera,
  onCambiarNumeroCarrera,
  onCerrarSesion,
}: Props) {
  const [ocultarSaldo, setOcultarSaldo] = useState(false);

  useEffect(() => {
    try {
      const guardado = localStorage.getItem("hipico_ocultar_saldo_wallet");
      if (guardado !== null) {
        setOcultarSaldo(guardado === "true");
      }
    } catch {
      /* ignore */
    }
  }, []);

  const toggleOcultar = () => {
    const nuevo = !ocultarSaldo;
    setOcultarSaldo(nuevo);
    try {
      localStorage.setItem("hipico_ocultar_saldo_wallet", String(nuevo));
    } catch {
      /* ignore */
    }
  };

  const esCerrada = carreraActiva.estado === "CERRADA" || carreraActiva.estado === "LIQUIDADA";
  const esLibre = saldo?.libre;
  const disp = saldo?.disponible ?? 0;
  const enJuego = saldo?.riesgo_en_curso ?? 0;

  return (
    <header
      style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Helvetica, Arial, sans-serif' }}
      className="flex h-16 w-full items-center justify-between bg-[#008069] px-3 sm:px-4 text-white shadow-md z-30 select-none antialiased"
    >
      {/* 1. Logo / Info de Sala y Carrera Activa */}
      <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
        <button
          type="button"
          onClick={() => {
            if (typeof window !== "undefined") window.location.href = "/inicio";
          }}
          title="Salir al Sistema Principal"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-black/20 hover:bg-black/35 text-white text-sm font-bold transition-colors cursor-pointer"
        >
          ←
        </button>

        <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#128c7e] text-xl font-bold shadow-sm border border-white/20">
          🐎
          <span
            className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-[#008069] ${
              esCerrada ? "bg-red-500" : "bg-emerald-400"
            }`}
          />
        </div>

        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-1.5 truncate">
            <span className="font-bold text-xs sm:text-sm text-white truncate">
              {nombreSala || "SALA DE JUEGOS"}
              {nombreGrupo ? ` · ${nombreGrupo}` : ""}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold ${
                esCerrada ? "bg-red-700/90 text-white" : "bg-emerald-800/80 text-emerald-100"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${esCerrada ? "bg-white" : "bg-emerald-300 animate-pulse"}`}
              />
              <span className="font-mono tabular-nums uppercase">
                {carreraActiva.hipodromo} C{carreraActiva.carrera} · {carreraActiva.estado}
              </span>
            </span>
          </div>
        </div>
      </div>

      {/* 2. Opciones de Carrera y Ver Ejemplares */}
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={onTogglePanelDerecho}
          title="Ver ejemplares e inscritos de esta carrera"
          className="inline-flex items-center gap-1.5 rounded-xl bg-black/25 hover:bg-black/40 px-2.5 py-1.5 text-xs font-bold text-white shadow-sm border border-white/10 active:scale-95 transition-all cursor-pointer"
        >
          <span>🏇</span>
          <span className="hidden sm:inline">Ejemplares (C{carreraActiva.carrera})</span>
        </button>

        {esOperadorOAdmin && onToggleEstadoCarrera && (
          <button
            type="button"
            onClick={onToggleEstadoCarrera}
            title={esCerrada ? "Abrir Carrera" : "Cerrar Carrera"}
            className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-black shadow-md transition-all cursor-pointer ${
              esCerrada
                ? "bg-emerald-500 text-white hover:bg-emerald-600 active:scale-95"
                : "bg-red-600 text-white hover:bg-red-700 active:scale-95 animate-pulse"
            }`}
          >
            <span>{esCerrada ? "🟢 Abrir Carrera" : "🔴 Cerrar Carrera"}</span>
          </button>
        )}
      </div>
    </header>
  );
}
