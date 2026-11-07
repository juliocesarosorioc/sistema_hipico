import { supabase } from "@/core/supabase";

export type EjemplarModalTablasYRemates = {
  numero_ejemplar: string;
  nombre: string;
  morning_line: string | null;
  retirado?: boolean;
};

export type EjemplarModalDupletaYPolla = {
  numero_ejemplar: string;
  nombre: string;
  retirado?: boolean;
};

/**
 * Filtro ligero en memoria para Modal Tablas Fijas y Remates:
 * Expone exclusivamente `numero_ejemplar`, `nombre` y `morning_line`.
 * Oculta y retira todo dato histórico y analítico profundo interno.
 */
export function filtrarParaTablasYRemates(
  ejemplares: Array<Record<string, unknown>>
): EjemplarModalTablasYRemates[] {
  if (!Array.isArray(ejemplares)) return [];
  return ejemplares.map((e) => {
    const num = String(e.numero_ejemplar ?? e.numero_programa ?? e.numero ?? "").trim();
    const nom = String(e.nombre ?? "").trim().toUpperCase();
    const ml = e.morning_line != null ? String(e.morning_line) : e.ml != null ? String(e.ml) : null;
    const ret = Boolean(e.retirado);
    return {
      numero_ejemplar: num,
      nombre: nom,
      morning_line: ml,
      retirado: ret,
    };
  });
}

/**
 * Filtro ligero en memoria para Modal Dupleta, Polla y 5y6:
 * Expone exclusivamente `numero_ejemplar` y `nombre`.
 * Oculta y retira todo dato histórico y analítico profundo interno.
 */
export function filtrarParaDupletaYPolla(
  ejemplares: Array<Record<string, unknown>>
): EjemplarModalDupletaYPolla[] {
  if (!Array.isArray(ejemplares)) return [];
  return ejemplares.map((e) => {
    const num = String(e.numero_ejemplar ?? e.numero_programa ?? e.numero ?? "").trim();
    const nom = String(e.nombre ?? "").trim().toUpperCase();
    const ret = Boolean(e.retirado);
    return {
      numero_ejemplar: num,
      nombre: nom,
      retirado: ret,
    };
  });
}

/**
 * Consulta la vista ligera `public.vw_modal_tablas_y_remates`.
 * Si no está disponible en Supabase, recurre a fallback.
 */
export async function consultarModalTablasYRemates(
  hipodromo: string,
  carrera: number,
  fecha: string
): Promise<EjemplarModalTablasYRemates[]> {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from("vw_modal_tablas_y_remates")
      .select("numero_ejemplar, nombre, morning_line, retirado")
      .ilike("hipodromo", `%${hipodromo.trim()}%`)
      .eq("carrera", carrera)
      .eq("fecha", fecha);

    if (error || !data) {
      return [];
    }

    return (data as Array<{
      numero_ejemplar: string;
      nombre: string;
      morning_line: string | null;
      retirado: boolean;
    }>).map((r) => ({
      numero_ejemplar: String(r.numero_ejemplar),
      nombre: String(r.nombre),
      morning_line: r.morning_line,
      retirado: Boolean(r.retirado),
    }));
  } catch {
    return [];
  }
}

/**
 * Consulta la vista ligera `public.vw_modal_dupleta_y_polla`.
 * Si no está disponible en Supabase, recurre a fallback.
 */
export async function consultarModalDupletaYPolla(
  hipodromo: string,
  carrera: number,
  fecha: string
): Promise<EjemplarModalDupletaYPolla[]> {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from("vw_modal_dupleta_y_polla")
      .select("numero_ejemplar, nombre, retirado")
      .ilike("hipodromo", `%${hipodromo.trim()}%`)
      .eq("carrera", carrera)
      .eq("fecha", fecha);

    if (error || !data) {
      return [];
    }

    return (data as Array<{
      numero_ejemplar: string;
      nombre: string;
      retirado: boolean;
    }>).map((r) => ({
      numero_ejemplar: String(r.numero_ejemplar),
      nombre: String(r.nombre),
      retirado: Boolean(r.retirado),
    }));
  } catch {
    return [];
  }
}
