/**
 * Saldos — Aplicación TRANSACCIONAL de la liquidación universal sobre el
 * saldo real del cliente (Bloque 3). Firma de seguridad:
 *
 *  - SOLO se "tochan" tickets en estado 'Pendiente' → cada ticket se decide
 *    UNA sola vez (idempotencia real: si la carrera ya fue liquidada, no se
 *    dobla el abono ni se pisan estados).
 *  - El abono al saldo del cliente se hace en el MISMO viaje que el update
 *    del ticket (Promise.all por lote → consistencia al finalizar).
 *  - Cuando se detecta que la carrera ya fue aplicada (tickets en
 *    'Ganador'/'Perdedor'), el lote se anula por seguridad (return ok,
 *    aplicados=0, yaAplicado=true).
 */
import { supabase } from "@/core/supabase";
import { liquidarOficial } from "@/features/motores/lib/oficiales";
import { hoyLocal } from "@/features/gaceta/lib/programa";
import { ventanaDiaLocal } from "@/features/liquidacion/lib/fecha";
import { parsearNini, netearComisionCruce, claveCruceFinanciero, type NeteoCruceItem } from "@/features/betting/lib/bettingEngine";
import type { TicketMotor, ResultadoMotor } from "@/features/betting/lib/bettingEngine";
import type { PizarraCarrera } from "@/features/liquidacion/lib/liquidacion";

export type LiquidarSaldosInput = {
  hipodromo: string;
  carrera: number | string;
  pizarra: PizarraCarrera;
  dividendos?: Record<string, number> | null;
  premio_por_tabla?: number | null;
  tasaComision?: number | null;
  /** Jornada (YYYY-MM-DD local) a la que pertenecen los tickets. Si no se pasa,
   *  se usa el día local. Antes SIEMPRE se usaba `hoyLocal()`: al liquidar una
   *  carrera de otra jornada (resultado cargado con retraso) la ventana de
   *  `fecha_registro` no la cubría y la liquidación no encontraba Pendientes. */
  fecha?: string;
};

export type ResumenSaldos = {
  ok: boolean;
  motivo: string;
  aplicados: number;
  yaAplicado: boolean;
  reembolsos: number;
  abonoTotal: number;
  errores: string[];
};

const NUM = (v: unknown): number => {
  const n = parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
};

/** Fabrica TicketMotor desde una fila de tickets_apuestas. */
export function motorDesdeFila(
  fila: Record<string, unknown>,
  ctx: LiquidarSaldosInput
): TicketMotor {
  const tipo = String(fila.nombre_jugada ?? "JUGADA").trim().toUpperCase();
  const monto = NUM(fila.monto_jugado);
  const numero = String(fila.caballo ?? "").trim();
  const nini = parsearNini(tipo);
  return {
    hipodromo: ctx.hipodromo,
    carrera: String(ctx.carrera),
    fechas: [],
    id: String(fila.id ?? "fila"),
    cruces: 1,
    cuota: null,
    total: monto,
    addedAt: 0,
    tipo_jugada: tipo,
    monto,
    caballo: nini ? numero : numero,
    puesto_final: typeof ctx.pizarra.primero === "number" ? ctx.pizarra.primero : parseInt(String(ctx.pizarra.primero ?? ""), 10) || 1,
    pizarra: ctx.pizarra,
    dividendos: ctx.dividendos ?? null,
    // El premio de TABLA viaja con el ticket (se congeló al vender, columna
    // `premio_por_tabla`). Si el caller no lo pasa —re-apertura y, sobre todo,
    // RE-LIQUIDACIÓN de una carrera ya pagada—, se usa el del propio ticket en
    // vez de caer al dividendo genérico o al 2 por defecto: sin esto, recalcular
    // una TABLA pagaría un premio distinto al que se pagó la primera vez.
    premio_por_tabla: ctx.premio_por_tabla != null
      ? ctx.premio_por_tabla
      : fila.premio_por_tabla != null
        ? NUM(fila.premio_por_tabla)
        : null,
  };
}

/**
 * Comisión (%) que corresponde a un ticket: la DEL GRUPO, congelada en
 * `comision_porcentaje` al vender. Si la fila no la trae (tickets viejos o
 * cargas sin grupo), se respalda con la tasa general que pasa el caller. Un 0%
 * EXPLÍCITO es válido (no se confunde con "falta el dato").
 */
export function tasaComisionDeFila(
  fila: Record<string, unknown>,
  respaldo?: number | null
): number {
  const raw = fila.comision_porcentaje;
  if (raw != null && String(raw).trim() !== "") {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  const f = Number(respaldo);
  return Number.isFinite(f) && f >= 0 ? f : 5;
}

/**
 * Decide cada fila con el motor universal y aplica el neteo de comisión por
 * cruce financiero. Es el corazón de la liquidación: se expone para que la
 * reversión (`revertirLiquidacionCarrera`) calcule EXACTAMENTE igual que la
 * aplicación y no haya deriva entre lo que se abona y lo que se descuenta.
 */
export function decidirTickets(
  filas: unknown[],
  input: LiquidarSaldosInput
): Array<{ fila: Record<string, unknown>; res: ResultadoMotor }> {
  const decisiones: Array<{ fila: Record<string, unknown>; res: ResultadoMotor }> = [];
  for (const fRaw of filas) {
    const fila = fRaw as Record<string, unknown>;
    // Comisión POR TICKET desde su grupo (`comision_porcentaje` congelado): si
    // se usara una tasa única, los grupos con comisión distinta quedarían mal
    // cobrados. El caller sigue siendo el respaldo para tickets sin el dato.
    const tasa = tasaComisionDeFila(fila, input.tasaComision);
    const res = liquidarOficial(motorDesdeFila(fila, input), tasa);
    decisiones.push({ fila, res });
  }

  // ── CRUCE FINANCIERO: comisión neta por (cliente_juega_id, caballo, carrera) ──
  // Mismo neteo que pagarYCerrar: la comisión y las devoluciones se calculan
  // SOLO sobre la ganancia neta del cliente por ejemplar en la carrera.
  const items: NeteoCruceItem[] = decisiones.map(({ fila, res }) => ({
    cliente: String(fila.cliente_juega_id ?? "").trim(),
    caballo: String(fila.caballo ?? "").trim(),
    monto: NUM(fila.monto_jugado),
    bruto: res.ok ? res.totalClienteNeto + res.gananciaCasa : 0,
    ok: res.ok,
    tasa: tasaComisionDeFila(fila, input.tasaComision),
  }));
  const gruposNeteo = netearComisionCruce(items, input.carrera, input.tasaComision);
  if (gruposNeteo.size > 0) {
    const gruposIdx = new Map<string, number[]>();
    for (let i = 0; i < decisiones.length; i++) {
      const cliente = String(decisiones[i].fila.cliente_juega_id ?? "").trim();
      const caballo = String(decisiones[i].fila.caballo ?? "").trim();
      if (!cliente || !caballo) continue;
      const k = claveCruceFinanciero(input.carrera, cliente, caballo);
      const g = gruposNeteo.get(k);
      if (!g || g.conteo < 2) continue;
      const arr = gruposIdx.get(k) ?? [];
      arr.push(i);
      gruposIdx.set(k, arr);
    }
    for (const [k, idxs] of gruposIdx) {
      const grupo = gruposNeteo.get(k)!;
      const oldSum = idxs.reduce((a, i) => a + (decisiones[i].res.ok ? decisiones[i].res.gananciaCasa : 0), 0);
      if (oldSum <= 0 || grupo.comisionNeta === oldSum) continue;
      for (const i of idxs) {
        const res = decisiones[i].res;
        if (!res.ok) continue;
        const bruto = res.totalClienteNeto + res.gananciaCasa;
        const share = res.gananciaCasa / oldSum;
        const nueva = Math.round(grupo.comisionNeta * share * 100) / 100;
        res.totalClienteNeto = Math.round((bruto - nueva) * 100) / 100;
        res.balanceBanca = Math.round((NUM(decisiones[i].fila.monto_jugado) - bruto + nueva) * 100) / 100;
        res.gananciaCasa = nueva;
      }
    }
  }
  return decisiones;
}

/** Crédito que la liquidación acredita al cliente por un ticket decidido
 *  (0 si perdió; el capital si quedó 'Retirado'/anulado). */
export function creditoDeTicket(res: ResultadoMotor): number {
  if (res.ok) return res.totalClienteNeto;
  return res.totalClienteNeto > 0 ? res.totalClienteNeto : 0;
}

/**
 * Liquida TODOS los tickets Pendientes de una carrera y aplica el resultado
 * en la BD: estado Ganador/Perdedor + premio_pagar + incremento de
 * clientes.saldo_actual del ganador (abono). Return resumen + errores.
 */
export async function aplicarLiquidacionSaldos(
  input: LiquidarSaldosInput
): Promise<ResumenSaldos> {
  if (!supabase) {
    return { ok: false, motivo: "Sin conexión a Supabase", aplicados: 0, yaAplicado: false, reembolsos: 0, abonoTotal: 0, errores: ["Sin conexión a Supabase."] };
  }
  const sdb = supabase;
  // Ventana UTC que cubre el día de la JORNADA (input.fecha) o, si no se pasa,
  // el día local. La columna real es fecha_registro (timestamptz del momento de
  // la venta). Antes se filtraba con .eq("fecha", f), y `fecha` NO existe en
  // tickets_apuestas: la consulta moría en el catch y esta pantalla devolvía
  // "No se pudieron leer los tickets pendientes", sin liquidar nunca nada.
  const f = input.fecha || hoyLocal();
  const { desde, hasta } = ventanaDiaLocal(f);
  let filas: unknown[] = [];
  try {
    const { data, error } = await sdb
      .from("tickets_apuestas")
      .select("*")
      .gte("fecha_registro", desde)
      .lt("fecha_registro", hasta)
      .eq("hipodromo", input.hipodromo.trim().toUpperCase())
      .eq("carrera", Number(input.carrera))
      .eq("estado", "Pendiente")
      // Una jugada ANULADA no se liquida: se excluye del motor. Sin este filtro,
      // anular una jugada dejaba el ticket 'Pendiente' y la re-liquidación lo
      // volvía a decidir/acreditar (la anulación no surtía efecto en el dinero).
      .or("anulada.is.null,anulada.eq.false")
      // Las MARCAS se liquidan con `club_liquidar_marca`, que lee el snapshot de
      // rivales del ticket. Si el motor universal las agarrara, decidiría "quien
      // salga primero" y pagaría a un rival que en la marca iba perdiendo.
      .not("nombre_jugada", "like", "MARCA %")
      .limit(2000);
    if (error) throw error;
    filas = data ?? [];
  } catch (e) {
    return { ok: false, motivo: "No se pudieron leer los tickets pendientes.", aplicados: 0, yaAplicado: false, reembolsos: 0, abonoTotal: 0, errores: [(e as Error).message] };
  }

  // Seguridad idempotente: si no hay Pendiente pero sí decididos → ya aplicado.
  const { data: decididos } = await sdb
    .from("tickets_apuestas")
    .select("id")
    .gte("fecha_registro", desde)
    .lt("fecha_registro", hasta)
    .eq("hipodromo", input.hipodromo.trim().toUpperCase())
    .eq("carrera", Number(input.carrera))
    .in("estado", ["Ganador", "Perdedor", "Retirado"])
    .not("nombre_jugada", "like", "MARCA %")
    .limit(1);
  if (filas.length === 0 && ((decididos ?? []).length > 0 || filas.length === 0)) {
    if ((decididos ?? []).length > 0) {
      return { ok: true, motivo: "Carrera ya liquidada (tickets decididos). Sin cambios.", aplicados: 0, yaAplicado: true, reembolsos: 0, abonoTotal: 0, errores: [] };
    }
    return { ok: true, motivo: "Sin tickets pendientes para esta carrera.", aplicados: 0, yaAplicado: false, reembolsos: 0, abonoTotal: 0, errores: [] };
  }

  // Decide cada ticket con el motor universal (idempotente por estado) y aplica
  // el neteo de comisión por cruce. La MISMA función la usa
  // `revertirLiquidacionCarrera` para que el cálculo de reversión y el de
  // re-liquidación empleen exactamente la misma fórmula.
  const decisiones = decidirTickets(filas, input);
  const errores: string[] = [];


  let abonoTotal = 0;
  let reembolsos = 0;
  for (const { res } of decisiones) {
    if (res.ok) {
      abonoTotal += res.totalClienteNeto;
    } else if (res.totalClienteNeto > 0) {
      // ANULADA: el motor devolvió el capital (ok:false pero con capital). La
      // venta ya lo descontó, así que entra en el abono como reembolso.
      abonoTotal += res.totalClienteNeto;
      reembolsos += 1;
    }
  }

  // Aplica los updates (ticket + saldo del cliente) en un viaje consistente.
  //
  // Los tickets INDETERMINADOS (el motor sabe que ganan por posición pero falta
  // el dividendo que cuantifica el premio, p. ej. la matriz W/P/S sin cargar) NO
  // se tocan: quedan PENDIENTES. Escribirlos como "Perdedor" con premio 0
  // cobraría $0 a una jugada ganadora y, como el estado queda persistido,
  // liquidar de nuevo ya no los revierte: el operador ni vería el error.
  const pendientes = decisiones.filter((d) => d.res.indeterminado);
  for (const { fila, res } of pendientes) {
    errores.push(
      `Ticket ${String(fila.id)} (${String(fila.nombre_jugada ?? "")}): sin dividendo para decidirlo, se deja PENDIENTE. ${res.motivo ?? ""}`.trim()
    );
  }

  const decidibles = decisiones.filter((d) => !d.res.indeterminado);
  const updates: Promise<unknown>[] = decidibles.map(({ fila, res }) => {
    // ANULADA: el motor devolvió el capital (ok:false con totalClienteNeto > 0
    // = monto). Se marca "Retirado" (ni ganador ni perdedor) y se le DEVUELVE el
    // capital al cliente. Antes caía en "Perdedor" con premio 0 y el cliente
    // perdía su dinero en una jugada que la casa anuló.
    const esAnulada = !res.ok && res.totalClienteNeto > 0;
    const estado = esAnulada ? "Retirado" : res.ok ? "Ganador" : "Perdedor";
    // premio_pagar / monto_decidido = PREMIO BRUTO (capital + ganancia ANTES de
    // comisión), que es la convención de TODO el sistema:
    //   · la liquidación legacy (marcas_venta.sql: premio_pagar = v_bruto;
    //     dupleta_liquidacion.sql: premio_pagar = v_premio),
    //   · el trigger del banquero (banqueros.sql: "v_mov := -premio_pagar
    //     (paga capital + ganancia)"),
    //   · el reporte de liquidación (reportes.ts: lee premio_pagar como bruto),
    //   · el mensaje de resultados del grupo (reportGenerator.mapearJugada →
    //     balanceJugada trata premio_pagar como el premio bruto).
    // Guardar aquí el NETO rompía todo eso: el "Consigue" del mensaje del grupo
    // (que relee la BD) pagaba de menos toda la comisión y el banquero cobraba/
    // pagaba de menos. El ABONO al saldo del ganador SÍ es neto
    // (totalClienteNeto): es el dinero que recibe en mano.
    const premioPagar = res.ok ? Math.round((res.totalClienteNeto + res.gananciaCasa) * 100) / 100 : 0;
    const montDecidido = premioPagar;
    const credito = res.ok || esAnulada ? res.totalClienteNeto : 0;

    const clientePromise = credito > 0
      ? (async () => {
          const fid = fila.cliente_juega_id;
          if (fid == null) return;
          const { data: c, error: eSel } = await sdb
            .from("clientes")
            .select("saldo_actual")
            .eq("id", fid)
            .maybeSingle();
          if (eSel) {
            // Sin lectura no se puede acumular sobre el saldo real: abortar solo el
            // abono. Antes el error se ignoraba, `actual` caía en 0 y el UPDATE
            // sobrescribía el saldo del cliente con el premio del ticket.
            errores.push(`Saldo cliente ${String(fid)}: no se pudo leer (${eSel.message})`);
            return;
          }
          const actual = NUM(((c ?? {}) as Record<string, unknown>).saldo_actual);
          const { error: eUpd } = await sdb
            .from("clientes")
            .update({ saldo_actual: actual + credito })
            .eq("id", fid as never);
          if (eUpd) errores.push(`Saldo cliente ${String(fid)}: no se pudo acreditar (${eUpd.message})`);
        })()
      : Promise.resolve();

    return Promise.all([
      sdb
        .from("tickets_apuestas")
        .update({ estado, premio_pagar: premioPagar, monto_decidido: montDecidido })
        .eq("id", fila.id as never),
      clientePromise,
    ]).catch((e) => {
      errores.push(`Ticket ${String(fila.id)}: ${(e as Error).message}`);
    });
  });

  await Promise.all(updates);

  const ganadores = decidibles.filter((d) => d.res.ok).length;
  const base =
    `Liquidación aplicada: ${decidibles.length} ticket(s) decidido(s) (${ganadores} ganadores` +
    (reembolsos ? `, ${reembolsos} anulados devueltos` : "") +
    `). ` +
    `Abono total $${abonoTotal.toFixed(2)}.`;
  let motivo = base;
  if (pendientes.length) {
    motivo =
      base +
      ` ${pendientes.length} ticket(s) quedaron PENDIENTES porque falta el dividendo ` +
      `que los cuantifica (cargue los dividendos de la carrera y liquide de nuevo).`;
  }

  return {
    ok: errores.length === 0,
    motivo,
    aplicados: decidibles.length,
    yaAplicado: false,
    reembolsos,
    abonoTotal,
    errores,
  };
}