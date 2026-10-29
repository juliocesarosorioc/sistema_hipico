"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useAuthStore } from "@/shared/store/useAuthStore";
import {
  contarTicketsPendientes,
  obtenerTodosLosTickets,
  EVENTO_TICKETS_ACTUALIZADOS,
} from "../lib/ticketsStorage";
import { ModalGestionTicketsAdmin } from "./ModalGestionTicketsAdmin";

export function AlertaTicketsTopbar() {
  const usuario = useAuthStore((s) => s.usuario);
  const esPrincipal = useAuthStore((s) => s.esPrincipal);
  const perfiles = useAuthStore((s) => s.perfiles);
  const grupoActivo = useAuthStore((s) => s.grupoActivo);

  const esAdmin =
    esPrincipal ||
    perfiles.some(
      (p) =>
        p.toLowerCase().includes("admin") ||
        p.toLowerCase().includes("super") ||
        p.toLowerCase().includes("principal")
    );

  const esDueno = perfiles.some(
    (p) =>
      p.toLowerCase().includes("dueno") ||
      p.toLowerCase().includes("dueño") ||
      p.toLowerCase().includes("banca")
  );

  const [pendientes, setPendientes] = useState(0);
  const [modalAbierto, setModalAbierto] = useState(false);
  const [ultimoTicketUrgente, setUltimoTicketUrgente] = useState<string | null>(null);

  const actualizarConteo = useCallback(() => {
    const cant = contarTicketsPendientes(esAdmin, esAdmin ? null : grupoActivo);
    setPendientes(cant);

    // Buscar si hay algún ticket urgente reciente para destacar
    const todos = obtenerTodosLosTickets();
    const urgente = todos.find(
      (t) => (t.estado === "abierto" || t.estado === "en_proceso") && t.prioridad === "urgente"
    );
    setUltimoTicketUrgente(urgente ? urgente.codigo : null);
  }, [esAdmin, grupoActivo]);

  useEffect(() => {
    actualizarConteo();
    window.addEventListener(EVENTO_TICKETS_ACTUALIZADOS, actualizarConteo);
    return () => window.removeEventListener(EVENTO_TICKETS_ACTUALIZADOS, actualizarConteo);
  }, [actualizarConteo]);

  // Si no es admin ni dueño, no mostramos el panel de resolución de tickets de administración
  if (!esAdmin && !esDueno) return null;

  return (
    <>
      <div className="flex items-center gap-1.5 shrink-0">
        {pendientes > 0 ? (
          <button
            type="button"
            onClick={() => setModalAbierto(true)}
            className="group relative inline-flex h-8 items-center gap-2 rounded-lg border-2 border-red-500 bg-red-600/90 hover:bg-red-600 px-3 text-[11px] font-black text-white shadow-lg shadow-red-500/20 transition-all hover:scale-102 cursor-pointer animate-pulse"
            title="¡Tienes tickets de incidencias pendientes de solución! Haz clic para abrir el modal y responder."
          >
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-white"></span>
            </span>
            <span className="flex items-center gap-1 tracking-tight">
              <span>🚨 TICKET{pendientes > 1 ? "S" : ""}:</span>
              <span className="rounded-full bg-white/20 px-1.5 py-0.2 text-[10px] font-black">
                {pendientes} PENDIENTE{pendientes > 1 ? "S" : ""}
              </span>
            </span>
            <span className="hidden xl:inline text-[9px] font-bold uppercase tracking-wider text-red-100 group-hover:underline">
              · Responder aquí →
            </span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setModalAbierto(true)}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/80 px-2.5 text-[11px] font-bold text-slate-300 hover:border-slate-600 hover:bg-slate-800 hover:text-white transition"
            title="Centro de Solución de Incidencias y Tickets (Sin pendientes)"
          >
            <span>🎫</span>
            <span className="hidden md:inline">Tickets</span>
          </button>
        )}
      </div>

      <ModalGestionTicketsAdmin
        abierto={modalAbierto}
        onCerrar={() => setModalAbierto(false)}
      />
    </>
  );
}
