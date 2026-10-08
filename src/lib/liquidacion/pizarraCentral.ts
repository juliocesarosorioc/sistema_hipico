import { supabase } from "@/lib/supabase";
import { tieneCapacidad } from "@/lib/seguridad/vigente";
import { hoyLocal } from "@/lib/gaceta/programa";
import { dividendosDePizarra, ordenLlegadaDePizarra, posicionesDePizarra } from "@/lib/liquidacion/posiciones";
import { leerRetirosCarrera } from "@/lib/carreras/retiros";
import type { PizarraResultados } from "@/components/liquidacion/CargaResultadosModal";

/**
 * Las mismas claves que acepta `upsertResultadoCentral` / la RPC
 * `club_guardar_resultado_carrera` server-side, replicadas para que cualquier
 * módulo pueda abrir la MISMA pizarra de resultados compacta
 * (`CargaResultadosModal`) y centralizar en `resultados_carreras`. La pizarra
 * NO se guarda en cada módulo: se escribe una sola vez acá y todos los demás
 * módulos la leen desde el mismo lugar.
 */
export const PERMISOS_PIZARRA_CENTRAL = [
  "gestion_jugadas:fn_liquidar_carrera",
  "gestion_jugadas:btn_cargar_resultados",
  "taquilla:btn_cargar_resultados",
  "carreras:fn_registrar_carrera",
] as const;

export type ResultadoPizarraCentral = { ok: boolean; error?: string };

/**
 * Guarda la pizarra de resultados en `resultados_carreras` (fuente de verdad
 * única) pasando por la RPC `security definer`, igual que `upsertResultadoCentral`.
 *
 * A diferencia de ese upsert, acá NO se mandan llaves para premio/detalle/
 * `aplicado_a_tablas`: como la RPC no toca las columnas ausentes, una pizarra
 * cargada desde Pollas/Remates/WhatsApp/Marcas no le borra el premio ni el
 * estado de pago de tablas a una carrera ya liquidada.
 *
 * Los retirados vigentes se conservan: se leen primero y se devuelven tal cual,
 * así cargar la pizarra no borra retiros ya echados desde otro módulo.
 */
export async function guardarPizarraCentral(opts: {
  hipodromo: string;
  carrera: number | string;
  fecha?: string;
  cargado_por: string;
  r: PizarraResultados;
}): Promise<ResultadoPizarraCentral> {
  const hip = String(opts.hipodromo).trim().toUpperCase();
  const n = Number(opts.carrera) || 0;
  if (!hip || !n) return { ok: false, error: "Indica Hipódromo y N° de Carrera." };
  if (opts.r.llenas < 1 || !opts.r.pizarra.primero) {
    return { ok: false, error: "Indica el 1er lugar de la pizarra." };
  }
  if (!tieneCapacidad(...PERMISOS_PIZARRA_CENTRAL)) {
    return { ok: false, error: "Sin permiso para guardar resultados de carrera." };
  }
  if (!supabase) return { ok: true };

  const fecha = opts.fecha ?? hoyLocal();
  const retirados = await leerRetirosCarrera(fecha, hip, n);

  // `ganadores` es la lista de llegadas (1º..8º) que consumen las jugadas de
  // puestos y los reportes; `orden_llegada` viaja aparte como {numero, puesto}.
  const fila = {
    ganadores: posicionesDePizarra(opts.r.pizarra),
    orden_llegada: ordenLlegadaDePizarra(opts.r.pizarra),
    dividendos: dividendosDePizarra(opts.r),
    retirados: retirados.length ? retirados.join(", ") : "NO HUBO RETIROS",
    cargado_por: opts.cargado_por,
  };

  const res = await supabase.rpc("club_guardar_resultado_carrera", {
    p_fecha: fecha,
    p_hipodromo: hip,
    p_carrera: n,
    p_fila: fila,
  });
  if (!res.error) return { ok: true };

  const texto = String(res.error.message ?? res.error);
  // La RPC todavía no existe en Supabase (SQL sin correr): caída al upsert
  // directo mergeando la fila previa para no pisar premios ni detalle.
  if (/PGRST202|not found|does not exist|404/i.test(texto)) {
    const sel = await supabase
      .from("resultados_carreras")
      .select("*")
      .eq("fecha", fecha)
      .eq("carrera", n)
      .maybeSingle();
    const prev = (sel.data ?? {}) as Record<string, unknown>;
    const u = await supabase
      .from("resultados_carreras")
      .upsert({ fecha, hipodromo: hip, carrera: n, ...prev, ...fila }, { onConflict: "fecha,hipodromo,carrera" });
    return u.error ? { ok: false, error: String(u.error.message) } : { ok: true };
  }
  return { ok: false, error: texto };
}