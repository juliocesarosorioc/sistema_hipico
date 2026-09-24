"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/useAuthStore";

type Props = {
  /** Permiso requerido para ver la ruta. Lista = se exigen TODOS. */
  permiso: string | string[];
  children: ReactNode;
};

/**
 * Guardia de RUTA (defensa en profundidad de src/middleware.ts).
 * Si el usuario actual no tiene el permiso, redirige a /dashboard sin
 * renderizar el contenido (evita el parpadeo de la página desautorizada).
 */
export function RutaProtegida({ permiso, children }: Props) {
  const router = useRouter();
  const inicializada = useAuthStore((s) => s.inicializada);
  const permisos = useAuthStore((s) => s.permisos);
  const [permitido, setPermitido] = useState<boolean | null>(null);

  useEffect(() => {
    if (!inicializada) return;
    const set = new Set(permisos);
    const ok = Array.isArray(permiso) ? permiso.every((p) => set.has(p)) : set.has(permiso);
    setPermitido(ok);
  }, [inicializada, permisos, permiso]);

  useEffect(() => {
    if (permitido === false) router.replace("/dashboard");
  }, [permitido, router]);

  if (!inicializada || permitido === null) return null;
  if (!permitido) return null;

  return <>{children}</>;
}

export default RutaProtegida;