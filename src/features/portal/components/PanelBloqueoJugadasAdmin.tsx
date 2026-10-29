"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/core/supabase";
import {
  BLOQUEO_POR_DEFECTO,
  guardarBloqueosJugadas,
  leerBloqueosJugadas,
  MODALIDADES_PORTAL_META,
  type EstadoBloqueoJugadas,
  type ModalidadPortalJugada,
} from "@/features/portal/lib/bloqueo-jugadas";
import { Button } from "@/shared/components/ui/Button";

const toast = (msg: string, tipo: "success" | "warning" | "error" | "info" = "info") =>
  window.dispatchEvent(new CustomEvent("toast", { detail: { msg, tipo } }));

type SolicitudDesbloqueoRow = {
  id: string | number;
  titulo?: string | null;
  mensaje?: string | null;
  cliente_nombre?: string | null;
  created_at?: string | null;
  datos?: {
    modalidad?: ModalidadPortalJugada;
    etiqueta?: string;
    hipodromo?: string | null;
    carrera?: number | string | null;
  } | null;
};

export function PanelBloqueoJugadasAdmin({ compacto = false }: { compacto?: boolean }) {
  const [bloqueos, setBloqueos] = useState<EstadoBloqueoJugadas>({ ...BLOQUEO_POR_DEFECTO });
  const [solicitudes, setSolicitudes] = useState<SolicitudDesbloqueoRow[]>([]);
  const [guardando, setGuardando] = useState(false);
  const [expandido, setExpandido] = useState(!compacto);

  const cargar = useCallback(async () => {
    const est = await leerBloqueosJugadas();
    setBloqueos(est);
    if (supabase) {
      const { data } = await supabase
        .from("notificaciones")
        .select("id, titulo, mensaje, cliente_nombre, created_at, datos")
        .eq("tipo", "solicitud_desbloqueo")
        .eq("estado", "Nueva")
        .order("created_at", { ascending: false })
        .limit(20);
      setSolicitudes((data as SolicitudDesbloqueoRow[]) ?? []);
    }
  }, []);

  useEffect(() => {
    void cargar();
    const handler = (e: Event) => {
      const ev = e as CustomEvent<EstadoBloqueoJugadas>;
      if (ev.detail) setBloqueos(ev.detail);
    };
    window.addEventListener("bloqueos-jugadas-actualizados", handler);
    return () => window.removeEventListener("bloqueos-jugadas-actualizados", handler);
  }, [cargar]);

  const alternarModalidad = async (mod: ModalidadPortalJugada) => {
    const meta = MODALIDADES_PORTAL_META.find((m) => m.id === mod);
    const siguiente: EstadoBloqueoJugadas = {
      ...bloqueos,
      [mod]: !bloqueos[mod],
    };
    setBloqueos(siguiente);
    setGuardando(true);
    await guardarBloqueosJugadas(siguiente);
    setGuardando(false);
    toast(
      siguiente[mod]
        ? `🔒 Venta de ${meta?.etiqueta ?? mod} BLOQUEADA en el Portal de Clientes.`
        : `🔓 Venta de ${meta?.etiqueta ?? mod} DESBLOQUEADA en el Portal de Clientes.`,
      siguiente[mod] ? "warning" : "success"
    );
  };

  const cambiarTodas = async (bloquear: boolean) => {
    const siguiente: EstadoBloqueoJugadas = {
      marcas: bloquear,
      tablas_fijas: bloquear,
      puestos: bloquear,
      remates: bloquear,
      dupletas: bloquear,
      pollas: bloquear,
    };
    setBloqueos(siguiente);
    setGuardando(true);
    await guardarBloqueosJugadas(siguiente);
    setGuardando(false);
    toast(
      bloquear
        ? "🔒 Todas las jugadas del Portal fueron BLOQUEADAS."
        : "🔓 Todas las jugadas del Portal fueron DESBLOQUEADAS.",
      bloquear ? "warning" : "success"
    );
  };

  const atenderSolicitud = async (sol: SolicitudDesbloqueoRow, desbloquear: boolean) => {
    const mod = sol.datos?.modalidad;
    if (desbloquear && mod) {
      const siguiente: EstadoBloqueoJugadas = { ...bloqueos, [mod]: false };
      setBloqueos(siguiente);
      await guardarBloqueosJugadas(siguiente);
    }
    if (supabase) {
      await supabase.from("notificaciones").update({ estado: "Atendida" }).eq("id", sol.id);
    }
    setSolicitudes((prev) => prev.filter((s) => s.id !== sol.id));
    toast(
      desbloquear
        ? `🔓 Se desbloqueó ${sol.datos?.etiqueta ?? "la modalidad"} solicitada por ${sol.cliente_nombre ?? "el jugador"}.`
        : "Solicitud marcada como atendida.",
      "success"
    );
  };

  const cantBloqueadas = MODALIDADES_PORTAL_META.filter((m) => bloqueos[m.id]).length;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-950 px-4 py-2.5 text-white">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm">🛡️</span>
          <span className="text-xs font-black uppercase tracking-wider">
            Control de Venta de Jugadas (Portal de Clientes)
          </span>
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${
              cantBloqueadas > 0
                ? "bg-amber-400 text-slate-950"
                : "bg-emerald-500/25 text-emerald-200 border border-emerald-400/40"
            }`}
          >
            {cantBloqueadas > 0
              ? `🔒 ${cantBloqueadas} bloqueada(s)`
              : "🔓 Todas habilitadas"}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={guardando}
            onClick={() => void cambiarTodas(false)}
            className="rounded-lg bg-emerald-600 hover:bg-emerald-500 px-2.5 py-1 text-[10px] font-black uppercase text-white transition"
          >
            🔓 Desbloquear todas
          </button>
          <button
            type="button"
            disabled={guardando}
            onClick={() => void cambiarTodas(true)}
            className="rounded-lg bg-rose-600 hover:bg-rose-500 px-2.5 py-1 text-[10px] font-black uppercase text-white transition"
          >
            🔒 Bloquear todas
          </button>
          {compacto && (
            <button
              type="button"
              onClick={() => setExpandido((v) => !v)}
              className="rounded-lg bg-white/10 hover:bg-white/20 px-2 py-1 text-[10px] font-bold text-white"
            >
              {expandido ? "Ocultar ▴" : "Configurar ▾"}
            </button>
          )}
        </div>
      </div>

      {expandido && (
        <div className="p-3.5 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            {MODALIDADES_PORTAL_META.map((m) => {
              const bloqueada = Boolean(bloqueos[m.id]);
              return (
                <button
                  key={m.id}
                  type="button"
                  disabled={guardando}
                  onClick={() => void alternarModalidad(m.id)}
                  className={`flex flex-col justify-between rounded-xl border p-2.5 text-left transition-all ${
                    bloqueada
                      ? "border-rose-300 bg-rose-50/90 hover:bg-rose-100/80"
                      : "border-emerald-300 bg-emerald-50/70 hover:bg-emerald-100/70"
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-base leading-none">{m.icono}</span>
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[9px] font-black uppercase ${
                        bloqueada
                          ? "bg-rose-600 text-white"
                          : "bg-emerald-600 text-white"
                      }`}
                    >
                      {bloqueada ? "🔒 Bloqueada" : "🔓 Activa"}
                    </span>
                  </div>
                  <div className="mt-2">
                    <div className="text-xs font-black text-slate-800">{m.etiqueta}</div>
                    <div className="text-[10px] text-slate-500 line-clamp-1">{m.descripcion}</div>
                  </div>
                </button>
              );
            })}
          </div>

        </div>
      )}
    </div>
  );
}
