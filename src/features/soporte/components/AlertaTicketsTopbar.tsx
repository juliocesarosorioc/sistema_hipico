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
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-rose-400 bg-rose-50 px-3 text-xs font-black text-rose-700 shadow-sm transition-all hover:bg-rose-100 hover:border-rose-500 cursor-pointer"
            title="¡Tienes tickets de incidencias pendientes de solución! Haz clic para abrir el centro de atención."
          >
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-600"></span>
            </span>
            <span className="tracking-tight">🚨 Tickets:</span>
            <span className="rounded-full bg-rose-600 px-2 py-0.5 text-[10px] font-black leading-none text-white">
              {pendientes} {pendientes === 1 ? "pendiente" : "pendientes"}
            </span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setModalAbierto(true)}
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-xs font-bold text-slate-700 transition-colors hover:bg-surfaceAlt cursor-pointer shadow-xs"
            title="Centro de Solución de Incidencias y Tickets (Sin pendientes)"
          >
            <span>🎫</span>
            <span>Tickets</span>
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
