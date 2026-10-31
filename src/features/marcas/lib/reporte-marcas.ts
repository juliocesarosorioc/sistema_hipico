/**
 * Carga de las MARCAS JUGADAS de un día para su reporte.
 *
 * Se alimenta de `tickets_apuestas` filtrando por el DÍA DE LA CARRERA
 * (`filtroDiaJornada` + `perteneceADiaJornada`) y se vincula directamente con
 * los resultados oficiales cargados en Gestión de Jugadas (`resultados_carreras`),
 * mostrando `SIN DECISIÓN` cuando ninguno de los ejemplares de la marca entra en
 * la pizarra oficial.
 */
import { cargarMapaSeudonimosClientes } from "@/features/clientes/lib/clientes";
import { supabase } from "@/core/supabase";
import { filtroDiaJornada, perteneceADiaJornada } from "@/features/liquidacion/lib/fecha";
import { normalizarMarca, rivalesDeNota } from "@/features/marcas/lib/reporte-marcas-nucleo";
import type { VentaTablaReporte } from "@/features/tablas/lib/reporte-tablas-nucleo";
import { puestosDesdeOrdenLlegada } from "@/features/motores/lib/oficiales";
import { claveHipodromo } from "@/features/carreras/lib/claves";

export type ResultadoCargaMarcas = {
  ok: boolean;
  ventas: VentaTablaReporte[];
  error?: string;
};

type ResultadoOficialMapa = {
  puestos: string[];
  retirados: Set<string>;
};

async function leerResultadosDia(dia: string): Promise<Map<string, ResultadoOficialMapa>> {
  const mapa = new Map<string, ResultadoOficialMapa>();
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
      const puestos = (oficial.length ? oficial : puestosDesdeOrdenLlegada(r.ganadores)).map((x) =>
        String(x).trim()
      );
      const rawRet = String(r.retirados ?? "").trim();
      const rets =
        rawRet && !/NO\s+HUBO\s+RETIRO/i.test(rawRet)
          ? (rawRet.match(/\d+/g) ?? []).map((x) => x.trim()).filter(Boolean)
          : [];
      mapa.set(k, { puestos, retirados: new Set(rets) });
    }
  } catch {
    /* best-effort */
  }
  return mapa;
}

export async function cargarMarcasJugadas(fecha: string): Promise<ResultadoCargaMarcas> {
  if (!supabase) return { ok: false, ventas: [], error: "Sin credenciales Supabase (.env.local)." };
  const dia = String(fecha ?? "").slice(0, 10);
  if (!dia) return { ok: false, ventas: [], error: "Indique el día del reporte." };
  try {
    const [{ data, error }, resultadosDia, mapaSeudonimos] = await Promise.all([
      supabase
        .from("tickets_apuestas")
        .select("*")
        .or(filtroDiaJornada(dia))
        .ilike("nombre_jugada", "%MARCA%")
        .order("fecha_registro"),
      leerResultadosDia(dia),
      cargarMapaSeudonimosClientes(),
    ]);
    if (error) return { ok: false, ventas: [], error: error.message };

    const filasDia = ((data ?? []) as Record<string, unknown>[]).filter((row) =>
      perteneceADiaJornada(row, dia)
    );

    const ventas = filasDia.map((row) => {
      const v = normalizarMarca(row, mapaSeudonimos);
      if (v.anulada) return v;

      const k = `${claveHipodromo(v.hipodromo)}|${Number(v.carrera) || 0}`;
      const res = resultadosDia.get(k);
      const numsCab = (String(row.caballo ?? "").match(/\d+/g) ?? []).map((x) => x.trim());
      const numElegido = String(row.ejemplar_numero ?? "").trim() || numsCab[0] || v.numero;
      let rivales = rivalesDeNota(row.nota_auditoria);
      if (!rivales.length && numsCab.length >= 2) {
        rivales = numsCab.filter((n, idx) => idx > 0 && n !== numElegido);
      }
      if (!rivales.length) {
        const numsJug = (String(row.nombre_jugada ?? "").match(/\d+/g) ?? []).map((x) => x.trim());
        rivales = numsJug.filter((n) => n !== numElegido);
      }

      if (res) {
        const hayRetiro =
          (numElegido && res.retirados.has(numElegido)) ||
          rivales.some((rv) => res.retirados.has(String(rv).trim()));
        if (hayRetiro) {
          return { ...v, estado: "Retirado", pagado: 0, comision: 0 };
        }
        if (res.puestos.length > 0 && numElegido && rivales.length > 0) {
          const posElegido = res.puestos.indexOf(numElegido);
          const posRivales = rivales.map((rv) => res.puestos.indexOf(String(rv).trim()));
          if (posElegido === -1 && posRivales.every((pr) => pr === -1)) {
            return { ...v, estado: "Sin Decisión", pagado: 0, comision: 0 };
          }
          if (posElegido !== -1 && posRivales.every((pr) => pr === -1 || posElegido < pr)) {
            const pagoMarca = Math.round(((v.monto * 5) / 6) * 100) / 100;
            const bruto = v.pagado > 0 ? v.pagado : Math.round((v.monto + pagoMarca) * 100) / 100;
            const com =
              v.comision > 0
                ? v.comision
                : Math.round(pagoMarca * ((v.comisionPct || 5) / 100) * 100) / 100;
            return { ...v, estado: "Ganador", pagado: bruto, comision: com };
          }
          if (posRivales.some((pr) => pr !== -1 && (posElegido === -1 || pr < posElegido))) {
            return { ...v, estado: "Perdedor", pagado: 0 };
          }
          return { ...v, estado: "Sin Decisión", pagado: 0, comision: 0 };
        }
      }
      return v;
    });

    return { ok: true, ventas };
  } catch (e) {
    return { ok: false, ventas: [], error: e instanceof Error ? e.message : String(e) };
  }
}
