import { supabase } from "@/lib/supabase";
import type { EjemplarTabla, TablaGrupo } from "@/lib/tablas/tipos";

/** Fila de tablas_fijas (mínima para cierre + completa para el Monitor). */
export type TablaFijaRow = {
  id: string | number;
  hipodromo?: string | null;
  hipodromo_id?: string | number | null;
  carrera?: number | null;
  fecha?: string | null;
  /** Día del evento cuando la columna "fecha" está NULL (fix legacy 2026-09-19). */
  fecha_creacion?: string | null;
  estado?: string | null;
  premio_original?: number | null;
  premio_recalculado?: number | null;
  suma_base_tabla?: number | null;
  limite_ventas?: number | null;
  cantidad_vendida?: number | null;
  moneda?: string | null;
  tasa_cambio?: number | null;
  distancia_carrera?: string | null;
  superficie?: string | null;
  retirados_oficiales?: string | null;
  comision_grupo?: number | null;
  grupo_venta?: string | null;
  monto_tabla?: number | null;
  caballos?: EjemplarTabla[] | null;
  tabla_grupos?: TablaGrupo[] | null;
};

export type ResultadoCerrar = {
  ok: boolean;
  error?: string;
  conteo?: number;
};

/**
 * Auto-cierre de la Tabla Fija publicada de una carrera.
 * Cambia estado → 'Cerrada' para que deje de aparecer como Abierta en el
 * módulo de Tablas Fijas (evita carreras abiertas sin cerrar).
 * RLS está desactivado sobre tablas_fijas → UPDATE directo válido.
 */
export async function cerrarTablaFija(
  hipodromo: string,
  carrera: number | string
): Promise<ResultadoCerrar> {
  if (!supabase) {
    return { ok: false, error: "Sin credenciales Supabase (.env.local)." };
  }
  try {
    let query = supabase
      .from("tablas_fijas")
      .update({ estado: "Cerrada" })
      .eq("carrera", carrera);
    if (hipodromo) query = query.eq("hipodromo", hipodromo);

    const { error, data } = await query.select("id");

    if (error) return { ok: false, error: error.message };
    return { ok: true, conteo: (data ?? []).length };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}