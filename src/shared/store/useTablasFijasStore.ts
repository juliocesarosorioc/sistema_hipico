import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { TablaFijaRow } from "@/features/tablas/lib/tablas-fijas";

export type StoredTablaFija = TablaFijaRow & { cerrada: boolean };

export type TablasFijasState = {
  tablas: StoredTablaFija[];
  /** Reemplaza la caché (al cargar el listado publicadas/Abierta). */
  setTablas: (tablas: TablaFijaRow[]) => void;
  /** Marca como Cerrada la tabla de (hipodromo, carrera) — sin refrescar página. */
  marcarCerrada: (hipodromo: string, carrera: number | string) => void;
};

/**
 * Caché de las Tablas Fijas publicadas en la SPA (dashboard/taquilla).
 * La UI se sincroniza vía marcarCerrada(): la tabla desaparece de "Abierta"
 * y se marca "Cerrada" sin necesidad de recargar.
 */
export const useTablasFijasStore = create<TablasFijasState>()(
  persist(
    (set) => ({
      tablas: [],

      setTablas: (tablas) =>
        set({
          tablas: tablas.map((t) => ({
            ...t,
            cerrada: (t.estado ?? "").toLowerCase() === "cerrada",
          })),
        }),

      marcarCerrada: (hipodromo, carrera) => {
        const hip = String(hipodromo ?? "").toUpperCase().replace(/\s+/g, "");
        set((s) => ({
          tablas: s.tablas.map((t) => {
            const th = String(t.hipodromo ?? "").toUpperCase().replace(/\s+/g, "");
            const tc = Number(t.carrera) || 0;
            const nc = Number(carrera) || 0;
            if (th === hip && tc === nc) {
              return { ...t, estado: "Cerrada", cerrada: true };
            }
            return t;
          }),
        }));
      },
    }),
    {
      name: "sistema-hipico:tablas-fijas",
      partialize: (s) => ({ tablas: s.tablas }),
    }
  )
);