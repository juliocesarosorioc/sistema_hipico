import { liquidarOficial } from "@/lib/motores/oficiales";
import { marcasConfigParaCarrera } from "@/lib/marcas";
import { cerrarTablaFija } from "@/lib/tablas-fijas";
import { useTablasFijasStore } from "@/store/useTablasFijasStore";
import type { TicketMotor, ResultadoMotor } from "@/lib/bettingEngine";
import type { PizarraCarrera } from "@/lib/liquidacion";
import { supabase } from "@/lib/supabase";

export type TicketPagar = {
  comando: string;
  monto: number;
  /** Número del ejemplar apostado (columna CABALLO) — necesario para NINIS. */
  caballo?: string;
};

export type ResLiquidarCarrera = {
  ok: boolean;
  motivo: string;
  procesados: Array<{ comando: string; resultado: ResultadoMotor }>;
  totalInvertido: number;
  totalClienteNeto: number;
  balanceBanca: number;
  gananciaCasa: number;
  tablaCerrada?: { ok: boolean; conteo?: number; error?: string };
};

/**
 * Flujo "Pagar Carrera": liquida cada ticket del operador contra el motor
 * UNIVERSAL (líquida NINI, REMATE, PUESTOS, GANADOR, Tablas Fijas y Marcas con
 * dividendos oficiales de resultados_carreras cuando existen) y, tras procesar
 * con éxito, Cierra automáticamente la Tabla Fija de esa carrera (status →
 * 'Cerrada'). La caché UI se sincroniza marcarCerrada() (sin recargar página).
 */
export async function liquidarCarreraYCerrarTabla(opts: {
  hipodromo: string;
  carrera: number | string;
  pizarra: PizarraCarrera;
  tickets: TicketPagar[];
  tasaComision?: number | null;
  dividendos?: Record<string, number> | null;
}): Promise<ResLiquidarCarrera> {
  const { hipodromo, carrera, pizarra, tickets, tasaComision } = opts;
  const dividendos = opts.dividendos ?? (await dividendosDe(hipodromo, carrera));

  // Config de Marcas de la carrera (izquierda/derecha) para interceptar
  // los tickets tipo MARCA según el caballo jugado.
  const marcasConfig = await marcasConfigParaCarrera(hipodromo, carrera);

  const procesados: ResLiquidarCarrera["procesados"] = [];
  let totalInvertido = 0;
  let gananciaCasa = 0;

  for (const t of tickets) {
    // Comando con monto al inicio ("100 2N") o sin monto (Tablas: "TABLA ...").
    const m = /^(\d+(?:\.\d+)?)\s+(.+?)\s*$/i.exec(String(t.comando).trim());
    const monto = m ? parseFloat(m[1]) : t.monto;
    const tipo = m ? m[2].trim().toUpperCase() : String(t.comando).trim().toUpperCase();
    if (!Number.isFinite(monto) || monto <= 0 || !tipo) {
      return {
        ok: false,
        motivo: "Ticket malformado (falta monto): " + t.comando,
        procesados,
        totalInvertido,
        totalClienteNeto: 0,
        balanceBanca: 0,
        gananciaCasa: 0,
        tablaCerrada: { ok: false, error: "Ticket malformado." },
      };
    }
    const ticketMotor: TicketMotor = {
      hipodromo,
      carrera: String(carrera),
      caballo: String(t.caballo ?? "").trim(),
      fechas: [],
      id: "liquidar-" + procesados.length,
      cruces: 1,
      cuota: null,
      total: monto,
      addedAt: 0,
      tipo_jugada: tipo,
      monto,
      puesto_final: typeof pizarra.primero === "number" ? pizarra.primero : firstOrdinal(pizarra.primero),
      pizarra,
      dividendos: dividendos ?? null,
      ...(/^MARCA|MARCAR/.test(tipo) && marcasConfig
        ? {
            marcas: {
              marcados: marcasConfig.marcados,
              contra: marcasConfig.contra,
            },
          }
        : {}),
    };

    const res = liquidarOficial(ticketMotor, tasaComision);
    procesados.push({ comando: t.comando, resultado: res });
    totalInvertido += monto;
    gananciaCasa += res.gananciaCasa;
  }

  let totalClienteNeto = 0;
  let balanceBanca = 0;
  for (const p of procesados) {
    totalClienteNeto += p.resultado.totalClienteNeto;
    balanceBanca += p.resultado.balanceBanca;
  }

  // AUTO-CIERRE: tras pagar con éxito, cierra la Tabla Fija de la carrera.
  const cierre = await cerrarTablaFija(hipodromo, carrera);
  if (cierre.ok) {
    useTablasFijasStore.getState().marcarCerrada(hipodromo, carrera);
  }

  return {
    ok: true,
    motivo: `Carrera ${hipodromo} C${carrera} liquidada. ${procesados.length} ticket(s).`,
    procesados,
    totalInvertido,
    totalClienteNeto,
    balanceBanca,
    gananciaCasa,
    tablaCerrada: cierre,
  };
}

function firstOrdinal(primero: unknown): number {
  if (typeof primero === "number") return primero;
  const n = Number.parseInt(String(primero ?? ""), 10);
  return Number.isFinite(n) ? n : 1;
}

/** Lee los dividendos oficiales ya persistidos en resultados_carreras
    (fecha + hipódromo + carrera) para cruzar la liquidación universal. */
async function dividendosDe(hipodromo: string, carrera: number | string): Promise<Record<string, number> | null> {
  if (!supabase) return null;
  try {
    const f = new Date().toISOString().slice(0, 10);
    const { data } = await supabase
      .from("resultados_carreras")
      .select("dividendos")
      .eq("fecha", f)
      .eq("hipodromo", hipodromo.trim().toUpperCase())
      .eq("carrera", Number(carrera))
      .maybeSingle();
    if (!data || data.dividendos == null || typeof data.dividendos !== "object") return null;
    const div = data.dividendos as Record<string, unknown>;
    const limpio: Record<string, number> = {};
    for (const [k, v] of Object.entries(div)) {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) limpio[k] = n;
    }
    return Object.keys(limpio).length ? limpio : null;
  } catch {
    return null;
  }
}