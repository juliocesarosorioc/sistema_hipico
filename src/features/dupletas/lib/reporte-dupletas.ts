/**
 * Carga de las DUPLETAS JUGADAS de un día para su reporte.
 *
 * Cada celda vendida en la matriz de Dupletas escribe un ticket en
 * `tickets_apuestas` con `nombre_jugada = 'DUPLETA <n1> x <n2>'`
 * (ver sql/dupleta_venta.sql). Al liquidar, `dupleta_liquidacion.sql` marca cada
 * ticket como `Ganador` (con `premio_pagar`) o `Perdedor`, y los retirados como
 * `Retirado`; el reporte genérico ya entiende esos tres estados, así que acá
 * solo se leen y normalizan con el mismo núcleo que Tablas Fijas y Marcas.
 *
 * Mismo criterio de día que los otros reportes: manda `fecha_carrera` (la
 * jornada que corre) y, para filas heredadas sin columna, la ventana local de
 * `fecha_registro`.
 */
import { supabase } from "@/core/supabase";
import { ventanaDiaLocal } from "@/features/liquidacion/lib/fecha";
import {
  normalizarVenta,
  type VentaTablaReporte,
} from "@/features/tablas/lib/reporte-tablas-nucleo";

export type ResultadoCargaDupletas = {
  ok: boolean;
  ventas: VentaTablaReporte[];
  error?: string;
};

export async function cargarDupletasJugadas(fecha: string): Promise<ResultadoCargaDupletas> {
  if (!supabase) return { ok: false, ventas: [], error: "Sin credenciales Supabase (.env.local)." };
  const dia = String(fecha ?? "").slice(0, 10);
  if (!dia) return { ok: false, ventas: [], error: "Indique el día del reporte." };
  const { desde, hasta } = ventanaDiaLocal(dia);
  try {
    const { data, error } = await supabase
      .from("tickets_apuestas")
      .select("*")
      .or(`fecha_carrera.eq.${dia},and(fecha_carrera.is.null,fecha_registro.gte.${desde},fecha_registro.lt.${hasta})`)
      .ilike("nombre_jugada", "DUPLETA %")
      .order("fecha_registro");
    if (error) return { ok: false, ventas: [], error: error.message };
    return {
      ok: true,
      ventas: ((data ?? []) as Record<string, unknown>[]).map(normalizarVenta),
    };
  } catch (e) {
    return { ok: false, ventas: [], error: e instanceof Error ? e.message : String(e) };
  }
}
