import { create } from "zustand";
import { persist } from "zustand/middleware";

export type TicketTaquilla = {
  id: string;
  /** Comando crudo tal como lo tipeó el operador (ej. "100 1 y 2n"). */
  comando: string;
  monto: number;
  /** Ganancia proyectada según el motor (mejor escenario neto − monto). */
  gananciaProyectada: number;
  /** Comisión de casa proyectada del mejor escenario. */
  comision: number;
  /** Timestamp (ms) de registro en la sesión. */
  addedAt: number;
};

export type TaquillaState = {
  tickets: TicketTaquilla[];
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