"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  FactorPista,
  LineaPista,
  EstiloCarrera,
  TendenciaTarde,
  ResultadoCarreraV4,
} from "@/features/inteligencia/lib/analista-venezuela-v4";
import {
  Estrategia5y6,
  CuadroMaestro5y6Resultado,
  generarCuadroMaestro5y6,
} from "@/features/inteligencia/lib/optimizador-5y6";

export type JurisdiccionIH = "VENEZUELA" | "USA";
export type ModoAnaliticoIH = "anticipado" | "en_vivo" | "cuadro_5y6";

export type EstadoInteligenciaHipica = {
  // Nivel 1: Jurisdicción
  jurisdiccion: JurisdiccionIH;
  setJurisdiccion: (j: JurisdiccionIH) => void;

  // Nivel 2: Modo analítico
  modoAnalitico: ModoAnaliticoIH;
  setModoAnalitico: (m: ModoAnaliticoIH) => void;

  // Tendencia de la Tarde (Sesgo en vivo)
  tendenciaTarde: TendenciaTarde;
  aplicarTendenciaTarde: (config: Omit<TendenciaTarde, "activa" | "bonoPuntos">) => void;
  limpiarTendenciaTarde: () => void;

  // Variables tácticas en vivo por carrera/ejemplar
  pesosEnVivo: Record<string, number>; // key: `${carreraId}_${numero}` -> kg
  setPesoEnVivo: (carreraId: string, numero: number, pesoKg: number | null) => void;

  lineasEnVivo: Record<string, LineaPista>; // key: `${carreraId}_${numero}` -> LineaPista
  setLineaEnVivo: (carreraId: string, numero: number, linea: LineaPista) => void;

  // Cuadro Maestro 5y6
  factorMultiplicador5y6: number;
  setFactorMultiplicador5y6: (f: number) => void;
  estrategia5y6: Estrategia5y6;
  setEstrategia5y6: (e: Estrategia5y6) => void;
  presupuestoMaximo5y6: number;
  setPresupuestoMaximo5y6: (p: number) => void;
  seleccionValidas5y6: Record<number, number[]>; // valida 1..6 -> [nums]
  alternarEjemplarEnValida5y6: (valida: number, numero: number) => void;
  limpiarSeleccionValida5y6: (valida: number) => void;
  reiniciarCuadro5y6: () => void;
};

export const useInteligenciaHipicaStore = create<EstadoInteligenciaHipica>()(
  persist(
    (set, get) => ({
      jurisdiccion: "VENEZUELA",
      setJurisdiccion: (jurisdiccion) => set({ jurisdiccion }),

      modoAnalitico: "anticipado",
      setModoAnalitico: (modoAnalitico) => set({ modoAnalitico }),

      tendenciaTarde: {
        activa: false,
        factorPista: "NORMAL",
        varianteSegundos: 0.0,
        carrilDominante: "CENTRO",
        estiloDominante: "E2",
        bonoPuntos: 2.5,
      },

      aplicarTendenciaTarde: (config) =>
        set({
          tendenciaTarde: {
            ...config,
            activa: true,
            bonoPuntos: config.factorPista === "LIGERA" ? 2.8 : 2.5,
          },
        }),

      limpiarTendenciaTarde: () =>
        set({
          tendenciaTarde: {
            activa: false,
            factorPista: "NORMAL",
            varianteSegundos: 0.0,
            carrilDominante: "CENTRO",
            estiloDominante: "E2",
            bonoPuntos: 2.5,
          },
        }),

      pesosEnVivo: {},
      setPesoEnVivo: (carreraId, numero, pesoKg) =>
        set((state) => {
          const key = `${carreraId}_${numero}`;
          const copia = { ...state.pesosEnVivo };
          if (pesoKg === null) {
            delete copia[key];
          } else {
            copia[key] = pesoKg;
          }
          return { pesosEnVivo: copia };
        }),

      lineasEnVivo: {},
      setLineaEnVivo: (carreraId, numero, linea) =>
        set((state) => ({
          lineasEnVivo: {
            ...state.lineasEnVivo,
            [`${carreraId}_${numero}`]: linea,
          },
        })),

      factorMultiplicador5y6: 35.0,
      setFactorMultiplicador5y6: (factorMultiplicador5y6) => set({ factorMultiplicador5y6 }),

      estrategia5y6: "EQUILIBRADO",
      setEstrategia5y6: (estrategia5y6) => set({ estrategia5y6 }),

      presupuestoMaximo5y6: 5000,
      setPresupuestoMaximo5y6: (presupuestoMaximo5y6) => set({ presupuestoMaximo5y6 }),

      seleccionValidas5y6: {},
      alternarEjemplarEnValida5y6: (valida, numero) =>
        set((state) => {
          const actual = state.seleccionValidas5y6[valida] ?? [];
          const existe = actual.includes(numero);
          const nuevaLista = existe ? actual.filter((n) => n !== numero) : [...actual, numero].sort((a, b) => a - b);
          // Al menos 1 ejemplar siempre en cada válida
          if (nuevaLista.length === 0) return state;

          return {
            seleccionValidas5y6: {
              ...state.seleccionValidas5y6,
              [valida]: nuevaLista,
            },
          };
        }),

      limpiarSeleccionValida5y6: (valida) =>
        set((state) => {
          const copia = { ...state.seleccionValidas5y6 };
          delete copia[valida];
          return { seleccionValidas5y6: copia };
        }),

      reiniciarCuadro5y6: () =>
        set({
          seleccionValidas5y6: {},
          estrategia5y6: "EQUILIBRADO",
          factorMultiplicador5y6: 35.0,
        }),
    }),
    {
      name: "ih_store_inteligencia_v4",
      partialize: (state) => ({
        jurisdiccion: state.jurisdiccion,
        modoAnalitico: state.modoAnalitico,
        factorMultiplicador5y6: state.factorMultiplicador5y6,
        estrategia5y6: state.estrategia5y6,
        presupuestoMaximo5y6: state.presupuestoMaximo5y6,
      }),
    }
  )
);
