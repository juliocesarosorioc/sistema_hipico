/**
 * Carga de las Tablas Fijas VENDIDAS de un día para el Reporte del Monitor.
 *
 * Filtra por el DÍA DE LA CARRERA (`filtroDiaJornada` + `perteneceADiaJornada`)
 * y sincroniza el estado de cada venta con los resultados oficiales cargados en
 * Gestión de Jugadas (`resultados_carreras`), evaluando por el 1° en Raya.
 */
import { supabase } from "@/core/supabase";
import { filtroDiaJornada, perteneceADiaJornada } from "@/features/liquidacion/lib/fecha";
import {
  normalizarVenta,
  type VentaTablaReporte,
} from "@/features/tablas/lib/reporte-tablas-nucleo";
import { numerosInvalidados } from "@/features/tablas/lib/tablas-fijas";
import type { EjemplarTabla } from "@/features/tablas/lib/tipos";
import { puestosDesdeOrdenLlegada } from "@/features/motores/lib/oficiales";
import { extraerOrdenLlegadaRaya } from "@/features/liquidacion/lib/posiciones";
import { claveHipodromo } from "@/features/carreras/lib/claves";

export type ResultadoCargaVentas = {
  ok: boolean;
  ventas: VentaTablaReporte[];
  error?: string;
};

type ResultadoTablaMapa = {
  ganadorRaya: string;
  retirados: Set<string>;
};

async function leerResultadosTablasDia(dia: string): Promise<Map<string, ResultadoTablaMapa>> {
  const mapa = new Map<string, ResultadoTablaMapa>();
  if (!supabase || !dia) return mapa;
  try {
    let { data, error } = await supabase
      .from("resultados_carreras")
      .select("hipodromo, carrera, ganadores, orden_llegada, retirados")
      .eq("fecha", dia);
    if (error && /retirados/i.test(error.message)) {
      const r2 = await supabase
        .from("resultados_carreras")
        .select("hipodromo, carrera, ganadores, orden_llegada")
        .eq("fecha", dia);
      data = r2.data as typeof data;
      error = r2.error;
    }
    if (error || !data) return mapa;
    for (const r of data as Array<Record<string, unknown>>) {
      const k = `${claveHipodromo(r.hipodromo)}|${Number(r.carrera) || 0}`;
      const oficial = puestosDesdeOrdenLlegada(r.orden_llegada);
      const puestos = oficial.length ? oficial : puestosDesdeOrdenLlegada(r.ganadores);
      const puestosRaya = extraerOrdenLlegadaRaya(r.orden_llegada, puestos);
      const ganadorRaya = String(puestosRaya[0] ?? puestos[0] ?? "").trim();
      const rawRet = String(r.retirados ?? "").trim();
      const rets =
        rawRet && !/NO\s+HUBO\s+RETIRO/i.test(rawRet)
          ? (rawRet.match(/\d+/g) ?? []).map((x) => x.trim()).filter(Boolean)
          : [];
      mapa.set(k, { ganadorRaya, retirados: new Set(rets) });
    }
  } catch {
    /* best-effort */
  }
  return mapa;
}

async function marcarInvalidados(ventas: VentaTablaReporte[]): Promise<VentaTablaReporte[]> {
  if (!supabase) return ventas;
  const ids = [...new Set(ventas.map((v) => v.tablaId ?? "").filter((x) => x !== ""))];
  if (!ids.length) return ventas;
  const numIds = ids.map((x) => Number(x)).filter((n) => Number.isFinite(n));
  if (!numIds.length) return ventas;
  try {
    const { data, error } = await supabase
      .from("tablas_fijas")
      .select("id, caballos")
      .in("id", numIds);
    if (error) return ventas;
    const invalidados = new Map<string, Set<string>>();
    for (const fila of (data ?? []) as Array<{ id?: unknown; caballos?: unknown }>) {
      const caballos = Array.isArray(fila.caballos) ? (fila.caballos as EjemplarTabla[]) : [];
      const lista = new Set(numerosInvalidados(caballos));
      if (lista.size) invalidados.set(String(fila.id), lista);
    }
    if (!invalidados.size) return ventas;
    return ventas.map((v) => ({
      ...v,
      invalidado: invalidados.get(v.tablaId ?? "")?.has(v.numero) ?? false,
    }));
  } catch {
    return ventas;
  }
}

export async function cargarVentasTablasFijas(fecha: string): Promise<ResultadoCargaVentas> {
  if (!supabase) return { ok: false, ventas: [], error: "Sin credenciales Supabase (.env.local)." };
  const dia = String(fecha ?? "").slice(0, 10);
  if (!dia) return { ok: false, ventas: [], error: "Indique el día del reporte." };
  try {
    const [{ data, error }, resultadosDia] = await Promise.all([
      supabase
        .from("tickets_apuestas")
        .select("*")
        .or(filtroDiaJornada(dia))
        .ilike("nombre_jugada", "TABLA FIJA%")
        .order("fecha_registro"),
      leerResultadosTablasDia(dia),
    ]);
    if (error) return { ok: false, ventas: [], error: error.message };

    const filasDia = ((data ?? []) as Record<string, unknown>[]).filter((row) =>
      perteneceADiaJornada(row, dia)
    );
    const conInvalidados = await marcarInvalidados(filasDia.map(normalizarVenta));

    const ventas = conInvalidados.map((v) => {
      if (v.anulada) return v;
      const k = `${claveHipodromo(v.hipodromo)}|${Number(v.carrera) || 0}`;
      const res = resultadosDia.get(k);
      if (!res) return v;
      const numEj = String(v.numero ?? "").trim() || (v.caballo.match(/\d+/)?.[0] ?? "");
      if (numEj && res.retirados.has(numEj)) {
        return { ...v, estado: "Retirado", pagado: 0, comision: 0 };
      }
      if (res.ganadorRaya && numEj) {
        if (v.invalidado) {
          return { ...v, estado: "Invalidado", pagado: 0 };
        }
        if (res.ganadorRaya === numEj) {
          const premioCalc =
            v.pagado > 0
              ? v.pagado
              : v.premioPorTabla > 0
                ? Math.round(v.premioPorTabla * (v.cantidad || 1) * 100) / 100
                : Math.round(v.monto * 2 * 100) / 100;
          const com =
            v.comision > 0
              ? v.comision
              : Math.round(premioCalc * ((v.comisionPct || 0) / 100) * 100) / 100;
          return { ...v, estado: "Ganador", pagado: premioCalc, comision: com };
        }
        return { ...v, estado: "Perdedor", pagado: 0, comision: 0 };
      }
      return v;
    });

    return { ok: true, ventas };
  } catch (e) {
    return { ok: false, ventas: [], error: e instanceof Error ? e.message : String(e) };
  }
}
