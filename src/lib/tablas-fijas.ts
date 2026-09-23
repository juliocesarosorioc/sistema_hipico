import { supabase } from "@/lib/supabase";

/** Fila mínima de tablas_fijas (solo lo que consume la SPA). */
export type TablaFijaRow = {
  id: string | number;
  hipodromo?: string | null;
  hipodromo_id?: string | number | null;
  carrera?: number | null;
  fecha?: string | null;
  estado?: string | null;
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