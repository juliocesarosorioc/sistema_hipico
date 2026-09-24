"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuthStore } from "@/store/useAuthStore";
import { Guard } from "@/components/ui/Guard";

type Item = { href?: string; emoji: string; txt: string };

/** Menú lateral clonado del legacy (js/components/layout.js → GRUPOS). */
const GRUPOS: Array<{ id: string; titulo: string; items: Item[] }> = [
  {
    id: "hipico",
    titulo: "Módulo Hípico",
    items: [
      { href: "/dashboard", emoji: "🏠", txt: "Inicio / Dashboard" },
      { href: "/gestion-jugadas", emoji: "🎟️", txt: "Gestión de Jugadas" },
      { href: "/tablas-fijas", emoji: "📋", txt: "Tablas Fijas" },
      { href: "/dupleta", emoji: "🎯", txt: "Dupletas" },
      { emoji: "🗂️", txt: "Grupos y Convenios" },
      { href: "/ejemplares", emoji: "🐴", txt: "Ejemplares y Gaceta" },
      { emoji: "🏇", txt: "W.P.S." },
      { emoji: "🔔", txt: "Remates" },
      { emoji: "🏆", txt: "Pollas" },
      { emoji: "🛟", txt: "Tickets / Reclamos" },
      { href: "/hipodromos", emoji: "🗺️", txt: "Hipódromos" },
    ],
  },
  {
    id: "contabilidad",
    titulo: "Contabilidad",
    items: [
      { emoji: "📥", txt: "Ingresos / Avales" },
      { emoji: "💵", txt: "Caja Unificada" },
      { emoji: "🏦", txt: "Bancos Reales" },
      { emoji: "🧾", txt: "Liquidación" },
      { emoji: "💱", txt: "Monedas y Tasas" },
    ],
  },
  {
    id: "comunicacion",
    titulo: "Comunicación",
    items: [{ href: "/whatsapp", emoji: "💬", txt: "WhatsApp" }],
  },
  {
    id: "configuracion",
    titulo: "Configuración",
    items: [
      { href: "/clientes", emoji: "👥", txt: "Clientes/Socios" },
      { emoji: "⚙️", txt: "Reglas de Jugadas" },
    ],
  },
  {
    id: "administracion",
    titulo: "Administración",
    items: [
      { emoji: "🛡️", txt: "Seguridad y Accesos", href: "/seguridad" },
      { emoji: "👥", txt: "Operadores" },
      { emoji: "🕘", txt: "Auditoría" },
      { emoji: "🩺", txt: "Diagnóstico" },
    ],
  },
];

const esActiva = (pathname: string, href?: string) =>
  !!href && (href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(href));

/**
 * Menú lateral izquierdo de la SPA (clon del legacy).
 * Fijo: 250px, oscuro. Los módulos aún no migrados se muestran como "Próximamente".
 */
export function Sidebar() {
  const pathname = usePathname();
  const perfiles = useAuthStore((s) => s.perfiles);

  const cerrarSesion = () => {
    try {
      localStorage.removeItem("club_sesion_activa");
    } catch {
      /* sinop */
    }
    window.location.assign("/");
  };

  return (
    <aside
      aria-label="Menú principal"
      className="flex h-full w-[250px] shrink-0 flex-col overflow-hidden bg-slate-900 text-slate-300"
    >
      {/* Encabezado — Club del Dinero + perfil */}
      <div className="border-b border-slate-700/70 p-5">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-wide text-white">
          <span>🪙</span>
          <span>Club del Dinero</span>
        </h1>
        <p className="mt-2 flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          {perfiles.length ? perfiles.join(" · ") : "Administrador Principal"}
        </p>
      </div>

      {/* Navegación por grupos (estructura del legacy) */}
      <nav className="sidebar-scroll flex-1 overflow-y-auto py-2" aria-label="Navegación">
        {GRUPOS.map((g) => (
          <div key={g.id} className="mb-1">
            <p className="px-5 pb-1 pt-4 text-[10px] font-bold uppercase tracking-widest text-slate-500">
              {g.titulo}
            </p>
            <ul>
              {g.items.map((it) => {
                const activo = esActiva(pathname, it.href);
                if (!it.href) {
                  return (
                    <li key={it.txt}>
                      <span
                        aria-disabled
                        title="Próximamente"
                        className="flex select-none items-center gap-3 px-5 py-2.5 text-base font-medium text-slate-600"
                      >
                        <span className="w-6 text-center">{it.emoji}</span>
                        <span className="flex-1">{it.txt}</span>
                        <span className="rounded-full bg-slate-800/80 px-1.5 py-0.5 text-[9px] font-bold uppercase text-slate-500">
                          pronto
                        </span>
                      </span>
                    </li>
                  );
                }
                return (
                  <li key={it.href}>
                    {it.href === "/seguridad" ? (
                      <Guard permiso="administrar_seguridad">
                        <Link
                          href={it.href}
                          className={`flex items-center gap-3 border-l-4 px-5 py-3 text-base font-semibold transition-colors ${
                            activo
                              ? "border-blue-400 bg-blue-600 text-white"
                              : "border-transparent text-slate-300 hover:bg-slate-800 hover:text-white"
                          }`}
                        >
                          <span className="w-6 text-center">{it.emoji}</span>
                          <span>{it.txt}</span>
                        </Link>
                      </Guard>
                    ) : it.href === "/clientes" ? (
                      <Guard permiso="gestionar_clientes">
                        <Link
                          href={it.href}
                          className={`flex items-center gap-3 border-l-4 px-5 py-3 text-base font-semibold transition-colors ${
                            activo
                              ? "border-blue-400 bg-blue-600 text-white"
                              : "border-transparent text-slate-300 hover:bg-slate-800 hover:text-white"
                          }`}
                        >
                          <span className="w-6 text-center">{it.emoji}</span>
                          <span>{it.txt}</span>
                        </Link>
                      </Guard>
                    ) : (
                      <Link
                        href={it.href}
                        className={`flex items-center gap-3 border-l-4 px-5 py-3 text-base font-semibold transition-colors ${
                          activo
                            ? "border-blue-400 bg-blue-600 text-white"
                            : "border-transparent text-slate-300 hover:bg-slate-800 hover:text-white"
                        }`}
                      >
                        <span className="w-6 text-center">{it.emoji}</span>
                        <span>{it.txt}</span>
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Cerrar sistema (paridad con el legacy) */}
      <div className="border-t border-slate-700/70 p-4">
        <button
          type="button"
          onClick={cerrarSesion}
          className="flex w-full items-center gap-3 text-left text-sm font-bold text-red-400 transition-colors hover:text-red-300"
        >
          <span className="w-6 text-center">⏻</span>
          <span>Cerrar Sistema</span>
        </button>
      </div>
    </aside>
  );
}

export default Sidebar;