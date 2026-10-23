"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuthStore } from "@/shared/store/useAuthStore";
import { Guard } from "@/shared/components/ui/Guard";
import { capacidadesDeRuta } from "@/features/seguridad/lib/capacidades";
import { WPS_PLANIFICACION, WPS_PLANIFICACION_CORTO } from "@/features/motores/lib/wps-planificacion";

type Item = {
  href?: string;
  emoji: string;
  txt: string;
  /**
   * Texto del chip que reemplaza al enlace cuando la entrada NO tiene `href`
   * (módulo todavía no habilitado). Si no viene se usa "pronto".
   */
  badge?: string;
  /** Tooltip de la entrada deshabilitada. */
  titulo?: string;
  /**
   * La entrada se muestra SIEMPRE, aunque el usuario no tenga la capacidad
   * de la ruta.
   *
   * Por qué hace falta: el `<Guard>` ESCONDE el enlace si falta el permiso.
   * Eso es correcto para un módulo cerrado, pero para una pantalla que el
   * dueño acaba de abrir ("Inteligencia Hípica") el operador concluía que
   * la función no existía. Con esta marca el enlace aparece siempre y quien
   * no tenga permiso recibe el mensaje de acceso denegado de la propia ruta
   * — que explica qué falta — en vez de un menú que calla.
   */
  visibleSiempre?: boolean;
};

/**
 * Navegación por CATEGORÍAS (filtros) y SUBMÓDULOS desplegables (subfiltros).
 *
 * Antes el menú era una lista plana de 5 bloques donde todo pesaba igual:
 * "Tablas Fijas" quedaba al lado de "Hipódromos" y el operador tenía que leer
 * los 20 renglones para encontrar lo que buscaba. Acá los módulos se agrupan
 * por la NATURALEZA del trabajo —qué se está haciendo, no de qué tabla sale—
 * en 6 categorías estables:
 *
 *   1. Operaciones en Vivo   · lo que pasa mientras corre la carrera
 *   2. Mercados y Pizarras   · lo que se vende y se juega
 *   3. Grupo y Clientes      · la cartera a cargo
 *   4. Finanzas              · el dinero y su contabilidad
 *   5. Reportes y Auditoría  · el cierre y el control
 *   6. Configuración         · el catálogo y los permisos
 *
 * Cada categoría se despliega/pliega; el estado se recuerda por sesión en
 * `localStorage` para que el menú no se reabra entero en cada recarga. La
 * categoría con la ruta activa se abre SOLA aunque el usuario la haya plegado.
 */
type Categoria = {
  id: string;
  titulo: string;
  emoji: string;
  items: Item[];
};

const CATEGORIAS: Categoria[] = [
  {
    id: "vivo",
    titulo: "Operaciones en Vivo",
    emoji: "🎥",
    items: [
      { href: "/inicio", emoji: "🏠", txt: "Inicio / Dashboard" },
      // Monitor de carreras del día: la pantalla que sigue el programa en vivo.
      { href: "/carreras", emoji: "🏁", txt: "Monitor de Carreras" },
      { href: "/gestion-jugadas", emoji: "🎟️", txt: "Gestión de Jugadas" },
      { href: "/taquilla", emoji: "🧾", txt: "Taquilla / Compras" },
      { href: "/jugadas", emoji: "📈", txt: "Monitor de Jugadas" },
    ],
  },
  {
    id: "mercados",
    titulo: "Mercados y Pizarras",
    emoji: "📊",
    items: [
      { href: "/tablas-fijas", emoji: "📋", txt: "Tablas Fijas" },
      { href: "/remates", emoji: "🔔", txt: "Remates en Vivo" },
      { href: "/marcas", emoji: "🏷️", txt: "Marcas" },
      { href: "/pollas", emoji: "🏆", txt: "Pollas" },
      { href: "/dupleta", emoji: "🎯", txt: "Dupletas" },
      // W.P.S. INACTIVA para todos los usuarios: sin `href` entra a la rama
      // deshabilitada (chip 🚧 + pointer-events-none/opacity-50) y no se ofrece
      // como pantalla operativa. El motor no se toca (features/motores/wps.ts).
      { emoji: "🏇", txt: "W.P.S.", badge: WPS_PLANIFICACION_CORTO, titulo: WPS_PLANIFICACION },
    ],
  },
  {
    id: "grupo",
    titulo: "Administración de Grupo y Clientes",
    emoji: "🗂️",
    items: [
      { href: "/clientes", emoji: "👥", txt: "Clientes y Saldos" },
      // Jugadas entre tercios: jugadas a futuro que se cobran/pagan por tercios.
      { href: "/reglas-jugadas", emoji: "⚙️", txt: "Jugadas entre Tercios" },
      { href: "/grupos", emoji: "🗂️", txt: "Grupos y Convenios" },
      { href: "/operadores", emoji: "🧑‍💼", txt: "Operadores" },
      { href: "/crear-grupo", emoji: "🧩", txt: "Creación de Grupos" },
    ],
  },
  {
    id: "finanzas",
    titulo: "Finanzas y Contabilidad",
    emoji: "💰",
    items: [
      { href: "/contabilidad/caja", emoji: "💵", txt: "Caja Unificada" },
      { href: "/contabilidad/bancos", emoji: "🏦", txt: "Bancos Reales" },
      { href: "/contabilidad/ingresos", emoji: "📥", txt: "Ingresos / Depósitos" },
      { href: "/contabilidad/monedas", emoji: "💱", txt: "Monedas y Tasas" },
    ],
  },
  {
    id: "reportes",
    titulo: "Reportes y Auditoría",
    emoji: "🧾",
    items: [
      { href: "/reporte-diario", emoji: "📅", txt: "Reporte Diario" },
      { href: "/saldos-reportes", emoji: "📊", txt: "Liquidación de Carreras" },
      { href: "/tickets", emoji: "🛟", txt: "Tickets / Reclamos" },
    ],
  },
  {
    id: "configuracion",
    titulo: "Configuración y Seguridad",
    emoji: "🛡️",
    items: [
      { href: "/hipodromos", emoji: "🗺️", txt: "Hipódromos" },
      { href: "/ejemplares", emoji: "🐴", txt: "Ejemplares / Gaceta IA" },
      { href: "/whatsapp", emoji: "💬", txt: "WhatsApp / Notificaciones" },
      { href: "/seguridad", emoji: "🛡️", txt: "Matriz de Seguridad" },
      { href: "/diagnostico", emoji: "🩺", txt: "Diagnóstico" },
    ],
  },
  {
    id: "inteligencia",
    titulo: "Inteligencia Hípica",
    emoji: "🧭",
    items: [
      // `visibleSiempre`: la pantalla existe y el dueño la abrió. Esconderla
      // porque el usuario no tiene la capacidad deja al operador pensando que
      // la función no está; es mejor que entre y lea el motivo del rechazo.
      { href: "/inteligencia-hipica/proyecciones", emoji: "📈", txt: "Proyecciones", visibleSiempre: true },
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

/** Clave de `localStorage` donde se recuerdan las categorías plegadas. */
const CLAVE_PLEGADAS = "club_sidebar_plegadas";

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
 * Menú lateral izquierdo de la SPA, en dos niveles: categoría → submódulos.
 *
 * Dos modos de ancho, igual que `js/components/layout.js`:
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

  const salir = useAuthStore((s) => s.salir);
  const [saliendo, setSaliendo] = useState(false);

  // Categorías plegadas por el usuario. Arrancan todas abiertas y el estado se
  // recuerda entre recargas; la categoría activa se ignora al plegar (ver abajo).
  const [plegadas, setPlegadas] = useState<string[]>([]);
  useEffect(() => {
    try {
      const crudo = localStorage.getItem(CLAVE_PLEGADAS);
      if (crudo) setPlegadas(JSON.parse(crudo) as string[]);
    } catch {
      /* sinop */
    }
  }, []);

  const alternarCategoria = (id: string) => {
    setPlegadas((prev) => {
      const siguiente = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      try {
        localStorage.setItem(CLAVE_PLEGADAS, JSON.stringify(siguiente));
      } catch {
        /* sinop */
      }
      return siguiente;
    });
  };

  const cerrarSesion = async () => {
    if (saliendo) return;
    setSaliendo(true);
    try {
      localStorage.removeItem("club_sesion_activa");
    } catch {
      /* sinop */
    }
    try {
      await salir();
    } catch {
      /* aunque falle el borrado remoto, se sale igual para no quedar atrapado */
    } finally {
      window.location.replace("/");
    }
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

      {/* Navegación por categorías desplegables */}
      <nav className="flex-1 py-2" aria-label="Navegación">
        {CATEGORIAS.map((cat) => {
          // ¿Hay algún submódulo de esta categoría activo? Si sí, se abre sola
          // aunque el usuario la haya plegado: el menú nunca esconde dónde está
          // parado. En modo riel (compacto) siempre se ve la lista de iconos.
          const activa = cat.items.some((it) => esActiva(pathname, it.href));
          const plegada = plegadas.includes(cat.id) && !activa;
          const abierta = compacto || !plegada;

          return (
            <div key={cat.id} className="mb-1">
              <button
                type="button"
                onClick={() => alternarCategoria(cat.id)}
                aria-expanded={abierta}
                aria-controls={`cat-${cat.id}`}
                title={compacto ? cat.titulo : undefined}
                className={`flex w-full items-center gap-2 px-5 pb-1 pt-4 text-left text-[10px] font-bold uppercase tracking-widest transition-colors ${
                  activa ? "text-amber-400" : "text-slate-500 hover:text-slate-300"
                } ${compacto ? "lg:hidden" : ""}`}
              >
                <span className="shrink-0 text-xs">{cat.emoji}</span>
                <span className="min-w-0 flex-1 truncate">{cat.titulo}</span>
                <span
                  aria-hidden="true"
                  className={`shrink-0 text-slate-500 transition-transform duration-200 ${
                    abierta ? "rotate-90" : ""
                  }`}
                >
                  ▶
                </span>
              </button>
              {/* Separador visible en modo riel para no perder el agrupamiento. */}
              <span className={`mx-4 mb-1 block border-t border-slate-700/50 ${compacto ? "lg:block" : "hidden"}`} />
              <ul id={`cat-${cat.id}`} className={abierta ? "" : "hidden"}>
                {cat.items.map((it) => {
                  const itemActivo = esActiva(pathname, it.href);
                  const icono = (
                    <span className={`w-6 shrink-0 text-center ${compacto ? "lg:mx-auto" : ""}`}>
                      {it.emoji}
                    </span>
                  );
                  const rotulo = <span className={compacto ? "lg:hidden" : ""}>{it.txt}</span>;

                  if (!it.href) {
                    // Módulo no habilitado (W.P.S. 🚧): entrada bloqueada, sin
                    // enlace y sin foco, con el badge que explica por qué.
                    return (
                      <li key={it.txt}>
                        <span
                          aria-disabled
                          title={compacto ? it.txt : it.titulo ?? "Próximamente"}
                          className={`flex select-none items-center gap-3 px-5 py-2.5 text-base font-medium text-slate-600 ${
                            compacto ? "lg:justify-center lg:px-0" : ""
                          }`}
                        >
                          {icono}
                          <span className={`min-w-0 flex-1 truncate ${compacto ? "lg:hidden" : ""}`}>{it.txt}</span>
                          <span
                            className={`pointer-events-none shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase opacity-50 ${
                              it.badge ? "bg-amber-500/20 text-amber-400" : "bg-slate-800/80 text-slate-500"
                            } ${compacto ? "lg:hidden" : ""}`}
                          >
                            {it.badge ?? "pronto"}
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
                      className={`flex items-center gap-3 border-l-4 px-5 py-2.5 text-sm font-semibold transition-colors ${
                        compacto ? "lg:justify-center lg:px-0" : ""
                      } ${
                        itemActivo
                          ? "border-amber-400 bg-blue-600 text-white"
                          : "border-transparent text-slate-300 hover:bg-slate-800 hover:text-white"
                      }`}
                    >
                      {icono}
                      {rotulo}
                    </Link>
                  );
                  return (
                    <li key={it.href}>
                      {cap && !it.visibleSiempre ? <Guard permiso={cap}>{enlace}</Guard> : enlace}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
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
