/**
 * Carga de los REMATES vendidos de un día para su reporte contable.
 *
 * Al cerrar un remate, `sql/remate_cierre.sql` inserta UN ticket por ejemplar
 * vendido en `tickets_apuestas` con `nombre_jugada = 'REMATE <HIPO> (C<n>)'`.
 * Ese ticket NO es una apuesta con premio: es una VENTA. El comprador ya pagó y
 * el dinero quedó para la casa, así que contablemente es una jugada PERDIDA:
 *
 *   · `Pagado`  = 0 (no hay premio que devolverle al comprador);
 *   · `Cobrado` = monto × (1 − % convenio del grupo que publicó el remate).
 *
 * El cierre deja el ticket `Pendiente` cuando no hay banquero y `Perdedor`
 * cuando lo hay; para que el reporte no dependa de ese detalle se normaliza
 * todo a `Perdedor`, salvo un eventual `Retirado` (que sí se reembolsa).
 *
 * Mismo criterio de día que los otros reportes: manda `fecha_carrera` (la nota
 * del remate) y, para filas heredadas sin columna, la ventana local de
 * `fecha_registro`.
 */
import { supabase } from "@/core/supabase";
import { ventanaDiaLocal } from "@/features/liquidacion/lib/fecha";
import {
  estadoNormalizado,
  normalizarVenta,
  type VentaTablaReporte,
} from "@/features/tablas/lib/reporte-tablas-nucleo";

export type ResultadoCargaRemates = {
  ok: boolean;
  ventas: VentaTablaReporte[];
  error?: string;
};

export async function cargarRematesVendidos(fecha: string): Promise<ResultadoCargaRemates> {
  if (!supabase) return { ok: false, ventas: [], error: "Sin credenciales Supabase (.env.local)." };
  const dia = String(fecha ?? "").slice(0, 10);
  if (!dia) return { ok: false, ventas: [], error: "Indique el día del reporte." };
  const { desde, hasta } = ventanaDiaLocal(dia);
  try {
    const { data, error } = await supabase
      .from("tickets_apuestas")
      .select("*")
      .or(`fecha_carrera.eq.${dia},and(fecha_carrera.is.null,fecha_registro.gte.${desde},fecha_registro.lt.${hasta})`)
      .ilike("nombre_jugada", "REMATE %")
      .order("fecha_registro");
    if (error) return { ok: false, ventas: [], error: error.message };

    const ventas = ((data ?? []) as Record<string, unknown>[]).map((row) => {
      const venta = normalizarVenta(row);
      // La venta de remate es dinero cobrado: no hay premio. Se deja `Retirado`
      // intacto por si alguna devolución se registró con ese estado.
      if (estadoNormalizado(venta.estado) === "Retirado") return venta;
      return { ...venta, estado: "Perdedor" };
    });

    return { ok: true, ventas };
  } catch (e) {
    return { ok: false, ventas: [], error: e instanceof Error ? e.message : String(e) };
  }
}
