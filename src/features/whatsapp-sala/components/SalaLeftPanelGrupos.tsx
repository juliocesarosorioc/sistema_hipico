"use client";

import React, { useState } from "react";
import type { GrupoSala } from "../lib/chat-p2p";

interface Props {
  grupos: GrupoSala[];
  grupoActivoId: string;
  onSeleccionarGrupo: (grupoId: string) => void;
  nombreUsuario: string;
  esOperadorOAdmin?: boolean;
  onCrearSala?: (nombre: string, descripcion?: string) => Promise<{ ok: boolean; error?: string }>;
}

export function SalaLeftPanelGrupos({
  grupos,
  grupoActivoId,
  onSeleccionarGrupo,
  nombreUsuario,
  esOperadorOAdmin,
  onCrearSala,
}: Props) {
  const [busqueda, setBusqueda] = useState("");
  const [modalNuevaSala, setModalNuevaSala] = useState(false);
  const [nombreNuevaSala, setNombreNuevaSala] = useState("");
  const [descNuevaSala, setDescNuevaSala] = useState("");
  const [guardandoSala, setGuardandoSala] = useState(false);
  const [errorSala, setErrorSala] = useState<string | null>(null);

  const gruposFiltrados = grupos.filter((g) =>
    g.nombre.toLowerCase().includes(busqueda.toLowerCase())
  );

  const handleGuardarNuevaSala = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nombreNuevaSala.trim()) return;
    setGuardandoSala(true);
    setErrorSala(null);
    try {
      if (onCrearSala) {
        const res = await onCrearSala(nombreNuevaSala.trim(), descNuevaSala.trim() || undefined);
        if (res.ok) {
          setNombreNuevaSala("");
          setDescNuevaSala("");
          setModalNuevaSala(false);
        } else {
          setErrorSala(res.error || "No se pudo crear la sala");
        }
      }
    } catch (err: any) {
      setErrorSala(err.message || "Error al crear la sala");
    } finally {
      setGuardandoSala(false);
    }
  };

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
          {esOperadorOAdmin && (
            <button
              onClick={() => setModalNuevaSala(true)}
              title="Crear Nueva Sala (Administrador)"
              className="flex items-center gap-1 text-xs bg-[#00a884] hover:bg-[#029071] text-white px-2.5 py-1 rounded-md font-semibold transition active:scale-95 shadow-sm"
            >
              <span>➕</span>
              <span className="hidden sm:inline">Nueva Sala</span>
            </button>
          )}
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
        <div className="flex items-center justify-between px-3 py-1.5 bg-[#182229] text-[10px] font-bold uppercase tracking-wider text-[#8696a0]">
          <span>Grupos Oficiales de Jugadas</span>
          {esOperadorOAdmin && (
            <button
              onClick={() => setModalNuevaSala(true)}
              className="text-[#00a884] hover:underline normal-case font-semibold text-[11px] flex items-center gap-0.5"
            >
              <span>+ Crear sala</span>
            </button>
          )}
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

      {/* Modal Crear Nueva Sala para Administrador */}
      {modalNuevaSala && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-xl bg-[#202c33] border border-[#2a3942] p-5 text-[#e9edef] shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between mb-4 border-b border-[#2a3942] pb-3">
              <h3 className="text-base font-bold text-[#e9edef] flex items-center gap-2">
                <span>🏛️</span> Nueva Sala de Chat
              </h3>
              <button
                type="button"
                onClick={() => setModalNuevaSala(false)}
                className="text-[#8696a0] hover:text-[#e9edef] text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleGuardarNuevaSala} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#8696a0] mb-1">
                  Nombre de la Sala *
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  value={nombreNuevaSala}
                  onChange={(e) => setNombreNuevaSala(e.target.value)}
                  placeholder="Ej. SALA VALENCIA VIP, SALA USA"
                  className="w-full rounded-lg bg-[#111b21] border border-[#2a3942] px-3 py-2 text-sm text-[#e9edef] placeholder-[#8696a0] focus:border-[#00a884] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#8696a0] mb-1">
                  Descripción o Responsable
                </label>
                <input
                  type="text"
                  value={descNuevaSala}
                  onChange={(e) => setDescNuevaSala(e.target.value)}
                  placeholder="Ej. Jugadas de puestos y paradas en vivo"
                  className="w-full rounded-lg bg-[#111b21] border border-[#2a3942] px-3 py-2 text-sm text-[#e9edef] placeholder-[#8696a0] focus:border-[#00a884] focus:outline-none"
                />
              </div>

              {errorSala && (
                <div className="rounded-lg bg-red-950/60 border border-red-800/80 p-2.5 text-xs text-red-300">
                  ⚠️ {errorSala}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setModalNuevaSala(false)}
                  className="rounded-lg bg-[#111b21] px-3 py-2 text-xs font-medium text-[#8696a0] hover:text-[#e9edef] hover:bg-[#2a3942]"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={guardandoSala || !nombreNuevaSala.trim()}
                  className="flex items-center gap-1.5 rounded-lg bg-[#00a884] hover:bg-[#029071] px-4 py-2 text-xs font-bold text-white disabled:opacity-50 active:scale-95 transition"
                >
                  {guardandoSala ? "Creando..." : "Crear Sala"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </aside>
  );
}
