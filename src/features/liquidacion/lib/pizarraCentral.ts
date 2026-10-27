import { supabase } from "@/core/supabase";
import { tieneCapacidad } from "@/features/seguridad/lib/vigente";
import { hoyLocal } from "@/features/gaceta/lib/programa";
import {
  CAMPOS_POSICION,
  dividendosDePizarra,
  ordenLlegadaDePizarra,
  posicionesDePizarra,
} from "@/features/liquidacion/lib/posiciones";
import type { PizarraCarrera } from "@/features/liquidacion/lib/liquidacion";
import { PREFIJO_WPS } from "@/features/motores/lib/wps";
import { leerRetirosCarrera } from "@/features/carreras/lib/retiros";
import { jornadaDeCarrera, type ResultadoOficial } from "@/features/carreras/lib/carreras-dia";
import type { PizarraResultados } from "@/features/liquidacion/components/CargaResultadosModal";
import { aplicarLiquidacionSaldos } from "@/features/liquidacion/lib/saldos";
import { liquidarJugadasDeCarrera, type ResumenJugadas } from "@/features/liquidacion/lib/pagarYCerrar";

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
  /** Liquida TODAS las jugadas de la carrera tras guardar el resultado
   *  (tablas fijas, marcas, dupletas y la liquidación universal de los tickets
   *  reales de taquilla). Por defecto `true`: registrar el resultado paga.
   *  Pasar `false` SOLO cuando el caller liquida por su cuenta acto seguido
   *  (Gestión de Jugadas con sus tickets de sesión), para no pagar dos veces. */
  liquidar?: boolean;
  /** Comisión de la carrera para el motor universal (solo si `liquidar`). */
  tasaComision?: number | null;
  usuario?: string | null;
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

  const fecha = opts.fecha || (await jornadaDeCarrera(hip, n)) || hoyLocal();
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
  if (!res.error) {
    await liquidarTrasPizarra({ hipodromo: hip, carrera: n, fecha, r: opts.r, liquidar: opts.liquidar, tasaComision: opts.tasaComision, usuario: opts.usuario });
    return { ok: true };
  }

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
    if (u.error) return { ok: false, error: String(u.error.message) };
    await liquidarTrasPizarra({ hipodromo: hip, carrera: n, fecha, r: opts.r, liquidar: opts.liquidar, tasaComision: opts.tasaComision, usuario: opts.usuario });
    return { ok: true };
  }
  return { ok: false, error: texto };
}

/**
 * Tras escribir el resultado en el central, LIQUIDA todas las jugadas que
 * dependen de él —por el mismo pipeline que usa la liquidación completa— para
 * que registrar el resultado UNA vez pague tablas fijas, marcas, dupletas y las
 * jugadas de taquilla. Best-effort: un fallo acá no revierte el resultado ya
 * guardado (se podría re-liquidar con el botón de re-apertura).
 */
async function liquidarTrasPizarra(opts: {
  hipodromo: string;
  carrera: number;
  fecha: string;
  r: PizarraResultados;
  liquidar?: boolean;
  tasaComision?: number | null;
  usuario?: string | null;
}): Promise<ResumenJugadas | null> {
  if (opts.liquidar === false) return null;
  try {
    const dividendos = dividendosDePizarra(opts.r);
    // 1) Jugadas de taquilla (GANADOR/PUESTOS/WPS/PAREOS, remates) sobre los
    //    tickets REALES de la carrera, no los de la sesión.
    await aplicarLiquidacionSaldos({
      hipodromo: opts.hipodromo,
      carrera: opts.carrera,
      pizarra: opts.r.pizarra,
      dividendos,
      premio_por_tabla: opts.r.premio_por_tabla ?? null,
      tasaComision: opts.tasaComision ?? null,
      fecha: opts.fecha,
    });
    // 2) Tablas fijas + marcas + dupletas.
    return await liquidarJugadasDeCarrera({
      hipodromo: opts.hipodromo,
      carrera: opts.carrera,
      fecha: opts.fecha,
      pizarra: opts.r.pizarra,
      usuario: opts.usuario,
    });
  } catch {
    return null;
  }
}

/**
 * Reconstruye una pizarra editable (`PizarraResultados`) a partir del resultado
 * OFICIAL ya guardado en `resultados_carreras` (`leerResultadoOficial`).
 *
 * Sirve para PRECARGAR el `CargaResultadosModal`: si la carrera ya tiene
 * resultados cargados (y probablemente pagados), el operador no debe volver a
 * tipear la llegada completa — abre el modal con todo puesto y solo edita lo
 * que haga falta.
 *
 * El central guarda posiciones (`ganadores`/`orden_llegada`) y dividendos
 * (`dividendos`, con las claves W/P/S ya prefijadas `wps_`). Lo que NO guarda es
 * la lista de empates, así que se devuelve vacía: el operador puede volver a
 * marcar los que correspondan. El redondeo a 8 posiciones es por el tope del
 * formulario (`CAMPOS_POSICION`).
 */
export function pizarraDesdeResultadoOficial(of: ResultadoOficial): PizarraResultados {
  const pizarra: PizarraCarrera = { primero: "" };
  const puestos = of.puestos ?? [];
  CAMPOS_POSICION.forEach((campo, i) => {
    const n = String(puestos[i] ?? "").trim();
    if (n) pizarra[campo] = n;
  });
  if (Array.isArray(of.puestosRaya) && of.puestosRaya.length > 0 && of.puestosRaya.join(",") !== puestos.join(",")) {
    pizarra.primero_raya = of.puestosRaya[0];
    pizarra.orden_llegada_raya = of.puestosRaya;
  }

  const dividendos: Record<string, number> = {};
  const matrizWps: Record<string, number> = {};
  for (const [k, v] of Object.entries(of.dividendos ?? {})) {
    if (k.startsWith(PREFIJO_WPS)) matrizWps[k] = v;
    else dividendos[k] = v;
  }

  return {
    pizarra,
    empates: [],
    llenas: posicionesDePizarra(pizarra).length,
    dividendos: Object.keys(dividendos).length ? dividendos : null,
    matrizWps: Object.keys(matrizWps).length ? matrizWps : null,
  };
}
