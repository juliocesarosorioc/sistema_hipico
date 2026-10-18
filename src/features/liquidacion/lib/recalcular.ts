/**
 * ============================================================================
 * RECALCULAR CARRERA — corregir una jugada ya liquidada REHACE la carrera
 * ============================================================================
 *
 * Cuando una carrera YA está liquidada y alguien corrige o anula una jugada,
 * no alcanza con guardar el cambio: cambian los ganadores/perdedores, el
 * abono a cada cliente y la comisión neta de la carrera (cruces financieros).
 *
 * Estrategia (undo + redo), que es la única que no arrastra deriva:
 *
 *   1. REVERTIR: se releen los tickets decididos de la carrera y se les
 *      DEVUELVE al cliente el crédito que se les había acreditado (recalculado
 *      con la MISMA fórmula de `aplicarLiquidacionSaldos` vía `decidirTickets`,
 *      así que el descuento es exacto). Los tickets vuelven a 'Pendiente'.
 *   2. APLICAR la corrección/anulación pedida.
 *   3. RE-LIQUIDAR: se corre `aplicarLiquidacionSaldos`, que decide TODOS los
 *      Pendientes con los montos nuevos → recomputa ganadores, perdedores,
 *      premios y comisión.
 *
 * Las MARCAS quedan fuera de esta reversión (su liquidación la hace la RPC
 * `club_liquidar_marca` sobre un snapshot de rivales y no se re-decide acá);
 * solo se recalcula la liquidación universal, que es donde vive la comisión de
 * la carrera.
 */

import { supabase } from "@/core/supabase";
import { hoyLocal } from "@/features/gaceta/lib/programa";
import { ventanaDiaLocal } from "@/features/liquidacion/lib/fecha";
import { CAMPOS_POSICION, dividendosDePizarra } from "@/features/liquidacion/lib/posiciones";
import { aplicarLiquidacionSaldos, creditoDeTicket, decidirTickets } from "@/features/liquidacion/lib/saldos";
import { leerResultadoOficial } from "@/features/carreras/lib/carreras-dia";
import { editarJugada, anularJugada, type EditablesJugada } from "@/features/jugadas/lib/jugadas";
import type { PizarraCarrera } from "@/features/liquidacion/lib/liquidacion";

export type ResRecalcular = {
  ok: boolean;
  motivo: string;
  /** Tickets decididos que volvieron a 'Pendiente' (crédito devuelto). */
  revertidos: number;
  /** Saldo total descontado a los clientes al revertir. */
  revertidoTotal: number;
  /** Tickets re-liquidados con los datos nuevos. */
  reliquidados: number;
  /** Saldo total acreditado en la re-liquidación. */
  abonoTotal: number;
  errores: string[];
};

const NUM = (v: unknown): number => {
  const n = parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
};

/** Arma la pizarra (`primero`..`octavo`) desde el orden de llegada oficial. */
function pizarraDePuestos(puestos: string[]): PizarraCarrera | null {
  if (!puestos.length) return null;
  const p: PizarraCarrera = { primero: String(puestos[0]) };
  CAMPOS_POSICION.forEach((campo, i) => {
    if (i > 0 && puestos[i]) (p as Record<string, unknown>)[campo] = String(puestos[i]);
  });
  return p;
}

/**
 * Devuelve a 'Pendiente' los tickets YA DECIDIDOS de la carrera y descuenta a
 * cada cliente el crédito que se le había acreditado. Recalcula ese crédito con
 * `decidirTickets`, la misma fórmula de la liquidación original.
 *
 * No toca MARCAS ni tickets Pendientes.
 */
export async function revertirLiquidacionCarrera(opts: {
  hipodromo: string;
  carrera: number | string;
  fecha?: string;
  tasaComision?: number | null;
}): Promise<ResRecalcular> {
  const vacio: ResRecalcular = { ok: true, motivo: "", revertidos: 0, revertidoTotal: 0, reliquidados: 0, abonoTotal: 0, errores: [] };
  if (!supabase) return { ...vacio, ok: false, motivo: "Sin conexión a Supabase", errores: ["Sin conexión a Supabase."] };
  const sdb = supabase;
  const fecha = opts.fecha || hoyLocal();

  // Resultado oficial vigente (pizarra + dividendos) para recomputar igual.
  const oficial = await leerResultadoOficial(opts.hipodromo, opts.carrera, fecha);
  const pizarra = pizarraDePuestos(oficial?.puestos ?? []);
  if (!pizarra) {
    return { ...vacio, motivo: "La carrera no tiene resultado oficial: no hay nada que revertir." };
  }

  const { desde, hasta } = ventanaDiaLocal(fecha);
  let filas: unknown[] = [];
  try {
    const { data, error } = await sdb
      .from("tickets_apuestas")
      .select("*")
      .gte("fecha_registro", desde)
      .lt("fecha_registro", hasta)
      .eq("hipodromo", opts.hipodromo.trim().toUpperCase())
      .eq("carrera", Number(opts.carrera))
      .in("estado", ["Ganador", "Perdedor", "Retirado"])
      .not("nombre_jugada", "like", "MARCA %")
      .limit(2000);
    if (error) throw error;
    filas = data ?? [];
  } catch (e) {
    return { ...vacio, ok: false, motivo: "No se pudieron leer los tickets decididos.", errores: [(e as Error).message] };
  }
  if (!filas.length) return { ...vacio, motivo: "No había tickets decididos que revertir." };

  const decisiones = decidirTickets(filas, {
    hipodromo: opts.hipodromo,
    carrera: opts.carrera,
    pizarra,
    dividendos: dividendosDePizarra({ dividendos: oficial?.dividendos ?? null }),
    tasaComision: opts.tasaComision ?? null,
    fecha,
  });

  const errores: string[] = [];
  let revertidos = 0;
  let revertidoTotal = 0;
  const updates: Promise<unknown>[] = [];
  for (const { fila, res } of decisiones) {
    const credito = creditoDeTicket(res);
    const fid = fila.cliente_juega_id;
    const devolucion = credito > 0
      ? (async () => {
          if (fid == null) return;
          const { data: c, error: eSel } = await sdb.from("clientes").select("saldo_actual").eq("id", fid).maybeSingle();
          if (eSel) {
            errores.push(`Saldo cliente ${String(fid)}: no se pudo leer (${eSel.message})`);
            return;
          }
          const actual = NUM(((c ?? {}) as Record<string, unknown>).saldo_actual);
          const { error: eUpd } = await sdb.from("clientes").update({ saldo_actual: actual - credito }).eq("id", fid as never);
          if (eUpd) errores.push(`Saldo cliente ${String(fid)}: no se pudo revertir (${eUpd.message})`);
        })()
      : Promise.resolve();
    revertidos += 1;
    revertidoTotal += credito;
    updates.push(
      Promise.all([
        sdb
          .from("tickets_apuestas")
          .update({ estado: "Pendiente", premio_pagar: 0, monto_decidido: 0 })
          .eq("id", fila.id as never),
        devolucion,
      ]).catch((e) => {
        errores.push(`Ticket ${String(fila.id)}: ${(e as Error).message}`);
      })
    );
  }
  await Promise.all(updates);
  return {
    ok: errores.length === 0,
    motivo: `Revertidos ${revertidos} ticket(s) · $${revertidoTotal.toFixed(2)} devuelto a los clientes.`,
    revertidos,
    revertidoTotal,
    reliquidados: 0,
    abonoTotal: 0,
    errores,
  };
}

/** Re-liquidación completa: decide TODOS los Pendientes (ganadores, perdedores,
 *  premios y comisión neta) con el resultado oficial vigente. */
async function reliquidar(opts: {
  hipodromo: string;
  carrera: number | string;
  fecha?: string;
  tasaComision?: number | null;
}): Promise<ResRecalcular> {
  const vacio: ResRecalcular = { ok: true, motivo: "", revertidos: 0, revertidoTotal: 0, reliquidados: 0, abonoTotal: 0, errores: [] };
  if (!supabase) return { ...vacio, ok: false, motivo: "Sin conexión a Supabase", errores: ["Sin conexión a Supabase."] };
  const fecha = opts.fecha || hoyLocal();
  const oficial = await leerResultadoOficial(opts.hipodromo, opts.carrera, fecha);
  const pizarra = pizarraDePuestos(oficial?.puestos ?? []);
  if (!pizarra) return { ...vacio, ok: false, motivo: "Sin resultado oficial no se puede re-liquidar.", errores: ["Sin resultado oficial."] };

  const s = await aplicarLiquidacionSaldos({
    hipodromo: opts.hipodromo,
    carrera: opts.carrera,
    pizarra,
    dividendos: dividendosDePizarra({ dividendos: oficial?.dividendos ?? null }),
    tasaComision: opts.tasaComision ?? null,
    fecha,
  });
  return {
    ok: s.ok,
    motivo: s.motivo,
    revertidos: 0,
    revertidoTotal: 0,
    reliquidados: s.aplicados,
    abonoTotal: s.abonoTotal,
    errores: s.errores,
  };
}

/** Corrige campos de una jugada y REHACE la carrera (revertir → corregir → re-liquidar). */
export async function corregirJugadaYRecalcular(opts: {
  id: string | number;
  campos: EditablesJugada;
  motivo: string;
  usuario: string;
  hipodromo: string;
  carrera: number | string;
  fecha?: string;
  tasaComision?: number | null;
}): Promise<ResRecalcular> {
  const rev = await revertirLiquidacionCarrera(opts);
  const edit = await editarJugada(opts.id, opts.campos, opts.motivo, opts.usuario);
  if (!edit.ok) {
    // Si la corrección falla, no se deja la carrera revertida: se re-liquida.
    const re = await reliquidar(opts);
    return { ...re, ok: false, motivo: `No se pudo corregir la jugada: ${edit.error ?? "error"}`, revertidos: rev.revertidos, revertidoTotal: rev.revertidoTotal, errores: [...rev.errores, edit.error ?? "error desconocido"] };
  }
  const re = await reliquidar(opts);
  return {
    ok: rev.ok && re.ok,
    motivo: `Corrección aplicada y carrera recalculada. ${re.motivo}`,
    revertidos: rev.revertidos,
    revertidoTotal: rev.revertidoTotal,
    reliquidados: re.reliquidados,
    abonoTotal: re.abonoTotal,
    errores: [...rev.errores, ...re.errores],
  };
}

/** Anula una jugada y REHACE la carrera (revertir → anular → re-liquidar). */
export async function anularJugadaYRecalcular(opts: {
  id: string | number;
  motivo: string;
  imagen?: string | null;
  usuario: string;
  hipodromo: string;
  carrera: number | string;
  fecha?: string;
  tasaComision?: number | null;
}): Promise<ResRecalcular> {
  const rev = await revertirLiquidacionCarrera(opts);
  const anu = await anularJugada(opts.id, opts.motivo, opts.imagen ?? null, opts.usuario);
  if (!anu.ok) {
    const re = await reliquidar(opts);
    return { ...re, ok: false, motivo: `No se pudo anular la jugada: ${anu.error ?? "error"}`, revertidos: rev.revertidos, revertidoTotal: rev.revertidoTotal, errores: [...rev.errores, anu.error ?? "error desconocido"] };
  }
  const re = await reliquidar(opts);
  return {
    ok: rev.ok && re.ok,
    motivo: `Jugada anulada y carrera recalculada. ${re.motivo}`,
    revertidos: rev.revertidos,
    revertidoTotal: rev.revertidoTotal,
    reliquidados: re.reliquidados,
    abonoTotal: re.abonoTotal,
    errores: [...rev.errores, ...re.errores],
  };
}

/**
 * REHACE toda la carrera sin cambiar ninguna jugada: revierte la liquidación de
 * los tickets ya decididos y vuelve a liquidar todo con el resultado vigente.
 * Se usa tras RESTAURAR una jugada anulada (vuelve a entrar al motor) para que
 * premios y comisión queden consistentes con el nuevo conjunto de jugadas.
 */
export async function recalcularCarrera(opts: {
  hipodromo: string;
  carrera: number | string;
  fecha?: string;
  tasaComision?: number | null;
}): Promise<ResRecalcular> {
  const rev = await revertirLiquidacionCarrera(opts);
  const re = await reliquidar(opts);
  return {
    ok: rev.ok && re.ok,
    motivo: `Carrera recalculada. ${re.motivo}`,
    revertidos: rev.revertidos,
    revertidoTotal: rev.revertidoTotal,
    reliquidados: re.reliquidados,
    abonoTotal: re.abonoTotal,
    errores: [...rev.errores, ...re.errores],
  };
}
