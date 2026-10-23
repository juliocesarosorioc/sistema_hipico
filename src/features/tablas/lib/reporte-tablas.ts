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
import { numerosInvalidados } from "@/features/tablas/lib/tablas-fijas";
import type { EjemplarTabla } from "@/features/tablas/lib/tipos";

export type ResultadoCargaVentas = {
  ok: boolean;
  ventas: VentaTablaReporte[];
  error?: string;
};

/**
 * Marca las ventas cuyo ejemplar quedo INVALIDADO (descalificado) en la tabla
 * fija de la que salieron.
 *
 * El ticket no sabe nada del invalidamiento: lo sabe la TABLA (el array
 * `caballos`). Por eso se cruzan las dos cosas: la venta lleva el id de su
 * tabla en la nota de auditoria, y de ahi se leen los ejemplares invalidados.
 *
 * Sin esta marca el reporte contaria al descalificado como ganador (o como
 * perdedor normal) y no se veria por que ese ticket no cobro.
 */
async function marcarInvalidados(ventas: VentaTablaReporte[]): Promise<VentaTablaReporte[]> {
  if (!supabase) return ventas;
  const ids = [...new Set(ventas.map((v) => v.tablaId ?? "").filter((x) => x !== ""))];
  if (!ids.length) return ventas;
  // `tablas_fijas.id` es bigint: los ids que no son numero no son de una
  // tabla fija y se dejan fuera de la consulta.
  const numIds = ids.map((x) => Number(x)).filter((n) => Number.isFinite(n));
  if (!numIds.length) return ventas;
  try {
    const { data, error } = await supabase
      .from("tablas_fijas")
      .select("id, caballos")
      .in("id", numIds);
    if (error) return ventas;
    const invalidados = new Map<string, Set<string>>();
    for (const fila of (data ?? []) as Array<{ id?: unknown; caballos?: unknown }>) {
      const caballos = Array.isArray(fila.caballos) ? (fila.caballos as EjemplarTabla[]) : [];
      const lista = new Set(numerosInvalidados(caballos));
      if (lista.size) invalidados.set(String(fila.id), lista);
    }
    if (!invalidados.size) return ventas;
    return ventas.map((v) => ({
      ...v,
      invalidado: invalidados.get(v.tablaId ?? "")?.has(v.numero) ?? false,
    }));
  } catch {
    // Best-effort: sin la cruce el reporte sale como antes (sin la marca).
    return ventas;
  }
}

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
    const ventas = ((data ?? []) as Record<string, unknown>[]).map(normalizarVenta);
    return {
      ok: true,
      ventas: await marcarInvalidados(ventas),
    };
  } catch (e) {
    return { ok: false, ventas: [], error: e instanceof Error ? e.message : String(e) };
  }
}
