"use client";

import React, { useState } from "react";
import type { EstadoCarreraGrupo, TicketP2P } from "../lib/chat-p2p";
import { obtenerColorGualdrapa } from "../lib/chat-p2p";

interface Props {
  carreraActiva: EstadoCarreraGrupo;
  tickets: TicketP2P[];
  abierto: boolean;
  onCerrar: () => void;
  nombreUsuario: string;
  onEjemplarClick?: (num: string | number) => void;
}

export function SalaRightPanelCarrera({
  carreraActiva,
  tickets,
  abierto,
  onCerrar,
  nombreUsuario,
  onEjemplarClick,
}: Props) {
  const [pestana, setPestana] = useState<"ejemplares" | "tickets">("ejemplares");
  const [soloMios, setSoloMios] = useState(false);

  if (!abierto) return null;

  const ticketsFiltrados = tickets.filter((t) => {
    if (!soloMios) return true;
    const n = nombreUsuario.toUpperCase();
    return t.juega_nombre.toUpperCase() === n || t.da_nombre.toUpperCase() === n;
  });

  const totalMontoTickets = ticketsFiltrados.reduce((acc, t) => acc + Number(t.monto || 0), 0);

  return (
    <aside className="fixed inset-y-0 right-0 z-40 flex w-full max-w-sm flex-col bg-[#111b21] text-[#e9edef] shadow-2xl border-l border-[#222e35] select-none animate-in slide-in-from-right duration-200">
      {/* 1. Header del panel */}
      <div className="flex h-16 items-center justify-between bg-[#202c33] px-4 border-b border-[#222e35]">
        <div className="flex flex-col">
          <span className="text-sm font-bold text-white flex items-center gap-1.5">
            <span>🏇</span> {carreraActiva.hipodromo} · C{carreraActiva.carrera}
          </span>
          <span className="text-[11px] text-[#8696a0] font-mono">
            {carreraActiva.distancia || "1200m"} · {carreraActiva.superficie || "Arena"} ·{" "}
            <span
              className={`font-bold ${
                carreraActiva.estado === "ABIERTA" ? "text-emerald-400" : "text-red-400"
              }`}
            >
              {carreraActiva.estado}
            </span>
          </span>
        </div>

        <button
          onClick={onCerrar}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-[#111b21] hover:bg-[#2a3942] text-[#8696a0] hover:text-white transition-colors"
          title="Cerrar panel"
        >
          ✕
        </button>
      </div>

      {/* 2. Pestañas: Ejemplares vs Tickets */}
      <div className="flex border-b border-[#222e35] bg-[#182229]">
        <button
          onClick={() => setPestana("ejemplares")}
          className={`flex-1 py-2.5 text-xs font-bold transition-all border-b-2 ${
            pestana === "ejemplares"
              ? "border-[#00a884] text-[#00a884] bg-[#202c33]/50"
              : "border-transparent text-[#8696a0] hover:text-white"
          }`}
        >
          🏇 Ejemplares ({carreraActiva.ejemplares?.length || 0})
        </button>
        <button
          onClick={() => setPestana("tickets")}
          className={`flex-1 py-2.5 text-xs font-bold transition-all border-b-2 ${
            pestana === "tickets"
              ? "border-[#00a884] text-[#00a884] bg-[#202c33]/50"
              : "border-transparent text-[#8696a0] hover:text-white"
          }`}
        >
          🎫 Tickets P2P ({tickets.length})
        </button>
      </div>

      {/* 3. Contenido según pestaña activa */}
      <div className="flex-1 overflow-y-auto p-3">
        {pestana === "ejemplares" ? (
          <div className="space-y-2">
            <div className="text-[11px] text-[#8696a0] pb-1 flex justify-between">
              <span>Toca un ejemplar para proponer jugada</span>
              <span className="font-bold">ML / Jinete</span>
            </div>

            {carreraActiva.ejemplares && carreraActiva.ejemplares.length > 0 ? (
              carreraActiva.ejemplares.map((ej) => {
                const gualdrapa = obtenerColorGualdrapa(ej.numero);
                return (
                  <div
                    key={ej.numero}
                    onClick={() => onEjemplarClick?.(ej.numero)}
                    className={`flex items-center justify-between p-2.5 rounded-xl border transition-all cursor-pointer ${
                      ej.retirado
                        ? "bg-red-950/20 border-red-900/40 opacity-60"
                        : "bg-[#202c33] border-[#2a3942] hover:border-[#00a884] hover:bg-[#25323a]"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      {/* Disco de gualdrapa con colores oficiales */}
                      <div
                        style={{
                          backgroundColor: gualdrapa.bg,
                          color: gualdrapa.text,
                          borderColor: gualdrapa.border,
                        }}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-mono font-black text-sm shadow border-2"
                        title={`Gualdrapa oficial: ${gualdrapa.nombreColor}`}
                      >
                        {ej.numero}
                      </div>

                      <div className="flex flex-col">
                        <span
                          className={`text-xs font-bold ${
                            ej.retirado ? "line-through text-red-400" : "text-[#e9edef]"
                          }`}
                        >
                          {ej.nombre}
                          {ej.retirado && <span className="ml-1 text-[10px] text-red-400">(RET)</span>}
                        </span>
                        <span className="text-[10px] text-[#8696a0]">
                          {ej.jockey || "Jinete"} {ej.peso ? `· ${ej.peso}kg` : ""}
                        </span>
                      </div>
                    </div>

                    <div className="text-right">
                      <span className="inline-block rounded bg-[#111b21] px-2 py-0.5 text-xs font-mono font-black text-[#00a884]">
                        {ej.ml || "3-1"}
                      </span>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="rounded-xl bg-[#202c33] p-4 text-center text-xs text-[#8696a0]">
                No hay lista de ejemplares cargada para esta carrera.
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {/* Filtro y Resumen de Tickets */}
            <div className="flex items-center justify-between bg-[#202c33] p-2.5 rounded-xl border border-[#2a3942]">
              <div className="flex flex-col">
                <span className="text-[10px] text-[#8696a0] uppercase font-bold">Monto Total P2P</span>
                <span className="text-sm font-mono font-black tabular-nums text-[#00a884]">
                  ${totalMontoTickets.toLocaleString("es-VE", { minimumFractionDigits: 2 })}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSoloMios(!soloMios)}
                className={`rounded-lg px-2.5 py-1 text-xs font-bold transition-all border ${
                  soloMios
                    ? "bg-[#00a884] text-white border-transparent"
                    : "bg-[#111b21] text-[#8696a0] border-[#2a3942] hover:text-white"
                }`}
              >
                {soloMios ? "✓ Mis Tickets" : "Todos los tickets"}
              </button>
            </div>

            {/* Lista de Tickets Concretados */}
            {ticketsFiltrados.length > 0 ? (
              ticketsFiltrados.map((t) => {
                const esGanador = t.estado === "GANADOR";
                const esPerdedor = t.estado === "PERDEDOR";
                const gualdrapa = obtenerColorGualdrapa(t.caballo);

                return (
                  <div
                    key={t.id}
                    className={`rounded-xl p-3 border space-y-1.5 text-xs ${
                      esGanador
                        ? "bg-emerald-950/30 border-emerald-500/50"
                        : esPerdedor
                        ? "bg-red-950/20 border-red-500/30"
                        : "bg-[#202c33] border-[#2a3942]"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-bold text-[#00a884]">
                        Ticket #{t.numero_ticket}
                      </span>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[9px] font-black uppercase ${
                          esGanador
                            ? "bg-emerald-500 text-white"
                            : esPerdedor
                            ? "bg-red-600 text-white"
                            : "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                        }`}
                      >
                        {t.estado}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-1.5">
                        <span
                          style={{ backgroundColor: gualdrapa.bg, color: gualdrapa.text }}
                          className="h-5 w-5 rounded-full flex items-center justify-center font-mono font-black text-[10px]"
                        >
                          {t.caballo}
                        </span>
                        <span className="font-bold text-white">{t.jugada} #{t.caballo}</span>
                      </div>
                      <span className="font-mono font-black text-white tabular-nums">
                        ${Number(t.monto).toFixed(2)}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-[#8696a0] pt-1 border-t border-[#2a3942]/60">
                      <span>👤 Juega: <strong className="text-[#e9edef]">{t.juega_nombre}</strong></span>
                      <span>🛡️ Da: <strong className="text-[#e9edef]">{t.da_nombre}</strong></span>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="rounded-xl bg-[#202c33] p-4 text-center text-xs text-[#8696a0]">
                No hay tickets registrados aún para esta carrera.
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
