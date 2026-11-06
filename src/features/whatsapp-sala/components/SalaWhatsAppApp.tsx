"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/core/supabase";
import {
  type EstadoCarreraGrupo,
  type MensajeSala,
  type TicketP2P,
  type SaldoPrivado,
  type GrupoSala,
  obtenerMiSaldoPrivado,
  procesarRespuestaJugadaFifo,
  liquidarCarreraChatP2p,
  detectarComandoOperador,
  parsearPropuestaChat,
} from "../lib/chat-p2p";
import { SalaHeaderWallet } from "./SalaHeaderWallet";
import { SalaLeftPanelGrupos } from "./SalaLeftPanelGrupos";
import { SalaRightPanelCarrera } from "./SalaRightPanelCarrera";
import { SalaBurbujaMensaje } from "./SalaBurbujaMensaje";
import { emitirToast } from "@/shared/lib/mensajeria";

export interface ClienteSesionSala {
  id: string;
  nombre: string;
  seudonimo: string;
  telefono: string;
  saldo_actual: number;
  aval: number;
  libre: boolean;
  modo_juego: string;
  grupo_id?: string | null;
  esOperadorOAdmin?: boolean;
}

const STORAGE_SESSION_KEY = "hipico_sala_session_v2";
const STORAGE_FONT_KEY = "hipico_chat_font_size";
const GRUPO_DEFAULT_ID = "d290daa1-a44b-4ed4-bb8a-03db4ecc32b0";

function reproducirBeepWhatsApp() {
  if (typeof window === "undefined") return;
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(850, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.08);
    gain.gain.setValueAtTime(0.05, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.001, ctx.currentTime + 0.08);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.08);
  } catch {
    /* ignore audio policy */
  }
}

export function SalaWhatsAppApp() {
  const [sesion, setSesion] = useState<ClienteSesionSala | null>(null);
  const [cargandoAuth, setCargandoAuth] = useState(true);

  // Formulario Onboarding / Login
  const [formNombre, setFormNombre] = useState("");
  const [formTelefono, setFormTelefono] = useState("");
  const [pasoOtp, setPasoOtp] = useState(false);
  const [codigoOtp, setCodigoOtp] = useState("");
  const [codigoGenerado, setCodigoGenerado] = useState("");
  const [errorLogin, setErrorLogin] = useState<string | null>(null);

  // Multi-Grupo y Estado del Chat
  const [grupos, setGrupos] = useState<GrupoSala[]>([
    { id: GRUPO_DEFAULT_ID, nombre: "Sala Oficial La Rinconada & USA", descripcion: "Paradas P2P en vivo", activo: true },
    { id: "grupo-vip-1", nombre: "Sala Clásicos VIP", descripcion: "Apuestas mayores y pollas", activo: false },
  ]);
  const [grupoActivoId, setGrupoActivoId] = useState<string>(GRUPO_DEFAULT_ID);

  // Estado de Carrera Activa por Grupo
  const [carreraActiva, setCarreraActiva] = useState<EstadoCarreraGrupo>({
    grupo_id: GRUPO_DEFAULT_ID,
    hipodromo: "LA RINCONADA",
    carrera: 1,
    fecha: new Date().toISOString().slice(0, 10),
    estado: "ABIERTA",
    distancia: "1200m",
    superficie: "Arena",
    ejemplares: [],
  });

  // Saldo Privado del Usuario Actual
  const [saldoPrivado, setSaldoPrivado] = useState<SaldoPrivado | null>(null);

  // Escala Dinámica de Tamaño de Letra (12px - 24px)
  const [tamanoLetra, setTamanoLetra] = useState<number>(15);

  // Mensajes y Tickets
  const [mensajes, setMensajes] = useState<MensajeSala[]>([]);
  const [tickets, setTickets] = useState<TicketP2P[]>([]);
  const [mensajeCitado, setMensajeCitado] = useState<MensajeSala | null>(null);
  const [inputTexto, setInputTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [grabandoVoz, setGrabandoVoz] = useState(false);

  // Paneles responsive
  const [panelDerechoAbierto, setPanelDerechoAbierto] = useState(false);
  const [mostrarGruposMovil, setMostrarGruposMovil] = useState(false);

  const chatBottomRef = useRef<HTMLDivElement>(null);

  // 1. Cargar tamaño de letra persistido
  useEffect(() => {
    try {
      const f = localStorage.getItem(STORAGE_FONT_KEY);
      if (f) {
        const val = parseInt(f, 10);
        if (val >= 12 && val <= 24) setTamanoLetra(val);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const handleCambiarTamanoLetra = (nuevoTamano: number) => {
    setTamanoLetra(nuevoTamano);
    try {
      localStorage.setItem(STORAGE_FONT_KEY, String(nuevoTamano));
    } catch {
      /* ignore */
    }
  };

  // 2. Cargar sesión previa guardada
  useEffect(() => {
    try {
      const guardada = localStorage.getItem(STORAGE_SESSION_KEY);
      if (guardada) {
        const parsed = JSON.parse(guardada) as ClienteSesionSala;
        if (parsed && parsed.id && parsed.nombre) {
          setSesion(parsed);
        }
      }
    } catch {
      /* ignore */
    } finally {
      setCargandoAuth(false);
    }
  }, []);

  // 3. Refrescar Saldo Privado (RPC obtener_mi_saldo_privado)
  const refrescarSaldo = useCallback(async (clienteId?: string) => {
    const cid = clienteId || sesion?.id;
    if (!cid) return;
    const res = await obtenerMiSaldoPrivado(cid);
    if (res.ok) {
      setSaldoPrivado(res);
    }
  }, [sesion?.id]);

  useEffect(() => {
    if (sesion?.id) {
      refrescarSaldo(sesion.id);
    }
  }, [sesion?.id, refrescarSaldo]);

  // 4. Sincronizar grupos desde Supabase
  useEffect(() => {
    async function cargarGrupos() {
      if (!supabase) return;
      try {
        const { data } = await supabase.from("grupos").select("id, nombre, descripcion").order("nombre");
        if (data && data.length > 0) {
          setGrupos(data.map((g) => ({ id: String(g.id), nombre: g.nombre, descripcion: g.descripcion || undefined })));
        }
      } catch {
        /* fallback a grupos estáticos */
      }
    }
    cargarGrupos();
  }, []);

  // 5. Cargar estado de carrera del grupo activo
  const cargarEstadoCarreraGrupo = useCallback(async (grupoId: string) => {
    if (!supabase) return;
    try {
      // Primero buscar en chat_estado_grupo
      const { data } = await supabase
        .from("chat_estado_grupo")
        .select("*")
        .eq("grupo_id", grupoId)
        .maybeSingle();

      if (data) {
        setCarreraActiva({
          id: data.id,
          grupo_id: data.grupo_id,
          hipodromo: data.hipodromo,
          carrera: data.carrera,
          fecha: data.fecha,
          estado: data.estado as any,
          distancia: data.distancia || "1200m",
          superficie: data.superficie || "Arena",
          hora: data.hora,
          ejemplares: (data.ejemplares as any) || [],
        });
      } else {
        // Fallback: traer la carrera activa del día
        const hoy = new Date().toISOString().slice(0, 10);
        const { data: cData } = await supabase
          .from("carreras")
          .select("hipodromo, carrera, estado, hora, distancia, superficie")
          .eq("fecha", hoy)
          .order("carrera", { ascending: true })
          .limit(1);

        if (cData && cData.length > 0) {
          const c = cData[0];
          setCarreraActiva((prev) => ({
            ...prev,
            hipodromo: c.hipodromo || "LA RINCONADA",
            carrera: Number(c.carrera) || 1,
            estado: String(c.estado).toUpperCase() === "CERRADA" ? "CERRADA" : "ABIERTA",
            distancia: c.distancia || "1200m",
            superficie: c.superficie || "Arena",
          }));
        }
      }
    } catch {
      /* ignore */
    }
  }, []);

  // 6. Cargar mensajes y tickets del grupo activo
  const cargarMensajesYTickets = useCallback(async (grupoId: string, clienteId?: string) => {
    if (!supabase) return;
    try {
      const cid = clienteId || sesion?.id;

      // Mensajes: RLS ya filtra los privados, pero reforzamos en cliente
      const { data: msgs } = await supabase
        .from("chat_mensajes_sala")
        .select("*")
        .eq("grupo_id", grupoId)
        .order("created_at", { ascending: true })
        .limit(100);

      if (msgs) {
        const formateados: MensajeSala[] = msgs
          .filter((m: any) => {
            if (!m.destinatario_privado_id) return true;
            return m.destinatario_privado_id === cid || m.autor_id === cid;
          })
          .map((m: any) => ({
            id: m.id,
            grupo_id: m.grupo_id,
            autor_id: m.autor_id,
            autor_nombre: m.autor_nombre,
            autor_rol: m.autor_rol,
            texto: m.texto,
            tipo: m.tipo,
            destinatario_privado_id: m.destinatario_privado_id,
            reply_to_msg_id: m.reply_to_msg_id,
            propuesta_id: m.propuesta_id,
            monto_propuesto: m.monto_propuesto ? Number(m.monto_propuesto) : undefined,
            monto_disponible: m.monto_disponible ? Number(m.monto_disponible) : undefined,
            datos_jugada: m.datos_jugada,
            solo_borrable_operador: m.solo_borrable_operador,
            created_at: m.created_at,
            esMio: Boolean(cid && m.autor_id === cid),
            esPrivadoParaMi: Boolean(m.destinatario_privado_id && m.destinatario_privado_id === cid),
          }));
        setMensajes(formateados);
      }

      // Tickets P2P de esta carrera
      const { data: tkts } = await supabase
        .from("chat_tickets_p2p")
        .select("*")
        .eq("grupo_id", grupoId)
        .order("numero_ticket", { ascending: true })
        .limit(100);

      if (tkts) {
        setTickets(tkts as any);
      }
    } catch {
      /* ignore */
    }
  }, [sesion?.id]);

  // Recargar al cambiar de grupo
  useEffect(() => {
    if (!grupoActivoId) return;
    cargarEstadoCarreraGrupo(grupoActivoId);
    cargarMensajesYTickets(grupoActivoId, sesion?.id);
  }, [grupoActivoId, sesion?.id, cargarEstadoCarreraGrupo, cargarMensajesYTickets]);

  // 7. Suscripción Supabase Realtime para Mensajes, Estado y Tickets
  useEffect(() => {
    if (!supabase || !sesion?.id || !grupoActivoId) return;

    const canal = supabase
      .channel(`chat-sala-canal-${grupoActivoId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "chat_mensajes_sala",
          filter: `grupo_id=eq.${grupoActivoId}`,
        },
        (payload: any) => {
          const m = payload.new;
          if (!m) return;
          // Validar privacidad DM
          if (m.destinatario_privado_id && m.destinatario_privado_id !== sesion.id && m.autor_id !== sesion.id) {
            return;
          }

          reproducirBeepWhatsApp();
          setMensajes((prev) => {
            if (prev.some((x) => x.id === m.id)) return prev;
            return [
              ...prev,
              {
                id: m.id,
                grupo_id: m.grupo_id,
                autor_id: m.autor_id,
                autor_nombre: m.autor_nombre,
                autor_rol: m.autor_rol,
                texto: m.texto,
                tipo: m.tipo,
                destinatario_privado_id: m.destinatario_privado_id,
                reply_to_msg_id: m.reply_to_msg_id,
                propuesta_id: m.propuesta_id,
                monto_propuesto: m.monto_propuesto ? Number(m.monto_propuesto) : undefined,
                monto_disponible: m.monto_disponible ? Number(m.monto_disponible) : undefined,
                datos_jugada: m.datos_jugada,
                solo_borrable_operador: m.solo_borrable_operador,
                created_at: m.created_at,
                esMio: m.autor_id === sesion.id,
                esPrivadoParaMi: m.destinatario_privado_id === sesion.id,
              },
            ];
          });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "chat_mensajes_sala",
          filter: `grupo_id=eq.${grupoActivoId}`,
        },
        (payload: any) => {
          const m = payload.new;
          if (!m) return;
          setMensajes((prev) =>
            prev.map((item) =>
              item.id === m.id
                ? {
                    ...item,
                    monto_disponible: m.monto_disponible ? Number(m.monto_disponible) : 0,
                  }
                : item
            )
          );
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "chat_tickets_p2p",
          filter: `grupo_id=eq.${grupoActivoId}`,
        },
        () => {
          cargarMensajesYTickets(grupoActivoId, sesion.id);
          refrescarSaldo(sesion.id);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "chat_estado_grupo",
          filter: `grupo_id=eq.${grupoActivoId}`,
        },
        () => {
          cargarEstadoCarreraGrupo(grupoActivoId);
        }
      )
      .subscribe();

    return () => {
      canal.unsubscribe();
    };
  }, [grupoActivoId, sesion?.id, cargarMensajesYTickets, cargarEstadoCarreraGrupo, refrescarSaldo]);

  // Auto-scroll al final del chat
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [mensajes]);

  // ──────────────────────────────────────────────────────────────────────────
  // ONBOARDING / LOGIN MÓVIL OTP
  // ──────────────────────────────────────────────────────────────────────────
  const solicitarOtp = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorLogin(null);
    const nomLimpio = formNombre.trim().toUpperCase();
    const telLimpio = formTelefono.replace(/\D+/g, "");

    if (!nomLimpio) {
      setErrorLogin("Por favor ingresa tu nombre o seudónimo.");
      return;
    }
    if (telLimpio.length < 7) {
      setErrorLogin("Por favor ingresa un número de celular válido.");
      return;
    }

    const otp = Math.floor(1000 + Math.random() * 9000).toString();
    setCodigoGenerado(otp);
    setPasoOtp(true);
  };

  const confirmarOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (codigoOtp.trim() !== codigoGenerado) {
      setErrorLogin("Código incorrecto. Ingresa el código mostrado.");
      return;
    }

    const nomLimpio = formNombre.trim().toUpperCase();
    const telLimpio = formTelefono.trim();
    const esAdminOperador = /ADMIN|OPERADOR|ARELY|JULIO/i.test(nomLimpio);

    // Buscar si ya existe en tabla clientes por nombre o crear id
    let clienteId = crypto.randomUUID ? crypto.randomUUID() : `cli-${Date.now()}`;
    if (supabase) {
      try {
        const { data: cliExistente } = await supabase
          .from("clientes")
          .select("id, nombre, saldo_actual, aval, libre, modo_juego")
          .ilike("nombre", nomLimpio)
          .maybeSingle();

        if (cliExistente) {
          clienteId = cliExistente.id;
        }
      } catch {
        /* ignore */
      }
    }

    const nuevaSesion: ClienteSesionSala = {
      id: clienteId,
      nombre: nomLimpio,
      seudonimo: nomLimpio,
      telefono: telLimpio,
      saldo_actual: 0,
      aval: 0,
      libre: true,
      modo_juego: "libre",
      grupo_id: grupoActivoId,
      esOperadorOAdmin: esAdminOperador,
    };

    localStorage.setItem(STORAGE_SESSION_KEY, JSON.stringify(nuevaSesion));
    setSesion(nuevaSesion);
    setPasoOtp(false);
    refrescarSaldo(clienteId);
  };

  const cerrarSesion = () => {
    localStorage.removeItem(STORAGE_SESSION_KEY);
    setSesion(null);
    setPasoOtp(false);
    setFormNombre("");
    setFormTelefono("");
  };

  // ──────────────────────────────────────────────────────────────────────────
  // ENVIAR MENSAJE & PROCESAMIENTO AUTÓNOMO
  // ──────────────────────────────────────────────────────────────────────────
  const enviarMensaje = async (textoPersonalizado?: string) => {
    const texto = (textoPersonalizado ?? inputTexto).trim();
    if (!texto || !sesion || enviando) return;

    setEnviando(true);
    setInputTexto("");
    const replyId = mensajeCitado?.id || null;
    setMensajeCitado(null);

    const horaLocal = new Date().toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit", hour12: true });

    // ────────────────────────────────────────────────────────────────────────
    // MÓDULO 4: COMANDOS EXCLUSIVOS DE OPERADOR
    // ────────────────────────────────────────────────────────────────────────
    const cmdOp = detectarComandoOperador(texto);
    if (cmdOp) {
      if (!sesion.esOperadorOAdmin) {
        // Enviar respuesta PRIVADA aclarando que el comando es exclusivo de operadores
        if (supabase) {
          await supabase.from("chat_mensajes_sala").insert([
            {
              grupo_id: grupoActivoId,
              autor_id: null,
              autor_nombre: "Agente IA Oficial",
              autor_rol: "BOT",
              texto: `⛔ @${sesion.nombre}: Los comandos de apertura, cierre y pizarra son exclusivos de Operadores y Administradores.`,
              tipo: "DM_PRIVADO",
              destinatario_privado_id: sesion.id,
              reply_to_msg_id: replyId,
            },
          ]);
        }
        setEnviando(false);
        return;
      }

      // 4.1 ABRIR CARRERA
      if (cmdOp.tipo === "ABRIR_CARRERA") {
        const hipoNuevo = cmdOp.hipodromo || carreraActiva.hipodromo;
        const cNum = cmdOp.carrera;

        // Actualizar chat_estado_grupo
        if (supabase) {
          await supabase.from("chat_estado_grupo").upsert(
            {
              grupo_id: grupoActivoId,
              hipodromo: hipoNuevo,
              carrera: cNum,
              fecha: new Date().toISOString().slice(0, 10),
              estado: "ABIERTA",
              updated_at: new Date().toISOString(),
            },
            { onConflict: "grupo_id" }
          );

          // Insertar automáticamente tarjeta gráfica de carrera (MÓDULO 4.2)
          await supabase.from("chat_mensajes_sala").insert([
            {
              grupo_id: grupoActivoId,
              autor_id: sesion.id,
              autor_nombre: sesion.nombre,
              autor_rol: "OPERADOR",
              texto: `🟢 Carrera ABIERTA: ${hipoNuevo} Carrera ${cNum}`,
              tipo: "IMAGEN_CARRERA",
              solo_borrable_operador: true,
            },
          ]);
        }

        setCarreraActiva((prev) => ({
          ...prev,
          hipodromo: hipoNuevo,
          carrera: cNum,
          estado: "ABIERTA",
        }));
        setEnviando(false);
        return;
      }

      // 4.2 CERRAR CARRERA
      if (cmdOp.tipo === "CERRAR_CARRERA") {
        if (supabase) {
          await supabase
            .from("chat_estado_grupo")
            .update({ estado: "CERRADA", updated_at: new Date().toISOString() })
            .eq("grupo_id", grupoActivoId);

          await supabase.from("chat_mensajes_sala").insert([
            {
              grupo_id: grupoActivoId,
              autor_id: sesion.id,
              autor_nombre: sesion.nombre,
              autor_rol: "OPERADOR",
              texto: `🚨 *¡CARRERA CERRADA!*\n\n${carreraActiva.hipodromo} (Carrera ${carreraActiva.carrera}) ha sido **CERRADA** por el operador. No se admiten más jugadas.`,
              tipo: "ESTADO_CARRERA",
            },
          ]);
        }

        setCarreraActiva((prev) => ({ ...prev, estado: "CERRADA" }));
        setEnviando(false);
        return;
      }

      // 4.3 PUBLICAR PIZARRA CONTEXTUAL Y LIQUIDAR
      if (cmdOp.tipo === "PIZARRA") {
        await liquidarCarreraChatP2p({
          grupoId: grupoActivoId,
          pizarra: cmdOp.pizarra,
          operadorNombre: sesion.nombre,
        });
        setEnviando(false);
        return;
      }
    }

    // ────────────────────────────────────────────────────────────────────────
    // MÓDULO 2: PRIVACIDAD ESTRICTA DEL SALDO
    // ────────────────────────────────────────────────────────────────────────
    if (/^saldo$|^disponible$|^cuanto tengo$|^mi saldo$/i.test(texto)) {
      const s = await obtenerMiSaldoPrivado(sesion.id);
      const dispTxt = s.libre
        ? "⭐ Tu cuenta tiene **Estatus LIBRE** (sin limitaciones de saldo)."
        : `💰 Tu Saldo Disponible es **$${s.disponible.toFixed(2)}** (Saldo: $${s.saldo_actual.toFixed(2)} + Aval: $${s.aval.toFixed(2)}${
            s.riesgo_en_curso > 0 ? ` - En Juego: $${s.riesgo_en_curso.toFixed(2)}` : ""
          }).`;

      // Enviar con destinatario_privado_id = sesion.id para que NO ensucie el chat público
      if (supabase) {
        await supabase.from("chat_mensajes_sala").insert([
          {
            grupo_id: grupoActivoId,
            autor_id: null,
            autor_nombre: "Agente IA Oficial",
            autor_rol: "BOT",
            texto: dispTxt,
            tipo: "DM_PRIVADO",
            destinatario_privado_id: sesion.id,
            reply_to_msg_id: replyId,
          },
        ]);
      }
      setEnviando(false);
      return;
    }

    // ────────────────────────────────────────────────────────────────────────
    // MÓDULO 3: PROPUESTAS DE JUGADA Y MOTOR FIFO
    // ────────────────────────────────────────────────────────────────────────
    const prop = parsearPropuestaChat(texto);
    if (prop) {
      // 1. Validar que la carrera esté abierta
      if (carreraActiva.estado === "CERRADA" || carreraActiva.estado === "LIQUIDADA") {
        if (supabase) {
          await supabase.from("chat_mensajes_sala").insert([
            {
              grupo_id: grupoActivoId,
              autor_id: null,
              autor_nombre: "Agente IA Oficial",
              autor_rol: "BOT",
              texto: `⛔ @${sesion.nombre}: La carrera ${carreraActiva.hipodromo} C${carreraActiva.carrera} está **CERRADA**. No se aceptan jugadas.`,
              tipo: "DM_PRIVADO",
              destinatario_privado_id: sesion.id,
              reply_to_msg_id: replyId,
            },
          ]);
        }
        setEnviando(false);
        return;
      }

      // 2. Validar que el caballo no esté retirado
      const retirado = carreraActiva.ejemplares?.some(
        (ej) => String(ej.numero) === String(prop.caballo) && ej.retirado
      );
      if (retirado) {
        if (supabase) {
          await supabase.from("chat_mensajes_sala").insert([
            {
              grupo_id: grupoActivoId,
              autor_id: null,
              autor_nombre: "Agente IA Oficial",
              autor_rol: "BOT",
              texto: `⚠️ @${sesion.nombre}: El ejemplar #${prop.caballo} está marcado como **RETIRADO**.`,
              tipo: "DM_PRIVADO",
              destinatario_privado_id: sesion.id,
              reply_to_msg_id: replyId,
            },
          ]);
        }
        setEnviando(false);
        return;
      }

      // 3. Validar fondos del proponente
      const s = await obtenerMiSaldoPrivado(sesion.id);
      let montoReal = prop.monto;
      if (!s.libre) {
        if (s.disponible <= 0) {
          if (supabase) {
            await supabase.from("chat_mensajes_sala").insert([
              {
                grupo_id: grupoActivoId,
                autor_id: null,
                autor_nombre: "Agente IA Oficial",
                autor_rol: "BOT",
                texto: `⚠️ @${sesion.nombre}: Tu disponible es $0.00. No puedes proponer jugadas sin saldo.`,
                tipo: "DM_PRIVADO",
                destinatario_privado_id: sesion.id,
                reply_to_msg_id: replyId,
              },
            ]);
          }
          setEnviando(false);
          return;
        }

        // Si pide más de lo disponible, topar al máximo disponible
        if (montoReal > s.disponible) {
          montoReal = s.disponible;
        }
      }

      // 4. Si es concreción directa con contraparte (ej. "100 al 5 con @SAM")
      if (prop.contraparte) {
        const ticketNum = Math.floor(100000 + Math.random() * 900000);
        const juegaNombre = prop.rol === "JUEGA" ? sesion.nombre : prop.contraparte;
        const daNombre = prop.rol === "DA" ? sesion.nombre : prop.contraparte;

        if (supabase) {
          await supabase.from("chat_tickets_p2p").insert([
            {
              numero_ticket: ticketNum,
              grupo_id: grupoActivoId,
              juega_id: prop.rol === "JUEGA" ? sesion.id : null,
              juega_nombre: juegaNombre,
              da_id: prop.rol === "DA" ? sesion.id : null,
              da_nombre: daNombre,
              monto: montoReal,
              jugada: prop.jugada,
              caballo: prop.caballo,
              carrera: carreraActiva.carrera,
              hipodromo: carreraActiva.hipodromo,
              fecha: new Date().toISOString().slice(0, 10),
              estado: "PENDIENTE",
            },
          ]);

          await supabase.from("chat_mensajes_sala").insert([
            {
              grupo_id: grupoActivoId,
              autor_id: null,
              autor_nombre: "Agente IA Oficial",
              autor_rol: "BOT",
              texto: `✅ *¡Aquí jugaron!*\n\n🏇 **${prop.jugada}** al ejemplar **#${prop.caballo}** por **$${montoReal.toFixed(2)}**\n👤 Juega: **@${juegaNombre}**\n🛡️ Da: **@${daNombre}**\n🎫 Ticket Oficial: \`#${ticketNum}\`\n\nRegistrado en base de datos en tiempo real.`,
              tipo: "CONCRECION",
            },
          ]);
        }

        refrescarSaldo(sesion.id);
        setEnviando(false);
        return;
      }

      // 5. Propuesta Abierta a la Sala (Esperando respuestas FIFO)
      const rolTxt = prop.rol === "JUEGA" ? "Juega" : "Da";
      if (supabase) {
        await supabase.from("chat_mensajes_sala").insert([
          {
            grupo_id: grupoActivoId,
            autor_id: sesion.id,
            autor_nombre: sesion.nombre,
            autor_rol: sesion.esOperadorOAdmin ? "OPERADOR" : "JUGADOR",
            texto: `📢 **@${sesion.nombre}** ${rolTxt} **${prop.jugada}** al **#${prop.caballo}** por **$${montoReal.toFixed(2)}**.`,
            tipo: "PROPUESTA",
            monto_propuesto: montoReal,
            monto_disponible: montoReal,
            datos_jugada: {
              jugador: sesion.nombre,
              rol: prop.rol,
              monto: montoReal,
              jugada: prop.jugada,
              caballo: prop.caballo,
            },
          },
        ]);
      }

      setEnviando(false);
      return;
    }

    // ────────────────────────────────────────────────────────────────────────
    // RESPUESTA FIFO CUANDO EL USUARIO CITA UNA PROPUESTA PREVIA
    // ────────────────────────────────────────────────────────────────────────
    if (replyId) {
      const msgPropuesta = mensajes.find((m) => m.id === replyId);
      if (msgPropuesta && msgPropuesta.tipo === "PROPUESTA") {
        const resFifo = await procesarRespuestaJugadaFifo({
          grupoId: grupoActivoId,
          propuestaMsgId: replyId,
          respondeUsuarioId: sesion.id,
          respondeNombre: sesion.nombre,
          montoOComando: texto,
        });

        if (!resFifo.ok) {
          emitirToast(resFifo.error || "No se pudo concretar la jugada", "warning");
        } else {
          refrescarSaldo(sesion.id);
        }

        setEnviando(false);
        return;
      }
    }

    // ────────────────────────────────────────────────────────────────────────
    // MENSAJE DE CHAT LIBRE
    // ────────────────────────────────────────────────────────────────────────
    if (supabase) {
      await supabase.from("chat_mensajes_sala").insert([
        {
          grupo_id: grupoActivoId,
          autor_id: sesion.id,
          autor_nombre: sesion.nombre,
          autor_rol: sesion.esOperadorOAdmin ? "OPERADOR" : "JUGADOR",
          texto,
          tipo: "TEXTO",
          reply_to_msg_id: replyId,
        },
      ]);
    }

    setEnviando(false);
  };

  // Tomar propuesta FIFO desde los botones interactivos
  const handleTomarPropuestaFifo = async (msgProp: MensajeSala, montoOComando: string) => {
    if (!sesion) return;
    const res = await procesarRespuestaJugadaFifo({
      grupoId: grupoActivoId,
      propuestaMsgId: msgProp.id,
      respondeUsuarioId: sesion.id,
      respondeNombre: sesion.nombre,
      montoOComando,
    });

    if (!res.ok) {
      emitirToast(res.error || "No se pudo tomar la propuesta", "warning");
    } else {
      emitirToast(`Ticket #${res.numero_ticket} emitido ($${res.monto_concretado})`, "success");
      refrescarSaldo(sesion.id);
    }
  };

  // Dictado por voz nativo
  const alternarDictadoVoz = () => {
    if (typeof window === "undefined") return;
    const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRec) {
      alert("Tu dispositivo no soporta dictado de voz nativo en este navegador.");
      return;
    }

    if (grabandoVoz) {
      setGrabandoVoz(false);
      return;
    }

    try {
      const rec = new SpeechRec();
      rec.lang = "es-VE";
      rec.interimResults = false;
      rec.onstart = () => setGrabandoVoz(true);
      rec.onresult = (evt: any) => {
        const trans = evt.results?.[0]?.[0]?.transcript;
        if (trans) setInputTexto(trans);
        setGrabandoVoz(false);
      };
      rec.onerror = () => setGrabandoVoz(false);
      rec.onend = () => setGrabandoVoz(false);
      rec.start();
    } catch {
      setGrabandoVoz(false);
    }
  };

  // Toggle rápido de Operador Apertura / Cierre
  const toggleEstadoCarrera = async () => {
    if (!sesion?.esOperadorOAdmin || !supabase) return;
    const nuevo = carreraActiva.estado === "ABIERTA" ? "CERRADA" : "ABIERTA";

    await supabase
      .from("chat_estado_grupo")
      .update({ estado: nuevo, updated_at: new Date().toISOString() })
      .eq("grupo_id", grupoActivoId);

    const txt =
      nuevo === "ABIERTA"
        ? `🟢 *CARRERA ABIERTA*: ${carreraActiva.hipodromo} C${carreraActiva.carrera}`
        : `🚨 *CARRERA CERRADA*: ${carreraActiva.hipodromo} C${carreraActiva.carrera}`;

    await supabase.from("chat_mensajes_sala").insert([
      {
        grupo_id: grupoActivoId,
        autor_id: sesion.id,
        autor_nombre: sesion.nombre,
        autor_rol: "OPERADOR",
        texto: txt,
        tipo: "ESTADO_CARRERA",
      },
    ]);

    setCarreraActiva((prev) => ({ ...prev, estado: nuevo as any }));
  };

  // Eliminar mensaje gráfico solo por operador
  const handleEliminarMensajeOperador = async (msgId: string) => {
    if (!sesion?.esOperadorOAdmin || !supabase) return;
    try {
      await supabase.from("chat_mensajes_sala").delete().eq("id", msgId);
      setMensajes((prev) => prev.filter((m) => m.id !== msgId));
      emitirToast("Tarjeta eliminada por el operador", "info");
    } catch {
      /* ignore */
    }
  };

  // ──────────────────────────────────────────────────────────────────────────
  // RENDER: ONBOARDING / LOGIN MÓVIL
  // ──────────────────────────────────────────────────────────────────────────
  if (cargandoAuth) {
    return (
      <div className="flex h-[100dvh] w-full items-center justify-center bg-[#111b21] text-white">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-[#00a884] border-t-transparent" />
      </div>
    );
  }

  if (!sesion) {
    return (
      <div className="flex min-h-[100dvh] w-full items-center justify-center bg-[#111b21] p-4 text-white font-sans select-none">
        <div className="w-full max-w-sm rounded-3xl bg-[#202c33] p-6 shadow-2xl border border-[#2a3942]">
          <div className="flex flex-col items-center gap-2 pb-6 text-center border-b border-[#2a3942]">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#00a884] text-white shadow-lg text-3xl">
              🐎
            </div>
            <h1 className="text-xl font-bold tracking-tight text-[#e9edef]">Sala WhatsApp Oficial</h1>
            <p className="text-xs text-[#8696a0]">
              Vincula tu celular para interactuar con tus jugadas P2P, paradas y saldo privado.
            </p>
          </div>

          {!pasoOtp ? (
            <form onSubmit={solicitarOtp} className="mt-6 space-y-4">
              <div>
                <label className="block text-[11px] font-bold uppercase text-[#8696a0] mb-1">
                  Tu Seudónimo o Nombre
                </label>
                <input
                  type="text"
                  value={formNombre}
                  onChange={(e) => setFormNombre(e.target.value)}
                  placeholder="Ej. ARELY, SAM, LEYBA..."
                  className="w-full rounded-xl bg-[#111b21] px-4 py-3 text-sm text-[#e9edef] placeholder-[#8696a0] border border-[#2a3942] focus:border-[#00a884] focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase text-[#8696a0] mb-1">
                  Número Celular / WhatsApp
                </label>
                <input
                  type="tel"
                  value={formTelefono}
                  onChange={(e) => setFormTelefono(e.target.value)}
                  placeholder="+58 412 1234567"
                  className="w-full rounded-xl bg-[#111b21] px-4 py-3 text-sm text-[#e9edef] placeholder-[#8696a0] border border-[#2a3942] focus:border-[#00a884] focus:outline-none font-mono"
                  required
                />
              </div>

              {errorLogin && (
                <div className="rounded-xl bg-red-900/30 border border-red-500/50 p-3 text-xs text-red-200">
                  {errorLogin}
                </div>
              )}

              <button
                type="submit"
                className="w-full rounded-xl bg-[#00a884] py-3.5 text-sm font-bold text-white shadow-lg hover:bg-[#02906f] active:scale-[0.98] transition-all"
              >
                Vincular Celular
              </button>
            </form>
          ) : (
            <form onSubmit={confirmarOtp} className="mt-6 space-y-4">
              <div className="rounded-xl bg-[#111b21] p-3 border border-[#00a884]/40 text-center">
                <span className="text-[11px] text-[#8696a0] block">Código de confirmación generado:</span>
                <span className="font-mono text-2xl font-black text-[#00a884] tracking-widest">{codigoGenerado}</span>
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase text-[#8696a0] mb-1 text-center">
                  Ingresa el código
                </label>
                <input
                  type="text"
                  maxLength={4}
                  value={codigoOtp}
                  onChange={(e) => setCodigoOtp(e.target.value)}
                  placeholder="0000"
                  className="w-full text-center tracking-[0.5em] font-mono text-2xl rounded-xl bg-[#111b21] px-4 py-3 text-[#e9edef] border border-[#2a3942] focus:border-[#00a884] focus:outline-none"
                  autoFocus
                  required
                />
              </div>

              {errorLogin && (
                <div className="rounded-xl bg-red-900/30 border border-red-500/50 p-3 text-xs text-red-200 text-center">
                  {errorLogin}
                </div>
              )}

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPasoOtp(false)}
                  className="flex-1 rounded-xl bg-[#2a3942] py-3 text-xs font-bold text-[#e9edef] hover:bg-[#32424b]"
                >
                  Atrás
                </button>
                <button
                  type="submit"
                  className="flex-1 rounded-xl bg-[#00a884] py-3 text-xs font-bold text-white shadow-lg hover:bg-[#02906f]"
                >
                  Entrar a la Sala
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    );
  }

  // ──────────────────────────────────────────────────────────────────────────
  // RENDER: INTERFAZ DUAL (MÓVIL PWA 100dvh + DESKTOP WHATSAPP WEB)
  // ──────────────────────────────────────────────────────────────────────────
  const esCerrada = carreraActiva.estado === "CERRADA" || carreraActiva.estado === "LIQUIDADA";

  return (
    <div className="flex h-[100dvh] w-full overflow-hidden bg-[#111b21] font-sans">
      {/* ── PANEL IZQUIERDO: LISTA DE GRUPOS Y CANAL BOT (ESCRITORIO & MÓVIL MODAL) ── */}
      <div
        className={`${
          mostrarGruposMovil ? "fixed inset-0 z-50 flex" : "hidden md:flex"
        } h-full shrink-0`}
      >
        <SalaLeftPanelGrupos
          grupos={grupos}
          grupoActivoId={grupoActivoId}
          onSeleccionarGrupo={(gid) => {
            setGrupoActivoId(gid);
            setMostrarGruposMovil(false);
          }}
          nombreUsuario={sesion.nombre}
        />
      </div>

      {/* ── PANEL CENTRAL: CHAT ACTIVO Y CARRERA EN VIVO ── */}
      <div className="flex flex-1 flex-col h-full bg-[#0b141a] min-w-0 relative">
        {/* 1. Header con Billetera y Controles */}
        <SalaHeaderWallet
          carreraActiva={carreraActiva}
          saldo={saldoPrivado}
          nombreUsuario={sesion.nombre}
          esOperadorOAdmin={sesion.esOperadorOAdmin}
          tamanoLetra={tamanoLetra}
          onCambiarTamanoLetra={handleCambiarTamanoLetra}
          onTogglePanelDerecho={() => setPanelDerechoAbierto(!panelDerechoAbierto)}
          panelDerechoAbierto={panelDerechoAbierto}
          onToggleEstadoCarrera={toggleEstadoCarrera}
          onCerrarSesion={cerrarSesion}
        />

        {/* 2. Cuerpo de Mensajes con Fondo WhatsApp */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-2 bg-[#0b141a]">
          {/* Banner de Encriptación y Reglas */}
          <div className="mx-auto my-1 max-w-sm rounded-xl bg-[#182229] px-3 py-1.5 text-center shadow-sm border border-[#222e35]">
            <p className="text-[10px] text-[#8696a0] leading-snug">
              🔒 <b>Privacidad Estricta:</b> Tu saldo solo lo ves tú. Paradas emparejadas en tiempo real bajo orden FIFO.
            </p>
          </div>

          {/* Mensajes del chat */}
          {mensajes.map((m) => {
            const citado = m.reply_to_msg_id
              ? mensajes.find((x) => x.id === m.reply_to_msg_id)
              : null;
            return (
              <SalaBurbujaMensaje
                key={m.id}
                mensaje={m}
                mensajeCitado={citado}
                carreraActiva={carreraActiva}
                nombreUsuarioActual={sesion.nombre}
                tamanoLetra={tamanoLetra}
                esOperadorOAdmin={sesion.esOperadorOAdmin}
                onCitar={(msg) => setMensajeCitado(msg)}
                onTomarPropuestaFifo={handleTomarPropuestaFifo}
                onEliminarMensajeOperador={handleEliminarMensajeOperador}
              />
            );
          })}
          <div ref={chatBottomRef} />
        </div>

        {/* 3. Previsualización de Mensaje Citado */}
        {mensajeCitado && (
          <div className="flex items-center justify-between bg-[#1f2c34] px-4 py-2 border-t border-[#2a3942] text-xs">
            <div className="flex flex-col min-w-0">
              <span className="font-bold text-[#00a884] text-[11px]">
                Respondiendo a @{mensajeCitado.autor_nombre}
              </span>
              <span className="text-[#8696a0] truncate">{mensajeCitado.texto}</span>
            </div>
            <button
              onClick={() => setMensajeCitado(null)}
              className="text-[#8696a0] hover:text-white p-1 text-sm"
            >
              ✕
            </button>
          </div>
        )}

        {/* 4. Chips Rápidos de Jugadas */}
        <div className="flex gap-2 overflow-x-auto bg-[#202c33] px-3 py-1.5 border-t border-[#222e35] scrollbar-none select-none">
          <button
            onClick={() => enviarMensaje("Saldo")}
            className="whitespace-nowrap rounded-full bg-[#111b21] px-3 py-1 text-xs font-semibold text-[#00a884] shadow-sm border border-[#00a884]/40 hover:bg-[#182229] active:scale-95"
          >
            💰 Mi Saldo (Privado)
          </button>
          <button
            onClick={() => enviarMensaje("100 al 5 con @SAM")}
            disabled={esCerrada}
            className="whitespace-nowrap rounded-full bg-[#111b21] px-3 py-1 text-xs font-semibold text-slate-200 shadow-sm border border-[#2a3942] hover:bg-[#182229] active:scale-95 disabled:opacity-40"
          >
            🏇 100 al 5 con @SAM
          </button>
          <button
            onClick={() => enviarMensaje("Doy 50 al 2")}
            disabled={esCerrada}
            className="whitespace-nowrap rounded-full bg-[#111b21] px-3 py-1 text-xs font-semibold text-slate-200 shadow-sm border border-[#2a3942] hover:bg-[#182229] active:scale-95 disabled:opacity-40"
          >
            🛡️ Doy 50 al 2
          </button>
          {sesion.esOperadorOAdmin && (
            <button
              onClick={() => enviarMensaje(`Abierta ${carreraActiva.hipodromo} ${carreraActiva.carrera}`)}
              className="whitespace-nowrap rounded-full bg-emerald-950/50 px-3 py-1 text-xs font-semibold text-emerald-300 shadow-sm border border-emerald-500/40 hover:bg-emerald-900/50 active:scale-95"
            >
              🟢 Comando Abrir
            </button>
          )}
        </div>

        {/* 5. Barra Inferior Fija de Input Estilo WhatsApp */}
        <div className="flex items-center gap-2 bg-[#202c33] px-3 py-2 border-t border-[#222e35]">
          {/* Botón selector de grupos en móvil */}
          <button
            type="button"
            onClick={() => setMostrarGruposMovil(!mostrarGruposMovil)}
            className="md:hidden flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#111b21] text-white hover:bg-[#2a3942] text-sm"
            title="Cambiar de grupo"
          >
            💬
          </button>

          <input
            type="text"
            value={inputTexto}
            onChange={(e) => setInputTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                enviarMensaje();
              }
            }}
            placeholder={
              grabandoVoz
                ? "🎙️ Escuchando jugada por dictado de voz..."
                : esCerrada
                ? "⛔ Carrera cerrada (no se admiten jugadas)..."
                : "Escribe un mensaje o propuesta (ej. Juego 1p 7 100)..."
            }
            className={`flex-1 rounded-2xl bg-[#2a3942] px-4 py-2.5 text-sm text-[#e9edef] placeholder-[#8696a0] border shadow-sm focus:border-[#00a884] focus:outline-none transition-all ${
              grabandoVoz ? "border-red-500 bg-red-950/40 animate-pulse" : "border-transparent"
            }`}
          />

          {/* Botón Dictado de Voz Nativo */}
          <button
            type="button"
            onClick={alternarDictadoVoz}
            title={grabandoVoz ? "Detener dictado" : "Dictar por voz"}
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white shadow-md active:scale-95 transition-all ${
              grabandoVoz ? "bg-red-500 animate-bounce" : "bg-[#128c7e] hover:bg-[#008069]"
            }`}
          >
            🎙️
          </button>

          {/* Botón Enviar */}
          <button
            type="button"
            onClick={() => enviarMensaje()}
            disabled={!inputTexto.trim() || enviando}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#00a884] text-white shadow-md hover:bg-[#02906f] active:scale-95 disabled:opacity-40 transition-all"
          >
            ➤
          </button>
        </div>
      </div>

      {/* ── PANEL DERECHO COLAPSABLE: EJEMPLARES Y TICKETS ACTIVOS ── */}
      <SalaRightPanelCarrera
        carreraActiva={carreraActiva}
        tickets={tickets}
        abierto={panelDerechoAbierto}
        onCerrar={() => setPanelDerechoAbierto(false)}
        nombreUsuario={sesion.nombre}
        onEjemplarClick={(num) => {
          setInputTexto(`Juego 1p ${num} 50`);
          setPanelDerechoAbierto(false);
        }}
      />
    </div>
  );
}
