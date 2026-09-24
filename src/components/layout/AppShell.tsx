"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { Topbar } from "@/components/layout/Topbar";
import { Sidebar } from "@/components/layout/Sidebar";
import { BetSlipPanel } from "@/components/betting/BetSlipPanel";
import { useAuthStore } from "@/store/useAuthStore";

const ES_PORTAL = (p: string) => p === "/portal" || p.startsWith("/portal/");

/**
 * ¿El usuario es el rol Cliente? (defensa real en despliegue estático,
 * donde el middleware de Next NO corre): perfil cuyo nombre contiene
 * "cliente" y cuyos permisos vigentes son SOLO acceso_portal.
 */
function esRolCliente(perfiles: string[], permisos: string[]): boolean {
  const perfilCliente = perfiles.some((p) => /cliente/i.test(p));
  if (!perfilCliente) return false;
  return permisos.every((p) => p === "acceso_portal");
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

  useEffect(() => {
    if (!ES_PORTAL(pathname) && esRolCliente(perfiles, permisos)) {
      router.replace("/portal");
    }
  }, [pathname, perfiles, permisos, router]);

  if (ES_PORTAL(pathname)) {
    return (
      <div className="min-h-screen bg-slate-100 font-sans text-sm text-slate-800">
        {children}
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="flex-1 overflow-y-auto bg-gray-50">{children}</main>
      </div>
      <BetSlipPanel />
    </div>
  );
}

export default AppShell;