"use client";

import { useCallback, useEffect, useState } from "react";
import { listarCarrerasCentrales, type CarreraCentral } from "@/features/carreras/lib/central";
import { useRegistroCentral, useRealtimeCarreras } from "@/shared/store/useRegistroCentral";

/**
 * Data central de carreras del día (hipódromo + fecha) compartida por los
 * módulos (Gestión, Tablas Fijas, Dupletas, Carreras del Día).
 * Con `fecha`/`hipodromo` vacíos devuelve TODAS las carreras centrales, que es
 * lo que necesitan los selectores en cascada (primero hipódromo, luego día).
 *
 * Se suscribe a `versionCarreras` (que incluye los eventos realtime de la
 * matriz): sin esto este hook leía una sola vez al montar y una carrera
 * extraída después nunca aparecía hasta remontar el componente.
 */
export function useCarrerasCentrales(fecha?: string, hipodromo?: string) {
  const [centrales, setCentrales] = useState<CarreraCentral[]>([]);
  const [cargando, setCargando] = useState(false);
  const versionCarreras = useRegistroCentral((s) => s.versionCarreras);

  useRealtimeCarreras();

  const recargar = useCallback(async () => {
    setCargando(true);
    const r = await listarCarrerasCentrales(fecha, hipodromo);
    setCargando(false);
    if (r.ok) setCentrales(r.datos ?? []);
  }, [fecha, hipodromo]);

  useEffect(() => {
    void recargar();
  }, [recargar, versionCarreras]);

  return { centrales, cargando, recargar };
}

export default useCarrerasCentrales;
