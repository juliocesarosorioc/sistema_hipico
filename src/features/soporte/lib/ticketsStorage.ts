/**
 * Gestor de Persistencia y Sincronización de Tickets de Incidencias.
 * Soporta almacenamiento local en localStorage con sincronización de eventos reactivos
 * y fallback estructurado para operadores, dueños de grupo y administradores.
 */

import { supabase } from "@/core/supabase";
import {
  TicketIncidencia,
  EstadoTicket,
  CategoriaTicket,
  PrioridadTicket,
  MensajeTicket,
  EmisorTicket,
} from "../types/soporte";

const CLAVE_STORAGE = "hipico_tickets_soporte_v2";
export const EVENTO_TICKETS_ACTUALIZADOS = "hipico_tickets_actualizados";

// Sin semillas ficticias para no generar alertas falsas al operador/administrador
const TICKETS_SEMILLA: TicketIncidencia[] = [];

// Memoria de respaldo para entornos sin window (pruebas unitarias, SSR)
let memoriaSsr: TicketIncidencia[] = [];

let sincronizacionEnCurso = false;

/**
 * Sincroniza solicitudes de desbloqueo pendientes de la base de datos Supabase con la lista de tickets.
 */
export async function sincronizarTicketsConSupabase(): Promise<void> {
  if (typeof window === "undefined" || !supabase || sincronizacionEnCurso) return;
  sincronizacionEnCurso = true;
  try {
    const { data, error } = await supabase
      .from("notificaciones")
      .select("id, titulo, mensaje, cliente_id, cliente_nombre, datos, created_at, estado")
      .eq("tipo", "solicitud_desbloqueo")
      .order("created_at", { ascending: false })
      .limit(50);

    if (error || !data) return;

    const ticketsActuales = obtenerTodosLosTickets();
    let huboCambios = false;

    for (const noti of data) {
      const idTicket = `desb-${noti.id}`;
      const existe = ticketsActuales.some((t) => t.id === idTicket);
      if (!existe) {
        const d = (noti.datos && typeof noti.datos === "object" ? noti.datos : {}) as Record<string, unknown>;
        const estadoNoti = String(noti.estado || "Nueva").toLowerCase();
        const nuevo: TicketIncidencia = {
          id: idTicket,
          codigo: `DESB-${String(noti.id).padStart(4, "0")}`,
          titulo: noti.titulo || `🔓 Solicitud de desbloqueo: ${d.etiqueta || "Jugada"}`,
          descripcion: noti.mensaje || `El cliente ${noti.cliente_nombre || "Jugador"} solicita desbloquear la modalidad.`,
          categoria: "desbloqueo",
          prioridad: "alta",
          estado: estadoNoti === "atendida" || estadoNoti === "resuelta" ? "resuelto" : "abierto",
          emisor: {
            id: String(noti.cliente_id || "cli-0"),
            nombre: String(noti.cliente_nombre || "Cliente"),
            rol: "cliente",
            grupoId: null,
            grupoNombre: null,
          },
          destinatario: "admin",
          mensajes: [
            {
              id: `msg-${idTicket}-1`,
              autorId: String(noti.cliente_id || "cli-0"),
              autorNombre: String(noti.cliente_nombre || "Cliente"),
              autorRol: "usuario",
              texto: noti.mensaje || "Solicitud de desbloqueo de modalidad.",
              fecha: noti.created_at || new Date().toISOString(),
            },
          ],
          fechaCreacion: noti.created_at || new Date().toISOString(),
          fechaActualizacion: noti.created_at || new Date().toISOString(),
        };
        ticketsActuales.unshift(nuevo);
        huboCambios = true;
      }
    }

    if (huboCambios) {
      guardarTickets(ticketsActuales);
    }
  } catch {
    // ignore
  } finally {
    sincronizacionEnCurso = false;
  }
}

/**
 * Lee la lista completa de tickets almacenados.
 */
export function obtenerTodosLosTickets(): TicketIncidencia[] {
  if (typeof window === "undefined") return memoriaSsr;

  try {
    const raw = localStorage.getItem(CLAVE_STORAGE);
    if (!raw) {
      localStorage.setItem(CLAVE_STORAGE, JSON.stringify(TICKETS_SEMILLA));
      return [];
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      // Filtrar tickets de demo para que no ensucien la consola de administración
      return parsed.filter((t) => !String(t.id).startsWith("tk-seed-"));
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Guarda los tickets en storage y dispara el evento reactivo en tiempo real.
 */
function guardarTickets(tickets: TicketIncidencia[]): void {
  if (typeof window === "undefined") {
    memoriaSsr = tickets;
    return;
  }

  try {
    localStorage.setItem(CLAVE_STORAGE, JSON.stringify(tickets));
    window.dispatchEvent(
      new CustomEvent(EVENTO_TICKETS_ACTUALIZADOS, {
        detail: { total: tickets.length, timestamp: Date.now() },
      })
    );
  } catch {
    /* sinop */
  }
}

/**
 * Filtra los tickets según criterios de búsqueda y permisos.
 */
export function listarTickets(filtro?: {
  estado?: EstadoTicket | "todos";
  categoria?: CategoriaTicket | "todas";
  prioridad?: PrioridadTicket | "todas";
  grupoId?: string | null;
  busqueda?: string;
  esAdmin?: boolean;
}): TicketIncidencia[] {
  const todos = obtenerTodosLosTickets();

  return todos
    .filter((t) => {
      // Filtro de estado
      if (filtro?.estado && filtro.estado !== "todos" && t.estado !== filtro.estado) {
        return false;
      }
      // Filtro de categoría
      if (filtro?.categoria && filtro.categoria !== "todas" && t.categoria !== filtro.categoria) {
        return false;
      }
      // Filtro de prioridad
      if (filtro?.prioridad && filtro.prioridad !== "todas" && t.prioridad !== filtro.prioridad) {
        return false;
      }
      // Filtro por grupo (si no es admin global y tiene grupoId específico)
      if (!filtro?.esAdmin && filtro?.grupoId && t.emisor.grupoId && t.emisor.grupoId !== filtro.grupoId) {
        return false;
      }
      // Búsqueda de texto libre
      if (filtro?.busqueda && filtro.busqueda.trim() !== "") {
        const q = filtro.busqueda.toLowerCase().trim();
        const coincide =
          t.codigo.toLowerCase().includes(q) ||
          t.titulo.toLowerCase().includes(q) ||
          t.descripcion.toLowerCase().includes(q) ||
          t.emisor.nombre.toLowerCase().includes(q) ||
          (t.emisor.grupoNombre && t.emisor.grupoNombre.toLowerCase().includes(q));
        if (!coincide) return false;
      }
      return true;
    })
    .sort((a, b) => new Date(b.fechaActualizacion).getTime() - new Date(a.fechaActualizacion).getTime());
}

/**
 * Obtiene un ticket individual por su ID o código.
 */
export function obtenerTicketPorId(idOCodigo: string): TicketIncidencia | null {
  const tickets = obtenerTodosLosTickets();
  return tickets.find((t) => t.id === idOCodigo || t.codigo === idOCodigo) || null;
}

/**
 * Cuenta los tickets que requieren atención inmediata (abiertos o en proceso).
 */
export function contarTicketsPendientes(esAdmin: boolean, grupoId?: string | null): number {
  if (typeof window !== "undefined") {
    void sincronizarTicketsConSupabase();
  }
  const tickets = listarTickets({
    estado: "todos",
    esAdmin,
    grupoId,
  });

  return tickets.filter((t) => t.estado === "abierto" || t.estado === "en_proceso").length;
}

/**
 * Crea un nuevo ticket de soporte / incidencia.
 */
export function crearTicketIncidencia(datos: {
  titulo: string;
  descripcion: string;
  categoria: CategoriaTicket;
  prioridad: PrioridadTicket;
  emisor: EmisorTicket;
  destinatario?: "admin" | "dueno_grupo";
  carreraId?: string;
  jugadaId?: string;
  mensajesPreviosIa?: { rol: "usuario" | "ia"; texto: string }[];
}): TicketIncidencia {
  const tickets = obtenerTodosLosTickets();
  const anio = new Date().getFullYear().toString().slice(-2);
  const secuencial = String(tickets.length + 1).padStart(4, "0");
  const codigo = `INC-${anio}-${secuencial}`;
  const ahora = new Date().toISOString();

  const mensajesIniciales: MensajeTicket[] = [];

  // Inyectar el historial previo con el bot IA si existe
  if (datos.mensajesPreviosIa && datos.mensajesPreviosIa.length > 0) {
    datos.mensajesPreviosIa.forEach((m, idx) => {
      mensajesIniciales.push({
        id: `prev-${idx}-${Date.now()}`,
        autorId: m.rol === "ia" ? "bot-ia" : datos.emisor.id,
        autorNombre: m.rol === "ia" ? "Asistente IA" : datos.emisor.nombre,
        autorRol: m.rol === "ia" ? "ia" : "usuario",
        texto: m.texto,
        fecha: ahora,
        esIa: m.rol === "ia",
      });
    });
  }

  // Agregar la consulta o problema actual
  mensajesIniciales.push({
    id: `msg-${Date.now()}`,
    autorId: datos.emisor.id,
    autorNombre: datos.emisor.nombre,
    autorRol: "usuario",
    texto: datos.descripcion,
    fecha: ahora,
  });

  const nuevoTicket: TicketIncidencia = {
    id: `tk-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    codigo,
    titulo: datos.titulo,
    descripcion: datos.descripcion,
    categoria: datos.categoria,
    prioridad: datos.prioridad,
    estado: "abierto",
    emisor: datos.emisor,
    destinatario: datos.destinatario || "admin",
    mensajes: mensajesIniciales,
    carreraId: datos.carreraId,
    jugadaId: datos.jugadaId,
    fechaCreacion: ahora,
    fechaActualizacion: ahora,
  };

  const actualizados = [nuevoTicket, ...tickets];
  guardarTickets(actualizados);
  return nuevoTicket;
}

/**
 * Añade una respuesta al hilo del ticket.
 */
export function responderTicket(
  ticketId: string,
  texto: string,
  autor: { id: string; nombre: string; rol: "admin" | "dueno" | "usuario" | "ia" }
): TicketIncidencia | null {
  const tickets = obtenerTodosLosTickets();
  const idx = tickets.findIndex((t) => t.id === ticketId);
  if (idx === -1) return null;

  const ahora = new Date().toISOString();
  const nuevoMensaje: MensajeTicket = {
    id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    autorId: autor.id,
    autorNombre: autor.nombre,
    autorRol: autor.rol,
    texto: texto.trim(),
    fecha: ahora,
    esIa: autor.rol === "ia",
  };

  const ticket = tickets[idx];
  const estadoActualizado: EstadoTicket =
    autor.rol === "admin" || autor.rol === "dueno"
      ? ticket.estado === "abierto"
        ? "en_proceso"
        : ticket.estado
      : ticket.estado;

  tickets[idx] = {
    ...ticket,
    estado: estadoActualizado,
    fechaActualizacion: ahora,
    mensajes: [...ticket.mensajes, nuevoMensaje],
  };

  guardarTickets(tickets);
  return tickets[idx];
}

/**
 * Cambia el estado del ticket y registra opcionalmente la resolución.
 */
export function cambiarEstadoTicket(
  ticketId: string,
  nuevoEstado: EstadoTicket,
  notaResolucion?: string,
  resueltoPor?: { id: string; nombre: string; rol: string }
): TicketIncidencia | null {
  const tickets = obtenerTodosLosTickets();
  const idx = tickets.findIndex((t) => t.id === ticketId);
  if (idx === -1) return null;

  const ahora = new Date().toISOString();
  const ticket = tickets[idx];

  tickets[idx] = {
    ...ticket,
    estado: nuevoEstado,
    fechaActualizacion: ahora,
    fechaResolucion: nuevoEstado === "resuelto" || nuevoEstado === "cerrado" ? ahora : ticket.fechaResolucion,
    resolucionNota: notaResolucion || ticket.resolucionNota,
    resueltoPor: resueltoPor || ticket.resueltoPor,
  };

  guardarTickets(tickets);
  return tickets[idx];
}
