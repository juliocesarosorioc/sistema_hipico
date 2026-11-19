"use client";

import { useEffect, useRef } from "react";
import { supabase } from "@/core/supabase";

type OpcionesRealtimeApuestas = {
  activo?: boolean;
  fecha?: string | null;
  hipodromo?: string | null;
  carrera?: number | string | null;
  /** Si viene definido, limita los eventos al grupo de la caja. */
  grupoId?: string | number | null;
  onCambio: () => void | Promise<void>;
  /** Respaldo cuando la publicación realtime no está habilitada. */
  intervaloRespaldoMs?: number;
};

const COOLDOWN_MS = 450;

/**
 * Mantiene frescas las jugadas de una carrera mientras el modal/visor está abierto.
 * Escucha inserciones y actualizaciones de `tickets_apuestas` (espejo de Taquilla)
 * y de `chat_tickets_fifo` (concreciones del bot), con throttle para no repetir
 * lecturas cuando una concreción escribe en ambas tablas en la misma transacción.
 */
export function useRealtimeApuestasCarrera({
  activo = true,
  fecha,
  hipodromo,
  carrera,
  grupoId,
  onCambio,
  intervaloRespaldoMs = 7000,
}: OpcionesRealtimeApuestas): void {
  const onCambioRef = useRef(onCambio);
  const ultimoDisparo = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enVuelo = useRef(false);
  const canalId = useRef("");

  useEffect(() => {
    onCambioRef.current = onCambio;
  }, [onCambio]);

  if (!canalId.current) {
    canalId.current = `apuestas-rt-${Math.random().toString(36).slice(2, 10)}`;
  }

  useEffect(() => {
    const sb = supabase;
    if (!activo || !sb) return;

    const disparar = () => {
      ultimoDisparo.current = Date.now();
      if (enVuelo.current) return;
      enVuelo.current = true;
      try {
        void Promise.resolve(onCambioRef.current())
          .catch(() => undefined)
          .finally(() => {
            enVuelo.current = false;
          });
      } catch {
        enVuelo.current = false;
      }
    };

    const solicitar = () => {
      const restante = COOLDOWN_MS - (Date.now() - ultimoDisparo.current);
      if (restante <= 0) {
        disparar();
        return;
      }
      if (timer.current) return;
      timer.current = setTimeout(() => {
        timer.current = null;
        disparar();
      }, restante);
    };

    const filtroGrupo = grupoId != null && String(grupoId).trim() !== ""
      ? String(grupoId).trim()
      : null;

    const canal = sb
      .channel(`${canalId.current}-${String(fecha ?? "")}-${String(hipodromo ?? "")}-${String(carrera ?? "")}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "tickets_apuestas",
          ...(filtroGrupo ? { filter: `grupo_cobro_id=eq.${filtroGrupo}` } : {}),
        },
        solicitar
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "chat_tickets_fifo",
          ...(filtroGrupo ? { filter: `grupo_id=eq.${filtroGrupo}` } : {}),
        },
        solicitar
      )
      .subscribe();

    const intervalo = setInterval(solicitar, Math.max(2000, intervaloRespaldoMs));

    return () => {
      clearInterval(intervalo);
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      try {
        void sb.removeChannel(canal);
      } catch {
        /* noop */
      }
    };
  }, [activo, fecha, hipodromo, carrera, grupoId, intervaloRespaldoMs]);
}
