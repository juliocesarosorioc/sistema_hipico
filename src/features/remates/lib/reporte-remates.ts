/**
 * Carga de los REMATES vendidos de un día para su reporte contable.
 *
 * Filtra por el DÍA DE LA CARRERA (`filtroDiaJornada` + `perteneceADiaJornada`),
 * importa también las pujas con comprador de `remates` + `remate_caballos` de ese
 * día, y sincroniza el estado ganador/perdedor con los resultados oficiales
 * cargados en Gestión de Jugadas (`resultados_carreras`, 1° en Raya).
 */
import { cargarMapaSeudonimosClientes } from "@/features/clientes/lib/clientes";
import { supabase } from "@/core/supabase";
import { filtroDiaJornada, perteneceADiaJornada } from "@/features/liquidacion/lib/fecha";
import {
  estadoNormalizado,
  normalizarVenta,
  type VentaTablaReporte,
} from "@/features/tablas/lib/reporte-tablas-nucleo";
import { puestosDesdeOrdenLlegada } from "@/features/motores/lib/oficiales";
import { extraerOrdenLlegadaRaya } from "@/features/liquidacion/lib/posiciones";
import { claveHipodromo } from "@/features/carreras/lib/claves";
import { calcularFinanzasRemate } from "@/features/remates/lib/remates";

export type ResultadoCargaRemates = {
  ok: boolean;
  ventas: VentaTablaReporte[];
  error?: string;
};

export async function cargarRematesVendidos(fecha: string): Promise<ResultadoCargaRemates> {
  if (!supabase) return { ok: false, ventas: [], error: "Sin credenciales Supabase (.env.local)." };
  const dia = String(fecha ?? "").slice(0, 10);
  if (!dia) return { ok: false, ventas: [], error: "Indique el día del reporte." };
  try {
    const [{ data, error }, { data: resData }, { data: rematesData }, mapaSeudonimos] = await Promise.all([
      supabase
        .from("tickets_apuestas")
        .select("*")
        .or(filtroDiaJornada(dia))
        .ilike("nombre_jugada", "REMATE %")
        .order("fecha_registro"),
      supabase
        .from("resultados_carreras")
        .select("hipodromo, carrera, ganadores, orden_llegada, retirados")
        .eq("fecha", dia),
      supabase
        .from("remates")
        .select("id, hipodromo, carrera, fecha, incentivo, incentivo_pct, comision_pct")
        .eq("fecha", dia),
      cargarMapaSeudonimosClientes().catch(() => new Map<string, string>()),
    ]);
    if (error) return { ok: false, ventas: [], error: error.message };

    const resultadosPorCarrera = new Map<string, { ganadorRaya: string; retirados: Set<string> }>();
    for (const r of (resData ?? []) as Array<Record<string, unknown>>) {
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
      resultadosPorCarrera.set(k, { ganadorRaya, retirados: new Set(rets) });
    }

    const premioPorCarrera = new Map<string, number>();
    const listaRemates = (rematesData ?? []) as Array<Record<string, unknown>>;
    const idsCaballosEnTickets = new Set<string>();
    const filasTickets = ((data ?? []) as Record<string, unknown>[]).filter((row) =>
      perteneceADiaJornada(row, dia)
    );
    for (const t of filasTickets) {
      const m = /"remate_caballo_id"\s*:\s*"([^"]+)"/.exec(String(t.nota_auditoria ?? ""));
      if (m?.[1]) idsCaballosEnTickets.add(m[1]);
    }

    const pujasExtra: VentaTablaReporte[] = [];
    if (listaRemates.length > 0) {
      const remIds = listaRemates.map((r) => String(r.id ?? "")).filter(Boolean);
      const { data: cabs } = await supabase
        .from("remate_caballos")
        .select("id, remate_id, numero, ejemplar_numero, nombre, monto_usd, cliente_id, clientes(nombre, seudonimo)")
        .in("remate_id", remIds);
      const cabsPorRemate = new Map<string, Array<Record<string, unknown>>>();
      for (const c of (cabs ?? []) as Array<Record<string, unknown>>) {
        const rid = String(c.remate_id ?? "");
        const arr = cabsPorRemate.get(rid) ?? [];
        arr.push(c);
        cabsPorRemate.set(rid, arr);
      }
      for (const rem of listaRemates) {
        const rid = String(rem.id ?? "");
        const listaC = cabsPorRemate.get(rid) ?? [];
        const fin = calcularFinanzasRemate(
          listaC.map((c) => ({ monto_usd: Number(c.monto_usd) || 0 })),
          Number(rem.incentivo) || 0,
          Number(rem.comision_pct ?? 20),
          Number(rem.incentivo_pct) || 0
        );
        const k = `${claveHipodromo(rem.hipodromo)}|${Number(rem.carrera) || 0}`;
        if (fin.premioGanador > 0) premioPorCarrera.set(k, fin.premioGanador);

        for (const c of listaC) {
          const cid = String(c.id ?? "");
          const monto = Number(c.monto_usd) || 0;
          if (!c.cliente_id || monto <= 0 || idsCaballosEnTickets.has(cid)) continue;
          const cliObj = c.clientes as { nombre?: unknown; seudonimo?: unknown } | null;
          const numEj = String(c.ejemplar_numero ?? c.numero ?? "").trim();
          pujasExtra.push({
            id: `rem-cab-${cid}`,
            hipodromo: String(rem.hipodromo ?? "").toUpperCase(),
            carrera: Number(rem.carrera) || 0,
            numero: numEj,
            caballo: String(c.nombre ?? numEj),
            jugadorId: String(c.cliente_id),
            jugador: String((c.cliente_id && mapaSeudonimos.get(String(c.cliente_id))) || cliObj?.seudonimo || cliObj?.nombre || c.cliente_id || "—"),
            grupoId: "REMATE",
            grupo: "REMATE",
            monto,
            cantidad: 1,
            pts: 0,
            premioPorTabla: fin.premioGanador,
            comisionPct: Number(rem.comision_pct) || 0,
            estado: "Pendiente",
            pagado: 0,
            comision: 0,
            moneda: "USD",
            anulada: false,
            adelantada: true,
            fecha: dia,
            fechaVenta: dia,
          });
        }
      }
    }

    const baseVentas = [...filasTickets.map((r) => normalizarVenta(r, mapaSeudonimos)), ...pujasExtra];
    const ventas = baseVentas.map((venta) => {
      if (venta.anulada) return venta;
      if (estadoNormalizado(venta.estado) === "Retirado") return venta;
      const k = `${claveHipodromo(venta.hipodromo)}|${Number(venta.carrera) || 0}`;
      const res = resultadosPorCarrera.get(k);
      const numEj = String(venta.numero ?? "").trim() || (venta.caballo.match(/\d+/)?.[0] ?? "");
      if (res) {
        if (numEj && res.retirados.has(numEj)) {
          return { ...venta, estado: "Retirado", pagado: 0 };
        }
        if (res.ganadorRaya && numEj) {
          if (res.ganadorRaya === numEj) {
            const pagado = venta.pagado > 0 ? venta.pagado : (premioPorCarrera.get(k) ?? 0);
            return { ...venta, estado: "Ganador", pagado };
          }
          return { ...venta, estado: "Perdedor", pagado: 0 };
        }
      }
      if (estadoNormalizado(venta.estado) === "Ganador") return venta;
      return { ...venta, estado: "Perdedor" };
    });

    return { ok: true, ventas };
  } catch (e) {
    return { ok: false, ventas: [], error: e instanceof Error ? e.message : String(e) };
  }
}
