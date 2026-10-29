"use client";

import React, { useState, useEffect, useRef } from "react";
import { consultarAsistenteIa } from "../lib/asistenteIa";
import {
  crearTicketIncidencia,
  obtenerTodosLosTickets,
  EVENTO_TICKETS_ACTUALIZADOS,
} from "../lib/ticketsStorage";
import { useAuthStore } from "@/shared/store/useAuthStore";
import { CategoriaTicket, PrioridadTicket, TicketIncidencia } from "../types/soporte";

interface MensajeChat {
  id: string;
  remitente: "usuario" | "ia" | "sistema";
  texto: string;
  fecha: string;
  requiereEscalamiento?: boolean;
  categoriaSugerida?: CategoriaTicket;
  prioridadSugerida?: PrioridadTicket;
}

export function WidgetAsistenteIa() {
  const usuario = useAuthStore((s) => s.usuario);
  const perfiles = useAuthStore((s) => s.perfiles);
  const grupoId = useAuthStore((s) => s.grupoId);
  const grupoActivo = useAuthStore((s) => s.grupoActivo);
  const grupoNombre = useAuthStore((s) => s.grupoNombre);
  const modoOperador = useAuthStore((s) => s.modoOperador);

  const [abierto, setAbierto] = useState(false);
  const [pestana, setPestana] = useState<"chat" | "mis_tickets">("chat");

  // Mensajes del chat interactivo
  const [mensajes, setMensajes] = useState<MensajeChat[]>([
    {
      id: "bienvenida",
      remitente: "ia",
      texto: `👋 ¡Hola! Soy tu **Asistente Inteligente del Sistema Hípico**.\n¿En qué puedo ayudarte hoy?\n\nPuedes consultarme sobre carga de jugadas (\`Puestos\`, \`Premios\`, \`PP\`, \`WPS\`), gestión de saldos (\`Libre\`, \`Aval\`, \`Pozo\`), cruces o liquidación.`,
      fecha: new Date().toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit" }),
    },
  ]);

  const [textoInput, setTextoInput] = useState("");
  const [escribiendoIa, setEscribiendoIa] = useState(false);

  // Estado para el modal o tarjeta de escalamiento a Ticket
  const [mostrarFormEscalar, setMostrarFormEscalar] = useState(false);
  const [tituloTicket, setTituloTicket] = useState("");
  const [descripcionTicket, setDescripcionTicket] = useState("");
  const [categoriaTicket, setCategoriaTicket] = useState<CategoriaTicket>("duda_plataforma");
  const [prioridadTicket, setPrioridadTicket] = useState<PrioridadTicket>("media");
  const [ticketRecienCreado, setTicketRecienCreado] = useState<string | null>(null);

  // Mis tickets
  const [misTickets, setMisTickets] = useState<TicketIncidencia[]>([]);

  const chatEndRef = useRef<HTMLDivElement>(null);

  // Auto scroll al último mensaje
  useEffect(() => {
    if (abierto && pestana === "chat") {
      chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [mensajes, abierto, pestana, escribiendoIa]);

  // Cargar mis tickets
  const cargarMisTickets = () => {
    const todos = obtenerTodosLosTickets();
    const idUsuario = usuario || "usr-actual";
    const filtrados = todos.filter(
      (t) => t.emisor.id === idUsuario || (usuario && t.emisor.nombre.includes(usuario))
    );
    setMisTickets(filtrados);
  };

  useEffect(() => {
    cargarMisTickets();
    window.addEventListener(EVENTO_TICKETS_ACTUALIZADOS, cargarMisTickets);
    return () => window.removeEventListener(EVENTO_TICKETS_ACTUALIZADOS, cargarMisTickets);
  }, [usuario]);

  const rolActual =
    perfiles.find((p) => p.toLowerCase().includes("dueno"))
      ? "dueno"
      : modoOperador || perfiles.some((p) => p.toLowerCase().includes("operador"))
      ? "operador"
      : "operador";

  // Enviar mensaje al bot IA
  const handleEnviarMensaje = (textoPersonalizado?: string) => {
    const mensajeAEnviar = (textoPersonalizado || textoInput).trim();
    if (!mensajeAEnviar) return;

    const ahoraFmt = new Date().toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit" });

    const nuevoMsgUsuario: MensajeChat = {
      id: `usr-${Date.now()}`,
      remitente: "usuario",
      texto: mensajeAEnviar,
      fecha: ahoraFmt,
    };

    setMensajes((prev) => [...prev, nuevoMsgUsuario]);
    setTextoInput("");
    setEscribiendoIa(true);

    // Simula procesamiento inteligente de la IA con la base de conocimiento
    setTimeout(() => {
      const res = consultarAsistenteIa(mensajeAEnviar, rolActual);

      const nuevoMsgIa: MensajeChat = {
        id: `ia-${Date.now()}`,
        remitente: "ia",
        texto: res.respuesta,
        fecha: new Date().toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit" }),
        requiereEscalamiento: res.sugerenciaEscalamiento,
        categoriaSugerida: res.categoriaDetectada,
        prioridadSugerida: res.prioridadDetectada,
      };

      setMensajes((prev) => [...prev, nuevoMsgIa]);
      setEscribiendoIa(false);

      if (res.sugerenciaEscalamiento) {
        setTituloTicket(mensajeAEnviar.slice(0, 60));
        setDescripcionTicket(mensajeAEnviar);
        if (res.categoriaDetectada) setCategoriaTicket(res.categoriaDetectada);
        if (res.prioridadDetectada) setPrioridadTicket(res.prioridadDetectada);
      }
    }, 450);
  };

  // Crear Ticket formal
  const handleCrearTicket = (e: React.FormEvent) => {
    e.preventDefault();
    if (!tituloTicket.trim() || !descripcionTicket.trim()) return;

    const emisor = {
      id: usuario || "usr-actual",
      nombre: usuario || "Operador de Taquilla",
      rol: (rolActual === "dueno" ? "dueno" : "operador") as any,
      grupoId: grupoId || grupoActivo || null,
      grupoNombre: grupoNombre || "Grupo Activo",
    };

    // Extraer historial previo con la IA
    const historialIa = mensajes
      .filter((m) => m.id !== "bienvenida")
      .map((m) => ({
        rol: m.remitente === "usuario" ? ("usuario" as const) : ("ia" as const),
        texto: m.texto,
      }));

    const nuevo = crearTicketIncidencia({
      titulo: tituloTicket.trim(),
      descripcion: descripcionTicket.trim(),
      categoria: categoriaTicket,
      prioridad: prioridadTicket,
      emisor,
      destinatario: "admin",
      mensajesPreviosIa: historialIa,
    });

    setTicketRecienCreado(nuevo.codigo);
    setMostrarFormEscalar(false);

    // Añadir mensaje del sistema en el chat
    setMensajes((prev) => [
      ...prev,
      {
        id: `sys-${Date.now()}`,
        remitente: "sistema",
        texto: `🎫 **Ticket Creado Exitosamente: \`${nuevo.codigo}\`**\nSe ha emitido una alerta prioritaria al Administrador del Sistema. Puedes seguir el estado en la pestaña *"Mis Tickets"*.`,
        fecha: new Date().toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit" }),
      },
    ]);
  };

  return (
    <div className="fixed bottom-4 right-4 z-50">
      {/* BOTÓN FLOTANTE TRIGGER */}
      {!abierto && (
        <button
          onClick={() => setAbierto(true)}
          className="group relative flex items-center gap-2.5 rounded-full border-2 border-emerald-400 bg-slate-900 px-4 py-2.5 text-white shadow-2xl shadow-emerald-500/30 transition-all hover:scale-105 hover:bg-slate-800"
          title="Abrir Asistente IA y Soporte Inteligente"
        >
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
          </span>
          <span className="text-xl">🤖</span>
          <div className="flex flex-col text-left">
            <span className="text-xs font-black tracking-tight text-emerald-400">
              Asistente IA & Soporte
            </span>
            <span className="text-[10px] font-bold text-slate-300">
              ¿Dudas o incidencias? Clic aquí
            </span>
          </div>
        </button>
      )}

      {/* VENTANA FLOTANTE DEL CHAT */}
      {abierto && (
        <div className="flex h-[560px] w-[360px] sm:w-[420px] flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-950 text-slate-100 shadow-2xl animate-in zoom-in-95 duration-200">
          {/* HEADER DEL WIDGET */}
          <div className="flex shrink-0 items-center justify-between border-b border-slate-800 bg-slate-900 px-4 py-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/20 text-lg border border-emerald-500/40">
                🤖
              </div>
              <div>
                <h4 className="text-xs font-black tracking-tight text-white flex items-center gap-1.5">
                  <span>Asistente Inteligente 24/7</span>
                  <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                </h4>
                <p className="text-[10px] text-slate-400">
                  Resolución inmediata y tickets al Administrador
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <button
                onClick={() => setAbierto(false)}
                className="grid h-7 w-7 place-items-center rounded-md border border-slate-700 bg-slate-800 text-slate-400 hover:text-white"
                title="Minimizar"
              >
                ✕
              </button>
            </div>
          </div>

          {/* SELECTOR DE PESTAÑAS (CHAT VS MIS TICKETS) */}
          <div className="flex border-b border-slate-800 bg-slate-950/80 text-xs font-bold">
            <button
              onClick={() => setPestana("chat")}
              className={`flex-1 py-2 text-center transition border-b-2 ${
                pestana === "chat"
                  ? "border-emerald-500 text-emerald-400 bg-emerald-950/20"
                  : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              💬 Consulta Inteligente
            </button>
            <button
              onClick={() => setPestana("mis_tickets")}
              className={`flex-1 py-2 text-center transition border-b-2 ${
                pestana === "mis_tickets"
                  ? "border-amber-500 text-amber-400 bg-amber-950/20"
                  : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              🎫 Mis Tickets ({misTickets.length})
            </button>
          </div>

          {/* CONTENIDO PESTAÑA CHAT */}
          {pestana === "chat" && (
            <div className="flex flex-1 flex-col overflow-hidden">
              {/* ÁREA DE MENSAJES */}
              <div className="flex-1 overflow-y-auto p-3.5 space-y-3">
                {mensajes.map((m) => (
                  <div
                    key={m.id}
                    className={`flex flex-col ${
                      m.remitente === "usuario"
                        ? "items-end"
                        : m.remitente === "sistema"
                        ? "items-center"
                        : "items-start"
                    }`}
                  >
                    {m.remitente === "sistema" ? (
                      <div className="my-1 rounded-xl border border-amber-500/40 bg-amber-950/40 p-3 text-center text-xs text-amber-200">
                        <p className="whitespace-pre-line">{m.texto}</p>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center gap-1.5 mb-1 text-[10px] text-slate-400">
                          <span>{m.remitente === "usuario" ? "Tú" : "🤖 Asistente IA"}</span>
                          <span>•</span>
                          <span>{m.fecha}</span>
                        </div>
                        <div
                          className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed shadow-sm ${
                            m.remitente === "usuario"
                              ? "bg-emerald-600 text-white rounded-br-xs"
                              : "bg-slate-900 border border-slate-800 text-slate-200 rounded-bl-xs"
                          }`}
                        >
                          <p className="whitespace-pre-line">{m.texto}</p>

                          {/* Si la IA sugiere escalar */}
                          {m.requiereEscalamiento && !mostrarFormEscalar && (
                            <div className="mt-2.5 pt-2 border-t border-slate-700/60">
                              <button
                                type="button"
                                onClick={() => setMostrarFormEscalar(true)}
                                className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-red-500/60 bg-red-600/30 hover:bg-red-600/50 px-3 py-1.5 text-xs font-black text-red-200 transition"
                              >
                                <span>🚨 Escalar a Ticket con el Administrador</span>
                              </button>
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                ))}

                {escribiendoIa && (
                  <div className="flex items-center gap-2 text-xs text-slate-400 italic">
                    <span className="h-2 w-2 rounded-full bg-emerald-500 animate-bounce" />
                    <span>El asistente está procesando tu consulta...</span>
                  </div>
                )}

                <div ref={chatEndRef} />
              </div>

              {/* FORMULARIO DE ESCALAMIENTO INTEGRADO */}
              {mostrarFormEscalar && (
                <div className="border-t border-slate-800 bg-slate-900/90 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-black text-amber-400 flex items-center gap-1">
                      <span>🎫 Generar Ticket para el Administrador</span>
                    </span>
                    <button
                      onClick={() => setMostrarFormEscalar(false)}
                      className="text-xs text-slate-400 hover:text-white"
                    >
                      ✕
                    </button>
                  </div>
                  <form onSubmit={handleCrearTicket} className="space-y-2">
                    <input
                      type="text"
                      value={tituloTicket}
                      onChange={(e) => setTituloTicket(e.target.value)}
                      placeholder="Título breve del problema..."
                      required
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:border-amber-500 focus:outline-hidden"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <select
                        value={categoriaTicket}
                        onChange={(e) => setCategoriaTicket(e.target.value as CategoriaTicket)}
                        className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-white focus:border-amber-500"
                      >
                        <option value="duda_plataforma">Duda Plataforma</option>
                        <option value="disputa_jugada">Disputa Jugada</option>
                        <option value="ajuste_saldo">Ajuste de Saldo</option>
                        <option value="carrera_liquidacion">Liquidación</option>
                        <option value="error_sistema">Error Técnico</option>
                      </select>
                      <select
                        value={prioridadTicket}
                        onChange={(e) => setPrioridadTicket(e.target.value as PrioridadTicket)}
                        className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-white focus:border-amber-500"
                      >
                        <option value="baja">Prioridad Baja</option>
                        <option value="media">Prioridad Media</option>
                        <option value="alta">Prioridad Alta</option>
                        <option value="urgente">🔥 Urgente</option>
                      </select>
                    </div>
                    <textarea
                      rows={2}
                      value={descripcionTicket}
                      onChange={(e) => setDescripcionTicket(e.target.value)}
                      placeholder="Detalles específicos para el administrador..."
                      required
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:border-amber-500 focus:outline-hidden resize-none"
                    />
                    <button
                      type="submit"
                      className="w-full rounded-lg bg-amber-500 py-2 text-xs font-black text-slate-950 hover:bg-amber-400 transition"
                    >
                      🚀 Enviar Ticket al Administrador
                    </button>
                  </form>
                </div>
              )}

              {/* CHIPS RÁPIDOS DE PREGUNTAS FRECUENTES */}
              {!mostrarFormEscalar && (
                <div className="border-t border-slate-800/80 bg-slate-950/60 px-3 py-1.5 overflow-x-auto flex gap-1.5 text-[10px]">
                  <button
                    type="button"
                    onClick={() => handleEnviarMensaje("¿Cómo se calculan los puestos con varios ejemplares como 1y2 o 3y4?")}
                    className="shrink-0 rounded-full border border-slate-700 bg-slate-900 px-2.5 py-1 text-slate-300 hover:border-emerald-500 hover:text-white"
                  >
                    🐎 Puestos con varios caballos
                  </button>
                  <button
                    type="button"
                    onClick={() => handleEnviarMensaje("¿Cómo cargo apuestas WPS e incentivos de Venezuela?")}
                    className="shrink-0 rounded-full border border-slate-700 bg-slate-900 px-2.5 py-1 text-slate-300 hover:border-emerald-500 hover:text-white"
                  >
                    🏇 Módulo WPS
                  </button>
                  <button
                    type="button"
                    onClick={() => handleEnviarMensaje("¿Qué diferencia hay entre saldo Libre, Avalado y Pozo?")}
                    className="shrink-0 rounded-full border border-slate-700 bg-slate-900 px-2.5 py-1 text-slate-300 hover:border-emerald-500 hover:text-white"
                  >
                    💵 Saldos
                  </button>
                  <button
                    type="button"
                    onClick={() => handleEnviarMensaje("¿Cómo funciona el Control de Cruces?")}
                    className="shrink-0 rounded-full border border-slate-700 bg-slate-900 px-2.5 py-1 text-slate-300 hover:border-emerald-500 hover:text-white"
                  >
                    ⚡ Cruces
                  </button>
                </div>
              )}

              {/* CAMPO DE TEXTO INPUT */}
              {!mostrarFormEscalar && (
                <div className="border-t border-slate-800 bg-slate-900 p-2.5">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={textoInput}
                      onChange={(e) => setTextoInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleEnviarMensaje();
                      }}
                      placeholder="Escribe tu consulta o duda aquí…"
                      className="flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-hidden"
                    />
                    <button
                      type="button"
                      onClick={() => handleEnviarMensaje()}
                      disabled={!textoInput.trim() || escribiendoIa}
                      className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-black text-white hover:bg-emerald-500 disabled:opacity-50 transition"
                    >
                      Enviar
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* CONTENIDO PESTAÑA MIS TICKETS */}
          {pestana === "mis_tickets" && (
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              {misTickets.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center p-6 text-slate-400">
                  <span className="text-3xl mb-2">📋</span>
                  <p className="text-xs font-bold text-slate-300">No tienes tickets abiertos</p>
                  <p className="text-[11px] text-slate-500 mt-1">
                    Si tienes algún problema con una carrera o saldo que la IA no resuelva, puedes crear uno desde el chat.
                  </p>
                </div>
              ) : (
                misTickets.map((t) => (
                  <div
                    key={t.id}
                    className="rounded-xl border border-slate-800 bg-slate-900 p-3 shadow-sm"
                  >
                    <div className="flex items-center justify-between gap-1 mb-1">
                      <span className="font-mono text-xs font-black text-amber-400">
                        {t.codigo}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase ${
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

                    <h5 className="text-xs font-bold text-white mb-1">{t.titulo}</h5>
                    <p className="text-[11px] text-slate-400 mb-2">{t.descripcion}</p>

                    {/* Mensajes del administrador */}
                    {t.mensajes.filter((m) => m.autorRol === "admin" || m.autorRol === "dueno").length > 0 && (
                      <div className="rounded-lg border border-emerald-500/40 bg-emerald-950/30 p-2 text-[11px] text-emerald-200">
                        <span className="font-bold block mb-0.5">💬 Respuesta del Administrador:</span>
                        <p>
                          {
                            t.mensajes.filter((m) => m.autorRol === "admin" || m.autorRol === "dueno").slice(-1)[0].texto
                          }
                        </p>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
