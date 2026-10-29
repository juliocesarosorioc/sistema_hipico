/**
 * Tipos oficiales para el Gestor de Soporte, Mensajería Inteligente y Tickets de Incidencias.
 */

export type CategoriaTicket =
  | "duda_plataforma"
  | "disputa_jugada"
  | "ajuste_saldo"
  | "carrera_liquidacion"
  | "error_sistema"
  | "otro";

export type PrioridadTicket = "baja" | "media" | "alta" | "urgente";

export type EstadoTicket = "abierto" | "en_proceso" | "resuelto" | "cerrado";

export type RolEmisorTicket = "operador" | "dueno" | "taquillero" | "admin" | "cliente";

export interface MensajeTicket {
  id: string;
  autorId: string;
  autorNombre: string;
  autorRol: "usuario" | "ia" | "admin" | "dueno";
  texto: string;
  fecha: string; // ISO
  esIa?: boolean;
  adjuntoUrl?: string;
}

export interface EmisorTicket {
  id: string;
  nombre: string;
  rol: RolEmisorTicket;
  grupoId: string | null;
  grupoNombre: string | null;
  telefono?: string;
  email?: string;
}

export interface TicketIncidencia {
  id: string;
  codigo: string; // e.g. "INC-26-0042"
  titulo: string;
  descripcion: string;
  categoria: CategoriaTicket;
  prioridad: PrioridadTicket;
  estado: EstadoTicket;
  emisor: EmisorTicket;
  destinatario: "admin" | "dueno_grupo";
  mensajes: MensajeTicket[];
  carreraId?: string;
  jugadaId?: string;
  fechaCreacion: string; // ISO
  fechaActualizacion: string; // ISO
  resueltoPor?: {
    id: string;
    nombre: string;
    rol: string;
  };
  fechaResolucion?: string;
  resolucionNota?: string;
}

export interface ConsultaIaRespuesta {
  respuesta: string;
  resuelto: boolean;
  sugerenciaEscalamiento: boolean;
  categoriaDetectada?: CategoriaTicket;
  prioridadDetectada?: PrioridadTicket;
  accionesSugeridas?: {
    titulo: string;
    accion: () => void | string;
    tipo: "enlace" | "comando" | "escalar";
  }[];
}
