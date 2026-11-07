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
    <header className="flex h-16 w-full items-center justify-between bg-[#008069] px-3 sm:px-4 text-white shadow-md z-30 select-none">
      {/* 1. Logo / Info de Sala y Carrera Activa */}
      <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
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
              {nombreSala || "SALA OFICIAL HÍPICA"}
              {nombreGrupo ? ` · ${nombreGrupo}` : ""}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
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

      {/* 2. Control Deslizador de Letra (A- / A+) y Billetera Personal */}
      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
        {/* Controles de Escala de Letra A- / A+ */}
        <div className="hidden xs:flex items-center bg-black/20 rounded-full px-2 py-0.5 border border-white/10 gap-1 text-[11px]">
          <button
            type="button"
            onClick={() => onCambiarTamanoLetra(Math.max(12, tamanoLetra - 1))}
            className="px-1 font-black hover:text-emerald-200 transition-colors"
            title="Reducir tamaño de letra"
          >
            A-
          </button>
          <span className="text-[10px] font-mono tabular-nums text-white/80">{tamanoLetra}px</span>
          <button
            type="button"
            onClick={() => onCambiarTamanoLetra(Math.min(24, tamanoLetra + 1))}
            className="px-1 font-black hover:text-emerald-200 transition-colors"
            title="Aumentar tamaño de letra"
          >
            A+
          </button>
        </div>

        {/* Toggle Operador Apertura / Cierre */}
        {esOperadorOAdmin && onToggleEstadoCarrera && (
          <button
            onClick={onToggleEstadoCarrera}
            title={esCerrada ? "Abrir Carrera" : "Cerrar Carrera"}
            className={`hidden sm:inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold shadow-sm transition-all ${
              esCerrada
                ? "bg-emerald-500 text-white hover:bg-emerald-600"
                : "bg-red-600 text-white hover:bg-red-700 animate-pulse"
            }`}
          >
            {esCerrada ? "🟢 Abrir" : "🔴 Cerrar"}
          </button>
        )}

        {/* Billetera Personal Estricta (Privada) */}
        <div className="flex items-center gap-1.5 rounded-full bg-black/25 px-2.5 sm:px-3 py-1 backdrop-blur-sm border border-white/10 text-right">
          <div className="flex flex-col text-right">
            <span className="text-[9px] uppercase font-bold text-emerald-200 truncate max-w-[80px] sm:max-w-[120px]">
              {nombreUsuario}
            </span>
            <div className="text-xs font-mono font-black tabular-nums text-white flex items-center justify-end gap-1">
              {ocultarSaldo ? (
                <span className="text-slate-300 tracking-wider">$ ••••</span>
              ) : esLibre ? (
                <span className="text-amber-300">⭐ LIBRE</span>
              ) : (
                <span>
                  ${disp.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  {enJuego > 0 && (
                    <span className="text-[9px] text-amber-300 ml-1 font-normal" title="Saldo en juego">
                      (-${enJuego.toFixed(0)})
                    </span>
                  )}
                </span>
              )}
            </div>
          </div>

          {/* Botón de Ocultar Saldo 👁️ */}
          <button
            type="button"
            onClick={toggleOcultar}
            className="text-xs p-1 rounded-full hover:bg-white/10 text-emerald-100 hover:text-white transition-colors"
            title={ocultarSaldo ? "Mostrar saldo disponible" : "Ocultar saldo con asteriscos"}
          >
            {ocultarSaldo ? "🙈" : "👁️"}
          </button>
        </div>

        {/* Botón Panel Derecho (Caballos y Tickets) */}
        <button
          type="button"
          onClick={onTogglePanelDerecho}
          className={`flex h-8 w-8 items-center justify-center rounded-full text-xs transition-colors ${
            panelDerechoAbierto ? "bg-white text-[#008069] shadow-sm font-bold" : "bg-black/20 hover:bg-black/30 text-white"
          }`}
          title="Ver caballos y tickets de la carrera"
        >
          📋
        </button>

        {/* Salir / Cambiar Sesión */}
        <button
          type="button"
          onClick={onCerrarSesion}
          title="Cerrar sesión"
          className="flex h-8 w-8 items-center justify-center rounded-full bg-black/20 hover:bg-black/30 text-white text-xs transition-colors"
        >
          🚪
        </button>
      </div>
    </header>
  );
}
