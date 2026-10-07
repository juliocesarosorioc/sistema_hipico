"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

/**
 * Barra superior limpia de la SPA (Organismo del layout raíz).
 * Solo notificaciones + cierre de sesión: la navegación vive en el Sidebar izquierdo.
 */
export type TopbarProps = {
  /** Si viene, se dibuja el botón de menú a la izquierda. */
  alAlternarMenu?: () => void;
  /**
   * Estado visible del menú lateral. En escritorio el botón NO lo esconde: lo
   * deja en modo rail (solo íconos), que es como el legacy lo dejaba, así que
   * el rótulo tiene que decir eso y no "ocultar".
   */
  menuVisible?: boolean;
};

type Novedad = {
  id: number | string;
  fecha: string | null;
  modulo: string | null;
  accion: string | null;
  usuario: string | null;
};

const LIMITE = 8;

const fmtMomento = (f: string | null): string => {
  if (!f) return "—";
  const d = new Date(f);
  if (Number.isNaN(d.getTime())) return "—";
  const hoy = new Date();
  const mismoDia = d.toDateString() === hoy.toDateString();
  return mismoDia
    ? d.toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleString("es-VE", { dateStyle: "short", timeStyle: "short" });
};

/**
 * Barra superior de la SPA.
 *
 * Notificaciones + cierre de sesión; la navegación vive en el Sidebar izquierdo,
 * que se deja en modo rail (solo íconos) con el botón de la izquierda.
 *
 * La campana tiene TEXTO a propósito: en el dashboard y en el resto de rutas un
 * ícono suelto no dice nada (y en pantallas chicas se pierde del todo). Por eso
 * muestra "Novedades" + cuántas hay, y el desplegable lista la auditoría real en
 * vez del "sin actividad" de antes: el panel de Seguridad existe y escribe
 * `public.auditoria`, así que lo que llega a la campana son hechos, no un adorno.
 */
export function Topbar({ alAlternarMenu, menuVisible = true }: TopbarProps = {}) {
  const [abierto, setAbierto] = useState(false);
  const [novedades, setNovedades] = useState<Novedad[]>([]);
  const [cargando, setCargando] = useState(false);

  const cargarNovedades = useCallback(async () => {
    if (!supabase) {
      setNovedades([]);
      return;
    }
    setCargando(true);
    try {
      const { data } = await supabase
        .from("auditoria")
        .select("id, fecha, modulo, accion, usuario")
        .order("fecha", { ascending: false })
        .limit(LIMITE);
      setNovedades((data ?? []) as Novedad[]);
    } catch {
      setNovedades([]);
    } finally {
      setCargando(false);
    }
  }, []);

  // Se lee al abrir la campana, no en cada render: son filas del log de todo el
  // sistema y no tienen por qué viajar en cada navegación.
  useEffect(() => {
    if (!abierto) return;
    void cargarNovedades();
  }, [abierto, cargarNovedades]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!(e.target as HTMLElement)?.closest?.("[data-campana]")) setAbierto(false);
    };
    if (abierto) document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [abierto]);

  const cerrarSesion = () => {
    try {
      localStorage.removeItem("club_sesion_activa");
    } catch {
      /* sinop */
    }
    window.location.assign("/");
  };

  const total = novedades.length;

  return (
    <header className="sticky top-0 z-40 flex h-[50px] shrink-0 items-center gap-2 border-b border-line bg-surface/90 px-4 backdrop-blur">
      {alAlternarMenu && (
        <button
          type="button"
          onClick={alAlternarMenu}
          aria-label={menuVisible ? "Ocultar los textos del menú (dejar solo íconos)" : "Mostrar el menú completo"}
          aria-expanded={menuVisible}
          title={menuVisible ? "Ocultar los textos del menú" : "Mostrar el menú completo"}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line bg-surface text-lg leading-none text-slate-600 transition-colors hover:bg-surfaceAlt"
        >
          <span aria-hidden="true">{menuVisible ? "✕" : "☰"}</span>
        </button>
      )}

      {/* Campana de novedades: auditoría reciente del sistema. */}
      <div className="relative" data-campana>
        <button
          type="button"
          aria-label={`Novedades del sistema (${total} ${total === 1 ? "registro" : "registros"})`}
          aria-expanded={abierto}
          onClick={() => setAbierto((v) => !v)}
          title="Novedades del sistema"
          className="inline-flex h-9 items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 text-xs font-bold text-slate-700 transition-colors hover:bg-surfaceAlt"
        >
          <span className="relative text-base leading-none">
            🔔
            <span
              className={`absolute -right-1 -top-1 h-2 w-2 rounded-full ${
                total ? "bg-red-500" : "bg-slate-300"
              }`}
            />
          </span>
          <span className="hidden sm:inline">Novedades</span>
          {total > 0 && (
            <span className="rounded-full bg-red-500 px-1.5 text-[10px] font-black leading-4 text-white">
              {total}
            </span>
          )}
        </button>
        {abierto && (
          <div className="absolute left-0 top-11 z-50 w-80 overflow-hidden rounded-2xl border border-line bg-white shadow-2xl">
            <div className="flex items-center justify-between bg-slate-800 px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-white">
              <span>🔔 Novedades</span>
              <span className="text-[10px] font-semibold normal-case tracking-normal text-slate-300">
                auditoría
              </span>
            </div>
            <div className="max-h-72 overflow-y-auto">
              {cargando && (
                <p className="px-4 py-4 text-center text-[11px] italic text-slate-400">Cargando…</p>
              )}
              {!cargando && novedades.length === 0 && (
                <p className="px-4 py-4 text-center text-[11px] italic text-slate-500">
                  Sin actividad reciente por ahora.
                </p>
              )}
              {!cargando &&
                novedades.map((n) => (
                  <div key={n.id} className="border-b border-line/60 px-4 py-2 last:border-b-0">
                    <p className="text-[11px] font-black uppercase tracking-wide text-slate-700">
                      {n.accion || "Actividad"}
                      {n.modulo ? <span className="font-semibold text-slate-400"> · {n.modulo}</span> : null}
                    </p>
                    <p className="text-[10px] font-semibold text-slate-500">
                      {n.usuario || "sistema"} · {fmtMomento(n.fecha)}
                    </p>
                  </div>
                ))}
            </div>
            <div className="border-t border-line bg-gray-50 px-4 py-2 text-[10px] font-semibold text-slate-600">
              <Link href="/seguridad?pestana=auditoria" className="hover:underline">
                Ver la auditoría completa →
              </Link>
            </div>
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={cerrarSesion}
        className="inline-flex items-center gap-1.5 rounded-lg border border-danger-500/40 bg-danger-500/10 px-3 py-1.5 text-xs font-bold text-danger-600 transition-colors hover:bg-danger-500 hover:text-white"
      >
        <span aria-hidden="true">⏻</span>
        <span className="hidden sm:inline">Cerrar Sesión</span>
      </button>
    </header>
  );
}

export default Topbar;
