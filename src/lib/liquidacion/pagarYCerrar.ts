import { liquidarPuestos } from "@/lib/motores/puestos";
import { cerrarTablaFija } from "@/lib/tablas-fijas";
import { useTablasFijasStore } from "@/store/useTablasFijasStore";
import type { TicketMotor, ResultadoMotor } from "@/lib/bettingEngine";
import type { PizarraCarrera } from "@/lib/liquidacion";

export type TicketPagar = {
  comando: string;
  monto: number;
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
 * matemático y, tras procesar con éxito, Cierra automáticamente la Tabla Fija
 * de esa carrera (status → 'Cerrada') para que no quede abierta en Tablas
 * Fijas. La caché UI se sincroniza marcarCerrada() (sin recargar página).
 */
export async function liquidarCarreraYCerrarTabla(opts: {
  hipodromo: string;
  carrera: number | string;
  pizarra: PizarraCarrera;
  tickets: TicketPagar[];
  tasaComision?: number | null;
  dividendos?: Record<string, number> | null;
}): Promise<ResLiquidarCarrera> {
  const { hipodromo, carrera, pizarra, tickets, tasaComision, dividendos } = opts;

  const procesados: ResLiquidarCarrera["procesados"] = [];
  let totalInvertido = 0;
  let gananciaCasa = 0;

  for (const t of tickets) {
    const m = /^(\d+(?:\.\d+)?)\s+(.+?)\s*$/i.exec(String(t.comando).trim());
    if (!m) {
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
    const monto = parseFloat(m[1]);
    const ticketMotor: TicketMotor = {
      hipodromo,
      carrera: String(carrera),
      caballo: m[2].trim().toUpperCase(),
      fechas: [],
      id: "liquidar-" + procesados.length,
      cruces: 1,
      cuota: null,
      total: monto,
      addedAt: 0,
      tipo_jugada: m[2].trim().toUpperCase(),
      monto,
      puesto_final: typeof pizarra.primero === "number" ? pizarra.primero : firstOrdinal(pizarra.primero),
      pizarra,
      dividendos: dividendos ?? null,
    };

    const res = liquidarPuestos(ticketMotor, tasaComision);
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