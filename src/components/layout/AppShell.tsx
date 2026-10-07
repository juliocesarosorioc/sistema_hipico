"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { Topbar } from "@/components/layout/Topbar";
import { Sidebar } from "@/components/layout/Sidebar";
import { BetSlipPanel } from "@/components/betting/BetSlipPanel";
import { useAuthStore } from "@/store/useAuthStore";
import { esRutaPublica } from "@/lib/seguridad/capacidades";

const ES_PORTAL = (p: string) => p === "/portal" || p.startsWith("/portal/");
// Las rutas públicas salen de `PUERTAS` (ver `esRutaPublica`). La lista fija
// "/login | /" que estaba acá se quedó corta cuando se agregó
// `/reset-password`: esa páginaighted quedaba envuelta con el menú lateral, que
// es justo lo que no tiene que pasar en una pantalla de recuperación.
const ES_LOGIN = esRutaPublica;

/** Todo lo que el portal necesita para funcionar y nada más. */
const CAPS_PORTAIL = ["portal:ruta_portal", "portal:btn_jugar", "portal:celda_saldo_portal"];

/** Misma clave y breakpoint que el legacy (js/components/layout.js). */
const CLAVE_ESTADO_MENU = "club_sidebar_estado";
const MQ_ESCRITORIO = "(min-width: 1024px)";

/**
 * ¿El usuario es el rol Cliente? (defensa real en despliegue estático,
 * donde el middleware de Next NO corre): tipo "cliente"/"jugador" cuyos
 * permisos vigentes se limitan a las capacidades del portal.
 */
function esRolCliente(perfiles: string[], permisos: string[]): boolean {
  const perfilCliente = perfiles.some((p) => /cliente|jugador/i.test(p));
  if (!perfilCliente) return false;
  return permisos.every((p) => CAPS_PORTAIL.includes(p));
}

/**
 * Lo único que se ve mientras se verifica la sesión. Deliberadamente vacío de
 * datos del sistema: no muestra saldos, carreras ni nombres de cliente.
 */
function PantallaDeEspera() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950">
      <div
        className="h-8 w-8 animate-spin rounded-full border-2 border-slate-700 border-t-slate-400"
        role="status"
        aria-label="Verificando la sesi&oacute;n"
      />
    </div>
  );
}

/**
 * Shell raíz de la SPA.
 *
 * Si la ruta es el Portal del Cliente (/portal) → el contenido se renderiza
 * STANDALONE (sin menú lateral, sin topbar y sin bet slip): es la "vista
 * externa" para el rol cliente.
 *
 * En el resto de rutas admin → la zona de 3 columnas clásica:
 *   ┌──────────────┬──────────────────────────────────┬───────────────┐
 *   │  Sidebar 250 │  Topbar  (notifs + logout)       │  BetSlip      │
 *   │  oscuro      │──────────────────────────────────│  boleto der.  │
 *   │              │  <main bg-gray-50>{children}     │               │
 *   └──────────────┴──────────────────────────────────┴───────────────┘
 *
 * Además, si el perfil activo es el rol Cliente y no está en /portal, se
 * redirige ahí (equivale al redirect del middleware para el estático).
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const perfiles = useAuthStore((s) => s.perfiles);
  const permisos = useAuthStore((s) => s.permisos);
  const inicializada = useAuthStore((s) => s.inicializada);
  const usuario = useAuthStore((s) => s.usuario);

  useEffect(() => {
    if (inicializada && usuario && !ES_PORTAL(pathname) && esRolCliente(perfiles, permisos)) {
      router.replace("/portal");
    }
  }, [inicializada, usuario, pathname, perfiles, permisos, router]);

  // Estado del menú lateral (paridad con el legacy):
  //   - escritorio: el botón NO lo saca de pantalla, lo deja en RAIL DE ICONOS
  //     (64px, textos ocultos) y el choix se recuerda entre recargas;
  //   - móvil/tablet: drawer superpuesto que arranca cerrado.
  const [compacto, setCompacto] = useState(false);
  const [drawerAbierto, setDrawerAbierto] = useState(false);
  // El ancho lo decide CSS, pero el lector de pantalla y el ESC necesitan saber
  // en qué modo estamos, y eso solo se puede saber midiendo la ventana.
  const [esEscritorio, setEsEscritorio] = useState(true);

  useEffect(() => {
    try {
      if (localStorage.getItem(CLAVE_ESTADO_MENU) === "compacto") setCompacto(true);
    } catch {
      /* sinop */
    }
    const mq = window.matchMedia(MQ_ESCRITORIO);
    const alCambiar = () => {
      setEsEscritorio(mq.matches);
      // Al pasar a escritorio el drawer deja de aplicar: se cierra.
      if (mq.matches) setDrawerAbierto(false);
    };
    alCambiar();
    mq.addEventListener("change", alCambiar);
    return () => mq.removeEventListener("change", alCambiar);
  }, []);

  const alternarMenu = useCallback(() => {
    if (esEscritorio) {
      setCompacto((v) => {
        try {
          localStorage.setItem(CLAVE_ESTADO_MENU, v ? "abierto" : "compacto");
        } catch {
          /* sinop */
        }
        return !v;
      });
    } else {
      setDrawerAbierto((v) => !v);
    }
  }, [esEscritorio]);

  const cerrarDrawer = useCallback(() => setDrawerAbierto(false), []);

  useEffect(() => {
    if (esEscritorio || !drawerAbierto) return;
    const alPulsar = (e: KeyboardEvent) => {
      if (e.key === "Escape") cerrarDrawer();
    };
    document.addEventListener("keydown", alPulsar);
    return () => document.removeEventListener("keydown", alPulsar);
  }, [esEscritorio, drawerAbierto, cerrarDrawer]);

  const menuVisible = esEscritorio ? !compacto : drawerAbierto;

  /**
   * El riel de íconos SIGUE SIENDO EL MENÚ: no va `aria-hidden` ni se marca
   * oculto, porque sus enlaces se pueden seguir usando con el teclado y con el
   * tooltip. Oculto es solo el drawer móvil cerrado.
   */
  const menuOculto = !esEscritorio && !drawerAbierto;

  // La puerta se dibuja SIEMPRE, verificada la sesión o no. Antes el orden
  // estaba al revés y el login quedaba detrás del spinner: con la base
  // Supabase lenta o caída, la pantalla se quedaba "cargando" y el formulario
  // no llegaba a aparecer nunca. El login es público: no hay nada que
  // verificar para poder verlo. Es el propio formulario el que espera, con el
  // botón deshabilitado, a que el store sepa quién es.
  if (ES_LOGIN(pathname)) return <>{children}</>;

  // PUERTA DE ENTRADA del resto: hasta que la sesión real de Supabase no se
  // haya verificado, NO se dibuja nada. Antes se pintaba el shell y sus
  // controles con los permisos en caché y luego se expulsaba al usuario: el
  // contenido había salido a la pantalla antes de comprobar el acceso.
  if (!inicializada) return <PantallaDeEspera />;

  if (ES_PORTAL(pathname)) {
    return (
      <div className="min-h-screen bg-slate-100 font-sans text-sm text-slate-800">
        {children}
      </div>
    );
  }

  // Ruta protegida sin sesión: se está redirigiendo a /login (lo hacen
  // AuthBootstrap y RutaProtegida). Se mantiene la espera en vez de dibujar el
  // shell vacío, para no exponer la estructura a quien no entró.
  if (!usuario) return <PantallaDeEspera />;

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        compacto={compacto}
        drawerAbierto={drawerAbierto}
        oculto={menuOculto}
        onNavegar={esEscritorio ? undefined : cerrarDrawer}
      />
      {/* Tapa del drawer móvil: clic fuera = cerrar. */}
      {!esEscritorio && drawerAbierto && (
        <div
          className="fixed inset-0 z-40 bg-black/50"
          aria-hidden="true"
          onClick={cerrarDrawer}
        />
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar alAlternarMenu={alternarMenu} menuVisible={menuVisible} />
        <main className="flex-1 overflow-y-auto bg-gray-50">{children}</main>
      </div>
      <BetSlipPanel />
    </div>
  );
}

export default AppShell;