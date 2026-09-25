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
import { supabase } from "@/lib/supabase";
import { liquidarOficial } from "@/lib/motores/oficiales";
import { marcasConfigParaCarrera } from "@/lib/marcas";
import { hoyLocal } from "@/lib/gaceta/programa";
import { parsearNini, netearComisionCruce, claveCruceFinanciero, type NeteoCruceItem } from "@/lib/bettingEngine";
import type { TicketMotor, ResultadoMotor } from "@/lib/bettingEngine";
import type { PizarraCarrera } from "@/lib/liquidacion";

export type LiquidarSaldosInput = {
  hipodromo: string;
  carrera: number | string;
  pizarra: PizarraCarrera;
  dividendos?: Record<string, number> | null;
  premio_por_tabla?: number | null;
  tasaComision?: number | null;
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
  ctx: LiquidarSaldosInput,
  marcasConfig?: MarcaConfigLiquidacion | null
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
    premio_por_tabla: ctx.premio_por_tabla ?? null,
    ...(/^MARCA|MARCAR/.test(tipo) && marcasConfig
      ? { marcas: { marcados: marcasConfig.marcados, contra: marcasConfig.contra } }
      : {}),
  };
}

type MarcaConfigLiquidacion = { marcados: string[]; contra: string[] };

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
  // Fecha LOCAL (no UTC): los tickets se persisten con la fecha de la jornada
  // que ve el operador (ISO YYYY-MM-DD) → el filtro .eq('fecha', f) debe usar
  // la MISMA semántica, no el "día anterior" UTC tras las 20:00.
  const f = hoyLocal();
  const marcasConfig = await marcasConfigParaCarrera(input.hipodromo, input.carrera, f);
  let filas: unknown[] = [];
  try {
    const { data, error } = await sdb
      .from("tickets_apuestas")
      .select("*")
      .eq("fecha", f)
      .eq("hipodromo", input.hipodromo.trim().toUpperCase())
      .eq("carrera", Number(input.carrera))
      .eq("estado", "Pendiente")
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
    .eq("fecha", f)
    .eq("hipodromo", input.hipodromo.trim().toUpperCase())
    .eq("carrera", Number(input.carrera))
    .in("estado", ["Ganador", "Perdedor", "Retirado"])
    .limit(1);
  if (filas.length === 0 && ((decididos ?? []).length > 0 || filas.length === 0)) {
    if ((decididos ?? []).length > 0) {
      return { ok: true, motivo: "Carrera ya liquidada (tickets decididos). Sin cambios.", aplicados: 0, yaAplicado: true, reembolsos: 0, abonoTotal: 0, errores: [] };
    }
    return { ok: true, motivo: "Sin tickets pendientes para esta carrera.", aplicados: 0, yaAplicado: false, reembolsos: 0, abonoTotal: 0, errores: [] };
  }

  // Decide cada ticket con el motor universal (idempotente por estado).
  const decisiones: Array<{ fila: Record<string, unknown>; res: ResultadoMotor }> = [];
  const errores: string[] = [];
  for (const fRaw of filas) {
    const fila = fRaw as Record<string, unknown>;
    const res = liquidarOficial(motorDesdeFila(fila, input, marcasConfig), input.tasaComision);
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

  let abonoTotal = 0;
  for (const { res } of decisiones) {
    if (res.ok) abonoTotal += res.totalClienteNeto;
  }

  // Aplica los updates (ticket + saldo del cliente) en un viaje consistente.
  const updates: Promise<unknown>[] = decisiones.map(({ fila, res }) => {
    const estado = res.ok ? "Ganador" : "Perdedor";
    const premioPagar = res.ok ? res.totalClienteNeto : 0;
    const montDecidido = res.ok ? res.totalClienteNeto : 0;

    const clientePromise = res.ok
      ? (async () => {
          const fid = fila.cliente_juega_id;
          if (fid == null) return;
          const { data: c } = await sdb
            .from("clientes")
            .select("saldo_actual")
            .eq("id", fid)
            .maybeSingle();
          const actual = NUM(((c ?? {}) as Record<string, unknown>).saldo_actual);
          await sdb
            .from("clientes")
            .update({ saldo_actual: actual + res.totalClienteNeto })
            .eq("id", fid as never);
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

  return {
    ok: errores.length === 0,
    motivo: `Liquidación aplicada: ${decisiones.length} ticket(s) decidido(s) (${decisiones.filter((d) => d.res.ok).length} ganadores). Abono total $${abonoTotal.toFixed(2)}.`,
    aplicados: decisiones.length,
    yaAplicado: false,
    reembolsos: 0,
    abonoTotal,
    errores,
  };
}