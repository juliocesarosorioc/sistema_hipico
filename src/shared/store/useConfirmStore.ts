"use client";

import { create } from "zustand";
import { CLASE_MENSAJE, ICONO_MENSAJE, type TipoMensaje } from "@/shared/lib/mensajeria";

/**
 * ============================================================================
 * CONFIRMACIONES — una sola caja de diálogo para TODA la plataforma
 * ============================================================================
 *
 * Reemplaza a `window.confirm`. El navegador lo dibujaba sin estilo, con el
 * texto del sistema, sin ícono por tipo y sin poder explicar el alcance de la
 * acción. Acá la confirmación sale con el mismo lenguaje visual de la
 * mensajería (clases `.msg-*`) y con dos botones propios.
 *
 * Se expone como un store de Zustand + un hook `confirmar()` que devuelve una
 * Promesa<boolean>, para que sea un reemplazo 1:1 del `window.confirm`:
 *
 *   const confirmar = useConfirmar();
 *   const ok = await confirmar({
 *     titulo: "Archivar hipódromo",
 *     mensaje: "...",
 *     tipo: "warning",
 *     textoConfirmar: "Archivar",
 *   });
 *   if (!ok) return;
 *
 * El componente `<ConfirmHost/>` se monta una sola vez (en el layout del shell)
 * y dibuja la caja cuando hay una petición pendiente. Así cualquier módulo,
 * por profundo que esté, abre la misma confirmación.
 */

export type OpcionesConfirmacion = {
  /** Encabezado corto de la acción ("¿Eliminar la dupleta?"). */
  titulo: string;
  /** Cuerpo: qué va a pasar y a qué alcanza. */
  mensaje: string;
  /** Color/ícono del aviso. `warning` por defecto (una acción que borra). */
  tipo?: TipoMensaje;
  /** Texto del botón que confirma. */
  textoConfirmar?: string;
  /** Texto del botón que cancela. */
  textoCancelar?: string;
  /** Marca la acción como destructiva (botón rojo). */
  destructivo?: boolean;
};

type Peticion = OpcionesConfirmacion & { id: number; resolver: (ok: boolean) => void };

type EstadoConfirm = {
  peticion: Peticion | null;
  abrir: (opciones: OpcionesConfirmacion) => Promise<boolean>;
  resolver: (ok: boolean) => void;
};

let contador = 0;

export const useConfirmStore = create<EstadoConfirm>((set, get) => ({
  peticion: null,
  abrir: (opciones) =>
    new Promise<boolean>((resolver) => {
      // Una petición a la vez: si llega otra, se cierra la anterior como
      // cancelada para no dejar promesas colgadas esperando para siempre.
      const anterior = get().peticion;
      if (anterior) anterior.resolver(false);
      set({ peticion: { ...opciones, id: ++contador, resolver } });
    }),
  resolver: (ok) => {
    const p = get().peticion;
    if (p) p.resolver(ok);
    set({ peticion: null });
  },
}));

/**
 * Hook de uso: `const confirmar = useConfirmar();` y `await confirmar({...})`.
 * Fuera de un componente (una función de escritura) se puede llamar
 * `useConfirmStore.getState().abrir({...})`.
 */
export function useConfirmar(): (opciones: OpcionesConfirmacion) => Promise<boolean> {
  return useConfirmStore((s) => s.abrir);
}

/** Datos del botón de confirmar según el tipo (por defecto, advertencia). */
export function estiloConfirmar(tipo: TipoMensaje, destructivo?: boolean): string {
  if (destructivo || tipo === "error") {
    return "bg-rose-600 text-white hover:bg-rose-500";
  }
  if (tipo === "success") {
    return "bg-emerald-600 text-white hover:bg-emerald-500";
  }
  return "bg-amber-600 text-white hover:bg-amber-500";
}

/** Clase del marco/ícono, reexportada por comodidad del componente host. */
export const claseMarcoConfirm = CLASE_MENSAJE;
export const iconoConfirm = ICONO_MENSAJE;
