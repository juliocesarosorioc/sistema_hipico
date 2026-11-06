"use client";

import React, { useState } from "react";
import type { GrupoSala } from "../lib/chat-p2p";

interface Props {
  grupos: GrupoSala[];
  grupoActivoId: string;
  onSeleccionarGrupo: (grupoId: string) => void;
  nombreUsuario: string;
}

export function SalaLeftPanelGrupos({
  grupos,
  grupoActivoId,
  onSeleccionarGrupo,
  nombreUsuario,
}: Props) {
  const [busqueda, setBusqueda] = useState("");

  const gruposFiltrados = grupos.filter((g) =>
    g.nombre.toLowerCase().includes(busqueda.toLowerCase())
  );

  return (
    <aside className="flex flex-col h-full w-full sm:w-80 md:w-96 bg-[#111b21] border-r border-[#222e35] text-[#e9edef] select-none">
      {/* 1. Header del panel izquierdo estilo WhatsApp Web */}
      <div className="flex h-16 items-center justify-between bg-[#202c33] px-4 py-2 border-b border-[#222e35]">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#00a884] text-white font-bold text-lg shadow-sm">
            {nombreUsuario ? nombreUsuario.charAt(0).toUpperCase() : "👤"}
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-bold text-[#e9edef]">{nombreUsuario}</span>
            <span className="text-[11px] text-[#00a884] font-medium flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-[#00a884] animate-pulse" /> En línea
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 text-[#aebac1]">
          <span title="Salas Oficiales y Grupos Independientes" className="text-xs bg-[#111b21] px-2 py-1 rounded-md text-[#8696a0]">
            PWA · Web
          </span>
        </div>
      </div>

      {/* 2. Buscador de Grupos y Chats */}
      <div className="p-2 bg-[#111b21] border-b border-[#222e35]">
        <div className="flex items-center rounded-lg bg-[#202c33] px-3 py-1.5 gap-2 border border-transparent focus-within:border-[#00a884]/60">
          <span className="text-xs text-[#8696a0]">🔍</span>
          <input
            type="text"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar grupo o canal..."
            className="w-full bg-transparent text-xs text-[#e9edef] placeholder-[#8696a0] focus:outline-none"
          />
        </div>
      </div>

      {/* 3. Lista de Canales y Grupos */}
      <div className="flex-1 overflow-y-auto divide-y divide-[#222e35]/50">
        {/* Canal Privado con el Agente IA Bot */}
        <div
          onClick={() => onSeleccionarGrupo("bot-privado")}
          className={`flex items-center gap-3 px-3 py-3 cursor-pointer transition-colors ${
            grupoActivoId === "bot-privado" ? "bg-[#2a3942]" : "hover:bg-[#202c33]"
          }`}
        >
          <div className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-tr from-[#128c7e] to-[#00a884] text-white text-xl shadow">
            🤖
            <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full bg-emerald-400 border-2 border-[#111b21]" />
          </div>
          <div className="flex flex-col min-w-0 flex-1">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-[#e9edef] truncate">Agente IA Oficial (DM)</span>
              <span className="text-[10px] text-[#00a884] font-bold">Privado</span>
            </div>
            <p className="text-xs text-[#8696a0] truncate">
              Consultas privadas de saldo, liquidaciones y jugadas seguras
            </p>
          </div>
        </div>

        {/* Separador */}
        <div className="px-3 py-1.5 bg-[#182229] text-[10px] font-bold uppercase tracking-wider text-[#8696a0]">
          Grupos Oficiales de Jugadas
        </div>

        {/* Grupos Dinámicos */}
        {gruposFiltrados.map((g) => {
          const esActivo = g.id === grupoActivoId;
          return (
            <div
              key={g.id}
              onClick={() => onSeleccionarGrupo(g.id)}
              className={`flex items-center gap-3 px-3 py-3 cursor-pointer transition-colors ${
                esActivo ? "bg-[#2a3942]" : "hover:bg-[#202c33]"
              }`}
            >
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#1f2c34] text-2xl border border-[#2a3942]">
                🐎
              </div>
              <div className="flex flex-col min-w-0 flex-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-[#e9edef] truncate">{g.nombre}</span>
                  {g.noLeidos && g.noLeidos > 0 ? (
                    <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-[#00a884] px-1 text-[10px] font-black text-white">
                      {g.noLeidos}
                    </span>
                  ) : null}
                </div>
                <div className="flex items-center justify-between text-xs text-[#8696a0]">
                  <span className="truncate">{g.descripcion || "Sala P2P multi-operador"}</span>
                  <span className="text-[10px] text-[#00a884]">FIFO</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
