"use client";

import React, { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  consultarAgenteIaEnVivo,
  normalizarDictadoVoz,
  consultarCopilotoTransaccional,
  obtenerSesionCopilotoGlobal,
  detectarIntencionContableInicial,
  CATALOGO_ACCIONES_PLATAFORMA,
  CATALOGO_RUTAS_PLATAFORMA,
  emitirEventoAccionAgente,
  type AccionOperativaPlataforma,
} from "../lib/asistenteIa";
import {
  guardarBloqueosJugadas,
  leerBloqueosJugadas,
  MODALIDADES_PORTAL_META,
  type ModalidadPortalJugada,
} from "@/features/portal/lib/bloqueo-jugadas";
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
  reporteWhatsapp?: string;
}

export function WidgetAsistenteIa() {
  const router = useRouter();
  const usuario = useAuthStore((s) => s.usuario);
  const perfiles = useAuthStore((s) => s.perfiles);
  const grupoId = useAuthStore((s) => s.grupoId);
  const grupoActivo = useAuthStore((s) => s.grupoActivo);
  const grupoNombre = useAuthStore((s) => s.grupoNombre);
  const modoOperador = useAuthStore((s) => s.modoOperador);

  const [abierto, setAbierto] = useState(false);
  const [pestana, setPestana] = useState<"chat" | "acciones" | "mis_tickets">("chat");
  const [bloqueosPortal, setBloqueosPortal] = useState<Record<ModalidadPortalJugada, boolean> | null>(null);
  const [guardandoBloqueoIa, setGuardandoBloqueoIa] = useState(false);

  // Mensajes del chat interactivo
  const [mensajes, setMensajes] = useState<MensajeChat[]>([
    {
      id: "bienvenida",
      remitente: "ia",
      texto: `👋 ¡Hola! Soy tu **🤖 Agente de IA del Sistema Hípico**.\nTengo **todas las acciones de la plataforma activadas**: suministro información en vivo, ejecuto operaciones (liquidación, **🤖 Cambio de Pizarra**, cruces, saldos, clientes, bloqueos del portal y navegación a los 24 módulos) y puedes **dictarme por voz (🎙️)** o usar la pestaña **⚡ Acciones**.`,
      fecha: new Date().toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit" }),
    },
  ]);

  const [textoInput, setTextoInput] = useState("");
  const [escribiendoIa, setEscribiendoIa] = useState(false);
  const [escuchandoVoz, setEscuchandoVoz] = useState(false);
  const recognitionRef = useRef<any>(null);

  // Estado para el modal o tarjeta de escalamiento a Ticket
  const [mostrarFormEscalar, setMostrarFormEscalar] = useState(false);
  const [tituloTicket, setTituloTicket] = useState("");
  const [descripcionTicket, setDescripcionTicket] = useState("");
  const [categoriaTicket, setCategoriaTicket] = useState<CategoriaTicket>("duda_plataforma");
  const [prioridadTicket, setPrioridadTicket] = useState<PrioridadTicket>("media");
  const [ticketRecienCreado, setTicketRecienCreado] = useState<string | null>(null);

  // Mis tickets
  const [misTickets, setMisTickets] = useState<TicketIncidencia[]>([]);
  const [copiadoId, setCopiadoId] = useState<string | null>(null);

  const chatEndRef = useRef<HTMLDivElement>(null);

  // Escucha de reportes oficiales de liquidación para WhatsApp generados en el sistema
  useEffect(() => {
    const onReporteGenerado = (ev: Event) => {
      const d = ((ev as CustomEvent).detail ?? {}) as {
        mensajeWhatsapp?: string;
        hipodromo?: string;
        carrera?: string | number;
        fecha?: string;
      };
      if (!d.mensajeWhatsapp) return;

      const textoReporte = d.mensajeWhatsapp;
      const titulo = `🏁 **Reporte Oficial de Carrera — Resultados WhatsApp (${d.hipodromo ?? ""} C${d.carrera ?? ""})**`;

      setMensajes((prev) => [
        ...prev,
        {
          id: `rep-${Date.now()}`,
          remitente: "ia",
          texto: `${titulo}\n\n${textoReporte}`,
          fecha: new Date().toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit" }),
          reporteWhatsapp: textoReporte,
        },
      ]);
      // NO abrir automáticamente el asistente cuando se liquida desde otro modal
    };

    window.addEventListener("agente-ia-reporte-generado", onReporteGenerado);
    return () => window.removeEventListener("agente-ia-reporte-generado", onReporteGenerado);
  }, []);

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

  useEffect(() => {
    if (!abierto || pestana !== "acciones") return;
    let vivo = true;
    leerBloqueosJugadas()
      .then((cfg) => {
        if (vivo) setBloqueosPortal(cfg);
      })
      .catch(() => {
        /* noop */
      });
    return () => {
      vivo = false;
    };
  }, [abierto, pestana]);

  const dispararAccionConRuta = (
    ruta?: string,
    evento?: { accion: string; [k: string]: unknown }
  ) => {
    if (typeof window === "undefined") return;
    const pathActual = window.location.pathname;
    const yaEnApuestas = pathActual === "/apuestas" || pathActual === "/gestion-jugadas";
    if (ruta && !(ruta === "/apuestas" && yaEnApuestas) && pathActual !== ruta) {
      router.push(ruta);
      if (evento) {
        setTimeout(() => emitirEventoAccionAgente(evento), 380);
      }
      return;
    }
    if (evento) {
      emitirEventoAccionAgente(evento);
    }
  };

  const ejecutarAccionDirecta = (acc: AccionOperativaPlataforma) => {
    if (acc.evento || acc.rutaRequerida) {
      dispararAccionConRuta(acc.rutaRequerida, acc.evento);
      setMensajes((prev) => [
        ...prev,
        {
          id: `ia-acc-${Date.now()}`,
          remitente: "ia",
          texto: `⚡ **Acción Ejecutada**: **${acc.icono} ${acc.etiqueta}** — ${acc.descripcion}.`,
          fecha: new Date().toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit" }),
        },
      ]);
      setPestana("chat");
      return;
    }
    setPestana("chat");
    handleEnviarMensaje(acc.comandoChat);
  };

  const alternarModalidadPortalEnVivo = async (idMod: ModalidadPortalJugada) => {
    if (guardandoBloqueoIa) return;
    setGuardandoBloqueoIa(true);
    try {
      const base = bloqueosPortal ?? (await leerBloqueosJugadas());
      const proximo = {
        ...base,
        [idMod]: !base[idMod],
      };
      await guardarBloqueosJugadas(proximo);
      setBloqueosPortal(proximo);
    } finally {
      setGuardandoBloqueoIa(false);
    }
  };

  const cambiarTodasModalidadesPortal = async (bloquear: boolean) => {
    if (guardandoBloqueoIa) return;
    setGuardandoBloqueoIa(true);
    try {
      const proximo: Record<ModalidadPortalJugada, boolean> = {
        marcas: bloquear,
        tablas_fijas: bloquear,
        puestos: bloquear,
        remates: bloquear,
        dupletas: bloquear,
        pollas: bloquear,
      };
      await guardarBloqueosJugadas(proximo);
      setBloqueosPortal(proximo);
    } finally {
      setGuardandoBloqueoIa(false);
    }
  };

  const rolActual =
    perfiles.find((p) => p.toLowerCase().includes("dueno"))
      ? "dueno"
      : modoOperador || perfiles.some((p) => p.toLowerCase().includes("operador"))
      ? "operador"
      : "operador";

  // Enviar mensaje al Agente de IA
  const handleEnviarMensaje = (textoPersonalizado?: string, fueDictado = false) => {
    const mensajeAEnviar = (textoPersonalizado || textoInput).trim();
    if (!mensajeAEnviar) return;

    const ahoraFmt = new Date().toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit" });

    const nuevoMsgUsuario: MensajeChat = {
      id: `usr-${Date.now()}`,
      remitente: "usuario",
      texto: fueDictado ? `🎙️ ${mensajeAEnviar}` : mensajeAEnviar,
      fecha: ahoraFmt,
    };

    setMensajes((prev) => [...prev, nuevoMsgUsuario]);
    setTextoInput("");
    setEscribiendoIa(true);

    // Procesamiento inteligente del Agente de IA con acceso a toda la información del sistema y FSM contable
    setTimeout(async () => {
      const textoNormalizado = normalizarDictadoVoz(mensajeAEnviar);
      const sesionActual = obtenerSesionCopilotoGlobal();
      const intencionContable = detectarIntencionContableInicial(textoNormalizado);
      if (sesionActual.flujoContable || intencionContable.esContable) {
        const resCopiloto = await consultarCopilotoTransaccional(textoNormalizado, {
          operador: usuario || "Operador",
        });
        const nuevoMsgIa: MensajeChat = {
          id: `ia-${Date.now()}`,
          remitente: "ia",
          texto: resCopiloto.mensaje,
          fecha: new Date().toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit" }),
        };
        setMensajes((prev) => [...prev, nuevoMsgIa]);
        setEscribiendoIa(false);
        return;
      }

      const res = await consultarAgenteIaEnVivo(mensajeAEnviar, rolActual, fueDictado);

      if (res.rutaNavegacion || res.eventoAccion) {
        dispararAccionConRuta(res.rutaNavegacion, res.eventoAccion);
      }

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
    }, 300);
  };

  const alternarDictadoVoz = () => {
    if (escuchandoVoz && recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        /* noop */
      }
      setEscuchandoVoz(false);
      return;
    }

    const w = typeof window !== "undefined" ? (window as any) : null;
    const SpeechRec = w?.SpeechRecognition || w?.webkitSpeechRecognition;
    if (!SpeechRec) {
      setMensajes((prev) => [
        ...prev,
        {
          id: `sys-${Date.now()}`,
          remitente: "sistema",
          texto: "⚠️ Tu navegador no soporta dictado por voz directo (Web Speech API). Usa Chrome o Edge, o escribe tu comando en el cuadro inferior.",
          fecha: new Date().toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit" }),
        },
      ]);
      return;
    }

    const rec = new SpeechRec();
    rec.lang = "es-VE";
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    let transcripcionFinal = "";

    rec.onstart = () => {
      setEscuchandoVoz(true);
    };

    rec.onresult = (event: any) => {
      let parcial = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const pieza = event.results[i][0]?.transcript ?? "";
        if (event.results[i].isFinal) {
          transcripcionFinal += pieza + " ";
        } else {
          parcial += pieza;
        }
      }
      const combinado = (transcripcionFinal + parcial).trim();
      if (combinado) setTextoInput(combinado);
    };

    rec.onerror = () => {
      setEscuchandoVoz(false);
    };

    rec.onend = () => {
      setEscuchandoVoz(false);
      const finalLimpio = (transcripcionFinal || textoInput).trim();
      if (finalLimpio) {
        handleEnviarMensaje(finalLimpio, true);
      }
    };

    recognitionRef.current = rec;
    try {
      rec.start();
    } catch {
      setEscuchandoVoz(false);
    }
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
          title="Abrir Agente de IA · Información del Sistema y Dictado por Voz"
        >
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
          </span>
          <span className="text-xl">🤖</span>
          <div className="flex flex-col text-left">
            <span className="text-xs font-black tracking-tight text-emerald-400">
              🤖 Agente de IA
            </span>
            <span className="text-[10px] font-bold text-slate-300">
              Info del Sistema · 🎙️ Dictado por Voz
            </span>
          </div>
        </button>
      )}

      {/* VENTANA FLOTANTE DEL CHAT */}
      {abierto && (
        <div className="flex h-[560px] w-[360px] sm:w-[420px] flex-col overflow-hidden overflow-x-hidden rounded-2xl border border-slate-700 bg-slate-950 text-slate-100 shadow-2xl animate-in zoom-in-95 duration-200">
          {/* HEADER DEL WIDGET */}
          <div className="flex shrink-0 items-center justify-between border-b border-slate-800 bg-slate-900 px-4 py-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/20 text-lg border border-emerald-500/40">
                🤖
              </div>
              <div>
                <h4 className="text-xs font-black tracking-tight text-white flex items-center gap-1.5">
                  <span>🤖 Agente de IA del Sistema</span>
                  <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                </h4>
                <p className="text-[10px] text-slate-400">
                  Información total en vivo · 🎙️ Dictado e Interpretación
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

          {/* SELECTOR DE PESTAÑAS (CHAT VS ACCIONES VS MIS TICKETS) */}
          <div className="flex border-b border-slate-800 bg-slate-950/80 text-[11px] font-bold">
            <button
              onClick={() => setPestana("chat")}
              className={`flex-1 py-2 text-center transition border-b-2 ${
                pestana === "chat"
                  ? "border-emerald-500 text-emerald-400 bg-emerald-950/20"
                  : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              💬 Agente IA
            </button>
            <button
              onClick={() => setPestana("acciones")}
              className={`flex-1 py-2 text-center transition border-b-2 ${
                pestana === "acciones"
                  ? "border-indigo-500 text-indigo-300 bg-indigo-950/25"
                  : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              ⚡ Acciones
            </button>
            <button
              onClick={() => setPestana("mis_tickets")}
              className={`flex-1 py-2 text-center transition border-b-2 ${
                pestana === "mis_tickets"
                  ? "border-amber-500 text-amber-400 bg-amber-950/20"
                  : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              🎫 Tickets ({misTickets.length})
            </button>
          </div>

          {/* CONTENIDO PESTAÑA ACCIONES DE LA PLATAFORMA */}
          {pestana === "acciones" && (
            <div className="flex-1 overflow-y-auto overflow-x-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden p-3 space-y-3">
              {/* 1. Apuestas, Pizarra y Liquidación */}
              <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-2.5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black uppercase tracking-wider text-emerald-400">
                    🐎🎲 Apuestas, Pizarra y Liquidación
                  </span>
                  <span className="text-[9px] font-semibold text-slate-400">1 clic</span>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {CATALOGO_ACCIONES_PLATAFORMA.filter((a) => a.categoria === "apuestas").map((acc) => (
                    <button
                      key={acc.id}
                      type="button"
                      onClick={() => ejecutarAccionDirecta(acc)}
                      title={acc.descripcion}
                      className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-left text-[11px] font-bold text-slate-200 transition hover:border-emerald-500/60 hover:bg-emerald-950/30 hover:text-white"
                    >
                      <span className="shrink-0">{acc.icono}</span>
                      <span className="truncate">{acc.etiqueta}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* 2. Clientes, Saldos y Contabilidad */}
              <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-2.5 space-y-2">
                <span className="block text-[10px] font-black uppercase tracking-wider text-amber-400">
                  👥 Clientes, Saldos y Contabilidad
                </span>
                <div className="grid grid-cols-2 gap-1.5">
                  {CATALOGO_ACCIONES_PLATAFORMA.filter((a) => a.categoria === "clientes_contabilidad").map((acc) => (
                    <button
                      key={acc.id}
                      type="button"
                      onClick={() => ejecutarAccionDirecta(acc)}
                      title={acc.descripcion}
                      className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-left text-[11px] font-bold text-slate-200 transition hover:border-amber-500/60 hover:bg-amber-950/30 hover:text-white"
                    >
                      <span className="shrink-0">{acc.icono}</span>
                      <span className="truncate">{acc.etiqueta}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* 3. Control en Vivo del Portal de Clientes */}
              <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-2.5 space-y-2">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[10px] font-black uppercase tracking-wider text-indigo-300">
                    🛡️ Control de Venta (Portal de Clientes)
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={guardandoBloqueoIa}
                      onClick={() => void cambiarTodasModalidadesPortal(false)}
                      className="rounded bg-emerald-600 px-2 py-0.5 text-[9px] font-black uppercase text-white hover:bg-emerald-500 disabled:opacity-50"
                    >
                      🔓 Abrir Todo
                    </button>
                    <button
                      type="button"
                      disabled={guardandoBloqueoIa}
                      onClick={() => void cambiarTodasModalidadesPortal(true)}
                      className="rounded bg-rose-600 px-2 py-0.5 text-[9px] font-black uppercase text-white hover:bg-rose-500 disabled:opacity-50"
                    >
                      🔒 Bloquear Todo
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {MODALIDADES_PORTAL_META.map((mod) => {
                    const bloqueada = Boolean(bloqueosPortal?.[mod.id]);
                    return (
                      <button
                        key={mod.id}
                        type="button"
                        disabled={guardandoBloqueoIa}
                        onClick={() => void alternarModalidadPortalEnVivo(mod.id)}
                        className={`flex items-center justify-between rounded-lg border px-2 py-1.5 text-[10px] font-bold transition ${
                          bloqueada
                            ? "border-rose-500/50 bg-rose-950/40 text-rose-200"
                            : "border-emerald-500/40 bg-emerald-950/30 text-emerald-200"
                        }`}
                      >
                        <span className="truncate">
                          {mod.icono} {mod.etiqueta}
                        </span>
                        <span className="ml-1 shrink-0 text-[9px] font-black uppercase">
                          {bloqueada ? "🔒 Bloq" : "🔓 Act"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 4. Navegación Directa a todos los Módulos de la Plataforma */}
              <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-2.5 space-y-2">
                <span className="block text-[10px] font-black uppercase tracking-wider text-cyan-300">
                  🧭 Ir a Módulos de la Plataforma ({CATALOGO_RUTAS_PLATAFORMA.length})
                </span>
                <div className="grid grid-cols-2 gap-1.5">
                  {CATALOGO_RUTAS_PLATAFORMA.map((mod) => (
                    <button
                      key={mod.id}
                      type="button"
                      onClick={() => {
                        router.push(mod.ruta);
                      }}
                      className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-left text-[10px] font-bold text-slate-300 transition hover:border-cyan-400/60 hover:bg-cyan-950/30 hover:text-white"
                    >
                      <span className="shrink-0">{mod.icono}</span>
                      <span className="truncate">{mod.etiqueta}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* CONTENIDO PESTAÑA CHAT */}
          {pestana === "chat" && (
            <div className="flex flex-1 flex-col overflow-hidden overflow-x-hidden">
              {/* ÁREA DE MENSAJES */}
              <div className="flex-1 overflow-y-auto overflow-x-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden p-3.5 space-y-3">
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
                      <div className="my-1 rounded-xl border border-amber-500/40 bg-amber-950/40 p-3 text-center text-xs text-amber-200 break-words">
                        <p className="whitespace-pre-line break-words">{m.texto}</p>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center gap-1.5 mb-1 text-[10px] text-slate-400">
                          <span>{m.remitente === "usuario" ? "Tú" : "🤖 Agente de IA"}</span>
                          <span>•</span>
                          <span>{m.fecha}</span>
                        </div>
                        <div
                          className={`max-w-[90%] overflow-x-hidden break-words rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed shadow-sm ${
                            m.remitente === "usuario"
                              ? "bg-emerald-600 text-white rounded-br-xs"
                              : "bg-slate-900 border border-slate-800 text-slate-200 rounded-bl-xs"
                          }`}
                        >
                          <p className="whitespace-pre-line break-words">{m.texto}</p>

                          {/* Acciones directas si incluye reporte oficial para WhatsApp */}
                          {m.reporteWhatsapp && (
                            <div className="mt-3 pt-2.5 border-t border-slate-700/60 flex flex-wrap items-center gap-2">
                              <a
                                href={`https://wa.me/?text=${encodeURIComponent(m.reporteWhatsapp)}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs shadow-md transition active:scale-95"
                              >
                                <span>📲 Enviar por WhatsApp</span>
                              </a>
                              <button
                                type="button"
                                onClick={() => {
                                  if (typeof navigator !== "undefined" && navigator.clipboard) {
                                    void navigator.clipboard.writeText(m.reporteWhatsapp!);
                                    setCopiadoId(m.id);
                                    setTimeout(() => setCopiadoId(null), 2000);
                                  }
                                }}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-200 font-semibold text-xs transition active:scale-95"
                              >
                                <span>{copiadoId === m.id ? "✅ ¡Copiado!" : "📋 Copiar Reporte"}</span>
                              </button>
                            </div>
                          )}

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
                    <span>El Agente de IA está procesando la información del sistema...</span>
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

              {/* CHIPS RÁPIDOS DE INFORMACIÓN DEL SISTEMA (SIN SCROLL HORIZONTAL) */}
              {!mostrarFormEscalar && (
                <div className="border-t border-slate-800/80 bg-slate-950/60 px-3 py-1.5 overflow-x-hidden flex flex-wrap gap-1.5 text-[10px]">
                  <button
                    type="button"
                    onClick={() => handleEnviarMensaje("Resumen del sistema")}
                    className="rounded-full border border-emerald-500/40 bg-emerald-950/40 px-2.5 py-1 font-bold text-emerald-300 hover:border-emerald-400 hover:text-white"
                  >
                    📊 Resumen del Sistema
                  </button>
                  <button
                    type="button"
                    onClick={() => handleEnviarMensaje("¿Qué diferencia hay entre saldo Libre, Avalado y Pozo?")}
                    className="rounded-full border border-slate-700 bg-slate-900 px-2.5 py-1 text-slate-300 hover:border-emerald-500 hover:text-white"
                  >
                    💵 Saldos
                  </button>
                  <button
                    type="button"
                    onClick={() => handleEnviarMensaje("¿Cómo se calculan los puestos con varios ejemplares como 1y2 o 3y4?")}
                    className="rounded-full border border-slate-700 bg-slate-900 px-2.5 py-1 text-slate-300 hover:border-emerald-500 hover:text-white"
                  >
                    🐎 Puestos
                  </button>
                  <button
                    type="button"
                    onClick={() => handleEnviarMensaje("¿Cómo funciona el Control de Cruces?")}
                    className="rounded-full border border-slate-700 bg-slate-900 px-2.5 py-1 text-slate-300 hover:border-emerald-500 hover:text-white"
                  >
                    ⚡ Cruces
                  </button>
                </div>
              )}

              {/* CAMPO DE TEXTO INPUT + DICTADO POR VOZ */}
              {!mostrarFormEscalar && (
                <div className="border-t border-slate-800 bg-slate-900 p-2.5">
                  {escuchandoVoz && (
                    <div className="mb-1.5 flex items-center justify-between rounded-lg border border-rose-500/50 bg-rose-950/40 px-2.5 py-1 text-[10px] font-bold text-rose-200">
                      <span className="flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-rose-500 animate-ping" />
                        🎙️ Escuchando dictado… habla ahora y el Agente interpretará
                      </span>
                      <button
                        type="button"
                        onClick={alternarDictadoVoz}
                        className="text-rose-300 underline hover:text-white"
                      >
                        Detener
                      </button>
                    </div>
                  )}
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={alternarDictadoVoz}
                      title={escuchandoVoz ? "Detener dictado por voz" : "Dictar por voz (el Agente de IA interpreta tu voz)"}
                      className={`shrink-0 rounded-xl border px-2.5 py-2 text-xs font-black transition ${
                        escuchandoVoz
                          ? "border-rose-400 bg-rose-600 text-white animate-pulse"
                          : "border-slate-700 bg-slate-800 text-amber-300 hover:border-amber-400 hover:bg-slate-700"
                      }`}
                    >
                      {escuchandoVoz ? "⏹️" : "🎙️"}
                    </button>
                    <input
                      type="text"
                      value={textoInput}
                      onChange={(e) => setTextoInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleEnviarMensaje();
                      }}
                      placeholder="Escribe o dicta (🎙️) cualquier consulta o jugada…"
                      className="min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-hidden"
                    />
                    <button
                      type="button"
                      onClick={() => handleEnviarMensaje()}
                      disabled={!textoInput.trim() || escribiendoIa}
                      className="shrink-0 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-black text-white hover:bg-emerald-500 disabled:opacity-50 transition"
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
            <div className="flex-1 overflow-y-auto overflow-x-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden p-3 space-y-3">
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
