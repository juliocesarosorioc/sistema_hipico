"use client";

import { useCallback, useEffect, useState } from "react";
import { listarCarrerasCentrales, type CarreraCentral } from "@/lib/carreras/central";

/**
 * Data central de carreras del día (hipódromo + fecha) compartida por los
 * módulos (Gestión, Tablas Fijas, Marcas, Dupletas, Carreras del Día).
 * Con `fecha`/`hipodromo` vacíos devuelve TODAS las carreras centrales, que es
 * lo que necesitan los selectores en cascada (primero hipódromo, luego día).
 */
export function useCarrerasCentrales(fecha?: string, hipodromo?: string) {
  const [centrales, setCentrales] = useState<CarreraCentral[]>([]);
  const [cargando, setCargando] = useState(false);

  const recargar = useCallback(async () => {
    setCargando(true);
    const r = await listarCarrerasCentrales(fecha, hipodromo);
    setCargando(false);
    if (r.ok) setCentrales(r.datos ?? []);
  }, [fecha, hipodromo]);

  useEffect(() => {
    void recargar();
  }, [recargar]);

  return { centrales, cargando, recargar };
}

export default useCarrerasCentrales;
