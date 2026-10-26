"use client";

import { create } from "zustand";

export type SolicitudConfirmacion = {
  titulo: string;
  mensaje: string;
  detalle?: string;
  detalles?: string[];
  textoConfirmar?: string;
  textoCancelar?: string;
  variante?: "danger" | "warning" | "primary" | "info" | "success";
};

export type NotificacionResultado = {
  titulo: string;
  mensaje: string;
  detalle?: string;
  detalles?: string[];
  tipo?: "success" | "warning" | "error" | "info";
  variante?: "success" | "warning" | "error" | "info";
};

type EstadoInteraccionOperador = {
  confirmacionActiva: (SolicitudConfirmacion & { resolver: (ok: boolean) => void }) | null;
  resultadoActivo: (NotificacionResultado & { resolver: () => void }) | null;
  solicitarConfirmacion: (opts: SolicitudConfirmacion) => Promise<boolean>;
  notificarTareaEjecutada: (opts: NotificacionResultado) => Promise<void>;
  confirmarAccion: () => void;
  cancelarAccion: () => void;
  aceptarResultado: () => void;
};

export const useInteraccionOperadorStore = create<EstadoInteraccionOperador>((set, get) => ({
  confirmacionActiva: null,
  resultadoActivo: null,

  solicitarConfirmacion: (opts) =>
    new Promise<boolean>((resolve) => {
      set({
        confirmacionActiva: {
          ...opts,
          resolver: resolve,
        },
      });
    }),

  notificarTareaEjecutada: (opts) =>
    new Promise<void>((resolve) => {
      set({
        resultadoActivo: {
          ...opts,
          resolver: resolve,
        },
      });
    }),

  confirmarAccion: () => {
    const actual = get().confirmacionActiva;
    set({ confirmacionActiva: null });
    if (actual) actual.resolver(true);
  },

  cancelarAccion: () => {
    const actual = get().confirmacionActiva;
    set({ confirmacionActiva: null });
    if (actual) actual.resolver(false);
  },

  aceptarResultado: () => {
    const actual = get().resultadoActivo;
    set({ resultadoActivo: null });
    if (actual) actual.resolver();
  },
}));

export function solicitarConfirmacionOperador(opts: SolicitudConfirmacion): Promise<boolean> {
  return useInteraccionOperadorStore.getState().solicitarConfirmacion({
    ...opts,
    detalle: opts.detalle ?? (opts.detalles?.length ? opts.detalles.join(" · ") : undefined),
  });
}

export function notificarTareaEjecutadaOperador(opts: NotificacionResultado): Promise<void> {
  return useInteraccionOperadorStore.getState().notificarTareaEjecutada({
    ...opts,
    tipo: opts.tipo ?? opts.variante ?? "success",
    detalle: opts.detalle ?? (opts.detalles?.length ? opts.detalles.join(" · ") : undefined),
  });
}
