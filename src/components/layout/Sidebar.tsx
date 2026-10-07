"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuthStore } from "@/store/useAuthStore";
import { Guard } from "@/components/ui/Guard";
import { capacidadesDeRuta } from "@/lib/seguridad/capacidades";

type Item = { href?: string; emoji: string; txt: string };

/** Menú lateral clonado del legacy (js/components/layout.js → GRUPOS). */
const GRUPOS: Array<{ id: string; titulo: string; items: Item[] }> = [
  {
    id: "hipico",
    titulo: "Módulo Hípico",
    items: [
      { href: "/inicio", emoji: "🏠", txt: "Inicio / Dashboard" },
      { href: "/gestion-jugadas", emoji: "🎟️", txt: "Gestión de Jugadas" },
      { href: "/jugadas", emoji: "📈", txt: "Monitor de Jugadas" },
      { href: "/tablas-fijas", emoji: "📋", txt: "Tablas Fijas" },
      { href: "/dupleta", emoji: "🎯", txt: "Dupletas" },
      { href: "/marcas", emoji: "🏷️", txt: "Marcas" },
      { href: "/grupos", emoji: "🗂️", txt: "Grupos y Convenios" },
      { href: "/ejemplares", emoji: "🐴", txt: "Ejemplares, Gaceta y Carreras" },
      { emoji: "🏇", txt: "W.P.S." },
      { href: "/remates", emoji: "🔔", txt: "Remates" },
      { href: "/pollas", emoji: "🏆", txt: "Pollas" },
      { href: "/tickets", emoji: "🛟", txt: "Tickets / Reclamos" },
      { href: "/hipodromos", emoji: "🗺️", txt: "Hipódromos" },
    ],
  },
  {
    id: "contabilidad",
    titulo: "Contabilidad",
    items: [
      { href: "/contabilidad/ingresos", emoji: "📥", txt: "Ingresos / Avales" },
      { href: "/contabilidad/caja", emoji: "💵", txt: "Caja Unificada" },
      { href: "/contabilidad/bancos", emoji: "🏦", txt: "Bancos Reales" },
      { href: "/saldos-reportes", emoji: "📊", txt: "Liquidación" },
      { href: "/contabilidad/monedas", emoji: "💱", txt: "Monedas y Tasas" },
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
      { emoji: "🩺", txt: "Diagnóstico", href: "/diagnostico" },
    ],
  },
];

// El href puede traer query (?pestana=auditoria): para comparar contra el
// pathname se usa solo la parte de la ruta.
const esActiva = (pathname: string, href?: string) => {
  if (!href) return false;
  const ruta = href.split("?")[0];
  return ruta === "/inicio" ? pathname === "/inicio" : pathname.startsWith(ruta);
};

export type SidebarProps = {
  /** Escritorio: colapsado a solo iconos. Persistido por AppShell. */
  compacto?: boolean;
  /** Móvil/tablet: drawer deslizante abierto. */
  drawerAbierto?: boolean;
  /**
   * El drawer móvil cerrado se aparta con translate, pero sus enlaces siguen
   * siendo tabulables y el lector de pantalla los anuncia: sin esto se puede
   * saltar al menú "oculto" con el teclado.
   */
  oculto?: boolean;
  /** Al navegar en móvil se cierra el drawer (el legacy lo hacía al cambiar de ruta). */
  onNavegar?: () => void;
};

/**
 * Menú lateral izquierdo de la SPA (clon del legacy).
 *
 * Dos modos, igual que `js/components/layout.js`:
 *   - escritorio (lg+): en el flujo, 250px o colapsado a 64px de iconos;
 *   - móvil/tablet: drawer superpuesto que se cierra con overlay o ESC.
 *
 * El ancho lo resuelve CSS (clases `lg:`), no JavaScript, para que el primer
 * render del servidor y el del cliente coincidan y no haya salto de layout.
 */
export function Sidebar({
  compacto = false,
  drawerAbierto = false,
  oculto = false,
  onNavegar,
}: SidebarProps) {
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
      aria-hidden={oculto ? true : undefined}
      className={[
        "sidebar-scroll z-50 flex h-full shrink-0 flex-col overflow-y-auto overflow-x-hidden bg-slate-900 text-slate-300",
        "transition-[width,transform] duration-200 ease-out",
        // Móvil/tablet: drawer sobre el contenido.
        "fixed inset-y-0 left-0 w-64",
        drawerAbierto ? "translate-x-0" : "-translate-x-full",
        // Escritorio: vuelve al flujo normal. El ancho sale de UNA sola clase
        // según el modo: con `lg:w-[250px]` y `lg:w-16` a la vez ganaba la
        // arbitraria y el menú "oculto" se quedaba en 250px con los textos
        // tapados, es decir, ni rail de iconos ni menú normal.
        "lg:static lg:translate-x-0",
        compacto ? "lg:w-16" : "lg:w-[250px]",
      ].join(" ")}
    >
      {/* Encabezado — Club del Dinero + perfil */}
      <div className="border-b border-slate-700/70 p-5">
        <h1
          className={`flex items-center gap-2 text-2xl font-bold tracking-wide text-white ${
            compacto ? "lg:justify-center" : ""
          }`}
        >
          <span className="shrink-0">🪙</span>
          <span className={compacto ? "lg:hidden" : ""}>Club del Dinero</span>
        </h1>
        <p
          className={`mt-2 flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-slate-400 ${
            compacto ? "lg:hidden" : ""
          }`}
        >
          <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
          {perfiles.length ? perfiles.join(" · ") : "Administrador Principal"}
        </p>
      </div>

      {/* Navegación por grupos (estructura del legacy) */}
      <nav className="flex-1 py-2" aria-label="Navegación">
        {GRUPOS.map((g) => (
          <div key={g.id} className="mb-1">
            <p
              className={`px-5 pb-1 pt-4 text-[10px] font-bold uppercase tracking-widest text-slate-500 ${
                compacto ? "lg:hidden" : ""
              }`}
            >
              {g.titulo}
            </p>
            <ul>
              {g.items.map((it) => {
                const activo = esActiva(pathname, it.href);
                const icono = (
                  <span className={`w-6 shrink-0 text-center ${compacto ? "lg:mx-auto" : ""}`}>
                    {it.emoji}
                  </span>
                );
                const rotulo = <span className={compacto ? "lg:hidden" : ""}>{it.txt}</span>;

                if (!it.href) {
                  return (
                    <li key={it.txt}>
                      <span
                        aria-disabled
                        title={compacto ? it.txt : "Próximamente"}
                        className={`flex select-none items-center gap-3 px-5 py-2.5 text-base font-medium text-slate-600 ${
                          compacto ? "lg:justify-center lg:px-0" : ""
                        }`}
                      >
                        {icono}
                        <span className={`flex-1 ${compacto ? "lg:hidden" : ""}`}>{it.txt}</span>
                        <span
                          className={`rounded-full bg-slate-800/80 px-1.5 py-0.5 text-[9px] font-bold uppercase text-slate-500 ${
                            compacto ? "lg:hidden" : ""
                          }`}
                        >
                          pronto
                        </span>
                      </span>
                    </li>
                  );
                }
                // La capacidad del enlace sale del REGISTRO MAESTRO según la
                // ruta: el menú no mantiene su propia lista de permisos y no
                // puede quedar desincronizado del maestro. Se consulta solo la
                // parte de la ruta, sin el query (?pestana=auditoria).
                const cap = capacidadesDeRuta(it.href.split("?")[0])[0];
                const enlace = (
                  <Link
                    href={it.href}
                    title={compacto ? it.txt : undefined}
                    onClick={onNavegar}
                    className={`flex items-center gap-3 border-l-4 px-5 py-3 text-base font-semibold transition-colors ${
                      compacto ? "lg:justify-center lg:px-0" : ""
                    } ${
                      activo
                        ? "border-blue-400 bg-blue-600 text-white"
                        : "border-transparent text-slate-300 hover:bg-slate-800 hover:text-white"
                    }`}
                  >
                    {icono}
                    {rotulo}
                  </Link>
                );
                return (
                  <li key={it.href}>{cap ? <Guard permiso={cap}>{enlace}</Guard> : enlace}</li>
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
          title={compacto ? "Cerrar Sistema" : undefined}
          className={`flex w-full items-center gap-3 text-left text-sm font-bold text-red-400 transition-colors hover:text-red-300 ${
            compacto ? "lg:justify-center" : ""
          }`}
        >
          <span className="w-6 shrink-0 text-center">⏻</span>
          <span className={compacto ? "lg:hidden" : ""}>Cerrar Sistema</span>
        </button>
      </div>
    </aside>
  );
}

export default Sidebar;
