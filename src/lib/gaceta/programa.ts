/**
 * Servicio del "Programa del Día" — paridad con el legacy js/components/programa_dia.js.
 * Cada jornada es UNA fila en la tabla compartida `programa_dia`
 * (unique por fecha) con hipódromos y carreras en JSONB. El shape de cada
 * carrera es el mismo que persiste la gaceta/ensamblaje:
 *   { hipodromo, fecha, carrera, distancia, superficie, premio, caballos:[...] }
 */
import { supabase } from "@/lib/supabase";

export type CaballoPrograma = {
  numero: string | number;
  nombre: string;
  nacionalidad: string;
  valor?: number;
  ejemplar_id?: string | number | null;
  nuevo?: boolean;
  jockey?: string;
  peso?: number | string;
};

export type CarreraPrograma = {
  hipodromo: string;
  fecha?: string | null;
  carrera: number | null;
  distancia?: number;
  superficie?: string;
  premio?: number;
  caballos: CaballoPrograma[];
};

export type ProgramaDia = {
  fecha: string;
  hipodromos: string[];
  carreras: CarreraPrograma[];
  resumen?: string;
  creado_por?: string | null;
};

export type ResPrograma = { ok: boolean; data?: ProgramaDia | null; error?: string };

/** Fecha local YYYY-MM-DD (misma regla que el legacy hoy()). */
export function hoyLocal(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${dd}`;
}

function norm(c: unknown): CarreraPrograma {
  const x = (c ?? {}) as Record<string, unknown>;
  const caballos = Array.isArray(x.caballos)
    ? (x.caballos as Array<Record<string, unknown>>).map((cb) => ({
        numero: (cb.numero ?? "") as string | number,
        nombre: String(cb.nombre ?? "").toUpperCase(),
        nacionalidad: String(cb.nacionalidad ?? "VE").toUpperCase() || "VE",
        valor: Number(cb.valor ?? cb.pts ?? 0) || 0,
        ejemplar_id: (cb.ejemplar_id as string | number | null | undefined) ?? null,
        jockey: cb.jockey ? String(cb.jockey) : undefined,
        peso: cb.peso !== undefined ? (cb.peso as string | number) : undefined,
      }))
    : [];
  return {
    hipodromo: String(x.hipodromo ?? "").toUpperCase(),
    fecha: x.fecha ? String(x.fecha) : null,
    carrera: x.carrera != null ? Number(x.carrera) || null : null,
    distancia: Number(x.distancia) || 0,
    superficie: String(x.superficie ?? "ARENA").toUpperCase() || "ARENA",
    premio: Number(x.premio) || 0,
    caballos,
  };
}

/** Lee la fila `fecha` del programa del día (RPC primero → SELECT directo con fallback). */
export async function leerProgramaPorFecha(fecha: string): Promise<ResPrograma> {
  if (!supabase) return { ok: true, data: null };
  const build = (t: Record<string, unknown> | null | undefined): ProgramaDia | null =>
    t
      ? {
          fecha: String(t.fecha ?? fecha),
          hipodromos: Array.isArray(t.hipodromos) ? t.hipodromos.map((h) => String(h).toUpperCase()) : [],
          carreras: Array.isArray(t.carreras) ? (t.carreras as unknown[]).map(norm) : [],
          resumen: t.resumen ? String(t.resumen) : "",
          creado_por: t.creado_por ? String(t.creado_por) : null,
        }
      : null;

  try {
    const viaRpc = await supabase.rpc("club_leer_programa_dia");
    if (!viaRpc.error && Array.isArray(viaRpc.data) && viaRpc.data.length) {
      const fila = viaRpc.data.find((x: Record<string, unknown>) => String(x.fecha) === fecha) ?? viaRpc.data[0];
      return { ok: true, data: build(fila) };
    }
  } catch {
    /* RPC inexistente → SELECT directo */
  }
  try {
    const { data, error } = await supabase
      .from("programa_dia")
      .select("fecha, hipodromos, carreras, resumen, creado_por, updated_at")
      .eq("fecha", fecha)
      .maybeSingle();
    if (error) return { ok: true, data: null };
    return { ok: true, data: build(data as Record<string, unknown> | null) };
  } catch {
    return { ok: true, data: null };
  }
}

/**
 * UPSERT masivo en `programa_dia` (RPC club_guardar_programa_dia → upsert por
 * `fecha`). Devuelve el programa persistido para reflejo inmediato en la UI.
 */
export async function guardarPrograma(p: ProgramaDia, creadoPor?: string): Promise<{ ok: boolean; data?: ProgramaDia; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin credenciales Supabase (.env.local)." };
  const fecha = p.fecha || hoyLocal();
  const hipodromos = [...new Set((p.hipodromos || []).map((h) => String(h).toUpperCase().trim()).filter(Boolean))];
  const carreras = (p.carreras || []).filter((c) => c.hipodromo).map(norm);
  const resumen = `${carreras.length} carrera(s) · ${hipodromos.join(", ")}`;
  const normP: ProgramaDia = { fecha, hipodromos, carreras, resumen, creado_por: creadoPor || "desconocido" };

  try {
    const r = await supabase.rpc("club_guardar_programa_dia", {
      p_fecha: fecha,
      p_hipodromos: hipodromos,
      p_carreras: carreras,
      p_creado_por: creadoPor || "desconocido",
    });
    if (r.error) throw r.error;
    return { ok: true, data: normP };
  } catch (e1) {
    try {
      const { error } = await supabase.from("programa_dia").upsert(normP, { onConflict: "fecha" });
      if (error) return { ok: false, error: error.message };
      return { ok: true, data: normP };
    } catch (e2) {
      return { ok: false, error: e2 instanceof Error ? e2.message : String(e2) };
    }
  }
}