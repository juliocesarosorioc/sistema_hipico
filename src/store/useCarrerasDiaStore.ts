import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Venta de tablas de una carrera (snapshot por ejemplar vendido). */
export type VentaTablaRegistrada = {
  numero: string;
  nombre: string;
  cantidad: number;
  grupo?: string | null;
  jugador?: string | null;
  tablaId?: string | number;
};

/** Pago automático de las tablas vendidas al confirmar resultados. */
export type PagoTablas = {
  fecha: string;
  totalPagado: number;
  tablasPagadas: number;
};

/**
 * Carrera del día como ESTADO CENTRAL compartido entre módulos
 * (Tablas Fijas / Taquilla / Liquidación): fuente de verdad de resultados,
 * retirados, premio recalculado y pagos de tablas vendidas.
 */
export type CarreraDelDia = {
  fecha: string;
  hipodromo: string;
  carrera: number;
  estado: "Programada" | "Resultados" | "Liquidada";
  ganadores?: string[];
  retirados?: string;
  premio_oficial?: number;
  premio_recalculado?: number;
  aplicado_a_tablas?: boolean;
  cargado_por?: string;
  ventas: VentaTablaRegistrada[];
  pago?: PagoTablas | null;
  updatedAt?: string;
};

export type CarrerasDiaState = {
  carreras: CarreraDelDia[];
  /** Reemplaza el ledger (al sincronizar con Supabase). */
  setCarreras: (carreras: CarreraDelDia[]) => void;
  /** Inserta o actualiza por (fecha, hipodromo, carrera). */
  upsert: (c: CarreraDelDia) => void;
  /** Registra la venta de tablas de un ejemplar en la carrera. */
  agregarVenta: (hipodromo: string, carrera: number | string, v: VentaTablaRegistrada, fecha?: string) => void;
  /** Pagos automáticos: totalPagado = premio_recalculado × tablas ganadoras. */
  pagar: (hipodromo: string, carrera: number | string, premioRecalculado: number, fecha?: string) => void;
  /** Estado derivado para corazones semáforo en la UI. */
  estadoDe: (hipodromo: string, carrera: number | string) => CarreraDelDia | null;
  /** ¿Existe ya esa carrera en el ledger para [fecha + hipódromo]? */
  existeCarrera: (hipodromo: string, carrera: number | string, fecha?: string) => boolean;
};

function clave(h: string, c: number | string): string {
  return `${String(h).trim().toUpperCase()}|${c}`;
}

function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}

export const useCarrerasDiaStore = create<CarrerasDiaState>()(
  persist(
    (set, get) => ({
      carreras: [],

      setCarreras: (carreras) => set({ carreras }),

      upsert: (c) =>
        set((s) => {
          const i = s.carreras.findIndex(
            (x) => clave(x.hipodromo, x.carrera) === clave(c.hipodromo, c.carrera) && x.fecha === (c.fecha || hoy())
          );
          const updated = { ...c, updatedAt: new Date().toISOString() };
          if (i === -1) return { carreras: [...s.carreras, updated] };
          const carreras = [...s.carreras];
          carreras[i] = { ...carreras[i], ...updated };
          return { carreras };
        }),

      agregarVenta: (hipodromo, carrera, v, fecha) =>
        set((s) => {
          const f = fecha || hoy();
          const k = clave(hipodromo, carrera);
          const existente = s.carreras.find(
            (x) => clave(x.hipodromo, x.carrera) === k && x.fecha === f
          );
          const base: CarreraDelDia = existente ?? {
            fecha: f,
            hipodromo: String(hipodromo).trim().toUpperCase(),
            carrera: Number(carrera) || 0,
            estado: "Programada",
            ventas: [],
            pago: null,
          };
          return {
            carreras: [
              ...s.carreras.filter((x) => !(clave(x.hipodromo, x.carrera) === k && x.fecha === f)),
              { ...base, ventas: [...base.ventas, v], estado: base.estado === "Liquidada" ? "Liquidada" : "Programada", updatedAt: new Date().toISOString() },
            ],
          };
        }),

      pagar: (hipodromo, carrera, premioRecalculado, fecha) =>
        set((s) => {
          const f = fecha || hoy();
          const k = clave(hipodromo, carrera);
          const existente = s.carreras.find(
            (x) => clave(x.hipodromo, x.carrera) === k && x.fecha === f
          );
          if (!existente || existente.pago) {
            return {};
          }
          const ganadores = (existente.ganadores ?? []).map(String);
          let tablasPagadas = 0;
          for (const v of existente.ventas) {
            if (v.nombre === "TABLA COMPLETA" || ganadores.includes(String(v.numero))) {
              tablasPagadas += v.cantidad || 1;
            }
          }
          const premio = Number(premioRecalculado) || 0;
          return {
            carreras: [
              ...s.carreras.filter((x) => !(clave(x.hipodromo, x.carrera) === k && x.fecha === f)),
              {
                ...existente,
                estado: "Liquidada",
                aplicado_a_tablas: true,
                pago: { fecha: f, totalPagado: premio * tablasPagadas, tablasPagadas },
                updatedAt: new Date().toISOString(),
              },
            ],
          };
        }),

      estadoDe: (hipodromo, carrera) => {
        const k = clave(hipodromo, carrera);
        return get().carreras.find((x) => clave(x.hipodromo, x.carrera) === k) ?? null;
      },

      existeCarrera: (hipodromo, carrera, fecha) => {
        const f = fecha || hoy();
        const k = clave(hipodromo, carrera);
        return get().carreras.some((x) => clave(x.hipodromo, x.carrera) === k && x.fecha === f);
      },
    }),
    {
      name: "sistema-hipico:carreras-dia",
      partialize: (s) => ({ carreras: s.carreras }),
    }
  )
);