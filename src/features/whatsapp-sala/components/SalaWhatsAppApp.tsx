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
import {
  listarSalasPorGrupo,
  crearSalaEnGrupo,
  editarSala,
  eliminarSala,
  editarGrupoVenta,
  eliminarGrupoVenta,
  type SalaChat,
} from "../lib/salas";
import { type GrupoVentaItem } from "./SalaLeftPanelGrupos";
import { listarGruposVenta } from "@/features/grupos/lib/grupos";

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
  esAdmin?: boolean;
}

function esUsuarioAdministrador(usuario?: string, perfiles: string[] = [], esPrincipal = false): boolean {
  if (esPrincipal) return true;
  if (perfiles && perfiles.some((p) => /admin/i.test(p))) return true;
  if (/ADMIN|JULIO|JOSORIO/i.test(usuario || "")) return true;
  return false;
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

  const cargarListaClientes = useCallback(async () => {
    if (!supabase) return;
    try {
      const { data: clis } = await supabase
        .from("clientes")
        .select("id, nombre, seudonimo, telefono, saldo_actual, aval, libre, modo_juego, grupo_id")
        .order("nombre", { ascending: true })
        .limit(100);

      if (clis && clis.length > 0) {
        setClientesDisponibles(clis);
      }
    } catch {
      /* ignore */
    }
  }, []);

  // Grupos de Venta y Salas Propias por Grupo ("cada grupo tiene sus propias salas")
  const [gruposVenta, setGruposVenta] = useState<GrupoVentaItem[]>([]);
  const [grupoSeleccionadoId, setGrupoSeleccionadoId] = useState<string>(GRUPO_DEFAULT_ID);
  const [salas, setSalas] = useState<SalaChat[]>([]);
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
  const [imagenAdjunta, setImagenAdjunta] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputMensajeRef = useRef<HTMLInputElement>(null);

  const handleCitarMensaje = useCallback((msg: MensajeSala) => {
    setMensajeCitado(msg);
    setTimeout(() => {
      inputMensajeRef.current?.focus();
    }, 60);
  }, []);

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

      // Cargar clientes registrados para tener la lista disponible de inmediato
      void cargarListaClientes();

      // Si el usuario presionó 'Cerrar sesión' o cambiar cuenta en esta pestaña:
      const manualExit = sessionStorage.getItem("hipico_sala_manual_exit") === "true";
      if (manualExit) {
        setCargandoAuth(false);
        return;
      }

      // 1. ¿Tiene sesión previa en la sala guardada en el dispositivo?
      try {
        const guardada = localStorage.getItem(STORAGE_SESSION_KEY);
        if (guardada) {
          const parsed = JSON.parse(guardada) as ClienteSesionSala;
          if (parsed && parsed.id && parsed.nombre) {
            const alias = String(parsed.seudonimo || parsed.nombre).toUpperCase();
            const authSt = useAuthStore.getState();
            const esAdminCalc = esUsuarioAdministrador(
              parsed.id.startsWith("op-") ? authSt.usuario : alias,
              authSt.perfiles,
              authSt.esPrincipal
            );
            const sesionRestaurada: ClienteSesionSala = {
              ...parsed,
              nombre: alias,
              seudonimo: alias,
              esAdmin: esAdminCalc,
            };
            setSesion(sesionRestaurada);
            setCargandoAuth(false);
            return;
          }
        }
      } catch {
        /* ignore */
      }

      // 2. ¿Tiene sesión activa en el Portal de Jugadores ("portal.cliente")?
      try {
        const portalRaw = localStorage.getItem("portal.cliente");
        if (portalRaw) {
          const p = JSON.parse(portalRaw);
          const c = p?.cliente;
          if (c && (c.nombre || c.id)) {
            const authSt = useAuthStore.getState();
            const aliasCli = String(c.seudonimo || c.nombre || "Jugador").toUpperCase();
            const sesionDetectada: ClienteSesionSala = {
              id: String(c.id),
              nombre: aliasCli,
              seudonimo: aliasCli,
              telefono: String(c.telefono || ""),
              saldo_actual: Number(c.saldo_actual || 0),
              aval: Number(c.aval || 0),
              libre: Boolean(c.libre || String(c.modo_juego).toLowerCase() === "libre"),
              modo_juego: String(c.modo_juego || "aval"),
              grupo_id: c.grupo_id || GRUPO_DEFAULT_ID,
              esOperadorOAdmin: /ADMIN|OPERADOR|ARELY|JULIO/i.test(c.nombre || ""),
              esAdmin: esUsuarioAdministrador(aliasCli, authSt.perfiles, authSt.esPrincipal),
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

      // 3. ¿Tiene sesión activa de Operador / Administrador en useAuthStore?
      try {
        const authSt = useAuthStore.getState();
        const authUser = authSt.usuario;
        const nombreOp = authSt.tipoUsuario?.nombre || authUser;
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
            grupo_id: authSt.grupoActivo || GRUPO_DEFAULT_ID,
            esOperadorOAdmin: true,
            esAdmin: esUsuarioAdministrador(authUser, authSt.perfiles, authSt.esPrincipal),
          };
          localStorage.setItem(STORAGE_SESSION_KEY, JSON.stringify(sesionOp));
          setSesion(sesionOp);
          setCargandoAuth(false);
          return;
        }
      } catch {
        /* ignore */
      }

      setCargandoAuth(false);
    }

    resolverIdentidadAutomatica();
  }, [cargarListaClientes]);

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

  // 4. Sincronizar grupos de venta disponibles
  useEffect(() => {
    async function cargarGruposVenta() {
      try {
        const lista = await listarGruposVenta();
        if (lista && lista.length > 0) {
          const mapG: GrupoVentaItem[] = lista.map((g) => ({
            id: String(g.id),
            nombre: g.nombre,
          }));
          setGruposVenta(mapG);
          if (sesion?.grupo_id) {
            setGrupoSeleccionadoId(String(sesion.grupo_id));
          } else {
            setGrupoSeleccionadoId((prev) => (mapG.some((g) => String(g.id) === prev) ? prev : String(mapG[0].id)));
          }
          return;
        }
        if (supabase) {
          const { data } = await supabase.from("grupos_venta").select("id, nombre").order("nombre");
          if (data && data.length > 0) {
            const mapG: GrupoVentaItem[] = data.map((g) => ({ id: String(g.id), nombre: g.nombre }));
            setGruposVenta(mapG);
            if (sesion?.grupo_id) {
              setGrupoSeleccionadoId(String(sesion.grupo_id));
            } else {
              setGrupoSeleccionadoId(String(data[0].id));
            }
          }
        }
      } catch {
        /* fallback */
      }
    }
    cargarGruposVenta();
  }, [sesion?.grupo_id]);

  // 4b. Sincronizar las salas exclusivas del grupo seleccionado ("cada grupo tiene sus propias salas")
  useEffect(() => {
    if (!grupoSeleccionadoId) return;
    const gObj = gruposVenta.find((g) => String(g.id) === String(grupoSeleccionadoId));
    const nombreG = gObj?.nombre;

    async function sincronizarSalas() {
      try {
        const sList = await listarSalasPorGrupo(grupoSeleccionadoId, nombreG);
        setSalas(sList);
        setGrupoActivoId((prev) => {
          if (prev === "bot-privado") return prev;
          if (sList.some((s) => s.id === prev)) return prev;
          return sList[0]?.id || `${grupoSeleccionadoId}_principal`;
        });
      } catch {
        /* ignore */
      }
    }
    void sincronizarSalas();

    const handler = (e: any) => {
      if (!e.detail?.grupoId || String(e.detail.grupoId) === String(grupoSeleccionadoId)) {
        void sincronizarSalas();
      }
    };
    window.addEventListener("hipico:salas-actualizadas", handler);
    return () => window.removeEventListener("hipico:salas-actualizadas", handler);
  }, [grupoSeleccionadoId, gruposVenta]);

  // 4c. Administrador: Crear nueva sala para el grupo activo
  const handleCrearNuevaSala = async (nombre: string, descripcion?: string): Promise<{ ok: boolean; error?: string }> => {
    if (!sesion?.esOperadorOAdmin) {
      return { ok: false, error: "Solo los administradores u operadores pueden crear salas." };
    }
    try {
      const gObj = gruposVenta.find((g) => String(g.id) === String(grupoSeleccionadoId));
      const res = await crearSalaEnGrupo(grupoSeleccionadoId, nombre, descripcion);

      if (!res.ok || !res.sala) {
        return { ok: false, error: res.error || "No se pudo crear la sala" };
      }

      const sList = await listarSalasPorGrupo(grupoSeleccionadoId, gObj?.nombre);
      setSalas(sList);
      setGrupoActivoId(res.sala.id);
      emitirToast(`Sala ${nombre.toUpperCase()} creada con éxito en ${gObj?.nombre || "este grupo"}`, "success");
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e.message || "Error al crear la sala" };
    }
  };

  // 4d. Administrador: Editar sala existente (solo administrador)
  const handleEditarSala = async (salaId: string, nuevoNombre: string, descripcion?: string): Promise<{ ok: boolean; error?: string }> => {
    if (!sesion?.esAdmin) {
      return { ok: false, error: "Solo los administradores pueden editar salas de juegos." };
    }
    try {
      const res = await editarSala(salaId, grupoSeleccionadoId, nuevoNombre, descripcion);
      if (!res.ok) return res;
      const gObj = gruposVenta.find((g) => String(g.id) === String(grupoSeleccionadoId));
      const sList = await listarSalasPorGrupo(grupoSeleccionadoId, gObj?.nombre);
      setSalas(sList);
      emitirToast("Sala actualizada", "success");
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e.message || "Error al editar la sala" };
    }
  };

  // 4e. Administrador: Eliminar sala (solo administrador)
  const handleEliminarSala = async (salaId: string): Promise<{ ok: boolean; error?: string }> => {
    if (!sesion?.esAdmin) {
      return { ok: false, error: "Solo los administradores pueden eliminar salas de juegos." };
    }
    try {
      const res = await eliminarSala(salaId, grupoSeleccionadoId);
      if (!res.ok) return res;
      const gObj = gruposVenta.find((g) => String(g.id) === String(grupoSeleccionadoId));
      const sList = await listarSalasPorGrupo(grupoSeleccionadoId, gObj?.nombre);
      setSalas(sList);
      if (grupoActivoId === salaId) {
        setGrupoActivoId(sList[0]?.id || "bot-privado");
      }
      emitirToast("Sala eliminada", "info");
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e.message || "Error al eliminar la sala" };
    }
  };

  // 4f. Administrador: Editar nombre de grupo de venta (solo administrador)
  const handleEditarGrupo = async (grupoId: string, nuevoNombre: string): Promise<{ ok: boolean; error?: string }> => {
    if (!sesion?.esAdmin) return { ok: false, error: "Solo los administradores pueden editar grupos." };
    try {
      const res = await editarGrupoVenta(grupoId, nuevoNombre);
      if (!res.ok) return res;
      setGruposVenta((prev) =>
        prev.map((g) => (String(g.id) === String(grupoId) ? { ...g, nombre: nuevoNombre.trim().toUpperCase() } : g))
      );
      emitirToast("Grupo renombrado", "success");
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e.message || "Error al renombrar el grupo" };
    }
  };

  // 4g. Administrador: Eliminar / desactivar grupo de venta (solo administrador)
  const handleEliminarGrupo = async (grupoId: string): Promise<{ ok: boolean; error?: string }> => {
    if (!sesion?.esAdmin) return { ok: false, error: "Solo los administradores pueden eliminar grupos." };
    try {
      const res = await eliminarGrupoVenta(grupoId);
      if (!res.ok) return res;
      const filtrados = gruposVenta.filter((g) => String(g.id) !== String(grupoId));
      setGruposVenta(filtrados);
      if (filtrados.length > 0) {
        setGrupoSeleccionadoId(String(filtrados[0].id));
      }
      emitirToast("Grupo desactivado", "info");
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e.message || "Error al eliminar el grupo" };
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
        let ejs = (data.ejemplares as any) || [];
        if (!ejs || ejs.length === 0) {
          const hoy = data.fecha || new Date().toISOString().slice(0, 10);
          const { data: cRow } = await supabase
            .from("carreras")
            .select("caballos, distancia, superficie, hora")
            .eq("fecha", hoy)
            .eq("hipodromo", data.hipodromo)
            .eq("carrera", data.carrera)
            .maybeSingle();
          if (cRow?.caballos) {
            ejs = cRow.caballos;
          }
        }
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
          ejemplares: ejs,
        });
      } else {
        const hoy = new Date().toISOString().slice(0, 10);
        const { data: cData } = await supabase
          .from("carreras")
          .select("hipodromo, carrera, estado, hora, distancia, superficie, caballos")
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
            hora: c.hora,
            ejemplares: (c.caballos as any) || [],
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
            if (m.destinatario_privado_id === cid || m.autor_id === cid) return true;
            if (sesion?.esOperadorOAdmin && /admin|operador|soporte|taquilla/i.test(m.destinatario_privado_id)) return true;
            return false;
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
            if (!(sesion.esOperadorOAdmin && /admin|operador|soporte|taquilla/i.test(payload.destinatario_privado_id))) {
              return;
            }
          }
          reproducirBeepWhatsApp();
          setMensajes((prev) => {
            if (prev.some((x) => x.id === payload.id)) return prev;
            return [
              ...prev,
              {
                ...payload,
                esMio: false,
                esPrivadoParaMi: payload.destinatario_privado_id === sesion.id || (sesion.esOperadorOAdmin && /admin|operador|soporte|taquilla/i.test(payload.destinatario_privado_id)),
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
            if (!(sesion.esOperadorOAdmin && /admin|operador|soporte|taquilla/i.test(m.destinatario_privado_id))) {
              return;
            }
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
      if (grupoActivoId === "admin-privado") {
        const msgAdminPrivado: MensajeSala = {
          id: `welcome-admin-${sesion.id}`,
          grupo_id: "admin-privado",
          autor_id: null,
          autor_nombre: "Atención al Cliente",
          autor_rol: "BOT",
          texto: `👨‍💼 ¡Hola @${sesion.nombre}! Este es tu canal directo y confidencial con el **Administrador** y los **Operadores de Taquilla**.\n\nEscribe aquí tus consultas, dudas, recargas o solicitudes de atención. Los demás usuarios **no tienen acceso** a este canal privado.`,
          tipo: "TEXTO",
          created_at: new Date().toISOString(),
          esMio: false,
        };
        setMensajes([msgAdminPrivado]);
        return;
      }

      const esLibre = sesion.libre;
      const msgBienvenida: MensajeSala = {
        id: `welcome-${sesion.id}`,
        grupo_id: grupoActivoId,
        autor_id: null,
        autor_nombre: "Agente IA Oficial",
        autor_rol: "BOT",
        texto: `👋 ¡Hola @${sesion.nombre}! Soy tu Agente IA Oficial y moderador de la Sala.\n\n🏇 Carrera Activa: **${carreraActiva.hipodromo} (Carrera ${carreraActiva.carrera})** · Estado: **${carreraActiva.estado}**\n${
          esLibre ? "⭐ Estatus: **Cuenta LIBRE**" : `💰 Tu Saldo Disponible: **$${(sesion.saldo_actual + sesion.aval).toFixed(2)}**`
        }\n\nPuedes registrar tus jugadas de puestos directamente (ej. "Juego 1p 7 100", "50 2n al 1"), consultar tu "Saldo" en privado o contactar al Administrador u Operadores con /admin tu mensaje. ¿En qué te colaboro hoy?`,
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
    try {
      sessionStorage.removeItem("hipico_sala_manual_exit");
    } catch {
      /* ignore */
    }
    const aliasCli = String(cli.seudonimo || cli.nombre || "Jugador").toUpperCase();
    const authSt = useAuthStore.getState();
    const sesionNueva: ClienteSesionSala = {
      id: String(cli.id),
      nombre: aliasCli,
      seudonimo: aliasCli,
      telefono: String(cli.telefono || ""),
      saldo_actual: Number(cli.saldo_actual || 0),
      aval: Number(cli.aval || 0),
      libre: Boolean(cli.libre || String(cli.modo_juego).toLowerCase() === "libre"),
      modo_juego: String(cli.modo_juego || "aval"),
      grupo_id: cli.grupo_id || GRUPO_DEFAULT_ID,
      esOperadorOAdmin: /ADMIN|OPERADOR|ARELY|JULIO/i.test(cli.nombre || ""),
      esAdmin: esUsuarioAdministrador(aliasCli, authSt.perfiles, authSt.esPrincipal),
    };
    localStorage.setItem(STORAGE_SESSION_KEY, JSON.stringify(sesionNueva));
    setSesion(sesionNueva);
    refrescarSaldo(sesionNueva.id);
  };

  const ingresarComoOperador = () => {
    try {
      sessionStorage.removeItem("hipico_sala_manual_exit");
    } catch {
      /* ignore */
    }
    const authSt = useAuthStore.getState();
    const authUser = authSt.usuario || "operador";
    const nombreOp = authSt.tipoUsuario?.nombre || authUser;
    const sesionOp: ClienteSesionSala = {
      id: `op-${authUser}`,
      nombre: String(nombreOp || authUser).toUpperCase(),
      seudonimo: String(nombreOp || authUser).toUpperCase(),
      telefono: "",
      saldo_actual: 0,
      aval: 0,
      libre: true,
      modo_juego: "libre",
      grupo_id: authSt.grupoActivo || GRUPO_DEFAULT_ID,
      esOperadorOAdmin: true,
      esAdmin: esUsuarioAdministrador(authUser, authSt.perfiles, authSt.esPrincipal),
    };
    localStorage.setItem(STORAGE_SESSION_KEY, JSON.stringify(sesionOp));
    setSesion(sesionOp);
  };

  const cerrarSesion = () => {
    try {
      sessionStorage.setItem("hipico_sala_manual_exit", "true");
      localStorage.removeItem(STORAGE_SESSION_KEY);
    } catch {
      /* ignore */
    }
    setSesion(null);
    void cargarListaClientes();
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
    if ((!texto && !imagenAdjunta) || !sesion || enviando) return;

    const imagenUrlParaEnviar = imagenAdjunta || undefined;
    setEnviando(true);
    setInputTexto("");
    setImagenAdjunta(null);
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
    // CANAL DIRECTO DE ATENCIÓN CON ADMINISTRADOR / OPERADORES
    // ────────────────────────────────────────────────────────────────────────
    if (grupoActivoId === "admin-privado") {
      const msgAdminDirecto: MensajeSala = {
        id: msgId,
        grupo_id: "admin-privado",
        autor_id: sesion.id,
        autor_nombre: sesion.nombre,
        autor_rol: sesion.esOperadorOAdmin ? "OPERADOR" : "JUGADOR",
        texto,
        tipo: "DM_PRIVADO",
        destinatario_privado_id: "admin",
        reply_to_msg_id: replyId,
        created_at: nowIso,
        esMio: true,
        esPrivadoParaMi: true,
      };

      setMensajes((prev) => [...prev, msgAdminDirecto]);
      canalRealtimeRef.current?.send({
        type: "broadcast",
        event: "mensaje_sala",
        payload: msgAdminDirecto,
      });

      if (supabase) {
        try {
          await supabase.from("chat_mensajes_sala").insert([
            {
              id: msgAdminDirecto.id,
              grupo_id: "admin-privado",
              autor_id: sesion.id,
              autor_nombre: sesion.nombre,
              autor_rol: msgAdminDirecto.autor_rol,
              texto: msgAdminDirecto.texto,
              tipo: "DM_PRIVADO",
              destinatario_privado_id: "admin",
              reply_to_msg_id: replyId,
            },
          ]);
        } catch { /* noop */ }
      }

      setEnviando(false);
      return;
    }

    // ────────────────────────────────────────────────────────────────────────
    // COMANDO DIRECTO PARA CONTACTAR AL ADMINISTRADOR U OPERADORES (/admin, /operador, /soporte)
    // ────────────────────────────────────────────────────────────────────────
    const mStaff = /^(?:\/admin|\/operador|\/soporte)\s+([\s\S]+)$/i.exec(texto);
    if (mStaff) {
      const staffTexto = mStaff[1].trim();
      const msgStaff: MensajeSala = {
        id: msgId,
        grupo_id: grupoActivoId,
        autor_id: sesion.id,
        autor_nombre: sesion.nombre,
        autor_rol: sesion.esOperadorOAdmin ? "OPERADOR" : "JUGADOR",
        texto: `🔒 [Mensaje para Administrador / Operadores]: ${staffTexto}`,
        tipo: "DM_PRIVADO",
        destinatario_privado_id: "admin",
        reply_to_msg_id: replyId,
        created_at: nowIso,
        esMio: true,
        esPrivadoParaMi: true,
      };

      setMensajes((prev) => [...prev, msgStaff]);
      canalRealtimeRef.current?.send({
        type: "broadcast",
        event: "mensaje_sala",
        payload: msgStaff,
      });

      if (supabase) {
        try {
          await supabase.from("chat_mensajes_sala").insert([
            {
              id: msgStaff.id,
              grupo_id: grupoActivoId,
              autor_id: sesion.id,
              autor_nombre: sesion.nombre,
              autor_rol: msgStaff.autor_rol,
              texto: msgStaff.texto,
              tipo: "DM_PRIVADO",
              destinatario_privado_id: "admin",
              reply_to_msg_id: replyId,
            },
          ]);
        } catch { /* noop */ }
      }

      emitirToast("Tu mensaje ha sido enviado al Administrador y Operadores.", "success");
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
      const esDestinoStaff = /ADMIN|OPERADOR|TAQUILLA|SOPORTE|SUPERVISOR|JULIO|JOSORIO/i.test(destNombre);

      // Los usuarios no pueden contactarse entre ellos: solo con admin u operadores
      if (!sesion.esOperadorOAdmin && !esDestinoStaff) {
        emitirToast("⛔ Los usuarios no pueden contactarse entre ellos. Solo puedes contactar al Administrador o a los Operadores.", "warning");
        setEnviando(false);
        return;
      }

      let targetId: string = "admin";
      let nombreDestino = "Administración / Operadores";

      if (!esDestinoStaff) {
        const targetCli = clientesDisponibles.find(
          (c) =>
            String(c.nombre).toUpperCase() === destNombre ||
            String(c.seudonimo).toUpperCase() === destNombre ||
            String(c.id) === destNombre
        );

        if (!targetCli) {
          emitirToast(`No se encontró al usuario @${destNombre} para mensaje directo`, "warning");
          setEnviando(false);
          return;
        }
        targetId = String(targetCli.id);
        nombreDestino = `@${targetCli.nombre || destNombre}`;
      }

      const msgDm: MensajeSala = {
        id: msgId,
        grupo_id: grupoActivoId,
        autor_id: sesion.id,
        autor_nombre: sesion.nombre,
        autor_rol: sesion.esOperadorOAdmin ? "OPERADOR" : "JUGADOR",
        texto: `🔒 (DM para ${nombreDestino}): ${dmTexto}`,
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
    // BLOQUEO DE INTERCAMBIO DE CONTACTO EXTERNO ENTRE CLIENTES EN SALAS PÚBLICAS
    // ────────────────────────────────────────────────────────────────────────
    const PATRON_CONTACTO_EXTERNO = /(?:\+?58\s*4\d{2}|\b0?4\d{2})[-.\s]?\d{3}[-.\s]?\d{4}|\b\d{7,11}\b|wa\.me\/|chat\.whatsapp\.com|api\.whatsapp\.com|t\.me\/|telegram\.me/i;
    if (!sesion.esOperadorOAdmin && PATRON_CONTACTO_EXTERNO.test(texto)) {
      emitirToast("⛔ Por seguridad, no está permitido compartir datos de contacto entre usuarios en la sala. Contacta al Administrador o a los Operadores.", "warning");
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

      // ABRIR CARRERA (Segmentado por Hipódromo del Chat y alimenta la BD)
      if (cmdOp.tipo === "ABRIR_CARRERA") {
        const salaSeleccionada = salas.find((s) => s.id === grupoActivoId);
        const hipoChat =
          salaSeleccionada?.hipodromo ||
          (salaSeleccionada?.nombre?.toUpperCase().includes("RINCONADA") ? "LA RINCONADA" : null) ||
          (salaSeleccionada?.nombre?.toUpperCase().includes("VALENCIA") ? "VALENCIA" : null);

        const hipoNuevo = cmdOp.hipodromo || hipoChat || carreraActiva.hipodromo || "LA RINCONADA";
        const cNum = cmdOp.carrera;
        const fechaHoy = new Date().toISOString().slice(0, 10);

        setCarreraActiva((prev) => ({
          ...prev,
          hipodromo: hipoNuevo,
          carrera: cNum,
          fecha: fechaHoy,
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
            // 1. Alimenta la base de datos de carreras correspondientes
            await supabase.from("carreras").upsert(
              {
                fecha: fechaHoy,
                hipodromo: hipoNuevo,
                carrera: cNum,
                estado: "PROGRAMADA",
                updated_at: nowIso,
              },
              { onConflict: "fecha,hipodromo,carrera" }
            );

            // 2. Alimenta el estado del chat / grupo
            await supabase.from("chat_estado_grupo").upsert(
              {
                grupo_id: grupoActivoId,
                hipodromo: hipoNuevo,
                carrera: cNum,
                fecha: fechaHoy,
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

      // PUBLICAR PIZARRA CONTEXTUAL, LIQUIDAR Y TOTALIZAR INFORME TIPO WHATSAPP
      if (cmdOp.tipo === "PIZARRA") {
        const resLiq = await liquidarCarreraChatP2p({
          grupoId: grupoActivoId,
          pizarra: cmdOp.pizarra,
          operadorNombre: sesion.nombre,
        });

        // Actualizar estado en carreras de la base de datos
        const fechaHoy = new Date().toISOString().slice(0, 10);
        if (supabase) {
          try {
            await supabase
              .from("carreras")
              .update({
                pizarra_oficial: cmdOp.pizarra,
                estado: "FINALIZADA",
                updated_at: nowIso,
              })
              .eq("fecha", carreraActiva.fecha || fechaHoy)
              .eq("hipodromo", carreraActiva.hipodromo)
              .eq("carrera", carreraActiva.carrera);
          } catch {
            /* noop */
          }
        }

        // Generar informe de resultados tipo WhatsApp (quién gana, quién pierde, y totalizado)
        const cabGanador = cmdOp.pizarra.split(/[- ,/]+/)[0]?.trim();
        const ticketsCarrera = tickets.filter(
          (t) =>
            Number(t.carrera) === Number(carreraActiva.carrera) &&
            String(t.hipodromo).toUpperCase().trim() === String(carreraActiva.hipodromo).toUpperCase().trim()
        );

        const balancePorJugador = new Map<string, number>();
        const detallesJugadas: string[] = [];

        for (const t of ticketsCarrera) {
          const ganoJuega = String(t.caballo).trim() === cabGanador;
          const monto = Number(t.monto) || 0;
          if (ganoJuega) {
            balancePorJugador.set(t.juega_nombre, (balancePorJugador.get(t.juega_nombre) || 0) + monto);
            balancePorJugador.set(t.da_nombre, (balancePorJugador.get(t.da_nombre) || 0) - monto);
            detallesJugadas.push(`✅ *Ticket #${t.numero_ticket}*: ${t.juega_nombre} GANA +${monto.toFixed(2)} (#${t.caballo}) vs ${t.da_nombre}`);
          } else {
            balancePorJugador.set(t.da_nombre, (balancePorJugador.get(t.da_nombre) || 0) + monto);
            balancePorJugador.set(t.juega_nombre, (balancePorJugador.get(t.juega_nombre) || 0) - monto);
            detallesJugadas.push(`❌ *Ticket #${t.numero_ticket}*: ${t.da_nombre} COBRA +${monto.toFixed(2)} vs ${t.juega_nombre} (#${t.caballo})`);
          }
        }

        // Consolidación estricta por usuario (un usuario nunca en positivos y negativos a la vez)
        const balanceConsolidado = new Map<string, { nombre: string; balance: number }>();
        for (const [nom, bal] of balancePorJugador.entries()) {
          const norm = String(nom).trim().toUpperCase();
          const prev = balanceConsolidado.get(norm);
          if (!prev) {
            balanceConsolidado.set(norm, { nombre: String(nom).trim(), balance: bal });
          } else {
            prev.balance += bal;
          }
        }
        const positivos = [...balanceConsolidado.values()].filter((x) => x.balance > 0.001).map((x) => [x.nombre, x.balance] as [string, number]);
        const negativos = [...balanceConsolidado.values()].filter((x) => x.balance < -0.001).map((x) => [x.nombre, x.balance] as [string, number]);

        let textoInformeWhatsapp = `🏁 *INFORME OFICIAL DE RESULTADOS Y LIQUIDACIÓN*\n🏇 *${carreraActiva.hipodromo}* · Carrera ${carreraActiva.carrera}\n📅 ${carreraActiva.fecha || fechaHoy}\n🥇 Pizarra Oficial: *${cmdOp.pizarra}* (Ganador: #${cabGanador})\n`;

        if (detallesJugadas.length > 0) {
          textoInformeWhatsapp += `\n📋 *DETALLE DE JUGADAS:*\n` + detallesJugadas.slice(0, 30).join("\n") + `\n`;
        }

        if (positivos.length > 0) {
          textoInformeWhatsapp += `\n🟢 *POSITIVOS (+):*\n` + positivos.map(([nom, bal]) => `• ${nom}: +${bal.toFixed(2)}`).join("\n");
        }
        if (negativos.length > 0) {
          textoInformeWhatsapp += `\n\n🔴 *NEGATIVOS (-):*\n` + negativos.map(([nom, bal]) => `• ${nom}: -${Math.abs(bal).toFixed(2)}`).join("\n");
        }

        const totalVolumen = ticketsCarrera.reduce((acc, t) => acc + Number(t.monto || 0), 0);
        textoInformeWhatsapp += `\n\n📊 *TOTALIZACIÓN:* ${ticketsCarrera.length} tickets liquidados · Volumen Total: ${totalVolumen.toFixed(2)}`;

        const msgReporte: MensajeSala = {
          id: `reporte-${Date.now()}`,
          grupo_id: grupoActivoId,
          autor_id: null,
          autor_nombre: "Agente IA Oficial",
          autor_rol: "BOT",
          texto: textoInformeWhatsapp,
          tipo: "PIZARRA",
          created_at: nowIso,
          esMio: false,
        };

        setMensajes((prev) => [...prev, msgReporte]);
        canalRealtimeRef.current?.send({ type: "broadcast", event: "mensaje_sala", payload: msgReporte });

        if (supabase) {
          try {
            await supabase.from("chat_mensajes_sala").insert([
              {
                id: msgReporte.id,
                grupo_id: grupoActivoId,
                autor_id: null,
                autor_nombre: "Agente IA Oficial",
                autor_rol: "BOT",
                texto: textoInformeWhatsapp,
                tipo: "PIZARRA",
              },
            ]);
          } catch {
            /* noop */
          }
        }

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
        if (!sesion.esOperadorOAdmin && !/ADMIN|OPERADOR|TAQUILLA|CASA|BANCA/i.test(prop.contraparte)) {
          emitirToast("⛔ No se permiten jugadas dirigidas directamente a otros usuarios. Publica tu parada abierta para la sala o dirígela a la Administración.", "warning");
          setEnviando(false);
          return;
        }

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
      texto: texto || "🖼️ [Imagen adjunta]",
      tipo: "TEXTO",
      imagen_url: imagenUrlParaEnviar || undefined,
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
            texto: nuevoMsgUsuario.texto,
            tipo: "TEXTO",
            imagen_url: imagenUrlParaEnviar || null,
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

  // Adjunto de imagen (solo Administrador mediante pegado o selección de archivo)
  const handlePasteImagen = (e: React.ClipboardEvent) => {
    if (!sesion?.esAdmin) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.indexOf("image") !== -1) {
        const blob = item.getAsFile();
        if (blob) {
          const reader = new FileReader();
          reader.onload = (uploadEvent) => {
            const base64 = uploadEvent.target?.result as string;
            setImagenAdjunta(base64);
          };
          reader.readAsDataURL(blob);
          e.preventDefault();
          break;
        }
      }
    }
  };

  const handleSelectImagenArchivo = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!sesion?.esAdmin) return;
    const file = e.target.files?.[0];
    if (file && file.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onload = (uploadEvent) => {
        const base64 = uploadEvent.target?.result as string;
        setImagenAdjunta(base64);
      };
      reader.readAsDataURL(file);
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

  // Cambio interactivo del número de carrera activa
  const handleCambiarNumeroCarrera = async (nuevaCarrera: number) => {
    const cNum = Math.max(1, Math.min(30, nuevaCarrera));
    const hipoActual = carreraActiva.hipodromo || "LA RINCONADA";
    const fechaActual = carreraActiva.fecha || new Date().toISOString().slice(0, 10);

    // 1. Inmediatamente actualizar el número de carrera en la UI
    setCarreraActiva((prev) => ({
      ...prev,
      carrera: cNum,
    }));

    // 2. Consultar en Supabase los datos de esa carrera y sus ejemplares
    if (supabase) {
      try {
        const { data } = await supabase
          .from("carreras")
          .select("id, hipodromo, carrera, estado, distancia, superficie, hora, caballos")
          .eq("fecha", fechaActual)
          .eq("hipodromo", hipoActual)
          .eq("carrera", cNum)
          .maybeSingle();

        const ejs = (data?.caballos as any) || [];
        const nuevoEstado = data?.estado
          ? String(data.estado).toUpperCase() === "CERRADA"
            ? "CERRADA"
            : "ABIERTA"
          : carreraActiva.estado;

        setCarreraActiva((prev) => ({
          ...prev,
          carrera: cNum,
          estado: nuevoEstado as any,
          distancia: data?.distancia || prev.distancia,
          superficie: data?.superficie || prev.superficie,
          hora: data?.hora || prev.hora,
          ejemplares: ejs,
        }));

        // Si es operador o admin, sincronizar chat_estado_grupo para que toda la sala refleje el cambio
        if (sesion?.esOperadorOAdmin) {
          await supabase.from("chat_estado_grupo").upsert(
            {
              grupo_id: grupoActivoId,
              hipodromo: hipoActual,
              carrera: cNum,
              fecha: fechaActual,
              estado: nuevoEstado,
              distancia: data?.distancia || carreraActiva.distancia,
              superficie: data?.superficie || carreraActiva.superficie,
              hora: data?.hora || carreraActiva.hora,
              ejemplares: ejs,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "grupo_id" }
          );
        }
      } catch (e) {
        console.warn("Error actualizando carrera activa:", e);
      }
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
    const authUser = useAuthStore.getState().usuario;
    const nombreOp = useAuthStore.getState().tipoUsuario?.nombre || authUser;
    const clientesFiltrados = clientesDisponibles.filter((c) =>
      c.nombre?.toLowerCase().includes(busquedaCliente.toLowerCase()) ||
      c.seudonimo?.toLowerCase().includes(busquedaCliente.toLowerCase())
    );

    return (
      <div className={`flex ${embebido ? "min-h-full" : "min-h-[100dvh]"} w-full items-center justify-center bg-[#111b21] p-4 text-white font-sans select-none`}>
        <div className="w-full max-w-sm rounded-3xl bg-[#202c33] p-5 shadow-2xl border border-[#2a3942]">
          {/* Barra superior de navegación / salir al sistema */}
          <div className="flex items-center justify-between pb-3 border-b border-[#2a3942]">
            <button
              type="button"
              onClick={() => {
                if (typeof window !== "undefined") window.location.href = "/inicio";
              }}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#8696a0] hover:text-[#00a884] transition-colors"
            >
              <span>←</span>
              <span>Salir al Sistema</span>
            </button>
            <span className="text-[10px] font-black uppercase tracking-wider text-[#00a884] bg-[#00a884]/10 px-2 py-0.5 rounded-full border border-[#00a884]/30">
              Sala de Juegos
            </span>
          </div>

          <div className="flex flex-col items-center gap-2 py-4 text-center border-b border-[#2a3942]">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#00a884] text-white shadow-lg text-2xl">
              🐎
            </div>
            <h1 className="text-base font-bold tracking-tight text-[#e9edef]">Sala de Juegos · Identidad</h1>
            <p className="text-xs text-[#8696a0]">
              Selecciona tu seudónimo o cuenta para ingresar directamente a las apuestas:
            </p>
          </div>

          <div className="mt-4 space-y-3">
            {authUser && (
              <button
                type="button"
                onClick={ingresarComoOperador}
                className="w-full flex items-center justify-between p-2.5 rounded-xl bg-gradient-to-r from-emerald-900/60 to-teal-900/60 hover:from-emerald-800 hover:to-teal-800 border border-emerald-500/40 transition-all text-left shadow-sm"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="h-8 w-8 rounded-full bg-emerald-500/20 border border-emerald-400 flex items-center justify-center text-sm shrink-0">
                    👑
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="text-xs font-black text-white truncate">Operador / Administrador</span>
                    <span className="text-[10px] text-emerald-200 truncate">{nombreOp || authUser}</span>
                  </div>
                </div>
                <span className="text-[11px] font-bold text-emerald-300">Entrar ➔</span>
              </button>
            )}

            <input
              type="text"
              value={busquedaCliente}
              onChange={(e) => setBusquedaCliente(e.target.value)}
              placeholder="Buscar seudónimo o nombre..."
              className="w-full rounded-xl bg-[#111b21] px-4 py-2 text-xs text-[#e9edef] placeholder-[#8696a0] border border-[#2a3942] focus:border-[#00a884] focus:outline-none"
            />

            <div className="max-h-60 overflow-y-auto space-y-1.5 pr-1">
              {clientesFiltrados.length > 0 ? (
                clientesFiltrados.map((cli) => {
                  const displayAlias = cli.seudonimo ? `@${cli.seudonimo}` : cli.nombre;
                  return (
                    <button
                      key={cli.id}
                      type="button"
                      onClick={() => ingresarComoClienteDirecto(cli)}
                      className="w-full flex items-center justify-between p-2 rounded-xl bg-[#111b21] hover:bg-[#1a252c] border border-[#2a3942] hover:border-[#00a884] transition-all text-left"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="h-7 w-7 rounded-full bg-[#00a884]/20 border border-[#00a884]/50 flex items-center justify-center text-xs font-bold text-[#00a884] shrink-0">
                          {cli.seudonimo ? cli.seudonimo.charAt(0).toUpperCase() : cli.nombre ? cli.nombre.charAt(0).toUpperCase() : "👤"}
                        </div>
                        <div className="flex flex-col min-w-0">
                          <span className="text-xs font-bold text-[#e9edef] truncate">{displayAlias}</span>
                          {cli.seudonimo && cli.nombre && cli.seudonimo.toLowerCase() !== cli.nombre.toLowerCase() && (
                            <span className="text-[10px] text-[#8696a0] truncate">{cli.nombre}</span>
                          )}
                        </div>
                      </div>
                      <span className="text-[10px] text-[#00a884] font-semibold shrink-0">Entrar ➔</span>
                    </button>
                  );
                })
              ) : (
                <div className="p-3 text-center text-xs text-[#8696a0]">
                  {clientesDisponibles.length === 0 ? "Cargando clientes registrados..." : "No se encontraron coincidencias."}
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
    <div className={`flex ${alturaRaiz} w-full overflow-hidden bg-[#111b21] antialiased`} style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Helvetica, Arial, sans-serif' }}>
      {/* Panel Izquierdo: Lista de Grupos y Canal Bot */}
      <div
        className={`${
          mostrarGruposMovil ? "fixed inset-0 z-50 flex" : "hidden md:flex"
        } h-full shrink-0`}
      >
        <SalaLeftPanelGrupos
          gruposVenta={gruposVenta}
          grupoSeleccionadoId={grupoSeleccionadoId}
          onCambiarGrupo={(gid) => setGrupoSeleccionadoId(gid)}
          onEditarGrupo={handleEditarGrupo}
          onEliminarGrupo={handleEliminarGrupo}
          salas={salas}
          salaActivaId={grupoActivoId}
          onSeleccionarSala={(sid) => {
            setGrupoActivoId(sid);
            setMostrarGruposMovil(false);
          }}
          onEditarSala={handleEditarSala}
          onEliminarSala={handleEliminarSala}
          nombreUsuario={sesion.nombre}
          esOperadorOAdmin={sesion.esOperadorOAdmin}
          esAdmin={Boolean(sesion.esAdmin)}
          onCrearSala={handleCrearNuevaSala}
        />
      </div>

      {/* Panel Central: Chat Activo con Agente IA */}
      <div className="flex flex-1 flex-col h-full bg-[#0b141a] min-w-0 relative">
        <SalaHeaderWallet
          carreraActiva={carreraActiva}
          saldo={saldoPrivado}
          nombreUsuario={sesion.nombre}
          nombreSala={
            grupoActivoId === "bot-privado"
              ? "Agente IA Oficial (DM)"
              : grupoActivoId === "admin-privado"
              ? "Atención · Administrador / Operadores"
              : (salas.find((s) => s.id === grupoActivoId)?.nombre || "Sala Principal")
          }
          nombreGrupo={gruposVenta.find((g) => String(g.id) === String(grupoSeleccionadoId))?.nombre}
          esOperadorOAdmin={sesion.esOperadorOAdmin}
          tamanoLetra={tamanoLetra}
          onCambiarTamanoLetra={handleCambiarTamanoLetra}
          onTogglePanelDerecho={() => setPanelDerechoAbierto(!panelDerechoAbierto)}
          panelDerechoAbierto={panelDerechoAbierto}
          onToggleEstadoCarrera={toggleEstadoCarrera}
          onCambiarNumeroCarrera={handleCambiarNumeroCarrera}
          onCerrarSesion={cerrarSesion}
        />

        {/* Feed de mensajes sin barra de desplazamiento */}
        <div
          className="flex-1 overflow-y-auto no-scrollbar p-3 sm:p-4 space-y-2 bg-[#0b141a]"
          style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
        >
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
                onCitar={handleCitarMensaje}
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

        {/* Barra Inferior Fija de Input */}
        <div className="flex flex-col bg-[#202c33] border-t border-[#222e35]">
          {imagenAdjunta && (
            <div className="flex items-center justify-between border-b border-[#2a3942] bg-[#111b21] px-3 py-1.5 text-xs text-[#00a884]">
              <div className="flex items-center gap-2 min-w-0">
                <img src={imagenAdjunta} alt="Vista previa" className="h-8 w-8 rounded object-cover border border-[#00a884]/60" />
                <span className="text-xs font-bold truncate">🖼️ Imagen adjunta (Solo Administrador)</span>
              </div>
              <button
                type="button"
                onClick={() => setImagenAdjunta(null)}
                className="h-5 w-5 rounded-full bg-[#202c33] hover:bg-[#2a3942] text-slate-300 flex items-center justify-center text-xs ml-2 cursor-pointer"
                title="Quitar imagen"
              >
                ✕
              </button>
            </div>
          )}

          <div className="flex items-center gap-2 px-3 py-2">
            <button
              type="button"
              onClick={() => setMostrarGruposMovil(!mostrarGruposMovil)}
              className="md:hidden flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#111b21] text-white hover:bg-[#2a3942] text-sm"
              title="Cambiar de grupo"
            >
              💬
            </button>

            {sesion?.esAdmin && (
              <>
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleSelectImagenArchivo}
                  accept="image/*"
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  title="Adjuntar imagen (Pegando o seleccionando archivo · Solo Administrador)"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#111b21] hover:bg-[#2a3942] text-[#00a884] text-base shadow-sm cursor-pointer active:scale-95 transition-all"
                >
                  📎
                </button>
              </>
            )}

            <input
              ref={inputMensajeRef}
              type="text"
              value={inputTexto}
              onChange={(e) => setInputTexto(e.target.value)}
              onPaste={handlePasteImagen}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  enviarMensaje();
                }
              }}
              placeholder={
                sesion?.esAdmin
                  ? "Escribe al Agente IA (o pega imágenes con Ctrl+V)..."
                  : esCerrada
                  ? "⛔ Carrera cerrada (no se admiten jugadas)..."
                  : "Escribe al Agente IA (ej. Juego 1p 7 100, 50 2n al 1)..."
              }
              className="flex-1 rounded-2xl bg-[#2a3942] px-4 py-2.5 text-sm text-[#e9edef] placeholder-[#8696a0] border border-transparent shadow-sm focus:border-[#00a884] focus:outline-none transition-all"
            />

            <button
              type="button"
              onClick={() => enviarMensaje()}
              disabled={(!inputTexto.trim() && !imagenAdjunta) || enviando}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#00a884] text-white shadow-md hover:bg-[#02906f] active:scale-95 disabled:opacity-40 transition-all cursor-pointer"
            >
              ➤
            </button>
          </div>
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
