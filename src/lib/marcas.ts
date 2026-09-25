/**
 * Servicio de MARCAS — persistencia en tabla `marcas_dia`
 * (unique por hipódromo + fecha). Una fila por carrera del día con los
 * caballos "marcados" (divididos por "/"), la leyenda NV (No Vale) y los
 * caballos "en contra" (separados por ","). Las condiciones editables viajan
 * junto con el día.
 */
import { supabase } from "@/lib/supabase";
import { hoyLocal } from "@/lib/gaceta/programa";

export const CONDICIONES_MARCAS_DEFECTO =
  "MARCA 120.000,00 BS P/100.000,00 BS O 120 P/100$ 15 MIN DE VIGENCIA. " +
  "ORDEN OFICIAL, NO VALEN DEBUTANTES EN VENEZUELA. " +
  "NO VALEN LAS PRUEBAS ANULADAS, APLAZADAS NI LIMITADAS.";

export type FilaMarca = {
  carrera: string;
  marcadas: string;
  contra: string;
};

export type MarcasDia = {
  hipodromo: string;
  fecha: string;
  filas: FilaMarca[];
  condiciones: string;
  updated_at?: string | null;
};

export const FILAS_MARCAS_DEFECTO = 14;

export function filaMarcaDefecto(i: number): FilaMarca {
  return { carrera: String(i + 1), marcadas: "", contra: "" };
}

export function filasMarcaDefecto(n: number = FILAS_MARCAS_DEFECTO): FilaMarca[] {
  return Array.from({ length: n }, (_, i) => filaMarcaDefecto(i));
}

export function normalizarFilaMarca(c: unknown): FilaMarca {
  const x = (c ?? {}) as Record<string, unknown>;
  return {
    carrera: String(x.carrera ?? ""),
    marcadas: String(x.marcadas ?? "").trim(),
    contra: String(x.contra ?? "").trim(),
  };
}

/** Lee la jornada de marcas de un hipódromo en una fecha (SELECT directo, tolerante). */
export async function leerMarcas(hipodromo: string, fecha: string): Promise<{ ok: boolean; datos?: MarcasDia | null; error?: string }> {
  const h = String(hipodromo ?? "").toUpperCase().trim();
  const f = fecha || hoyLocal();
  if (!h) return { ok: true, datos: null };
  if (!supabase) return { ok: true, datos: null };
  try {
    const { data, error } = await supabase
      .from("marcas_dia")
      .select("hipodromo, fecha, filas, condiciones, updated_at")
      .eq("hipodromo", h)
      .eq("fecha", f)
      .maybeSingle();
    if (error) return { ok: true, datos: null };
    if (!data) return { ok: true, datos: null };
    return {
      ok: true,
      datos: {
        hipodromo: h,
        fecha: f,
        filas: Array.isArray(data.filas) ? (data.filas as unknown[]).map(normalizarFilaMarca) : [],
        condiciones: String(data.condiciones ?? CONDICIONES_MARCAS_DEFECTO),
        updated_at: data.updated_at ? String(data.updated_at) : null,
      },
    };
  } catch {
    return { ok: true, datos: null };
  }
}

/** UPSERT de la jornada de marcas (hipódromo + fecha únicos). */
export async function guardarMarcas(d: MarcasDia): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin credenciales Supabase (.env.local)." };
  const filas = (d.filas || [])
    .filter((f) => f.carrera)
    .map(normalizarFilaMarca);
  const fila = {
    hipodromo: String(d.hipodromo ?? "").toUpperCase().trim(),
    fecha: d.fecha || hoyLocal(),
    filas,
    condiciones: String(d.condiciones || CONDICIONES_MARCAS_DEFECTO),
  };
  if (!fila.hipodromo) return { ok: false, error: "Falta el hipódromo." };
  try {
    const { error } = await supabase.from("marcas_dia").upsert(fila, { onConflict: "hipodromo,fecha" });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export type MarcasParaLiquidar = {
  marcados: string[];
  contra: string[];
};

/**
 * Config de Marcas de UNA carrera concreta (insumo del motor de liquidación).
 * Busca la fila de la carrera en la jornada del hipódromo + fecha y devuelve
 * la Izquierda (marcadas, separadas por "/") y la Derecha (contra, ",").
 * La SPA la inyecta en el ticket motor cuando la modalidad es MARCA.
 */
export async function marcasConfigParaCarrera(
  hipodromo: string,
  carrera: number | string,
  fecha?: string
): Promise<MarcasParaLiquidar | null> {
  const h = String(hipodromo ?? "").toUpperCase().trim();
  if (!h) return null;
  const r = await leerMarcas(h, fecha || hoyLocal());
  if (!r.ok || !r.datos || !r.datos.filas.length) return null;
  const fila = r.datos.filas.find(
    (f) => String(f.carrera).trim() === String(carrera).trim() || Number(f.carrera) === Number(carrera)
  );
  if (!fila) return null;
  if (!fila.marcadas.trim() && !fila.contra.trim()) return null;
  return {
    marcados: fila.marcadas ? fila.marcadas.split(/[/,;\s]+/).map((s) => s.trim()).filter(Boolean) : [],
    contra: fila.contra ? fila.contra.split(/[/,;\s]+/).map((s) => s.trim()).filter(Boolean) : [],
  };
}