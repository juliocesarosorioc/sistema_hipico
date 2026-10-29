/**
 * Gestor de Persistencia y Sincronización de Tickets de Incidencias.
 * Soporta almacenamiento local en localStorage con sincronización de eventos reactivos
 * y fallback estructurado para operadores, dueños de grupo y administradores.
 */

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

// Tickets de demostración iniciales para que el Administrador y Dueño vean el funcionamiento de inmediato
const TICKETS_SEMILLA: TicketIncidencia[] = [
  {
    id: "tk-seed-001",
    codigo: "INC-26-0101",
    titulo: "Duda sobre liquidación de jugada 2P con ejemplares 3y4",
    descripcion: "El operador pregunta cómo se reparte si el ejemplar 4 llega segundo y el 3 llega primero.",
    categoria: "disputa_jugada",
    prioridad: "media",
    estado: "abierto",
    emisor: {
      id: "usr-op-1",
      nombre: "Carlos Taquilla 1",
      rol: "operador",
      grupoId: "grp-1",
      grupoNombre: "Club del Dinero",
      telefono: "+58 412 1234567",
    },
    destinatario: "dueno_grupo",
    mensajes: [
      {
        id: "msg-1",
        autorId: "usr-op-1",
        autorNombre: "Carlos Taquilla 1",
        autorRol: "usuario",
        texto: "Buenas tardes, tengo una duda con la jugada 2P de 3y4 en la carrera 3 de La Rinconada. El 3 ganó y el 4 llegó segundo. ¿Cómo liquida?",
        fecha: new Date(Date.now() - 3600000 * 3).toISOString(),
      },
      {
        id: "msg-2",
        autorId: "ia-bot",
        autorNombre: "Asistente IA",
        autorRol: "ia",
        esIa: true,
        texto: "En jugadas de puestos con varios ejemplares (3y4), el sistema toma la mejor posición alcanzada (1° lugar). Dado que mejorPos <= 2, la jugada resulta ganadora (+1 factor).",
        fecha: new Date(Date.now() - 3600000 * 2.9).toISOString(),
      },
      {
        id: "msg-3",
        autorId: "usr-op-1",
        autorNombre: "Carlos Taquilla 1",
        autorRol: "usuario",
        texto: "Entendido, pero el cliente insiste en que le paguen doble porque metió los dos en la pizarra. ¿Puede el dueño confirmar la política del grupo?",
        fecha: new Date(Date.now() - 3600000 * 2).toISOString(),
      },
    ],
    fechaCreacion: new Date(Date.now() - 3600000 * 3).toISOString(),
    fechaActualizacion: new Date(Date.now() - 3600000 * 2).toISOString(),
  },
  {
    id: "tk-seed-002",
    codigo: "INC-26-0102",
    titulo: "Solicitud de ajuste de saldo por transferencia no acreditada",
    descripcion: "El operador reporta que un cliente avalado realizó un pago bancario y solicita acreditar Bs. 500 al cupo.",
    categoria: "ajuste_saldo",
    prioridad: "urgente",
    estado: "abierto",
    emisor: {
      id: "usr-op-2",
      nombre: "María Taquilla Central",
      rol: "operador",
      grupoId: "grp-1",
      grupoNombre: "Club del Dinero",
      telefono: "+58 414 9876543",
    },
    destinatario: "admin",
    mensajes: [
      {
        id: "msg-4",
        autorId: "usr-op-2",
        autorNombre: "María Taquilla Central",
        autorRol: "usuario",
        texto: "URGENTE: El cliente Pedro Pérez (Avalado) envió capture de pago móvil por Bs. 500,00 ref #98321. Por favor verificar y liberar el saldo en taquilla.",
        fecha: new Date(Date.now() - 3600000 * 1).toISOString(),
      },
    ],
    fechaCreacion: new Date(Date.now() - 3600000 * 1).toISOString(),
    fechaActualizacion: new Date(Date.now() - 3600000 * 1).toISOString(),
  },
];

// Memoria de respaldo para entornos sin window (pruebas unitarias, SSR)
let memoriaSsr: TicketIncidencia[] = [...TICKETS_SEMILLA];

/**
 * Lee la lista completa de tickets almacenados.
 */
export function obtenerTodosLosTickets(): TicketIncidencia[] {
  if (typeof window === "undefined") return memoriaSsr;

  try {
    const raw = localStorage.getItem(CLAVE_STORAGE);
    if (!raw) {
      localStorage.setItem(CLAVE_STORAGE, JSON.stringify(TICKETS_SEMILLA));
      return TICKETS_SEMILLA;
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    return TICKETS_SEMILLA;
  } catch {
    return TICKETS_SEMILLA;
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
