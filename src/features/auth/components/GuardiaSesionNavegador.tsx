"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { hasValidSession } from "@/features/auth/lib/sesion";

/**
 * Anula el BFCache: si el navegador restaura una página desde "Atrás" y no hay
 * sesión (o viene de la caché), sustituye la entrada por /login.
 */
export function GuardiaSesionNavegador() {
  const pathname = usePathname();

  useEffect(() => {
    if (pathname === "/login" || pathname === "/verificacion") return;

    const alMostrarPagina = (e: PageTransitionEvent) => {
      if (e.persisted || !hasValidSession()) {
        window.location.replace("/login");
      }
    };

    window.addEventListener("pageshow", alMostrarPagina);
    return () => window.removeEventListener("pageshow", alMostrarPagina);
  }, [pathname]);

  return null;
}

export default GuardiaSesionNavegador;
