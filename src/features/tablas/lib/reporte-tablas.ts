/**
 * Carga de las Tablas Fijas VENDIDAS de un día para el Reporte del Monitor.
 *
 * Cada venta de tabla fija escribe uno o más tickets en `tickets_apuestas`
 * (uno por ejemplar jugado, ver sql/tablas_venta.sql) con
 * `nombre_jugada = 'TABLA FIJA (HIPO Cn)'`. Acá se leen TODOS los del día en
 * UNA sola consulta y se normalizan; los filtros por grupo/hipódromo/carrera/
 * jugador se aplican en memoria (ver reporte-tablas-nucleo.ts), así cambiar un
 * filtro no vuelve a la base.
 *
 * El día es el de la CARRERA, no el de la venta: el reporte agrupa por la
 * jornada que corre (igual que el récord de Marcas y el Reporte Diario). La
 * columna `fecha_carrera` la mantiene el trigger `trg_tickets_fecha_carrera`
 * (sql/fecha_carrera_tickets.sql); para las filas heredadas sin columna se cae a
 * la ventana local de `fecha_registro` (`ventanaDiaLocal`).
 */
import { supabase } from "@/core/supabase";
import { ventanaDiaLocal } from "@/features/liquidacion/lib/fecha";
import {
  normalizarVenta,
  type VentaTablaReporte,
} from "@/features/tablas/lib/reporte-tablas-nucleo";

export type ResultadoCargaVentas = {
  ok: boolean;
  ventas: VentaTablaReporte[];
  error?: string;
};

export async function cargarVentasTablasFijas(fecha: string): Promise<ResultadoCargaVentas> {
  if (!supabase) return { ok: false, ventas: [], error: "Sin credenciales Supabase (.env.local)." };
  const dia = String(fecha ?? "").slice(0, 10);
  if (!dia) return { ok: false, ventas: [], error: "Indique el día del reporte." };
  const { desde, hasta } = ventanaDiaLocal(dia);
  try {
    const { data, error } = await supabase
      .from("tickets_apuestas")
      .select("*")
      // Día de la carrera; si la fila es heredada y la columna viene nula, cae al
      // día de la venta (misma ventana local que usa la liquidación).
      .or(`fecha_carrera.eq.${dia},and(fecha_carrera.is.null,fecha_registro.gte.${desde},fecha_registro.lt.${hasta})`)
      .ilike("nombre_jugada", "TABLA FIJA%")
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
