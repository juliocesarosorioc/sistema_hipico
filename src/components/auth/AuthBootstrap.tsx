"use client";

import { useEffect } from "react";
import { useAuthStore } from "@/store/useAuthStore";

/**
 * Al montar el SPA siembra la sesión RBAC (permisos en memoria + cookies para
 * el middleware). No renderiza nada.
 */
export function AuthBootstrap() {
  const inicializar = useAuthStore((s) => s.inicializar);

  useEffect(() => {
    void inicializar();
  }, [inicializar]);

  return null;
}

export default AuthBootstrap;