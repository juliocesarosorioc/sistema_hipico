"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  TicketIncidencia,
  EstadoTicket,
  CategoriaTicket,
  PrioridadTicket,
} from "../types/soporte";
import {
  listarTickets,
  responderTicket,
  cambiarEstadoTicket,
  EVENTO_TICKETS_ACTUALIZADOS,
} from "../lib/ticketsStorage";
import { useAuthStore } from "@/shared/store/useAuthStore";

interface Props {
  abierto: boolean;
  onCerrar: () => void;
  ticketInicialId?: string | null;
}

const PLANTILLAS_RESPUESTA = [
  "✅ Hemos verificado el caso y la incidencia ha sido solventada satisfactoriamente.",
  "⚙️ Se revisó la carrera con la pizarra oficial y los saldos han sido recalculados correctamente.",
  "💵 El comprobante de pago ha sido validado y el saldo se encuentra acreditado en la taquilla.",
  "🏇 La jugada cumple con la regla de mejor posición de llegada estipulada en el reglamento.",
  "📞 Nos hemos comunicado por vía telefónica/WhatsApp para coordinar los detalles.",
];

export function ModalGestionTicketsAdmin({
  abierto,
  onCerrar,
  ticketInicialId,
}: Props) {
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

  const [tickets, setTickets] = useState<TicketIncidencia[]>([]);
  const [filtroEstado, setFiltroEstado] = useState<EstadoTicket | "todos">("todos");
  const [filtroCategoria, setFiltroCategoria] = useState<CategoriaTicket | "todas">("todas");
  const [filtroPrioridad, setFiltroPrioridad] = useState<PrioridadTicket | "todas">("todas");
  const [busqueda, setBusqueda] = useState("");
  const [ticketSeleccionadoId, setTicketSeleccionadoId] = useState<string | null>(null);

  // Formulario de respuesta
  const [textoRespuesta, setTextoRespuesta] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [notaResolucion, setNotaResolucion] = useState("");

  const cargarTickets = useCallback(() => {
    const data = listarTickets({
      estado: filtroEstado,
      categoria: filtroCategoria,
      prioridad: filtroPrioridad,
      busqueda,
      esAdmin,
      grupoId: esAdmin ? null : grupoActivo,
    });
    setTickets(data);
    if (data.length > 0 && !ticketSeleccionadoId) {
      setTicketSeleccionadoId(ticketInicialId || data[0].id);
    }
  }, [filtroEstado, filtroCategoria, filtroPrioridad, busqueda, esAdmin, grupoActivo, ticketSeleccionadoId, ticketInicialId]);

  useEffect(() => {
    if (abierto) {
      cargarTickets();
      if (ticketInicialId) {
        setTicketSeleccionadoId(ticketInicialId);
      }
    }
  }, [abierto, ticketInicialId, cargarTickets]);

  // Escuchar actualizaciones de tickets
  useEffect(() => {
    if (!abierto) return;
    const onActualizacion = () => {
      cargarTickets();
    };
    window.addEventListener(EVENTO_TICKETS_ACTUALIZADOS, onActualizacion);
    return () => window.removeEventListener(EVENTO_TICKETS_ACTUALIZADOS, onActualizacion);
  }, [abierto, cargarTickets]);

  const ticketActivo = useMemo(() => {
    return tickets.find((t) => t.id === ticketSeleccionadoId) || tickets[0] || null;
  }, [tickets, ticketSeleccionadoId]);

  // Contadores para pestañas
  const contadores = useMemo(() => {
    const abiertos = tickets.filter((t) => t.estado === "abierto").length;
    const enProceso = tickets.filter((t) => t.estado === "en_proceso").length;
    const resueltos = tickets.filter((t) => t.estado === "resuelto").length;
    return { abiertos, enProceso, resueltos, total: tickets.length };
  }, [tickets]);

  const handleEnviarRespuesta = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticketActivo || !textoRespuesta.trim() || enviando) return;

    setEnviando(true);
    try {
      const nombreAdmin = usuario || "Administrador del Sistema";
      responderTicket(ticketActivo.id, textoRespuesta.trim(), {
        id: usuario || "admin-system",
        nombre: nombreAdmin,
        rol: esAdmin ? "admin" : "dueno",
      });
      setTextoRespuesta("");
      cargarTickets();
    } finally {
      setEnviando(false);
    }
  };

  const handleCambiarEstado = (nuevoEstado: EstadoTicket) => {
    if (!ticketActivo) return;
    const nombreAdmin = usuario || "Administrador";
    cambiarEstadoTicket(
      ticketActivo.id,
      nuevoEstado,
      notaResolucion.trim() || undefined,
      {
        id: usuario || "admin",
        nombre: nombreAdmin,
        rol: esAdmin ? "Administrador Principal" : "Dueño de Grupo",
      }
    );
    setNotaResolucion("");
    cargarTickets();
  };

  if (!abierto) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/80 p-2 sm:p-4 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="flex h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-950 text-slate-100 shadow-2xl">
        {/* ENCABEZADO DEL MODAL */}
        <header className="flex shrink-0 items-center justify-between border-b border-slate-800 bg-slate-900/90 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/20 text-xl border border-amber-500/40 shadow-inner">
              🎫
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-black tracking-tight text-white">
                  Centro de Solución de Incidencias & Tickets
                </h2>
                <span className="rounded-full bg-amber-500/10 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-amber-400 border border-amber-500/20">
                  {esAdmin ? "Administrador Principal" : "Gestión de Grupo"}
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Atención a operadores, dudas especializadas y resolución de contingencias operativas.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onCerrar}
              className="grid h-8 w-8 place-items-center rounded-lg border border-slate-700 bg-slate-800 text-slate-300 transition hover:bg-slate-700 hover:text-white"
              title="Cerrar ventana"
            >
              ✕
            </button>
          </div>
        </header>

        {/* BARRA DE FILTROS Y ESTADÍSTICAS */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 bg-slate-900/50 px-4 py-2.5 sm:px-6">
          {/* Pestañas de estado rápidas */}
          <div className="flex items-center gap-1.5 overflow-x-auto text-xs font-bold">
            <button
              onClick={() => setFiltroEstado("todos")}
              className={`rounded-lg px-3 py-1.5 transition ${
                filtroEstado === "todos"
                  ? "bg-slate-800 text-white shadow-xs border border-slate-700"
                  : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"
              }`}
            >
              Todos ({contadores.total})
            </button>
            <button
              onClick={() => setFiltroEstado("abierto")}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition ${
                filtroEstado === "abierto"
                  ? "bg-red-500/20 text-red-300 border border-red-500/40"
                  : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"
              }`}
            >
              <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
              Abiertos ({contadores.abiertos})
            </button>
            <button
              onClick={() => setFiltroEstado("en_proceso")}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition ${
                filtroEstado === "en_proceso"
                  ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                  : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"
              }`}
            >
              <span className="h-2 w-2 rounded-full bg-amber-400" />
              En Proceso ({contadores.enProceso})
            </button>
            <button
              onClick={() => setFiltroEstado("resuelto")}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition ${
                filtroEstado === "resuelto"
                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                  : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"
              }`}
            >
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              Resueltos ({contadores.resueltos})
            </button>
          </div>

          {/* Buscador interactivo */}
          <div className="relative min-w-[220px]">
            <input
              type="text"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar por código, operador o texto…"
              className="w-full rounded-lg border border-slate-700 bg-slate-950/80 px-3 py-1.5 pl-8 text-xs text-white placeholder-slate-500 focus:border-amber-500 focus:outline-hidden"
            />
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 text-xs">
              🔍
            </span>
            {busqueda && (
              <button
                onClick={() => setBusqueda("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-white"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* CUERPO PRINCIPAL: MASTER-DETAIL */}
        <div className="grid flex-1 grid-cols-1 md:grid-cols-12 overflow-hidden">
          {/* PANEL IZQUIERDO: LISTA DE TICKETS (col 4 o 5) */}
          <div className="md:col-span-5 lg:col-span-4 border-r border-slate-800 bg-slate-950/60 overflow-y-auto">
            {tickets.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-8 text-center text-slate-500">
                <span className="text-3xl mb-2">🎉</span>
                <p className="text-sm font-bold text-slate-300">¡Bandeja al día!</p>
                <p className="text-xs">No hay tickets pendientes con estos filtros.</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-800/80">
                {tickets.map((t) => {
                  const seleccionado = ticketActivo?.id === t.id;
                  const fechaFmt = new Date(t.fechaActualizacion).toLocaleTimeString("es-VE", {
                    hour: "2-digit",
                    minute: "2-digit",
                  });

                  return (
                    <div
                      key={t.id}
                      onClick={() => setTicketSeleccionadoId(t.id)}
                      className={`cursor-pointer p-3.5 transition ${
                        seleccionado
                          ? "bg-slate-800/90 border-l-4 border-amber-500"
                          : "hover:bg-slate-900/60 border-l-4 border-transparent"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1 mb-1">
                        <span className="font-mono text-xs font-black text-amber-400">
                          {t.codigo}
                        </span>
                        <div className="flex items-center gap-1.5">
                          {/* Badge de prioridad */}
                          <span
                            className={`rounded-md px-1.5 py-0.5 text-[9px] font-black uppercase ${
                              t.prioridad === "urgente"
                                ? "bg-red-500/30 text-red-300 border border-red-500/50 animate-pulse"
                                : t.prioridad === "alta"
                                ? "bg-orange-500/20 text-orange-300 border border-orange-500/30"
                                : "bg-slate-700/50 text-slate-400"
                            }`}
                          >
                            {t.prioridad}
                          </span>
                          <span className="text-[10px] text-slate-400 font-medium">
                            {fechaFmt}
                          </span>
                        </div>
                      </div>

                      <h4 className="text-xs font-bold text-slate-200 line-clamp-1 mb-1">
                        {t.titulo}
                      </h4>

                      <p className="text-[11px] text-slate-400 line-clamp-2 mb-2 leading-relaxed">
                        {t.descripcion}
                      </p>

                      <div className="flex items-center justify-between text-[10px] text-slate-500 font-medium">
                        <span className="truncate max-w-[150px]">
                          👤 {t.emisor.nombre}
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 font-bold text-[9px] uppercase ${
                            t.estado === "abierto"
                              ? "bg-red-500/20 text-red-300"
                              : t.estado === "en_proceso"
                              ? "bg-amber-500/20 text-amber-300"
                              : "bg-emerald-500/20 text-emerald-300"
                          }`}
                        >
                          {t.estado === "en_proceso" ? "En Proceso" : t.estado}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* PANEL DERECHO: DETALLE Y CONVERSACIÓN DEL TICKET (col 7 u 8) */}
          <div className="md:col-span-7 lg:col-span-8 flex flex-col h-full bg-slate-900/30 overflow-hidden">
            {ticketActivo ? (
              <div className="flex flex-col h-full overflow-hidden">
                {/* CABECERA DEL DETALLE */}
                <div className="shrink-0 border-b border-slate-800 bg-slate-950/70 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-black text-amber-400">
                          {ticketActivo.codigo}
                        </span>
                        <h3 className="text-sm sm:text-base font-black text-white">
                          {ticketActivo.titulo}
                        </h3>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                        <span>👤 {ticketActivo.emisor.nombre} ({ticketActivo.emisor.rol})</span>
                        <span>•</span>
                        <span>🏢 {ticketActivo.emisor.grupoNombre || "General"}</span>
                        {ticketActivo.emisor.telefono && (
                          <>
                            <span>•</span>
                            <span className="text-emerald-400">📞 {ticketActivo.emisor.telefono}</span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* SELECTOR RÁPIDO DE ESTADO */}
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => handleCambiarEstado("en_proceso")}
                        className={`rounded-lg px-2.5 py-1 text-xs font-bold transition border ${
                          ticketActivo.estado === "en_proceso"
                            ? "bg-amber-500/30 text-amber-300 border-amber-500"
                            : "bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700"
                        }`}
                      >
                        En Proceso
                      </button>
                      <button
                        onClick={() => handleCambiarEstado("resuelto")}
                        className={`rounded-lg px-2.5 py-1 text-xs font-bold transition border ${
                          ticketActivo.estado === "resuelto"
                            ? "bg-emerald-600 text-white border-emerald-500 shadow-sm"
                            : "bg-emerald-950/60 text-emerald-300 border-emerald-700/60 hover:bg-emerald-900"
                        }`}
                      >
                        ✅ Resolver
                      </button>
                      <button
                        onClick={() => handleCambiarEstado("cerrado")}
                        className="rounded-lg bg-slate-800 px-2 py-1 text-xs font-bold text-slate-400 border border-slate-700 hover:bg-slate-700"
                        title="Cerrar ticket"
                      >
                        🔒
                      </button>
                    </div>
                  </div>
                </div>

                {/* HILO DE MENSAJES Y CONVERSACIÓN */}
                <div className="flex-1 overflow-y-auto p-4 space-y-3.5">
                  {ticketActivo.mensajes.map((m) => {
                    const esIa = m.autorRol === "ia" || m.esIa;
                    const esAdminOdueno = m.autorRol === "admin" || m.autorRol === "dueno";
                    const esUsuario = !esIa && !esAdminOdueno;

                    return (
                      <div
                        key={m.id}
                        className={`flex flex-col ${
                          esAdminOdueno ? "items-end" : "items-start"
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-1 text-[11px]">
                          <span
                            className={`font-black ${
                              esAdminOdueno
                                ? "text-amber-400"
                                : esIa
                                ? "text-cyan-400"
                                : "text-slate-300"
                            }`}
                          >
                            {esAdminOdueno ? "🛡️ " : esIa ? "🤖 " : "👤 "}
                            {m.autorNombre}
                          </span>
                          <span className="text-[10px] text-slate-500">
                            {new Date(m.fecha).toLocaleTimeString("es-VE", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        </div>

                        <div
                          className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-xs sm:text-[13px] leading-relaxed shadow-md ${
                            esAdminOdueno
                              ? "bg-amber-600 text-white rounded-br-xs"
                              : esIa
                              ? "bg-slate-800 text-cyan-100 border border-cyan-800/40 rounded-bl-xs"
                              : "bg-slate-800 text-slate-100 border border-slate-700 rounded-bl-xs"
                          }`}
                        >
                          <p className="whitespace-pre-line">{m.texto}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* ÁREA DE RESPUESTA Y PLANTILLAS RÁPIDAS */}
                <div className="shrink-0 border-t border-slate-800 bg-slate-950/80 p-3 sm:p-4">
                  {/* Plantillas sugeridas en 1 clic */}
                  <div className="mb-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block mb-1">
                      ⚡ Respuestas Rápidas Sugeridas:
                    </span>
                    <div className="flex gap-1.5 overflow-x-auto pb-1 text-[11px]">
                      {PLANTILLAS_RESPUESTA.map((p, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => setTextoRespuesta(p)}
                          className="shrink-0 rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1 text-slate-300 transition hover:border-amber-500/60 hover:text-white"
                        >
                          {p.slice(0, 40)}…
                        </button>
                      ))}
                    </div>
                  </div>

                  <form onSubmit={handleEnviarRespuesta} className="flex gap-2">
                    <textarea
                      rows={2}
                      value={textoRespuesta}
                      onChange={(e) => setTextoRespuesta(e.target.value)}
                      placeholder="Escribe la respuesta de resolución para el operador..."
                      className="flex-1 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-amber-500 focus:outline-hidden resize-none"
                    />

                    <button
                      type="submit"
                      disabled={!textoRespuesta.trim() || enviando}
                      className="flex flex-col items-center justify-center rounded-xl bg-amber-500 px-4 py-2 text-xs font-black text-slate-950 transition hover:bg-amber-400 disabled:opacity-50"
                    >
                      <span>💬 Enviar</span>
                      <span className="text-[9px] uppercase tracking-wider font-extrabold text-slate-800">
                        Respuesta
                      </span>
                    </button>
                  </form>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full p-8 text-center text-slate-500">
                <span className="text-4xl mb-3">📬</span>
                <p className="text-sm font-bold text-slate-400">
                  Selecciona un ticket de la lista para gestionarlo y dar respuesta
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
