import { create } from "zustand";
import { persist } from "zustand/middleware";
import { MODALIDAD_POR_DEFECTO, type ModalidadTiempo } from "@/features/jugadas/lib/modalidad-tiempo";

export type TicketTaquilla = {
  id: string;
  /** Comando crudo tal como lo tipeó el operador (ej. "100 1 y 2n"). */
  comando: string;
  monto: number;
  /** Número del ejemplar apostado (columna CABALLO) — necesario para NINIS. */
  caballo?: string;
  /** Ganancia proyectada según el motor (mejor escenario neto − monto). */
  gananciaProyectada: number;
  /** Comisión de casa proyectada del mejor escenario. */
  comision: number;
  /** Nombre del CLIENTE 1 (el que "juega") — para la Pre-visualización. */
  cliente1?: string;
  /** Nombre del CLIENTE 2 (el que "da") — para la Pre-visualización. */
  cliente2?: string;
  /** Cobro neto proyectado del CLIENTE 1 (PREMIO/SALDO por jugador). */
  cobro1?: number;
  /** Cobro neto proyectado del CLIENTE 2 (PREMIO/SALDO por jugador). */
  cobro2?: number;
  /** Observación persistida del recorte progresivo de saldo. */
  observacion?: string | null;
  /** Disponible del cliente que juega después de esta línea. */
  saldoRestante?: number | null;
  /** Contexto [Fecha + Hipódromo + N° Carrera] — aislamiento de la vista Taquilla. */
  fecha?: string;
  hipodromo?: string;
  carrera?: number;
  /**
   * id de la fila real en `tickets_apuestas` una vez vendida
   * (club_vender_jugada). Si está, quitar/corregir la jugada debe ANULAR el
   * ticket para devolver el saldo; si no, es una jugada solo de sesión.
   */
  ticketId?: number;
  /** UUID del CLIENTE 1 (el que juega) en el catálogo — a quien se le cobra. */
  cliente1Id?: string;
  /** UUID del CLIENTE 2 (el que da), si está en el catálogo. */
  cliente2Id?: string;
  /** UUID del grupo de cobro congelado en la venta. */
  grupoId?: string;
  /** Timestamp (ms) de registro en la sesión. */
  addedAt: number;
};

export type TaquillaState = {
  tickets: TicketTaquilla[];
  /**
   * Modalidad de TIEMPO de la próxima jugada (PROMPT #4): `EN_VIVO` (por
   * defecto, el comportamiento de siempre) o `ADELANTADA` (cargada antes de que
   * corra la carrera). Es estado de SESIÓN: NO se persiste (el `partialize` de
   * abajo solo guarda `tickets`), así que cada recarga arranca siempre ⚡ En
   * Vivo y nadie queda colgado en "adelantada" sin querer.
   *
   * Compartida por TaquillaModule (barra superior) y BetSlip (junto al comando):
   * los dos pintan el mismo control y reflejan el mismo estado.
   */
  modalidadTiempo: ModalidadTiempo;
  setModalidadTiempo: (m: ModalidadTiempo) => void;
  agregarTicket: (t: Omit<TicketTaquilla, "id" | "addedAt">) => void;
  eliminarTicket: (id: string) => void;
  limpiarTickets: () => void;
};

let CONTADOR = 0;

function uid(): string {
  CONTADOR += 1;
  return String(CONTADOR).padStart(4, "0");
}

/**
 * Store de la Taquilla — tickets vendidos en la sesión actual.
 * Persiste en localStorage vía zustand/persist (mismo patrón que bet-slip).
 */
export const useTaquillaStore = create<TaquillaState>()(
  persist(
    (set) => ({
      tickets: [],
      modalidadTiempo: MODALIDAD_POR_DEFECTO,

      setModalidadTiempo: (m) => set({ modalidadTiempo: m }),

      agregarTicket: (t) =>
        set((s) => ({
          tickets: [...s.tickets, { ...t, id: uid(), addedAt: Date.now() }],
        })),

      eliminarTicket: (id) =>
        set((s) => ({ tickets: s.tickets.filter((x) => x.id !== id) })),

      limpiarTickets: () => set({ tickets: [] }),
    }),
    {
      name: "sistema-hipico:taquilla",
      partialize: (s) => ({ tickets: s.tickets }),
    }
  )
);