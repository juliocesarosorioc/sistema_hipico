/**
 * Carga de las DUPLETAS JUGADAS de un día para su reporte.
 *
 * Filtra por el DÍA DE LA CARRERA (`filtroDiaJornada` + `perteneceADiaJornada`)
 * y sincroniza el estado de cada dupleta con los resultados oficiales cargados en
 * Gestión de Jugadas (`resultados_carreras`).
 */
import { cargarMapaSeudonimosClientes } from "@/features/clientes/lib/clientes";
import { supabase } from "@/core/supabase";
import { filtroDiaJornada, perteneceADiaJornada } from "@/features/liquidacion/lib/fecha";
import {
  normalizarVenta,
  type VentaTablaReporte,
} from "@/features/tablas/lib/reporte-tablas-nucleo";
import { puestosDesdeOrdenLlegada } from "@/features/motores/lib/oficiales";
import { claveHipodromo } from "@/features/carreras/lib/claves";

export type ResultadoCargaDupletas = {
  ok: boolean;
  ventas: VentaTablaReporte[];
  error?: string;
};

export async function cargarDupletasJugadas(fecha: string): Promise<ResultadoCargaDupletas> {
  if (!supabase) return { ok: false, ventas: [], error: "Sin credenciales Supabase (.env.local)." };
  const dia = String(fecha ?? "").slice(0, 10);
  if (!dia) return { ok: false, ventas: [], error: "Indique el día del reporte." };
  try {
    const [{ data, error }, { data: resData }, mapaSeudonimos] = await Promise.all([
      supabase
        .from("tickets_apuestas")
        .select("*")
        .or(filtroDiaJornada(dia))
        .ilike("nombre_jugada", "DUPLETA %")
        .order("fecha_registro"),
      supabase
        .from("resultados_carreras")
        .select("hipodromo, carrera, ganadores, orden_llegada, retirados")
        .eq("fecha", dia),
      cargarMapaSeudonimosClientes().catch(() => new Map<string, string>()),
    ]);
    if (error) return { ok: false, ventas: [], error: error.message };

    const resultadosPorCarrera = new Map<string, { primero: string; retirados: Set<string> }>();
    for (const r of (resData ?? []) as Array<Record<string, unknown>>) {
      const k = `${claveHipodromo(r.hipodromo)}|${Number(r.carrera) || 0}`;
      const oficial = puestosDesdeOrdenLlegada(r.orden_llegada);
      const puestos = oficial.length ? oficial : puestosDesdeOrdenLlegada(r.ganadores);
      const primero = String(puestos[0] ?? "").trim();
      const rawRet = String(r.retirados ?? "").trim();
      const rets =
        rawRet && !/NO\s+HUBO\s+RETIRO/i.test(rawRet)
          ? (rawRet.match(/\d+/g) ?? []).map((x) => x.trim()).filter(Boolean)
          : [];
      resultadosPorCarrera.set(k, { primero, retirados: new Set(rets) });
    }

    const filasDia = ((data ?? []) as Record<string, unknown>[]).filter((row) =>
      perteneceADiaJornada(row, dia)
    );

    const ventas = filasDia.map((row) => {
      const v = normalizarVenta(row, mapaSeudonimos);
      if (v.anulada) return v;
      let c1 = Number(v.carrera) || 0;
      let c2 = 0;
      let n1 = "";
      let n2 = "";
      let premioNota = 0;
      try {
        const rawNota = row.nota_auditoria;
        const nota =
          typeof rawNota === "string" && rawNota.trim().startsWith("{")
            ? (JSON.parse(rawNota) as Record<string, unknown>)
            : rawNota && typeof rawNota === "object"
              ? (rawNota as Record<string, unknown>)
              : {};
        c1 = Number(nota.carrera1 ?? v.carrera) || c1;
        c2 = Number(nota.carrera2 ?? 0) || 0;
        n1 = String(nota.numero1 ?? "").trim();
        n2 = String(nota.numero2 ?? "").trim();
        premioNota = Number(nota.premio ?? 0) || 0;
      } catch {
        /* ignore */
      }
      if (!n1 || !n2) {
        const nums = (String(row.caballo ?? row.nombre_jugada ?? "").match(/\d+/g) ?? []).map((x) =>
          x.trim()
        );
        if (nums.length >= 2) {
          n1 = nums[0];
          n2 = nums[1];
        }
      }
      const hipKey = claveHipodromo(v.hipodromo);
      const r1 = c1 > 0 ? resultadosPorCarrera.get(`${hipKey}|${c1}`) : undefined;
      const r2 = c2 > 0 ? resultadosPorCarrera.get(`${hipKey}|${c2}`) : undefined;

      if ((r1 && n1 && r1.retirados.has(n1)) || (r2 && n2 && r2.retirados.has(n2))) {
        return { ...v, estado: "Retirado", pagado: 0, comision: 0 };
      }
      if (r1?.primero && r2?.primero && n1 && n2) {
        if (r1.primero === n1 && r2.primero === n2) {
          const pagado = v.pagado > 0 ? v.pagado : premioNota;
          return { ...v, estado: "Ganador", pagado };
        }
        return { ...v, estado: "Perdedor", pagado: 0 };
      }
      return v;
    });

    return { ok: true, ventas };
  } catch (e) {
    return { ok: false, ventas: [], error: e instanceof Error ? e.message : String(e) };
  }
}
