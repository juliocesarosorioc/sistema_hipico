/**
 * Carga de las MARCAS JUGADAS de un día para su reporte.
 *
 * Cada jugada de marca escribe un ticket en `tickets_apuestas` con
 * `nombre_jugada = 'MARCA <n>'` y `nota_auditoria.origen = 'MARCAS'`
 * (ver sql/marcas_venta.sql). Acá se leen TODAS las del día en UNA sola consulta
 * y se normalizan con el núcleo (`normalizarMarca`); los filtros por grupo,
 * hipódromo, carrera y jugador se aplican en memoria, igual que en el reporte de
 * Tablas Fijas.
 *
 * El día es el de la CARRERA, no el de la venta: una jugada pertenece a la
 * jornada que corre, que es la que abre el modal de Marcas. La columna
 * `fecha_carrera` la mantiene el trigger `trg_tickets_fecha_carrera`
 * (sql/fecha_carrera_tickets.sql); para las filas heredadas sin columna se cae a
 * la ventana local de `fecha_registro`, como hace el Reporte Diario.
 */
import { supabase } from "@/core/supabase";
import { ventanaDiaLocal } from "@/features/liquidacion/lib/fecha";
import { normalizarMarcas } from "@/features/marcas/lib/reporte-marcas-nucleo";
import type { VentaTablaReporte } from "@/features/tablas/lib/reporte-tablas-nucleo";

export type ResultadoCargaMarcas = {
  ok: boolean;
  ventas: VentaTablaReporte[];
  error?: string;
};

export async function cargarMarcasJugadas(fecha: string): Promise<ResultadoCargaMarcas> {
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
      .ilike("nombre_jugada", "MARCA %")
      .order("fecha_registro");
    if (error) return { ok: false, ventas: [], error: error.message };
    return { ok: true, ventas: normalizarMarcas((data ?? []) as Record<string, unknown>[]) };
  } catch (e) {
    return { ok: false, ventas: [], error: e instanceof Error ? e.message : String(e) };
  }
}