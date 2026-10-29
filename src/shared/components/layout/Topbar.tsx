"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/core/supabase";
import { SelectorGrupo } from "@/features/grupos/components/SelectorGrupo";
import { RelojNavegador } from "@/shared/components/layout/RelojNavegador";
import { useAuthStore } from "@/shared/store/useAuthStore";
import { rutaLoginConBasePath, limpiarAlmacenamientoSesionLocal } from "@/features/auth/lib/sesion";
import { ModalGestionRapidaSaldo } from "@/features/contabilidad/components/ModalGestionRapidaSaldo";
import { conCacheBust } from "@/shared/lib/logos";
import { useVersionLogos } from "@/shared/store/useHipodromosStore";
import { listarGruposVenta } from "@/features/grupos/lib/grupos";

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
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [modalSaldoOperador, setModalSaldoOperador] = useState(false);
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

  const salir = useAuthStore((s) => s.salir);
  const modoOperador = useAuthStore((s) => s.modoOperador);
  const setModoOperador = useAuthStore((s) => s.setModoOperador);
  const perfiles = useAuthStore((s) => s.perfiles);
  const grupoId = useAuthStore((s) => s.grupoId);
  const grupoActivo = useAuthStore((s) => s.grupoActivo);
  const grupoNombre = useAuthStore((s) => s.grupoNombre);
  const versionLogos = useVersionLogos();

  const [logoGrupo, setLogoGrupo] = useState<string | null>(null);
  const [nombreGrupo, setNombreGrupo] = useState<string>("");

  useEffect(() => {
    let vivo = true;
    void listarGruposVenta()
      .then((grupos) => {
        if (!vivo) return;
        const idBuscado = grupoId || grupoActivo;
        const encontrado = idBuscado
          ? grupos.find((g) => String(g.id) === String(idBuscado))
          : grupos[0];
        if (encontrado) {
          setNombreGrupo(encontrado.nombre || grupoNombre || "Club del Dinero");
          setLogoGrupo((encontrado as { logo_url?: string | null }).logo_url ?? null);
        } else {
          setNombreGrupo(grupoNombre || "Club del Dinero");
          setLogoGrupo(null);
        }
      })
      .catch(() => {
        if (vivo) {
          setNombreGrupo(grupoNombre || "Club del Dinero");
          setLogoGrupo(null);
        }
      });
    return () => {
      vivo = false;
    };
  }, [grupoId, grupoActivo, grupoNombre, versionLogos]);

  const esOperadorFijo =
    perfiles.length > 0 &&
    perfiles.every((p) => p.toLowerCase().includes("operador")) &&
    !perfiles.some((p) => p.toLowerCase().includes("admin"));

  const [saliendo, setSaliendo] = useState(false);

  /**
   * Cierre de sesión REAL.
   *
   * Antes solo se borraba una clave legacy de localStorage y se recargaba a
   * "/". La sesión de Supabase seguía VIVA en el navegador, así que al volver a
   * entrar `AuthBootstrap` la detectaba y la app arrancaba sola: el operador
   * caía dentro de su módulo sin poder escribir usuario y clave. `salir()` apaga
   * la sesión de Supabase (`auth.signOut`) y borra las cookies del middleware;
   * recién ahí se navega al login.
   */
  const cerrarSesion = async () => {
    if (saliendo) return;
    setSaliendo(true);
    limpiarAlmacenamientoSesionLocal();
    // El redirect va en un `finally` con corte propio: aunque el borrado remoto
    // se demore (o no conteste), el botón SIEMPRE termina en /login respetando
    // el basePath (/apuestas en GitHub Pages) en vez de generar un 404.
    try {
      await salir();
    } catch {
      /* aunque falle el borrado remoto, se sale igual para no quedar atrapado */
    } finally {
      try {
        router.replace("/login");
      } catch {
        /* sinop */
      }
      if (typeof window !== "undefined") {
        window.location.replace(rutaLoginConBasePath());
      }
    }
  };

  const total = novedades.length;

  return (
    <header className="sticky top-0 z-40 flex h-[50px] shrink-0 items-center justify-between gap-2 border-b border-line bg-surface/90 px-3 sm:px-4 backdrop-blur">
      {/* ESPACIO SUPERIOR IZQUIERDO: Menú + LOGO DEL GRUPO */}
      <div className="flex items-center gap-2 min-w-0 shrink-0">
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

        {/* Logo del Grupo en el espacio superior izquierdo */}
        <div
          className="flex items-center gap-2 min-w-0"
          title={`Grupo: ${nombreGrupo || "Club del Dinero"}`}
        >
          <div className="flex h-8 w-8 sm:h-9 sm:w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-300 bg-white p-0.5 shadow-xs">
            {logoGrupo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={conCacheBust(logoGrupo, versionLogos) || logoGrupo}
                alt={`Logo de ${nombreGrupo || "Grupo"}`}
                className="h-full w-full object-contain"
              />
            ) : (
              <span className="text-base sm:text-lg leading-none">🪙</span>
            )}
          </div>
          <div className="hidden lg:flex flex-col min-w-0 max-w-[140px] xl:max-w-[180px]">
            <span className="truncate text-xs font-black tracking-tight text-slate-900 leading-tight">
              {nombreGrupo || "Club del Dinero"}
            </span>
            <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 leading-none">
              {esOperadorFijo || modoOperador ? "Operador" : "Banca Activa"}
            </span>
          </div>
        </div>
      </div>

      {/* Controles y módulos de la barra superior */}
      <div className="flex items-center gap-2 min-w-0 overflow-x-auto">

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
        onClick={() => {
          if (esOperadorFijo) {
            router.push("/apuestas");
            return;
          }
          const nuevo = !modoOperador;
          setModoOperador(nuevo);
          if (nuevo) {
            router.push("/apuestas");
          }
        }}
        title={
          modoOperador
            ? "Modo Operador Activo: Solo muestra 🐎🎲 Apuestas y 💵📑 Reportes. Clic para volver a Vista Completa."
            : "Cambiar a Vista Operador (ingresa directo a la vista de operador en 🐎🎲 Apuestas)"
        }
        className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-black transition-colors ${
          modoOperador
            ? "border-amber-500 bg-amber-500/15 text-amber-800 hover:bg-amber-500/25"
            : "border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200"
        }`}
      >
        <span>{modoOperador ? "🐎🎲 VISTA: OPERADOR" : "🛡️ VISTA: COMPLETA"}</span>
      </button>

      {modoOperador && (
        <button
          type="button"
          onClick={() => setModalSaldoOperador(true)}
          title="Gestión rápida de saldos de clientes (Incrementar / Disminuir con capture de comprobante)"
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border-2 border-emerald-600 bg-emerald-600 px-3 text-[11px] font-black text-white shadow-sm transition hover:bg-emerald-700"
        >
          <span>💵</span>
          <span>Gestión Rápida de Saldos</span>
        </button>
      )}

      <SelectorGrupo />

      <RelojNavegador />

      <button
        type="button"
        onClick={() => void cerrarSesion()}
        className="inline-flex items-center gap-1.5 rounded-lg border border-danger-500/40 bg-danger-500/10 px-3 py-1.5 text-xs font-bold text-danger-600 transition-colors hover:bg-danger-500 hover:text-white shrink-0"
      >
        <span aria-hidden="true">⏻</span>
        <span className="hidden sm:inline">Cerrar Sesión</span>
      </button>
      </div>

      <ModalGestionRapidaSaldo
        abierto={modalSaldoOperador}
        onCerrar={() => setModalSaldoOperador(false)}
      />
    </header>
  );
}

export default Topbar;
