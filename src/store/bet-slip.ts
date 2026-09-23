import { create } from "zustand";
import { persist } from "zustand/middleware";

export type JugadaBase = {
  hipodromo: string;
  carrera: string;
  tipo_jugada: string;
  caballo: string;
  monto: number;
  fechas: string[];
};

export type BetSlipEntry = JugadaBase & {
  id: string;
  cruces: number;
  cuota: number | null;
  total: number;
  addedAt: number;
};

export type BetSlipState = {
  entries: BetSlipEntry[];
  isOpen: boolean;
  isDocked: boolean;
  lastAddedId: string | null;
  flashTotal: boolean;
  add: (j: JugadaBase, cuota?: number | null) => void;
  remove: (id: string) => void;
  clear: () => void;
  setMonto: (id: string, monto: number) => void;
  setOpen: (open: boolean) => void;
  setDocked: (docked: boolean) => void;
  markFlash: () => void;
};

function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

/**
 * Store global del Bet Slip (Boleto de Apuestas).
 * Vive en el layout raíz → persiste entre rutas (SPA sin recarga).
 * persist() mantiene el boleto en localStorage entre sesiones.
 */
export const useBetSlipStore = create<BetSlipState>()(
  persist(
    (set) => ({
      entries: [],
      isOpen: false,
      isDocked: false,
      lastAddedId: null,
      flashTotal: false,

      add: (j, cuota = null) =>
        set((s) => {
          const entry: BetSlipEntry = {
            ...j,
            id: uid(),
            cruces: 1,
            cuota,
            total: j.monto,
            addedAt: Date.now(),
          };
          return {
            entries: [...s.entries, entry],
            isOpen: true,
            lastAddedId: entry.id,
            flashTotal: true,
          };
        }),

      remove: (id) =>
        set((s) => ({
          entries: s.entries.filter((e) => e.id !== id),
          lastAddedId: null,
        })),

      clear: () => set({ entries: [], lastAddedId: null }),

      setMonto: (id, monto) =>
        set((s) => ({
          entries: s.entries.map((e) =>
            e.id === id ? { ...e, monto, total: monto * e.cruces } : e
          ),
        })),

      setOpen: (open) => set({ isOpen: open }),
      setDocked: (docked) => set({ isDocked: docked }),

      // Dispara evento (para listeners externos) y pone flag para CSS flash.
      markFlash: () => set({ flashTotal: true }),
    }),
    {
      name: "sistema-hipico:bet-slip",
      partialize: (s) => ({
        entries: s.entries,
        isOpen: s.isOpen,
        isDocked: s.isDocked,
      }),
    }
  )
);
