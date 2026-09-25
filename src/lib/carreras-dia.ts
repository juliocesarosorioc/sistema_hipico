/**
 * Centralización de resultados de carreras del día.
 * La tabla public.resultados_carreras (paquete SQL, RLS off) es la fuente de
 * verdad compartida entre módulos: los resultados + pizarra se persistén aquí
 * y el store "Carreras del Día" (sistema-hipico:carreras-dia) mantiene las
 * ventas/estado en vivo para la UI (sincronizado entre pestañas por persist).
 */
import { supabase } from "@/lib/supabase";
import { useCarrerasDiaStore, type CarreraDelDia } from "@/store/useCarrerasDiaStore";
import { leerProgramaPorFecha, guardarPrograma, hoyLocal } from "@/lib/gaceta/programa";

export type ResultadoCentralInput = {
  fecha?: string;
  hipodromo: string;
  carrera: number | string;
  ganadores: string[];
  retirados: string;
  premio_oficial?: number;
  premio_recalculado?: number;
  detalle?: unknown;
  orden_llegada?: unknown;
  dividendos?: unknown;
  cargado_por?: string;
};

function hoy(): string {
  // Fecha LOCAL (no UTC): con toISOString().slice(0,10) entre 20:00 y 24:00
  // (UTC−4) se escribía el DÍA ANTERIOR → jornadas que "desaparecían" del
  // filtro por fecha. ISO 8601 estricto con la fecha que ve el operador.
  return hoyLocal();
}

function normalizarRenglon(r: Record<string, unknown>): CarreraDelDia {
  const detalle = (Array.isArray(r.detalle) ? r.detalle : {}) as Record<string, unknown>;
  const ventas = Array.isArray(detalle.ventas)
    ? (detalle.ventas as CarreraDelDia["ventas"])
    : [];
  const pagado = detalle.pago;
  return {
    fecha: String(r.fecha ?? hoy()).slice(0, 10),
    hipodromo: String(r.hipodromo ?? "").trim().toUpperCase(),
    carrera: Number(r.carrera) || 0,
    estado: Boolean(r.aplicado_a_tablas)
      ? "Liquidada"
      : Array.isArray(r.ganadores) && (r.ganadores as unknown[]).length
        ? "Resultados"
        : "Programada",
    ganadores: Array.isArray(r.ganadores) ? (r.ganadores ?? []).map(String) : undefined,
    retirados: r.retirados ? String(r.retirados) : undefined,
    premio_oficial: r.premio_oficial != null ? Number(r.premio_oficial) : undefined,
    premio_recalculado: r.premio_recalculado != null ? Number(r.premio_recalculado) : undefined,
    aplicado_a_tablas: Boolean(r.aplicado_a_tablas),
    cargado_por: r.cargado_por ? String(r.cargado_por) : undefined,
    ventas,
    pago: pagado ? (pagado as CarreraDelDia["pago"]) : null,
    updatedAt: r.updated_at ? String(r.updated_at) : undefined,
  };
}

/** Trae las carreras del día desde resultados_carreras y alimenta el store. */
export async function cargarCarrerasDelDia(fecha?: string): Promise<CarreraDelDia[]> {
  const res: CarreraDelDia[] = [];
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from("resultados_carreras")
        .select("*")
        .eq("fecha", fecha || hoy())
        .order("carrera");
      if (error) throw error;
      for (const r of (data ?? []) as unknown[]) {
        res.push(normalizarRenglon(r as Record<string, unknown>));
      }
    } catch {
      /* sin tabla → ledger local */
    }
  }
  if (res.length) useCarrerasDiaStore.getState().setCarreras(res);
  return res;
}

/**
 * Registra una carrera manual (Modo Manual / bypass Gaceta) contra la BD.
 * Orden de persistencia (best-effort, nunca rompe el flujo local):
 *   1) resultados_carreras (upsert fecha+hipódromo+carrera) — si el RLS de
 *      producción lo permite;
 *   2) Programa del Día vía RPC club_guardar_programa_dia (security definer,
 *      grant anon) — merge de la carrera en la jornada existente.
 * listarCarrerasPorDia cruza ambas fuentes, así el semáforo de la Taquilla
 * siempre ve la carrera.
 */
export async function registrarCarreraProgramada(
  input: { fecha?: string; hipodromo: string; carrera: number | string }
): Promise<{ ok: boolean; error?: string }> {
  const f = input.fecha || hoy();
  const hip = String(input.hipodromo).trim().toUpperCase();
  const num = Number(input.carrera) || 0;
  if (!hip || !num) return { ok: false, error: "Hipódromo y carrera requeridos." };
  if (!useCarrerasDiaStore.getState().existeCarrera(hip, num, f)) {
    useCarrerasDiaStore.getState().upsert({
      fecha: f,
      hipodromo: hip,
      carrera: num,
      estado: "Programada",
      ventas: [],
    });
  }
  if (!supabase) return { ok: true };

  let errorPersistir: string | undefined;
  if (supabase) {
    try {
      const { error } = await supabase.from("resultados_carreras").upsert(
        {
          fecha: f,
          hipodromo: hip,
          carrera: num,
          ganadores: [],
          aplicado_a_tablas: false,
        },
        { onConflict: "fecha,hipodromo,carrera" }
      );
      if (error) errorPersistir = error.message;
      else return { ok: true };
    } catch (e) {
      errorPersistir = e instanceof Error ? e.message : String(e);
    }
  }

  // Fallback: Programa del Día (RPC security definer). Merge en la jornada.
  try {
    const leido = await leerProgramaPorFecha(f);
    const prev = leido.data;
    const carreras = [...(prev?.carreras ?? [])];
    const ya = carreras.some(
      (c) => c.hipodromo.toUpperCase() === hip && Number(c.carrera) === num
    );
    if (!ya) carreras.push({ hipodromo: hip, fecha: f, carrera: num, caballos: [] });
    const hipodromos = [...new Set([...(prev?.hipodromos ?? []).map((h) => h.toUpperCase()), hip])];
    const r = await guardarPrograma({ fecha: f, hipodromos, carreras, resumen: `${carreras.length} carrera(s)`, creado_por: "modo manual" }, "modo manual");
    if (r.ok) return { ok: true, error: errorPersistir ? `(resultados_carreras: ${errorPersistir})` : undefined };
    return { ok: false, error: `${r.error ?? "desconocido"}${errorPersistir ? `; resultados_carreras: ${errorPersistir}` : ""}` };
  } catch (e) {
    return { ok: false, error: `${e instanceof Error ? e.message : String(e)}${errorPersistir ? `; resultados_carreras: ${errorPersistir}` : ""}` };
  }
}

/**
 * Persisté el resultado central (upsert por fecha+hipodromo+carrera) y
 * actualiza el store. Las ventas de la sesión viajan dentro de detalle.ventas
 * y detalle.pago para sobrevivir al cierre de pestaña / recarga.
 */
export async function upsertResultadoCentral(
  input: ResultadoCentralInput
): Promise<{ ok: boolean; error?: string }> {
  const f = input.fecha || hoy();
  const estado = useCarrerasDiaStore.getState().estadoDe(input.hipodromo, input.carrera);
  const ventas = estado?.ventas ?? [];
  const pago = estado?.pago ?? null;

  // Actualiza el store (fuente en vivo, se paga si había ventas ganadoras).
  useCarrerasDiaStore.getState().upsert({
    fecha: f,
    hipodromo: String(input.hipodromo).trim().toUpperCase(),
    carrera: Number(input.carrera) || 0,
    estado: "Liquidada",
    ganadores: input.ganadores,
    retirados: input.retirados,
    premio_oficial: input.premio_oficial,
    premio_recalculado: input.premio_recalculado,
    aplicado_a_tablas: true,
    cargado_por: input.cargado_por,
    ventas,
    pago,
  });
  useCarrerasDiaStore.getState().pagar(input.hipodromo, input.carrera, input.premio_recalculado ?? 0, f);

  if (!supabase) return { ok: true };
  try {
    const detalle = {
      ventas: useCarrerasDiaStore.getState().estadoDe(input.hipodromo, input.carrera)?.ventas ?? ventas,
      pago: useCarrerasDiaStore.getState().estadoDe(input.hipodromo, input.carrera)?.pago ?? pago,
    };
    await supabase
      .from("resultados_carreras")
      .upsert(
        {
          fecha: f,
          hipodromo: String(input.hipodromo).trim().toUpperCase(),
          carrera: Number(input.carrera) || 0,
          ganadores: input.ganadores,
          retirados: input.retirados,
          premio_oficial: input.premio_oficial ?? null,
          premio_recalculado: input.premio_recalculado ?? null,
          detalle,
          aplicado_a_tablas: true,
          cargado_por: input.cargado_por ?? null,
          orden_llegada: input.orden_llegada ?? null,
          dividendos: input.dividendos ?? null,
        },
        { onConflict: "fecha,hipodromo,carrera" }
      );
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}