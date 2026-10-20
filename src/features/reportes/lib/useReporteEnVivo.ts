"use client";

/**
 * TIEMPO REAL DE LOS REPORTES — un solo hook para las cinco modalidades.
 *
 * Los reportes se arman con lo que hay en la base: `tickets_apuestas` (tablas,
 * marcas, dupletas y remates), `polla_ventas`/`polla_combinaciones` (polla) y
 * `resultados_carreras` (la pizarra oficial). Cuando el operador carga o paga
 * una carrera, esas tablas cambian; el reporte abierto tiene que reflejarlo sin
 * que nadie apriete "refrescar".
 *
 * Qué escucha SIEMPRE:
 *   · `resultados_carreras` → orden de llegada cargado/corregido;
 *   · `carreras`           → estado comercial (Liquidada = ya se pagó).
 * Y además las tablas que cada reporte pida (`tablas`), p. ej. `dupletas`,
 * `remates`, `polla_ventas`.
 *
 * Los eventos llegan en ráfaga (un pago toca varios tickets): se agrupan con un
 * debounce corto y se llama `onCambio` una sola vez. El hook es defensivo: si
 * la tabla no está en la publicación `supabase_realtime`, simplemente no llegan
 * eventos y el reporte sigue funcionando con el botón de refrescar.
 */
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/core/supabase";

export type OpcionesReporteEnVivo = {
  /** Se suscribe solo con el modal abierto / la pantalla montada. */
  habilitado: boolean;
  /** Día que se está mirando; sirve para recrear el canal al cambiar de día. */
  fecha?: string;
  /** Tablas propias de la modalidad que también deben refrescar el reporte. */
  tablas?: readonly string[];
  /** Se ejecuta (con debounce) cuando llega un cambio relevante. */
  onCambio: () => void;
  /** Milisegundos para agrupar una ráfaga de eventos. */
  espera?: number;
};

/**
 * Devuelve `true` cuando el canal quedó efectivamente suscrito. La pantalla lo
 * usa para mostrar el punto "En vivo"; si la publicación no tiene las tablas,
 * el punto queda apagado y el resto sigue igual.
 */
export function useReporteEnVivo({
  habilitado,
  fecha,
  tablas = [],
  onCambio,
  espera = 450,
}: OpcionesReporteEnVivo): boolean {
  const [enVivo, setEnVivo] = useState(false);
  // El callback puede cambiar de identidad en cada render (closures con estado);
  // se guarda en un ref para no re-suscribir el canal por eso.
  const cambioRef = useRef(onCambio);
  cambioRef.current = onCambio;

  useEffect(() => {
    if (!habilitado || !supabase) {
      setEnVivo(false);
      return;
    }
    // Se captura para que el cierre de limpieza no pierda el estrechamiento de
    // tipos (TypeScript no garantiza que `supabase` siga no-nulo alli).
    const cliente = supabase;

    let vigente = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const disparar = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (vigente) cambioRef.current();
      }, espera);
    };

    const nombre = `reporte-vivo-${fecha || "todo"}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    const canal = cliente.channel(nombre);

    canal.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "resultados_carreras" },
      disparar
    );
    canal.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "carreras" },
      disparar
    );
    for (const tabla of tablas) {
      if (!tabla) continue;
      canal.on(
        "postgres_changes",
        { event: "*", schema: "public", table: tabla },
        disparar
      );
    }

    canal.subscribe((estado) => {
      if (vigente) setEnVivo(estado === "SUBSCRIBED");
    });

    return () => {
      vigente = false;
      if (timer) clearTimeout(timer);
      try {
        void cliente.removeChannel(canal);
      } catch {
        /* el canal ya pudo haberse cerrado por red */
      }
    };
  }, [habilitado, fecha, tablas, espera]);

  return enVivo;
}
