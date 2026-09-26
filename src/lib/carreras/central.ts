/**
 * Carreras del Día — servicio CENTRAL de la jornada.
 * Fuente de verdad: tabla `resultados_carreras` (unique fecha+hipódromo+carrera,
 * RLS off). Desde este editor se registran las carreras que se van a jugar,
 * incluso SIN ejemplares con nombre (basta el Nº de caballos que corren) para
 * poder apostar por número y resolver al cargar la pizarra.
 *
 * `listarCarrerasPorDia` (lib/tablas/rpc) ya cruza esta tabla + programa_dia +
 * tablas_fijas, así que el semáforo de Gestión/taquilla y Marcas ven cualquier
 * carrera registrada aquí de inmediato.
 */
import { supabase } from "@/lib/supabase";
import { hoyLocal } from "@/lib/gaceta/programa";

export type EjemplarCarreraCentral = {
  numero: string;
  nombre?: string | null;
  nacionalidad?: string | null;
};

export type CarreraCentral = {
  id?: string | number;
  fecha: string;
  hipodromo: string;
  carrera: number;
  /** Ejemplares inscritos — pueden tener solo número (sin nombre). */
  caballos?: EjemplarCarreraCentral[];
  distancia?: string | null;
  superficie?: string | null;
  premio?: number | null;
  hora?: string | null;
  estado?: string;
  updated_at?: string | null;
};

export type ResCarreras = { ok: boolean; datos?: CarreraCentral[]; error?: string };

function normalizarCaballos(raw: unknown): EjemplarCarreraCentral[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((c) => {
      const x = (c ?? {}) as Record<string, unknown>;
      return {
        numero: String(x.numero ?? "").trim(),
        nombre: x.nombre != null ? String(x.nombre) : null,
        nacionalidad: x.nacionalidad != null ? String(x.nacionalidad) : null,
      };
    })
    .filter((c) => c.numero);
}

/** Números 1..n para generar ejemplares "solo número" (sin nombres). */
export function numerosEjemplares(n: number): EjemplarCarreraCentral[] {
  return Array.from({ length: n }, (_, i) => ({ numero: String(i + 1) }));
}

/**
 * Lista las carreras del día CENTRALES para [fecha + hipódromo] desde
 * resultados_carreras. Devuelve también carreras "Programada" (sin resultados).
 */
export async function listarCarrerasCentrales(
  fecha?: string,
  hipodromo?: string
): Promise<ResCarreras> {
  const f = fecha || hoyLocal();
  const hip = String(hipodromo ?? "").trim().toUpperCase();
  if (!supabase) return { ok: false, error: "Sin credenciales Supabase (.env.local)." };
  try {
    let q = supabase
      .from("resultados_carreras")
      .select("id, fecha, hipodromo, carrera, caballos, distancia, superficie, premio, hora, ganadores, aplicado_a_tablas, updated_at")
      .eq("fecha", f);
    if (hip) q = q.eq("hipodromo", hip);
    const { data, error } = await q.order("carrera");
    if (error) return { ok: false, error: error.message };
    return {
      ok: true,
      datos: (data ?? []).map((r) => {
        const raw = r as Record<string, unknown>;
        return {
          id: raw.id != null ? String(raw.id) : undefined,
          fecha: f,
          hipodromo: String(raw.hipodromo ?? "").trim().toUpperCase(),
          carrera: Number(raw.carrera) || 0,
          caballos: normalizarCaballos(raw.caballos),
          distancia: raw.distancia != null ? String(raw.distancia) : null,
          superficie: raw.superficie != null ? String(raw.superficie) : null,
          premio: raw.premio != null ? Number(raw.premio) : null,
          hora: raw.hora != null ? String(raw.hora) : null,
          estado: "Estado",
          updated_at: raw.updated_at != null ? String(raw.updated_at) : null,
        };
      }),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * UPSERT de la carrera central (unique fecha+hipódromo+carrera).
 * Persiste datos de la prueba + ejemplares (que pueden ser solo números).
 */
export async function guardarCarreraCentral(c: CarreraCentral): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin credenciales Supabase (.env.local)." };
  const hip = String(c.hipodromo ?? "").trim().toUpperCase();
  const num = Number(c.carrera) || 0;
  if (!hip || !num) return { ok: false, error: "Hipódromo y Nº de carrera requeridos." };
  const fila = {
    fecha: c.fecha || hoyLocal(),
    hipodromo: hip,
    carrera: num,
    caballos: Array.isArray(c.caballos) ? c.caballos.map((x) => ({ numero: String(x.numero).trim(), nombre: x.nombre ?? null, nacionalidad: x.nacionalidad ?? null })) : [],
    distancia: c.distancia ?? null,
    superficie: c.superficie ?? null,
    premio: c.premio != null ? Number(c.premio) : null,
    hora: c.hora ?? null,
  };
  try {
    const { error } = await supabase.from("resultados_carreras").upsert(fila, { onConflict: "fecha,hipodromo,carrera" });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Elimina la carrera del día CENTRAL (solo la oferta de carrera — NO borra
 * tablas fijas publicadas ni jugadas ya registradas).
 */
export async function eliminarCarreraCentral(fecha: string, hipodromo: string, carrera: number | string): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin credenciales Supabase (.env.local)." };
  try {
    const { error } = await supabase
      .from("resultados_carreras")
      .delete()
      .eq("fecha", fecha)
      .eq("hipodromo", String(hipodromo).trim().toUpperCase())
      .eq("carrera", Number(carrera) || 0);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}