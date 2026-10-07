"use client";

/**
 * PIZARRA OFICIAL DE MARCAS — hook para leerla desde cualquier modulo.
 *
 * Vive en su propio archivo (y no dentro de `lib/marcas.ts`) por la misma razon
 * que `lib/carreras/useCarrerasCentrales.ts`: el hook necesita React, y
 * `lib/marcas.ts` lo consumen cosas que no son componentes. Si el hook se
 * quedara ahi, importar los helpers de marcas desde un server component
 * arrastraria React al grafo del servidor.
 *
 * Que resuelve: `marcas_carrera` y `resultados_carreras` comparten la clave
 * `hipodromo + fecha + carrera`, pero son dos tablas. Quien las necesita juntas
 * se las cruza a mano y cada uno se inventa un poco el formato. Este hook hace
 * el cruce UNA vez y lo reparte.
 *
 * Que lo usa: el panel de Marcas, el editor de configuracion y los modulos que
 * cargan resultados (Taquilla, Tablas, Reportes). Las marcas se ven igual en
 * todos lados, y todas vienen de la misma fila de la misma tabla.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { listarPizarraMarcas, type PizarraMarca } from "@/lib/marcas";

export type PizarraOficial = {
  /** Una fila por carrera del dia, con config vigente y resultado. */
  filas: PizarraMarca[];
  cargando: boolean;
  error: string | null;
  /** Vuelve a leer. Se llama tras guardar, borrar o liquidar. */
  recargar: () => Promise<void>;
  /** El dia tiene al menos una carrera con marcas configuradas. */
  hayMarcas: boolean;
  /** Busca la fila de una carrera concreta. */
  de: (hipodromo: string, carrera: number) => PizarraMarca | undefined;
};

export function usePizarraOficial(dia: string, hipodromo?: string): PizarraOficial {
  const clave = `${dia}|${String(hipodromo ?? "").trim().toUpperCase()}`;
  const [filas, setFilas] = useState<PizarraMarca[]>([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recargar = useCallback(async () => {
    if (!dia) return;
    setCargando(true);
    const r = await listarPizarraMarcas({ dia, ...(hipodromo ? { hipodromo } : {}) });
    setCargando(false);
    if (!r.ok) {
      setFilas([]);
      setError(r.error ?? "No se pudo leer la pizarra de Marcas.");
      return;
    }
    setError(null);
    setFilas(r.filas);
  }, [dia, hipodromo]);

  useEffect(() => {
    void recargar();
  }, [recargar]);

  /**
   * El resultado de una carrera lo escribe OTRO modulo (Taquilla, Tablas). Sin
   * esta suscripcion, quien tenga la pantalla abierta se queda viendo el
   * resultado anterior hasta que recargue a mano, y eso en una mesa de carreras
   * es justo cuando no se recarga nadie.
   *
   * La clave `hipodromo` va con filtro: solo se re-lee si el evento es del dia o
   * hipodromo que esta viendo esta pantalla.
   */
  useEffect(() => {
    const sb = supabase;
    if (!sb) return;
    const filtro: Record<string, string> = dia ? { fecha: dia } : {};
    if (hipodromo) filtro.hipodromo = String(hipodromo).trim().toUpperCase();
    const canal = sb
      .channel(`pizarra-oficial:${clave}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "resultados_carreras", ...filtro }, () => {
        void recargar();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "marcas_carrera", ...filtro }, () => {
        void recargar();
      })
      .subscribe();
    return () => {
      void sb.removeChannel(canal);
    };
  }, [clave, dia, hipodromo, recargar]);

  return {
    filas,
    cargando,
    error,
    recargar,
    hayMarcas: filas.some((f) => !!f.config),
    de: (h, c) =>
      filas.find(
        (f) => f.carrera === c && f.hipodromo.trim().toUpperCase() === String(h).trim().toUpperCase()
      ),
  };
}
