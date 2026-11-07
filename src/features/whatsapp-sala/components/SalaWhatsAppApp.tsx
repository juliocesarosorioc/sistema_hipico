"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/core/supabase";
import { useAuthStore } from "@/shared/store/useAuthStore";
import {
  detectarCordialidad,
  generarRespuestaCordial,
} from "@/features/ia-copiloto/lib/cordialidad";
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
  detectarAnulacionUsuario,
  detectarComandoAnularAdmin,
  esPropuestaExpirada,
} from "../lib/chat-p2p";
import { SalaHeaderWallet } from "./SalaHeaderWallet";
import { SalaLeftPanelGrupos } from "./SalaLeftPanelGrupos";
import { SalaRightPanelCarrera } from "./SalaRightPanelCarrera";
import { SalaBurbujaMensaje } from "./SalaBurbujaMensaje";
import { emitirToast } from "@/shared/lib/mensajeria";
import { crearGrupo, listarGruposVenta } from "@/features/grupos/lib/grupos";

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

export function SalaWhatsAppApp({ embebido = false }: { embebido?: boolean } = {}) {
  const alturaRaiz = embebido ? "h-full" : "h-[100dvh]";
  const [sesion, setSesion] = useState<ClienteSesionSala | null>(null);
  const [cargandoAuth, setCargandoAuth] = useState(true);

  // Lista de clientes disponibles para selección rápida si entra sin sesión previa
  const [clientesDisponibles, setClientesDisponibles] = useState<any[]>([]);
  const [busquedaCliente, setBusquedaCliente] = useState("");

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
  const canalRealtimeRef = useRef<any>(null);

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

  // ──────────────────────────────────────────────────────────────────────────
  // 2. AUTO-VINCULACIÓN AUTOMÁTICA DE IDENTIDAD (SIN PEDIR CELULAR NI OTP)
  // ──────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    async function resolverIdentidadAutomatica() {
      if (typeof window === "undefined") return;

      // 1. ¿Tiene sesión activa en el Portal de Jugadores ("portal.cliente")?
      try {
        const portalRaw = localStorage.getItem("portal.cliente");
        if (portalRaw) {
          const p = JSON.parse(portalRaw);
          const c = p?.cliente;
          if (c && (c.nombre || c.id)) {
            const sesionDetectada: ClienteSesionSala = {
              id: String(c.id),
              // En el chat SIEMPRE se muestra el seudónimo (nunca el nombre real)
              nombre: String(c.seudonimo || c.nombre || "Jugador").toUpperCase(),
              seudonimo: String(c.seudonimo || c.nombre || "Jugador").toUpperCase(),
              telefono: String(c.telefono || ""),
              saldo_actual: Number(c.saldo_actual || 0),
              aval: Number(c.aval || 0),
              libre: Boolean(c.libre || String(c.modo_juego).toLowerCase() === "libre"),
              modo_juego: String(c.modo_juego || "aval"),
              grupo_id: c.grupo_id || GRUPO_DEFAULT_ID,
              esOperadorOAdmin: /ADMIN|OPERADOR|ARELY|JULIO/i.test(c.nombre || ""),
            };
            localStorage.setItem(STORAGE_SESSION_KEY, JSON.stringify(sesionDetectada));
            setSesion(sesionDetectada);
            setCargandoAuth(false);
            return;
          }
        }
      } catch {
        /* ignore */
      }

      // 2. ¿Tiene sesión activa de Operador / Administrador en useAuthStore?
      try {
        const authUser = useAuthStore.getState().usuario;
        const nombreOp = useAuthStore.getState().tipoUsuario?.nombre || authUser;
        if (authUser) {
          const sesionOp: ClienteSesionSala = {
            id: `op-${authUser}`,
            nombre: String(nombreOp || authUser).toUpperCase(),
            seudonimo: String(nombreOp || authUser).toUpperCase(),
            telefono: "",
            saldo_actual: 0,
            aval: 0,
            libre: true,
            modo_juego: "libre",
            grupo_id: useAuthStore.getState().grupoActivo || GRUPO_DEFAULT_ID,
            esOperadorOAdmin: true,
          };
          localStorage.setItem(STORAGE_SESSION_KEY, JSON.stringify(sesionOp));
          setSesion(sesionOp);
          setCargandoAuth(false);
          return;
        }
      } catch {
        /* ignore */
      }

      // 3. ¿Tiene sesión previa en la sala guardada en el dispositivo?
      try {
        const guardada = localStorage.getItem(STORAGE_SESSION_KEY);
        if (guardada) {
          const parsed = JSON.parse(guardada) as ClienteSesionSala;
          if (parsed && parsed.id && parsed.nombre) {
            // Sesiones guardadas antes de este cambio traían el nombre real
            const alias = String(parsed.seudonimo || parsed.nombre).toUpperCase();
            setSesion({ ...parsed, nombre: alias, seudonimo: alias });
            setCargandoAuth(false);
            return;
          }
        }
      } catch {
        /* ignore */
      }

      // 4. Si entra por primera vez sin ninguna sesión previa:
      // Traer la lista de clientes registrados para acceso directo en 1 clic
      if (supabase) {
        try {
          const { data: clis } = await supabase
            .from("clientes")
            .select("id, nombre, seudonimo, telefono, saldo_actual, aval, libre, modo_juego, grupo_id")
            .order("nombre", { ascending: true })
            .limit(60);

          if (clis && clis.length > 0) {
            setClientesDisponibles(clis);
          }
        } catch {
          /* ignore */
        }
      }

      setCargandoAuth(false);
    }

    resolverIdentidadAutomatica();
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

  // Garantiza que la identidad del chat sea el SEUDÓNIMO oficial de la ficha del
  // cliente (la caché del portal puede venir sin el campo `seudonimo`).
  useEffect(() => {
    if (!supabase || !sesion?.id || sesion.id.startsWith("op-")) return;
    let vivo = true;
    void (async () => {
      try {
        const { data } = await supabase!
          .from("clientes")
          .select("seudonimo, nombre")
          .eq("id", sesion.id)
          .maybeSingle();
        const alias = String(data?.seudonimo || data?.nombre || "").trim().toUpperCase();
        if (vivo && alias && alias !== sesion.nombre) {
          setSesion((prev) => {
            if (!prev) return prev;
            const act = { ...prev, nombre: alias, seudonimo: alias };
            try {
              localStorage.setItem(STORAGE_SESSION_KEY, JSON.stringify(act));
            } catch {
              /* ignore */
            }
            return act;
          });
        }
      } catch {
        /* best-effort */
      }
    })();
    return () => {
      vivo = false;
    };
  }, [sesion?.id, sesion?.nombre]);

  // Mapa autor_id → seudónimo para mostrar SIEMPRE el seudónimo, incluso en
  // mensajes antiguos que se guardaron con el nombre real.
  const [seudonimosPorId, setSeudonimosPorId] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!supabase) return;
    const ids = Array.from(
      new Set(
        mensajes
          .map((m) => m.autor_id)
          .filter((id): id is string => Boolean(id) && !String(id).startsWith("op-") && !(String(id) in seudonimosPorId))
      )
    );
    if (ids.length === 0) return;
    void (async () => {
      try {
        const { data } = await supabase!.from("clientes").select("id, seudonimo, nombre").in("id", ids);
        const nuevo: Record<string, string> = {};
        for (const id of ids) nuevo[id] = "";
        for (const c of (data ?? []) as Array<{ id: string; seudonimo?: string | null; nombre?: string | null }>) {
          nuevo[String(c.id)] = String(c.seudonimo || c.nombre || "").trim().toUpperCase();
        }
        setSeudonimosPorId((prev) => ({ ...prev, ...nuevo }));
      } catch {
        /* best-effort */
      }
    })();
  }, [mensajes, seudonimosPorId]);

  const conSeudonimo = useCallback(
    (m: MensajeSala | null | undefined): MensajeSala | null => {
      if (!m) return null;
      const alias = m.autor_id ? seudonimosPorId[String(m.autor_id)] : "";
      return alias ? { ...m, autor_nombre: alias } : m;
    },
    [seudonimosPorId]
  );

  // 4. Sincronizar grupos de venta / salas oficiales desde Supabase
  useEffect(() => {
    async function cargarGrupos() {
      try {
        const lista = await listarGruposVenta();
        if (lista && lista.length > 0) {
          const mapSalas: GrupoSala[] = lista.map((g) => ({
            id: String(g.id),
            nombre: g.nombre,
            descripcion: g.es_principal ? "Sala Principal P2P" : "Sala de apuestas",
            activo: g.activo ?? true,
          }));
          setGrupos(mapSalas);
          setGrupoActivoId((prev) => {
            return mapSalas.some((s) => s.id === prev) ? prev : mapSalas[0].id;
          });
          return;
        }
        if (supabase) {
          const { data } = await supabase.from("grupos_venta").select("id, nombre, activo, es_principal").order("nombre");
          if (data && data.length > 0) {
            setGrupos(data.map((g) => ({ id: String(g.id), nombre: g.nombre, descripcion: g.es_principal ? "Sala Principal P2P" : "Sala de apuestas", activo: g.activo ?? true })));
          }
        }
      } catch {
        /* fallback */
      }
    }
    cargarGrupos();
  }, []);

  // 4b. Administrador: Crear nueva sala de chat
  const handleCrearNuevaSala = async (nombre: string, descripcion?: string): Promise<{ ok: boolean; error?: string }> => {
    if (!sesion?.esOperadorOAdmin) {
      return { ok: false, error: "Solo los administradores u operadores pueden crear salas." };
    }
    try {
      const res = await crearGrupo({
        nombre: nombre.trim().toUpperCase(),
        responsable: descripcion?.trim() || "Administrador",
        activo: true,
        moneda: "USD",
        cupo_tabla: 100,
        comision_default: 5,
        permite_cruces: true,
        cruce_mismo_ejemplar: true,
        cruce_diferente_ejemplar: true,
      });

      if (!res.ok) {
        return { ok: false, error: res.error || "No se pudo crear la sala" };
      }

      // Recargar salas disponibles
      const lista = await listarGruposVenta();
      if (lista && lista.length > 0) {
        const mapSalas: GrupoSala[] = lista.map((g) => ({
          id: String(g.id),
          nombre: g.nombre,
          descripcion: g.es_principal ? "Sala Principal P2P" : (g.responsable ? `Resp: ${g.responsable}` : "Sala de apuestas"),
          activo: g.activo ?? true,
        }));
        setGrupos(mapSalas);
        const creada = mapSalas.find((g) => g.nombre.toUpperCase() === nombre.trim().toUpperCase());
        if (creada) {
          setGrupoActivoId(creada.id);
        }
      }
      emitirToast(`Sala ${nombre.toUpperCase()} creada con éxito`, "success");
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e.message || "Error al crear la sala" };
    }
  };

  // 5. Cargar estado de carrera del grupo activo
  const cargarEstadoCarreraGrupo = useCallback(async (grupoId: string) => {
    if (!supabase) return;
    try {
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

      const { data: msgs, error: errMsgs } = await supabase
        .from("chat_mensajes_sala")
        .select("*")
        .eq("grupo_id", grupoId)
        .order("created_at", { ascending: true })
        .limit(150);

      if (msgs && !errMsgs) {
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

  useEffect(() => {
    if (!grupoActivoId) return;
    cargarEstadoCarreraGrupo(grupoActivoId);
    cargarMensajesYTickets(grupoActivoId, sesion?.id);
  }, [grupoActivoId, sesion?.id, cargarEstadoCarreraGrupo, cargarMensajesYTickets]);

  // 7. Suscripción Supabase Realtime (Broadcast instantáneo + Postgres WAL)
  useEffect(() => {
    if (!supabase || !sesion?.id || !grupoActivoId) return;

    const canal = supabase
      .channel(`chat-sala-${grupoActivoId}`)
      .on("broadcast", { event: "mensaje_sala" }, ({ payload }) => {
        if (!payload) return;
        if (payload.autor_id !== sesion.id) {
          if (payload.destinatario_privado_id && payload.destinatario_privado_id !== sesion.id) {
            return;
          }
          reproducirBeepWhatsApp();
          setMensajes((prev) => {
            if (prev.some((x) => x.id === payload.id)) return prev;
            return [
              ...prev,
              {
                ...payload,
                esMio: false,
                esPrivadoParaMi: payload.destinatario_privado_id === sesion.id,
              },
            ];
          });
        }
      })
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
          if (m.destinatario_privado_id && m.destinatario_privado_id !== sesion.id && m.autor_id !== sesion.id) {
            return;
          }

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

    canalRealtimeRef.current = canal;

    return () => {
      canal.unsubscribe();
    };
  }, [grupoActivoId, sesion?.id, cargarMensajesYTickets, cargarEstadoCarreraGrupo, refrescarSaldo]);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [mensajes]);

  // Mensaje de bienvenida inicial del Agente IA al detectar la sesión
  useEffect(() => {
    if (!sesion) return;
    if (mensajes.length === 0) {
      const horaStr = new Date().toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit", hour12: true });
      const esLibre = sesion.libre;
      const msgBienvenida: MensajeSala = {
        id: `welcome-${sesion.id}`,
        grupo_id: grupoActivoId,
        autor_id: null,
        autor_nombre: "Agente IA Oficial",
        autor_rol: "BOT",
        texto: `👋 ¡Hola @${sesion.nombre}! Soy tu Agente IA Oficial y moderador de la Sala.\n\n🏇 Carrera Activa: **${carreraActiva.hipodromo} (Carrera ${carreraActiva.carrera})** · Estado: **${carreraActiva.estado}**\n${
          esLibre ? "⭐ Estatus: **Cuenta LIBRE**" : `💰 Tu Saldo Disponible: **$${(sesion.saldo_actual + sesion.aval).toFixed(2)}**`
        }\n\nPuedes registrar tus jugadas de puestos directamente (ej. "Juego 1p 7 100", "50 2n al 1", "100 2p al 5 con @SAM"), consultar tu "Saldo" en privado o preguntarme sobre la carrera. ¿En qué te colaboro hoy?`,
        tipo: "TEXTO",
        created_at: new Date().toISOString(),
        esMio: false,
      };
      setMensajes([msgBienvenida]);
    }
  }, [sesion?.id, grupoActivoId, carreraActiva.hipodromo, carreraActiva.carrera, carreraActiva.estado]);

  // ──────────────────────────────────────────────────────────────────────────
  // ENTRADA DIRECTA (SIN OTP NI FORMULARIOS)
  // ──────────────────────────────────────────────────────────────────────────
  const ingresarComoClienteDirecto = (cli: any) => {
    const sesionNueva: ClienteSesionSala = {
      id: String(cli.id),
      nombre: String(cli.seudonimo || cli.nombre || "Jugador").toUpperCase(),
      seudonimo: String(cli.seudonimo || cli.nombre || "Jugador").toUpperCase(),
      telefono: String(cli.telefono || ""),
      saldo_actual: Number(cli.saldo_actual || 0),
      aval: Number(cli.aval || 0),
      libre: Boolean(cli.libre || String(cli.modo_juego).toLowerCase() === "libre"),
      modo_juego: String(cli.modo_juego || "aval"),
      grupo_id: cli.grupo_id || GRUPO_DEFAULT_ID,
      esOperadorOAdmin: /ADMIN|OPERADOR|ARELY|JULIO/i.test(cli.nombre || ""),
    };
    localStorage.setItem(STORAGE_SESSION_KEY, JSON.stringify(sesionNueva));
    setSesion(sesionNueva);
    refrescarSaldo(sesionNueva.id);
  };

  const cerrarSesion = () => {
    localStorage.removeItem(STORAGE_SESSION_KEY);
    setSesion(null);
  };

  const anularPropuestaEnChat = async (propAAnular: MensajeSala, motivo: "USUARIO" | "ADMIN") => {
    const nowIso = new Date().toISOString();
    // 1. Marcar como disponible 0 y estado ANULADA en el estado local
    setMensajes((prev) =>
      prev.map((m) =>
        m.id === propAAnular.id
          ? {
              ...m,
              monto_disponible: 0,
              datos_jugada: m.datos_jugada
                ? { ...m.datos_jugada, estado: "ANULADA" as const }
                : undefined,
            }
          : m
      )
    );

    // 2. Anuncio oficial en el chat del grupo (PÚBLICO PARA TODOS)
    const avisoTexto =
      motivo === "USUARIO"
        ? `🚫 *¡Propuesta Retirada!* @${propAAnular.autor_nombre} retiró su jugada (${propAAnular.datos_jugada?.jugada || "1P"} #${propAAnular.datos_jugada?.caballo || "1"}) ("Se fue").`
        : `⚠️ *Propuesta Anulada por Administración*: La jugada de @${propAAnular.autor_nombre} (${propAAnular.datos_jugada?.jugada || "1P"} #${propAAnular.datos_jugada?.caballo || "1"}) fue retirada por corrección de herramienta.`;

    const msgAnuncio: MensajeSala = {
      id: `anul-${Date.now()}`,
      grupo_id: grupoActivoId,
      autor_id: null,
      autor_nombre: "Agente IA Oficial",
      autor_rol: "BOT",
      texto: avisoTexto,
      tipo: "TEXTO",
      reply_to_msg_id: propAAnular.id,
      created_at: nowIso,
      esMio: false,
    };

    setMensajes((prev) => [...prev, msgAnuncio]);

    // Broadcast a toda la sala
    canalRealtimeRef.current?.send({
      type: "broadcast",
      event: "mensaje_sala",
      payload: msgAnuncio,
    });

    if (supabase) {
      try {
        await supabase
          .from("chat_mensajes_sala")
          .update({
            monto_disponible: 0,
            datos_jugada: propAAnular.datos_jugada
              ? { ...propAAnular.datos_jugada, estado: "ANULADA" }
              : null,
          })
          .eq("id", propAAnular.id);

        await supabase.from("chat_mensajes_sala").insert([
          {
            id: msgAnuncio.id,
            grupo_id: grupoActivoId,
            autor_nombre: msgAnuncio.autor_nombre,
            autor_rol: msgAnuncio.autor_rol,
            texto: msgAnuncio.texto,
            tipo: msgAnuncio.tipo,
            reply_to_msg_id: propAAnular.id,
          },
        ]);
      } catch (err: any) {
        console.warn("[anularPropuestaEnChat] Error:", err?.message);
      }
    }

    emitirToast(motivo === "USUARIO" ? "Propuesta retirada ('Se fue')" : "Propuesta anulada por Administración", "success");
    if (propAAnular.autor_id) refrescarSaldo(propAAnular.autor_id);
  };

  // ──────────────────────────────────────────────────────────────────────────
  // ENVIAR MENSAJE: EL AGENTE IA MODERA, CONVERSA Y EJECUTA EN TIEMPO REAL
  // ──────────────────────────────────────────────────────────────────────────
  const enviarMensaje = async (textoPersonalizado?: string) => {
    const texto = (textoPersonalizado ?? inputTexto).trim();
    if (!texto || !sesion || enviando) return;

    setEnviando(true);
    setInputTexto("");
    const replyId = mensajeCitado?.id || null;
    setMensajeCitado(null);

    const nowIso = new Date().toISOString();
    const msgId = crypto.randomUUID ? crypto.randomUUID() : `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    // ────────────────────────────────────────────────────────────────────────
    // ANULACIÓN DE PROPUESTA POR EL USUARIO ("Se fue", "CF", "SF", "Sfue", "sefue", etc.)
    // ────────────────────────────────────────────────────────────────────────
    if (detectarAnulacionUsuario(texto)) {
      let propAAnular: MensajeSala | undefined;
      if (replyId) {
        propAAnular = mensajes.find((m) => m.id === replyId && m.tipo === "PROPUESTA");
      }
      if (!propAAnular) {
        propAAnular = [...mensajes]
          .reverse()
          .find(
            (m) =>
              m.tipo === "PROPUESTA" &&
              m.autor_id === sesion.id &&
              (m.monto_disponible ?? 0) > 0 &&
              !esPropuestaExpirada(m.created_at)
          );
      }

      if (propAAnular) {
        await anularPropuestaEnChat(propAAnular, "USUARIO");
      } else {
        const msgAviso: MensajeSala = {
          id: `bot-dm-${Date.now()}`,
          grupo_id: grupoActivoId,
          autor_id: null,
          autor_nombre: "Agente IA Oficial",
          autor_rol: "BOT",
          texto: `ℹ️ @${sesion.nombre}: No tienes ninguna propuesta abierta en esta carrera para retirar.`,
          tipo: "DM_PRIVADO",
          destinatario_privado_id: sesion.id,
          created_at: nowIso,
          esMio: false,
          esPrivadoParaMi: true,
        };
        setMensajes((prev) => [...prev, msgAviso]);
      }
      setEnviando(false);
      return;
    }

    // ────────────────────────────────────────────────────────────────────────
    // ANULACIÓN ADMINISTRATIVA POR ERROR DE HERRAMIENTA (/anular)
    // ────────────────────────────────────────────────────────────────────────
    const cmdAnularAdmin = detectarComandoAnularAdmin(texto);
    if (cmdAnularAdmin.esAnularAdmin) {
      if (!sesion.esOperadorOAdmin) {
        emitirToast("Solo operadores o administradores pueden anular propuestas", "warning");
        setEnviando(false);
        return;
      }
      let propAAnular = cmdAnularAdmin.propuestaId
        ? mensajes.find((m) => m.id === cmdAnularAdmin.propuestaId)
        : replyId
        ? mensajes.find((m) => m.id === replyId)
        : [...mensajes].reverse().find((m) => m.tipo === "PROPUESTA" && (m.monto_disponible ?? 0) > 0);

      if (propAAnular) {
        await anularPropuestaEnChat(propAAnular, "ADMIN");
      } else {
        emitirToast("No se encontró ninguna propuesta activa para anular", "warning");
      }
      setEnviando(false);
      return;
    }

    // ────────────────────────────────────────────────────────────────────────
    // MENSAJE DIRECTO (DM) EXCLUSIVO (/dm @usuario mensaje o /privado @usuario mensaje)
    // ────────────────────────────────────────────────────────────────────────
    const mDm = /^(?:\/dm|\/privado)\s+@?([a-zA-Z0-9_\-\.]+)\s+([\s\S]+)$/i.exec(texto);
    if (mDm) {
      const destNombre = mDm[1].trim().toUpperCase();
      const dmTexto = mDm[2].trim();
      const targetCli = clientesDisponibles.find(
        (c) =>
          String(c.nombre).toUpperCase() === destNombre ||
          String(c.seudonimo).toUpperCase() === destNombre ||
          String(c.id) === destNombre
      );

      const targetId = targetCli ? String(targetCli.id) : null;
      if (!targetId) {
        emitirToast(`No se encontró al usuario @${destNombre} para mensaje directo`, "warning");
        setEnviando(false);
        return;
      }

      const msgDm: MensajeSala = {
        id: msgId,
        grupo_id: grupoActivoId,
        autor_id: sesion.id,
        autor_nombre: sesion.nombre,
        autor_rol: sesion.esOperadorOAdmin ? "OPERADOR" : "JUGADOR",
        texto: `🔒 (DM para @${targetCli.nombre || destNombre}): ${dmTexto}`,
        tipo: "DM_PRIVADO",
        destinatario_privado_id: targetId,
        reply_to_msg_id: replyId,
        created_at: nowIso,
        esMio: true,
        esPrivadoParaMi: true,
      };

      setMensajes((prev) => [...prev, msgDm]);
      canalRealtimeRef.current?.send({
        type: "broadcast",
        event: "mensaje_sala",
        payload: msgDm,
      });

      if (supabase) {
        try {
          await supabase.from("chat_mensajes_sala").insert([
            {
              id: msgDm.id,
              grupo_id: grupoActivoId,
              autor_id: sesion.id,
              autor_nombre: sesion.nombre,
              autor_rol: msgDm.autor_rol,
              texto: msgDm.texto,
              tipo: msgDm.tipo,
              destinatario_privado_id: targetId,
              reply_to_msg_id: replyId,
            },
          ]);
        } catch { /* noop */ }
      }

      setEnviando(false);
      return;
    }

    // ────────────────────────────────────────────────────────────────────────
    // 1. COMANDOS EXCLUSIVOS DE OPERADOR (MÓDULO 4)
    // ────────────────────────────────────────────────────────────────────────
    const cmdOp = detectarComandoOperador(texto);
    if (cmdOp) {
      if (!sesion.esOperadorOAdmin) {
        const dmMsg: MensajeSala = {
          id: `bot-dm-${Date.now()}`,
          grupo_id: grupoActivoId,
          autor_id: null,
          autor_nombre: "Agente IA Oficial",
          autor_rol: "BOT",
          texto: `⛔ @${sesion.nombre}: Los comandos de apertura, cierre y pizarra son exclusivos de Operadores y Administradores.`,
          tipo: "DM_PRIVADO",
          destinatario_privado_id: sesion.id,
          reply_to_msg_id: replyId,
          created_at: nowIso,
          esMio: false,
          esPrivadoParaMi: true,
        };
        setMensajes((prev) => [...prev, dmMsg]);
        if (supabase) {
          try {
            await supabase.from("chat_mensajes_sala").insert([
              {
                id: dmMsg.id,
                grupo_id: dmMsg.grupo_id,
                autor_nombre: dmMsg.autor_nombre,
                autor_rol: dmMsg.autor_rol,
                texto: dmMsg.texto,
                tipo: dmMsg.tipo,
                destinatario_privado_id: dmMsg.destinatario_privado_id,
                reply_to_msg_id: replyId,
              },
            ]);
          } catch { /* noop */ }
        }
        setEnviando(false);
        return;
      }

      // ABRIR CARRERA
      if (cmdOp.tipo === "ABRIR_CARRERA") {
        const hipoNuevo = cmdOp.hipodromo || carreraActiva.hipodromo;
        const cNum = cmdOp.carrera;

        setCarreraActiva((prev) => ({
          ...prev,
          hipodromo: hipoNuevo,
          carrera: cNum,
          estado: "ABIERTA",
        }));

        const cardMsg: MensajeSala = {
          id: `card-${Date.now()}`,
          grupo_id: grupoActivoId,
          autor_id: sesion.id,
          autor_nombre: sesion.nombre,
          autor_rol: "OPERADOR",
          texto: `🟢 Carrera ABIERTA: ${hipoNuevo} Carrera ${cNum}`,
          tipo: "IMAGEN_CARRERA",
          solo_borrable_operador: true,
          created_at: nowIso,
          esMio: true,
        };

        setMensajes((prev) => [...prev, cardMsg]);
        canalRealtimeRef.current?.send({ type: "broadcast", event: "mensaje_sala", payload: cardMsg });

        if (supabase) {
          try {
            await supabase.from("chat_estado_grupo").upsert(
              {
                grupo_id: grupoActivoId,
                hipodromo: hipoNuevo,
                carrera: cNum,
                fecha: new Date().toISOString().slice(0, 10),
                estado: "ABIERTA",
                updated_at: nowIso,
              },
              { onConflict: "grupo_id" }
            );

            await supabase.from("chat_mensajes_sala").insert([
              {
                id: cardMsg.id,
                grupo_id: grupoActivoId,
                autor_id: sesion.id,
                autor_nombre: sesion.nombre,
                autor_rol: "OPERADOR",
                texto: cardMsg.texto,
                tipo: "IMAGEN_CARRERA",
                solo_borrable_operador: true,
              },
            ]);
          } catch { /* noop */ }
        }

        setEnviando(false);
        return;
      }

      // CERRAR CARRERA
      if (cmdOp.tipo === "CERRAR_CARRERA") {
        setCarreraActiva((prev) => ({ ...prev, estado: "CERRADA" }));

        const cierreMsg: MensajeSala = {
          id: `cierre-${Date.now()}`,
          grupo_id: grupoActivoId,
          autor_id: sesion.id,
          autor_nombre: sesion.nombre,
          autor_rol: "OPERADOR",
          texto: `🚨 *¡CARRERA CERRADA!*\n\n${carreraActiva.hipodromo} (Carrera ${carreraActiva.carrera}) ha sido **CERRADA** por el operador. No se admiten más jugadas.`,
          tipo: "ESTADO_CARRERA",
          created_at: nowIso,
          esMio: true,
        };

        setMensajes((prev) => [...prev, cierreMsg]);
        canalRealtimeRef.current?.send({ type: "broadcast", event: "mensaje_sala", payload: cierreMsg });

        if (supabase) {
          try {
            await supabase
              .from("chat_estado_grupo")
              .update({ estado: "CERRADA", updated_at: nowIso })
              .eq("grupo_id", grupoActivoId);

            await supabase.from("chat_mensajes_sala").insert([
              {
                id: cierreMsg.id,
                grupo_id: grupoActivoId,
                autor_id: sesion.id,
                autor_nombre: sesion.nombre,
                autor_rol: "OPERADOR",
                texto: cierreMsg.texto,
                tipo: "ESTADO_CARRERA",
              },
            ]);
          } catch { /* noop */ }
        }

        setEnviando(false);
        return;
      }

      // PUBLICAR PIZARRA CONTEXTUAL Y LIQUIDAR
      if (cmdOp.tipo === "PIZARRA") {
        await liquidarCarreraChatP2p({
          grupoId: grupoActivoId,
          pizarra: cmdOp.pizarra,
          operadorNombre: sesion.nombre,
        });
        cargarMensajesYTickets(grupoActivoId, sesion.id);
        setEnviando(false);
        return;
      }
    }

    // ────────────────────────────────────────────────────────────────────────
    // 2. CONSULTA DE SALDO PRIVADO (MÓDULO 2)
    // ────────────────────────────────────────────────────────────────────────
    if (/^saldo$|^disponible$|^cuanto tengo$|^mi saldo$/i.test(texto)) {
      const s = await obtenerMiSaldoPrivado(sesion.id);
      const dispTxt = s.libre
        ? "⭐ Tu cuenta tiene **Estatus LIBRE** (sin limitaciones de saldo)."
        : `💰 Tu Saldo Disponible es **$${s.disponible.toFixed(2)}** (Saldo: $${s.saldo_actual.toFixed(2)} + Aval: $${s.aval.toFixed(2)}${
            s.riesgo_en_curso > 0 ? ` - En Juego: $${s.riesgo_en_curso.toFixed(2)}` : ""
          }).`;

      const dmSaldo: MensajeSala = {
        id: `saldo-${Date.now()}`,
        grupo_id: grupoActivoId,
        autor_id: null,
        autor_nombre: "Agente IA Oficial",
        autor_rol: "BOT",
        texto: dispTxt,
        tipo: "DM_PRIVADO",
        destinatario_privado_id: sesion.id,
        reply_to_msg_id: replyId,
        created_at: nowIso,
        esMio: false,
        esPrivadoParaMi: true,
      };

      setMensajes((prev) => [...prev, dmSaldo]);

      if (supabase) {
        try {
          await supabase.from("chat_mensajes_sala").insert([
            {
              id: dmSaldo.id,
              grupo_id: grupoActivoId,
              autor_nombre: dmSaldo.autor_nombre,
              autor_rol: dmSaldo.autor_rol,
              texto: dmSaldo.texto,
              tipo: dmSaldo.tipo,
              destinatario_privado_id: dmSaldo.destinatario_privado_id,
              reply_to_msg_id: replyId,
            },
          ]);
        } catch { /* noop */ }
      }

      setEnviando(false);
      return;
    }

    // ────────────────────────────────────────────────────────────────────────
    // 3. PROPUESTAS DE JUGADA Y MOTOR FIFO (MÓDULO 3)
    // ────────────────────────────────────────────────────────────────────────
    const prop = parsearPropuestaChat(texto);
    if (prop) {
      if (carreraActiva.estado === "CERRADA" || carreraActiva.estado === "LIQUIDADA") {
        const dmRechazo: MensajeSala = {
          id: `rej-${Date.now()}`,
          grupo_id: grupoActivoId,
          autor_id: null,
          autor_nombre: "Agente IA Oficial",
          autor_rol: "BOT",
          texto: `⛔ @${sesion.nombre}: La carrera ${carreraActiva.hipodromo} C${carreraActiva.carrera} está **CERRADA**. No se aceptan jugadas.`,
          tipo: "DM_PRIVADO",
          destinatario_privado_id: sesion.id,
          reply_to_msg_id: replyId,
          created_at: nowIso,
          esMio: false,
          esPrivadoParaMi: true,
        };
        setMensajes((prev) => [...prev, dmRechazo]);
        setEnviando(false);
        return;
      }

      const s = await obtenerMiSaldoPrivado(sesion.id);
      let montoReal = prop.monto;
      if (!s.libre) {
        if (s.disponible <= 0) {
          const dmSinSaldo: MensajeSala = {
            id: `ss-${Date.now()}`,
            grupo_id: grupoActivoId,
            autor_id: null,
            autor_nombre: "Agente IA Oficial",
            autor_rol: "BOT",
            texto: `⚠️ @${sesion.nombre}: Tu disponible es $0.00. No puedes proponer jugadas sin saldo disponible.`,
            tipo: "DM_PRIVADO",
            destinatario_privado_id: sesion.id,
            reply_to_msg_id: replyId,
            created_at: nowIso,
            esMio: false,
            esPrivadoParaMi: true,
          };
          setMensajes((prev) => [...prev, dmSinSaldo]);
          setEnviando(false);
          return;
        }

        if (montoReal > s.disponible) {
          montoReal = s.disponible;
        }
      }

      if (prop.contraparte) {
        const ticketNum = Math.floor(100000 + Math.random() * 900000);
        const juegaNombre = prop.rol === "JUEGA" ? sesion.nombre : prop.contraparte;
        const daNombre = prop.rol === "DA" ? sesion.nombre : prop.contraparte;

        const msgConcrecion: MensajeSala = {
          id: `conc-${Date.now()}`,
          grupo_id: grupoActivoId,
          autor_id: null,
          autor_nombre: "Agente IA Oficial",
          autor_rol: "BOT",
          texto: `✅ *¡Aquí jugaron!*\n\n🏇 **${prop.jugada}** al ejemplar **#${prop.caballo}** por **$${montoReal.toFixed(2)}**\n👤 Juega: **@${juegaNombre}**\n🛡️ Da: **@${daNombre}**\n🎫 Ticket Oficial: \`#${ticketNum}\`\n\nRegistrado y asentado en tiempo real.`,
          tipo: "CONCRECION",
          created_at: nowIso,
          esMio: false,
        };

        setMensajes((prev) => [...prev, msgConcrecion]);
        canalRealtimeRef.current?.send({ type: "broadcast", event: "mensaje_sala", payload: msgConcrecion });

        if (supabase) {
          try {
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
                id: msgConcrecion.id,
                grupo_id: grupoActivoId,
                autor_nombre: msgConcrecion.autor_nombre,
                autor_rol: msgConcrecion.autor_rol,
                texto: msgConcrecion.texto,
                tipo: "CONCRECION",
              },
            ]);
          } catch { /* noop */ }
        }

        refrescarSaldo(sesion.id);
        setEnviando(false);
        return;
      }

      // Propuesta Abierta a la sala (FIFO)
      const rolTxt = prop.rol === "JUEGA" ? "Juega" : "Da";
      const msgPropuesta: MensajeSala = {
        id: `prop-${Date.now()}`,
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
        created_at: nowIso,
        esMio: true,
      };

      setMensajes((prev) => [...prev, msgPropuesta]);
      canalRealtimeRef.current?.send({ type: "broadcast", event: "mensaje_sala", payload: msgPropuesta });

      if (supabase) {
        try {
          await supabase.from("chat_mensajes_sala").insert([
            {
              id: msgPropuesta.id,
              grupo_id: grupoActivoId,
              autor_id: sesion.id,
              autor_nombre: sesion.nombre,
              autor_rol: msgPropuesta.autor_rol,
              texto: msgPropuesta.texto,
              tipo: "PROPUESTA",
              monto_propuesto: montoReal,
              monto_disponible: montoReal,
              datos_jugada: msgPropuesta.datos_jugada,
            },
          ]);
        } catch { /* noop */ }
      }

      setEnviando(false);
      return;
    }

    // ────────────────────────────────────────────────────────────────────────
    // 4. RESPUESTA FIFO CITANDO UNA PROPUESTA (Aceptación pública para toda la sala)
    // ────────────────────────────────────────────────────────────────────────
    if (replyId) {
      const msgPropuesta = mensajes.find((m) => m.id === replyId);
      if (msgPropuesta && msgPropuesta.tipo === "PROPUESTA") {
        if (esPropuestaExpirada(msgPropuesta.created_at)) {
          emitirToast("⏳ Esta propuesta superó los 3 minutos de duración y ha expirado.", "warning");
          setEnviando(false);
          return;
        }

        if ((msgPropuesta.monto_disponible ?? 0) <= 0) {
          emitirToast("Esta parada ya fue completada o retirada.", "warning");
          setEnviando(false);
          return;
        }

        // Mensaje de respuesta del usuario (PÚBLICO PARA TODOS)
        const msgAceptaUsuario: MensajeSala = {
          id: msgId,
          grupo_id: grupoActivoId,
          autor_id: sesion.id,
          autor_nombre: sesion.nombre,
          autor_rol: sesion.esOperadorOAdmin ? "OPERADOR" : "JUGADOR",
          texto: `🗣️ @${sesion.nombre}: Tomo ${texto.toUpperCase() === "J" ? "todo" : `$${texto}`} contra @${msgPropuesta.autor_nombre}`,
          tipo: "TEXTO",
          reply_to_msg_id: replyId,
          created_at: nowIso,
          esMio: true,
        };

        setMensajes((prev) => [...prev, msgAceptaUsuario]);
        canalRealtimeRef.current?.send({
          type: "broadcast",
          event: "mensaje_sala",
          payload: msgAceptaUsuario,
        });

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
          // Confirmación Oficial de Concreción (PÚBLICA PARA TODOS)
          const msgConcrecion: MensajeSala = {
            id: `conc-${Date.now()}`,
            grupo_id: grupoActivoId,
            autor_id: null,
            autor_nombre: "Agente IA Oficial",
            autor_rol: "BOT",
            texto: `✅ *¡Jugada Aceptada!* Ticket \`#${resFifo.numero_ticket}\`\n\n👤 **@${sesion.nombre}** casó **$${resFifo.monto_concretado?.toFixed(2)}** contra **@${msgPropuesta.autor_nombre}** en ${msgPropuesta.datos_jugada?.jugada || "1P"} #${msgPropuesta.datos_jugada?.caballo || "1"}.\n${resFifo.parada_completa ? "🏁 *Parada 100% completada.*" : `Quedan **$${resFifo.monto_restante_propuesta?.toFixed(2)}** disponibles.`}`,
            tipo: "CONCRECION",
            reply_to_msg_id: replyId,
            created_at: new Date().toISOString(),
            esMio: false,
          };

          setMensajes((prev) => [...prev, msgConcrecion]);
          canalRealtimeRef.current?.send({
            type: "broadcast",
            event: "mensaje_sala",
            payload: msgConcrecion,
          });

          cargarMensajesYTickets(grupoActivoId, sesion.id);
          refrescarSaldo(sesion.id);
        }

        setEnviando(false);
        return;
      }
    }

    // ────────────────────────────────────────────────────────────────────────
    // 5. MENSAJE LIBRE + RESPUESTA CONVERSACIONAL DEL AGENTE IA
    // ────────────────────────────────────────────────────────────────────────
    const nuevoMsgUsuario: MensajeSala = {
      id: msgId,
      grupo_id: grupoActivoId,
      autor_id: sesion.id,
      autor_nombre: sesion.nombre,
      autor_rol: sesion.esOperadorOAdmin ? "OPERADOR" : "JUGADOR",
      texto,
      tipo: "TEXTO",
      reply_to_msg_id: replyId,
      created_at: nowIso,
      esMio: true,
    };

    setMensajes((prev) => [...prev, nuevoMsgUsuario]);
    canalRealtimeRef.current?.send({
      type: "broadcast",
      event: "mensaje_sala",
      payload: nuevoMsgUsuario,
    });

    if (supabase) {
      try {
        await supabase.from("chat_mensajes_sala").insert([
          {
            id: nuevoMsgUsuario.id,
            grupo_id: grupoActivoId,
            autor_id: sesion.id,
            autor_nombre: sesion.nombre,
            autor_rol: nuevoMsgUsuario.autor_rol,
            texto,
            tipo: "TEXTO",
            reply_to_msg_id: replyId,
          },
        ]);
      } catch (err: any) {
        console.warn("[enviarMensaje] Advertencia de persistencia:", err?.message);
      }
    }

    // El Agente IA responde de forma inteligente y empática si le hablan a él o saludan
    const evalCordial = detectarCordialidad(texto);
    if (evalCordial.esCordial || /^(carrera|que corre|programa|quien corre|pizarra)/i.test(texto)) {
      setTimeout(async () => {
        let respuestaIa = "";
        if (evalCordial.esCordial) {
          respuestaIa = generarRespuestaCordial(evalCordial, {
            nombre: sesion.seudonimo || sesion.nombre,
            club: "Sala Oficial de Carreras",
          });
        } else {
          const totalEjs = carreraActiva.ejemplares?.length || 0;
          respuestaIa = `📍 Carrera Activa: **${carreraActiva.hipodromo} (Carrera ${carreraActiva.carrera})**\nDistancia: **${carreraActiva.distancia || "1200m"}** · Superficie: **${carreraActiva.superficie || "Arena"}**\nEstado: **${carreraActiva.estado === "ABIERTA" ? "🟢 ABIERTA" : "🔴 CERRADA"}**\nTotal ejemplares: **${totalEjs}**.\n\nPuedes enviar tu jugada (ej: "Juego 1p 7 100") o tocar la lista de ejemplares a la derecha. 🏇`;
        }

        const msgIa: MensajeSala = {
          id: `ia-reply-${Date.now()}`,
          grupo_id: grupoActivoId,
          autor_id: null,
          autor_nombre: "Agente IA Oficial",
          autor_rol: "BOT",
          texto: respuestaIa,
          tipo: "TEXTO",
          reply_to_msg_id: nuevoMsgUsuario.id,
          created_at: new Date().toISOString(),
          esMio: false,
        };

        setMensajes((prev) => [...prev, msgIa]);
        canalRealtimeRef.current?.send({ type: "broadcast", event: "mensaje_sala", payload: msgIa });

        if (supabase) {
          try {
            await supabase.from("chat_mensajes_sala").insert([
              {
                id: msgIa.id,
                grupo_id: grupoActivoId,
                autor_nombre: msgIa.autor_nombre,
                autor_rol: msgIa.autor_rol,
                texto: msgIa.texto,
                tipo: "TEXTO",
                reply_to_msg_id: nuevoMsgUsuario.id,
              },
            ]);
          } catch { /* noop */ }
        }
      }, 500);
    }

    setEnviando(false);
  };

  // Tomar propuesta FIFO desde los botones interactivos (Público para toda la sala)
  const handleTomarPropuestaFifo = async (msgProp: MensajeSala, montoOComando: string) => {
    if (!sesion) return;

    if (esPropuestaExpirada(msgProp.created_at)) {
      emitirToast("⏳ Esta propuesta superó los 3 minutos de duración y ha expirado.", "warning");
      return;
    }

    if ((msgProp.monto_disponible ?? 0) <= 0) {
      emitirToast("Esta parada ya fue completada o retirada.", "warning");
      return;
    }

    const nowIso = new Date().toISOString();
    // 1. Mostrar mensaje de respuesta de quien acepta (PÚBLICO PARA TODOS)
    const msgAcepta: MensajeSala = {
      id: `acepta-${Date.now()}`,
      grupo_id: grupoActivoId,
      autor_id: sesion.id,
      autor_nombre: sesion.nombre,
      autor_rol: sesion.esOperadorOAdmin ? "OPERADOR" : "JUGADOR",
      texto: `🗣️ @${sesion.nombre}: Tomo ${montoOComando === "J" ? "toda la parada" : `$${montoOComando}`} contra @${msgProp.autor_nombre}`,
      tipo: "TEXTO",
      reply_to_msg_id: msgProp.id,
      created_at: nowIso,
      esMio: true,
    };
    setMensajes((prev) => [...prev, msgAcepta]);
    canalRealtimeRef.current?.send({
      type: "broadcast",
      event: "mensaje_sala",
      payload: msgAcepta,
    });

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

      // 2. Anuncio oficial de concreción para TODOS
      const msgConc: MensajeSala = {
        id: `conc-${Date.now()}`,
        grupo_id: grupoActivoId,
        autor_id: null,
        autor_nombre: "Agente IA Oficial",
        autor_rol: "BOT",
        texto: `✅ *¡Jugada Aceptada!* Ticket \`#${res.numero_ticket}\`\n\n👤 **@${sesion.nombre}** casó **$${res.monto_concretado?.toFixed(2)}** contra **@${msgProp.autor_nombre}** en ${msgProp.datos_jugada?.jugada || "1P"} #${msgProp.datos_jugada?.caballo || "1"}.\n${res.parada_completa ? "🏁 *Parada 100% completada.*" : `Quedan **$${res.monto_restante_propuesta?.toFixed(2)}** disponibles.`}`,
        tipo: "CONCRECION",
        reply_to_msg_id: msgProp.id,
        created_at: new Date().toISOString(),
        esMio: false,
      };

      setMensajes((prev) => [...prev, msgConc]);
      canalRealtimeRef.current?.send({
        type: "broadcast",
        event: "mensaje_sala",
        payload: msgConc,
      });

      cargarMensajesYTickets(grupoActivoId, sesion.id);
      refrescarSaldo(sesion.id);
    }
  };

  // Manejador para anulación de propuesta por el propio usuario ("Se fue")
  const handleAnularPropuestaUsuario = (msgProp: MensajeSala) => {
    void anularPropuestaEnChat(msgProp, "USUARIO");
  };

  // Manejador para anulación administrativa por error de herramienta
  const handleAnularPropuestaAdmin = (msgId: string) => {
    const prop = mensajes.find((m) => m.id === msgId);
    if (prop) {
      void anularPropuestaEnChat(prop, "ADMIN");
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
    if (!sesion?.esOperadorOAdmin) return;
    const nuevo = carreraActiva.estado === "ABIERTA" ? "CERRADA" : "ABIERTA";
    setCarreraActiva((prev) => ({ ...prev, estado: nuevo as any }));

    const txt =
      nuevo === "ABIERTA"
        ? `🟢 *CARRERA ABIERTA*: ${carreraActiva.hipodromo} C${carreraActiva.carrera}`
        : `🚨 *CARRERA CERRADA*: ${carreraActiva.hipodromo} C${carreraActiva.carrera}`;

    const msgEst: MensajeSala = {
      id: `est-${Date.now()}`,
      grupo_id: grupoActivoId,
      autor_id: sesion.id,
      autor_nombre: sesion.nombre,
      autor_rol: "OPERADOR",
      texto: txt,
      tipo: "ESTADO_CARRERA",
      created_at: new Date().toISOString(),
      esMio: true,
    };

    setMensajes((prev) => [...prev, msgEst]);
    canalRealtimeRef.current?.send({ type: "broadcast", event: "mensaje_sala", payload: msgEst });

    if (supabase) {
      try {
        await supabase
          .from("chat_estado_grupo")
          .update({ estado: nuevo, updated_at: new Date().toISOString() })
          .eq("grupo_id", grupoActivoId);

        await supabase.from("chat_mensajes_sala").insert([
          {
            id: msgEst.id,
            grupo_id: grupoActivoId,
            autor_id: sesion.id,
            autor_nombre: sesion.nombre,
            autor_rol: "OPERADOR",
            texto: txt,
            tipo: "ESTADO_CARRERA",
          },
        ]);
      } catch { /* noop */ }
    }
  };

  // Eliminar mensaje gráfico solo por operador
  const handleEliminarMensajeOperador = async (msgId: string) => {
    if (!sesion?.esOperadorOAdmin) return;
    setMensajes((prev) => prev.filter((m) => m.id !== msgId));
    emitirToast("Tarjeta eliminada por el operador", "info");
    if (supabase) {
      try {
        await supabase.from("chat_mensajes_sala").delete().eq("id", msgId);
      } catch { /* noop */ }
    }
  };

  // ──────────────────────────────────────────────────────────────────────────
  // RENDER: PANTALLA DE CARGA O ACCESO DIRECTO RÁPIDO
  // ──────────────────────────────────────────────────────────────────────────
  if (cargandoAuth) {
    return (
      <div className={`flex ${alturaRaiz} w-full items-center justify-center bg-[#111b21] text-white`}>
        <div className="flex flex-col items-center gap-3">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-[#00a884] border-t-transparent" />
          <span className="text-xs text-[#8696a0]">Conectando con el Agente IA Oficial...</span>
        </div>
      </div>
    );
  }

  // Si entra desde una ventana nueva sin ninguna sesión previa vinculada:
  // Mostramos selección directa en 1 clic (SIN OTP ni pedir celular)
  if (!sesion) {
    const clientesFiltrados = clientesDisponibles.filter((c) =>
      c.nombre?.toLowerCase().includes(busquedaCliente.toLowerCase()) ||
      c.seudonimo?.toLowerCase().includes(busquedaCliente.toLowerCase())
    );

    return (
      <div className={`flex ${embebido ? "min-h-full" : "min-h-[100dvh]"} w-full items-center justify-center bg-[#111b21] p-4 text-white font-sans select-none`}>
        <div className="w-full max-w-sm rounded-3xl bg-[#202c33] p-6 shadow-2xl border border-[#2a3942]">
          <div className="flex flex-col items-center gap-2 pb-5 text-center border-b border-[#2a3942]">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#00a884] text-white shadow-lg text-3xl">
              🤖
            </div>
            <h1 className="text-lg font-bold tracking-tight text-[#e9edef]">Agente IA · Sala Oficial</h1>
            <p className="text-xs text-[#8696a0]">
              Selecciona tu cuenta o seudónimo para ingresar directamente a la sala:
            </p>
          </div>

          <div className="mt-4 space-y-3">
            <input
              type="text"
              value={busquedaCliente}
              onChange={(e) => setBusquedaCliente(e.target.value)}
              placeholder="Buscar tu seudónimo..."
              className="w-full rounded-xl bg-[#111b21] px-4 py-2.5 text-xs text-[#e9edef] placeholder-[#8696a0] border border-[#2a3942] focus:border-[#00a884] focus:outline-none"
            />

            <div className="max-h-60 overflow-y-auto space-y-1.5 pr-1">
              {clientesFiltrados.length > 0 ? (
                clientesFiltrados.map((cli) => (
                  <button
                    key={cli.id}
                    type="button"
                    onClick={() => ingresarComoClienteDirecto(cli)}
                    className="w-full flex items-center justify-between p-2.5 rounded-xl bg-[#111b21] hover:bg-[#1a252c] border border-[#2a3942] hover:border-[#00a884] transition-all text-left"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="h-7 w-7 rounded-full bg-[#00a884]/20 border border-[#00a884]/50 flex items-center justify-center text-xs font-bold text-[#00a884]">
                        {cli.nombre ? cli.nombre.charAt(0).toUpperCase() : "👤"}
                      </div>
                      <span className="text-xs font-bold text-[#e9edef] truncate">{cli.nombre}</span>
                    </div>
                    <span className="text-[10px] text-[#00a884] font-semibold">Entrar ➔</span>
                  </button>
                ))
              ) : (
                <div className="p-3 text-center text-xs text-[#8696a0]">
                  No se encontraron clientes registrados.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ──────────────────────────────────────────────────────────────────────────
  // RENDER: SALA DE MENSAJERÍA PWA + DESKTOP ESTILO WHATSAPP
  // ──────────────────────────────────────────────────────────────────────────
  const esCerrada = carreraActiva.estado === "CERRADA" || carreraActiva.estado === "LIQUIDADA";

  return (
    <div className={`flex ${alturaRaiz} w-full overflow-hidden bg-[#111b21] font-sans`}>
      {/* Panel Izquierdo: Lista de Grupos y Canal Bot */}
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
          esOperadorOAdmin={sesion.esOperadorOAdmin}
          onCrearSala={handleCrearNuevaSala}
        />
      </div>

      {/* Panel Central: Chat Activo con Agente IA */}
      <div className="flex flex-1 flex-col h-full bg-[#0b141a] min-w-0 relative">
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

        {/* Feed de mensajes */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-2 bg-[#0b141a]">
          <div className="mx-auto my-1 max-w-sm rounded-xl bg-[#182229] px-3 py-1.5 text-center shadow-sm border border-[#222e35]">
            <p className="text-[10px] text-[#8696a0] leading-snug">
              🤖 <b>Agente IA Oficial:</b> Modera la sala, empareja paradas FIFO y custodia tu saldo privado.
            </p>
          </div>

          {mensajes.map((m) => {
            const citado = m.reply_to_msg_id
              ? mensajes.find((x) => x.id === m.reply_to_msg_id)
              : null;
            return (
              <SalaBurbujaMensaje
                key={m.id}
                mensaje={conSeudonimo(m)!}
                mensajeCitado={conSeudonimo(citado)}
                carreraActiva={carreraActiva}
                nombreUsuarioActual={sesion.nombre}
                tamanoLetra={tamanoLetra}
                esOperadorOAdmin={sesion.esOperadorOAdmin}
                onCitar={(msg) => setMensajeCitado(msg)}
                onTomarPropuestaFifo={handleTomarPropuestaFifo}
                onAnularPropuestaUsuario={handleAnularPropuestaUsuario}
                onAnularPropuestaAdmin={handleAnularPropuestaAdmin}
                onEliminarMensajeOperador={handleEliminarMensajeOperador}
              />
            );
          })}
          <div ref={chatBottomRef} />
        </div>

        {/* Previsualización de Mensaje Citado */}
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

        {/* Chips Rápidos de Jugadas */}
        <div className="flex gap-2 overflow-x-auto bg-[#202c33] px-3 py-1.5 border-t border-[#222e35] scrollbar-none select-none">
          <button
            onClick={() => enviarMensaje("Saldo")}
            className="whitespace-nowrap rounded-full bg-[#111b21] px-3 py-1 text-xs font-semibold text-[#00a884] shadow-sm border border-[#00a884]/40 hover:bg-[#182229] active:scale-95"
          >
            💰 Mi Saldo (Privado)
          </button>
          <button
            onClick={() => enviarMensaje("¿Qué carrera viene?")}
            className="whitespace-nowrap rounded-full bg-[#111b21] px-3 py-1 text-xs font-semibold text-slate-200 shadow-sm border border-[#2a3942] hover:bg-[#182229] active:scale-95"
          >
            📍 Carrera Actual
          </button>
          <button
            onClick={() => enviarMensaje("100 al 5 con @SAM")}
            disabled={esCerrada}
            className="whitespace-nowrap rounded-full bg-[#111b21] px-3 py-1 text-xs font-semibold text-slate-200 shadow-sm border border-[#2a3942] hover:bg-[#182229] active:scale-95 disabled:opacity-40"
          >
            🏇 100 al 5 con @SAM
          </button>
          <button
            onClick={() => enviarMensaje("50 2n al 1")}
            disabled={esCerrada}
            className="whitespace-nowrap rounded-full bg-[#111b21] px-3 py-1 text-xs font-semibold text-slate-200 shadow-sm border border-[#2a3942] hover:bg-[#182229] active:scale-95 disabled:opacity-40"
          >
            🛡️ 50 2n al 1
          </button>
          {sesion.esOperadorOAdmin && (
            <button
              onClick={() => enviarMensaje(`Abierta ${carreraActiva.hipodromo} ${carreraActiva.carrera}`)}
              className="whitespace-nowrap rounded-full bg-emerald-950/50 px-3 py-1 text-xs font-semibold text-emerald-300 shadow-sm border border-emerald-500/40 hover:bg-emerald-900/50 active:scale-95"
            >
              🟢 Abrir Carrera
            </button>
          )}
        </div>

        {/* Barra Inferior Fija de Input */}
        <div className="flex items-center gap-2 bg-[#202c33] px-3 py-2 border-t border-[#222e35]">
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
                : "Escribe al Agente IA (ej. Juego 1p 7 100, 50 2n al 1)..."
            }
            className={`flex-1 rounded-2xl bg-[#2a3942] px-4 py-2.5 text-sm text-[#e9edef] placeholder-[#8696a0] border shadow-sm focus:border-[#00a884] focus:outline-none transition-all ${
              grabandoVoz ? "border-red-500 bg-red-950/40 animate-pulse" : "border-transparent"
            }`}
          />

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

      {/* Panel Derecho Colapsable: Ejemplares y Tickets */}
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
