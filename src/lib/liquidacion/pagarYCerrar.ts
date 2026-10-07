import { liquidarOficial } from "@/lib/motores/oficiales";
import { exigirPermiso } from "@/lib/seguridad/vigente";
import { cerrarTablaFija } from "@/lib/tablas-fijas";
import { upsertResultadoCentral } from "@/lib/carreras-dia";
import { leerRetirosCarrera } from "@/lib/carreras/retiros";
import { ordenLlegadaDePizarra, posicionesDePizarra } from "@/lib/liquidacion/posiciones";
import { useTablasFijasStore } from "@/store/useTablasFijasStore";
import { netearComisionCruce, claveCruceFinanciero, type NeteoCruceItem } from "@/lib/bettingEngine";
import type { TicketMotor, ResultadoMotor } from "@/lib/bettingEngine";
import type { PizarraCarrera } from "@/lib/liquidacion";
import { supabase } from "@/lib/supabase";
import { hoyLocal } from "@/lib/gaceta/programa";

/**
 * Suma de todos los tickets de la carrera. El comando puede traer el monto al
 * principio ("100 2N"), así que se lee del comando cuando aparece ahí y del
 * campo `monto` cuando no.
 */
function totalDeTickets(tickets: TicketPagar[]): number {
  let total = 0;
  for (const t of tickets) {
    const m = /^(\d+(?:\.\d+)?)\s+/i.exec(String(t.comando ?? "").trim());
    const monto = m ? Number(m[1]) : Number(t.monto);
    if (Number.isFinite(monto)) total += monto;
  }
  return total;
}

export type TicketPagar = {
  comando: string;
  monto: number;
  /** Número del ejemplar apostado (columna CABALLO) — necesario para NINIS. */
  caballo?: string;
  /** Nombre del CLIENTE 1 (el que "juega") — para el neteo de cruces. */
  cliente1?: string;
  /** Nombre del CLIENTE 2 (el que "da") — referencia de la operación. */
  cliente2?: string;
  /** Jerarquía de permisos resuelta por el caller (Carrera → Cliente → Grupo).
   *  false ⇒ el cruce financiero NO recibe descuento de comisión neta
   *  (factura comisión por ticket). undefined ⇒ se permite el neteo. */
  permiteCruces?: boolean;
};

export type ResLiquidarCarrera = {
  ok: boolean;
  motivo: string;
  procesados: Array<{ comando: string; resultado: ResultadoMotor }>;
  totalInvertido: number;
  totalClienteNeto: number;
  balanceBanca: number;
  gananciaCasa: number;
  /** Cantidad de tickets cuyos montos se ajustaron por comisión neta (cruces). */
  neteados?: number;
  tablaCerrada?: { ok: boolean; conteo?: number; error?: string };
  /** Escritura del resultado en `resultados_carreras` (fuente de verdad de
   *  Carreras del Día). Va aparte porque un fallo acá NO puede invalidar una
   *  liquidación cuyos tickets ya se pagaron. */
  resultadoCentral?: { ok: boolean; error?: string };
};

/** Respuesta vacía con ceros, para cuando la operación ni siquiera arranca. */
function liquidacionVacia(e: Error): ResLiquidarCarrera {
  return {
    ok: false,
    procesados: [],
    motivo: `SIN PERMISO: ${e.message}`,
    totalInvertido: 0,
    totalClienteNeto: 0,
    balanceBanca: 0,
    gananciaCasa: 0,
  };
}

/**
 * Flujo "Pagar Carrera": liquida cada ticket del operador contra el motor
 * UNIVERSAL (líquida NINI, REMATE, PUESTOS, GANADOR, Tablas Fijas con
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
    try {
      // Con contexto, no solo con permiso: el ABAC exige que el operador
      // liquide un hipódromo que sea del SUYO, y que el total de la carrera no
      // pase del tope que él puede firmar. Se evalúa por ticket, porque el tope
      // es por operación y liquidar 20 tickets de a uno esquivaría el control.
      exigirPermiso("gestion_jugadas:fn_liquidar_carrera", {
        hipodromo: opts.hipodromo,
        monto: totalDeTickets(opts.tickets),
      });
    } catch (e) {
      return liquidacionVacia(e as Error);
    }
    const { hipodromo, carrera, pizarra, tickets, tasaComision } = opts;
  const dividendos = opts.dividendos ?? (await dividendosDe(hipodromo, carrera));

  const procesados: ResLiquidarCarrera["procesados"] = [];
  const metadatos: Array<{ cliente1?: string; caballo: string; monto: number; permiteCruces?: boolean }> = [];
  let totalInvertido = 0;

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
    };

    const res = liquidarOficial(ticketMotor, tasaComision);
    procesados.push({ comando: t.comando, resultado: res });
    metadatos.push({ cliente1: t.cliente1, caballo: String(t.caballo ?? "").trim(), monto, permiteCruces: t.permiteCruces });
    totalInvertido += monto;
  }

  // ── CRUCE FINANCIERO: comisión neta por (cliente1, caballo, carrera) ──
  // La jerarquía Carrera → Cliente → Grupo llega resuelta en cada ticket
  // (permiteCruces). Con permiso en NO no se netea (comisión por ticket).
  // TODO(PLANIFICACIÓN): "INQUIETUDES CON RESPECTO A CRUCES" — pendiente
  // decidir si el permiso en NO además BLOQUEA la operación.
  let neteados = 0;
  const items: NeteoCruceItem[] = procesados.map((p, i) => ({
    cliente: metadatos[i].cliente1 ?? "",
    caballo: metadatos[i].caballo,
    monto: metadatos[i].monto,
    bruto: p.resultado.ok ? p.resultado.totalClienteNeto + p.resultado.gananciaCasa : 0,
    ok: p.resultado.ok,
  }));
  const gruposNeteo = netearComisionCruce(items, carrera, tasaComision);
  const gruposIdx = new Map<string, number[]>();
  for (let i = 0; i < procesados.length; i++) {
    const t = tickets[i];
    if (!(t.cliente1 ?? "").trim() || !(t.caballo ?? "").trim() || t.permiteCruces === false) continue;
    const k = claveCruceFinanciero(carrera, t.cliente1!, t.caballo!);
    const g = gruposNeteo.get(k);
    if (!g || g.conteo < 2) continue;
    const arr = gruposIdx.get(k) ?? [];
    arr.push(i);
    gruposIdx.set(k, arr);
  }
  for (const [k, idxs] of gruposIdx) {
    const grupo = gruposNeteo.get(k)!;
    const oldSum = idxs.reduce((a, i) => a + (procesados[i].resultado.ok ? procesados[i].resultado.gananciaCasa : 0), 0);
    if (oldSum <= 0 || grupo.comisionNeta === oldSum) continue;
    for (const i of idxs) {
      const res = procesados[i].resultado;
      if (!res.ok) continue;
      const bruto = res.totalClienteNeto + res.gananciaCasa;
      const share = res.gananciaCasa / oldSum;
      const nueva = round2(grupo.comisionNeta * share);
      res.totalClienteNeto = round2(bruto - nueva);
      res.balanceBanca = round2(metadatos[i].monto - bruto + nueva);
      res.gananciaCasa = nueva;
      res.motivo = (res.motivo ?? "") + " · comisión neta por cruce (sobre $" + grupo.neto + ")";
      neteados += 1;
    }
  }

  let totalClienteNeto = 0;
  let balanceBanca = 0;
  let gananciaCasa = 0;
  for (const p of procesados) {
    totalClienteNeto += p.resultado.totalClienteNeto;
    balanceBanca += p.resultado.balanceBanca;
    gananciaCasa += p.resultado.gananciaCasa;
  }

  // Resultado CENTRAL. Sin esto, liquidar desde /gestion-jugadas pagaba los
  // tickets y cerraba la tabla, pero la carrera NO llegaba a `resultados_carreras`
  // (la fuente de verdad de Carreras del Día, los semáforos y los saldos): el
  // resultado quedaba solo en memoria y se perdía al recargar. Se escribe antes
  // del cierre y sin abortar si falla, porque los tickets ya están pagados y
  // volver atrás sería peor que un resultado sin centralizar.
  const posiciones = posicionesDePizarra(pizarra);

  // `retirados` es obligatorio en el upsert y se escribe TAL CUAL, asi que hay
  // que releer el actual: mandar un "NO HUBO RETIROS" fijo borraria los retiros
  // ya registrados por la via de retiros al central.
  const fecha = hoyLocal();
  const retiradosActuales = await leerRetirosCarrera(fecha, hipodromo, carrera);
  const central = await upsertResultadoCentral({
    fecha,
    hipodromo,
    carrera,
    ganadores: posiciones,
    retirados: retiradosActuales.length ? retiradosActuales.join(" ") : "NO HUBO RETIROS",
    cargado_por: "GESTION-JUGADAS",
    // El orden estructurado y los dividendos NO se pueden quedar en el camino:
    // sin ellos la fila central queda con `orden_llegada`/`dividendos` en NULL
    // (era el caso de las 131 filas de producción) y la liquidación de puestos
    // no tiene con qué pagar. Taquilla ya los guardaba; esto lo alinea.
    orden_llegada: ordenLlegadaDePizarra(pizarra),
    dividendos: dividendos ?? null,
  });

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
    neteados,
    tablaCerrada: cierre,
    resultadoCentral: central,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
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
    // Fecha LOCAL (no UTC): el dividendo se persistió con la fecha de la
    // jornada que ve el operador (ISO YYYY-MM-DD); con UTC se consultaba el
    // "día anterior" tras las 20:00.
    const f = hoyLocal();
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