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
import { filtroDiaJornada } from "@/features/liquidacion/lib/fecha";
import { CAMPOS_POSICION, dividendosDePizarra } from "@/features/liquidacion/lib/posiciones";
import { aplicarLiquidacionSaldos, creditoDeTicket, decidirTickets } from "@/features/liquidacion/lib/saldos";
import { liquidarJugadasDeCarrera, type ResumenJugadas } from "@/features/liquidacion/lib/pagarYCerrar";
import { leerResultadoOficial } from "@/features/carreras/lib/carreras-dia";
import { claveHipodromo } from "@/features/carreras/lib/claves";
import { listarRemates, cerrarRemateLiquidando } from "@/features/remates/lib/remates";
import type { Remate } from "@/features/remates/lib/core";
import { editarJugada, anularJugada, type EditablesJugada } from "@/features/jugadas/lib/jugadas";
import type { PizarraCarrera } from "@/features/liquidacion/lib/liquidacion";
import { cargarOpcionesCrucesPuestos } from "@/features/gestion/lib/cruces-carrera";
import {
  sincronizarSaldosRealesClientes,
  calcularIncentivoCarreraCliente,
  type TicketContableRaw,
} from "@/features/saldos/lib/contabilidad-central";
import { restarDinero, sumarDinero } from "@/shared/lib/dinero";

export { sincronizarSaldosRealesClientes };
export {
  parsearComandoPizarra,
  pizarraDeLlegada,
  ejecutarComandoPizarra,
  MENSAJE_PIZARRA_ANULADA,
} from "@/features/liquidacion/lib/agente-pizarra";

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
 * No toca MARCAS, TABLAS FIJAS ni tickets Pendientes.
 *
 * MARCAS y TABLAS FIJAS se liquidan con sus PROPIAS RPC idempotentes
 * (`club_liquidar_marca`, `club_liquidar_tabla_fija`) que leen un snapshot
 * propio (rivales de la marca, `premio_por_tabla` de la venta). Si el revertir
 * las agarrara, les devolvería un crédito calculado con la fórmula del motor
 * universal (que NI SIQUIERA las considera al aplicar, ver
 * `aplicarLiquidacionSaldos`) y, como después no se las vuelve a pagar, el
 * cliente quedaría con un reembolso indebido. El filtro debe ser SIMÉTRICO al
 * de la aplicación.
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

  let filas: unknown[] = [];
  try {
    const { data, error } = await sdb
      .from("tickets_apuestas")
      .select("*")
      // Día de la CARRERA, no de la venta (ver `filtroDiaJornada`).
      .or(filtroDiaJornada(fecha))
      .eq("hipodromo", opts.hipodromo.trim().toUpperCase())
      .eq("carrera", Number(opts.carrera))
      .in("estado", ["Ganador", "Perdedor", "Retirado"])
      .not("nombre_jugada", "like", "MARCA %")
      // SIMÉTRICO a `aplicarLiquidacionSaldos`: las TABLAS FIJAS las paga su
      // propia RPC (`club_liquidar_tabla_fija`), nunca el motor universal. Sin
      // este filtro el revertir les devolvía un crédito ajeno y no se las volvía
      // a pagar → doble/incorrecto reembolso.
      .not("nombre_jugada", "like", "TABLA FIJA%")
      .limit(2000);
    if (error) throw error;
    filas = (data ?? []).filter((f) => !(f as Record<string, unknown>).anulada);
  } catch (e) {
    return { ...vacio, ok: false, motivo: "No se pudieron leer los tickets decididos.", errores: [(e as Error).message] };
  }
  if (!filas.length) return { ...vacio, motivo: "No había tickets decididos que revertir." };

  const reglasCruce = await cargarOpcionesCrucesPuestos({
    fecha,
    hipodromo: opts.hipodromo,
    carrera: opts.carrera,
  });
  if (!reglasCruce.ok) {
    return {
      ...vacio,
      ok: false,
      motivo: "No se pudieron cargar las reglas de cruces para revertir la liquidación.",
      errores: [reglasCruce.error ?? "Error desconocido."],
    };
  }
  const decisiones = decidirTickets(filas, {
    hipodromo: opts.hipodromo,
    carrera: opts.carrera,
    pizarra,
    dividendos: dividendosDePizarra({ dividendos: oficial?.dividendos ?? null }),
    tasaComision: opts.tasaComision ?? null,
    fecha,
    crucesPuestos: reglasCruce.opciones,
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

  // ── REVERSIÓN SIMÉTRICA DE INCENTIVOS SILENCIOSOS CARRERA A CARRERA ──
  const clientesReversion = [
    ...new Set(
      decisiones
        .map((d) => (d.fila as Record<string, unknown>).cliente_juega_id)
        .filter((id): id is string | number => id != null)
    ),
  ];

  if (clientesReversion.length > 0) {
    try {
      const { data: dbClientes } = await sdb
        .from("clientes")
        .select("id, nombre, saldo_actual, devolucion")
        .in("id", clientesReversion as string[]);

      if (dbClientes && dbClientes.length > 0) {
        for (const cli of dbClientes as Array<Record<string, unknown>>) {
          const devPct = Math.max(0, Number(cli.devolucion) || 0);
          if (devPct <= 0) continue;

          const ticketsCli: TicketContableRaw[] = decisiones
            .filter((d) => String((d.fila as Record<string, unknown>).cliente_juega_id) === String(cli.id))
            .map((d) => ({
              ...(d.fila as unknown as TicketContableRaw),
              estado: !d.res.ok && d.res.totalClienteNeto > 0 ? "Retirado" : d.res.ok ? "Ganador" : "Perdedor",
              monto_decidido: d.res.ok ? sumarDinero(d.res.totalClienteNeto, d.res.gananciaCasa) : (((d.fila as Record<string, unknown>).monto_jugado as number) ?? 0),
            }));

          const inc = calcularIncentivoCarreraCliente(ticketsCli, devPct);
          if (inc > 0) {
            const actual = NUM(cli.saldo_actual);
            const nuevoSaldo = restarDinero(actual, inc);
            await sdb
              .from("clientes")
              .update({ saldo_actual: nuevoSaldo })
              .eq("id", cli.id as never);
          }
        }
      }
    } catch (e) {
      console.error("Error revirtiendo incentivos silenciosos en carrera:", e);
    }
  }
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
  if (!pizarra) return { ...vacio, ok: true, motivo: "Carrera abierta sin resultado oficial (se liquidará al cargar la pizarra).", errores: [] };

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

/**
 * Re-liquida las MODALIDADES ESPECIALES de la carrera (Tablas Fijas, Marcas,
 * Dupletas vía sus RPCs idempotentes) y re-cobra los remates abiertos, cuando
 * ya hay resultado oficial. Se usa en el camino de corregir/anular/restaurar
 * una jugada: aunque el motor universal no toca esas modalidades (tienen RPC
 * propias), editar una jugada de TABLA/MARCA exige volver a correr su RPC para
 * que el cambio surta efecto en el dinero. Si no hay resultado, no hace nada.
 */
async function reliquidarEspecialesDeCarrera(opts: {
  hipodromo: string;
  carrera: number | string;
  fecha?: string;
  usuario?: string | null;
}): Promise<{ motivo: string; errores: string[] }> {
  const fecha = opts.fecha || hoyLocal();
  const dia = String(fecha).slice(0, 10);
  const carrera = Number(opts.carrera) || 0;
  const oficial = await leerResultadoOficial(opts.hipodromo, opts.carrera, fecha);
  const pizarra = pizarraDePuestos(oficial?.puestos ?? []);
  if (!pizarra) return { motivo: "", errores: [] }; // sin resultado no se toca nada
  const errores: string[] = [];
  let partes: string[] = [];
  try {
    const j = await liquidarJugadasDeCarrera({
      hipodromo: opts.hipodromo,
      carrera,
      fecha: dia,
      pizarra,
      usuario: opts.usuario ?? null,
    });
    if (j.tablasFijas && !j.tablasFijas.ok && j.tablasFijas.error) errores.push(`Tablas fijas: ${j.tablasFijas.error}`);
    if (j.marcas && !j.marcas.ok && j.marcas.error) errores.push(`Marcas: ${j.marcas.error}`);
    if (j.dupletas && !j.dupletas.ok && j.dupletas.error) errores.push(`Dupletas: ${j.dupletas.error}`);
    partes.push(`tablas ${j.tablasFijas?.tablas ?? 0}`, `dupletas ${j.dupletas?.liquidadas ?? 0}`);
  } catch (e) {
    errores.push(`Jugadas especiales: ${(e as Error).message}`);
  }
  const rem = await reCerrarRematesDeCarrera(opts.hipodromo, carrera, dia);
  errores.push(...rem.errores);
  if (rem.reabiertosCerrados) partes.push(`remates ${rem.reabiertosCerrados}`);
  return { motivo: partes.length ? `[especiales: ${partes.join(" · ")}]` : "", errores };
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
  const hipoDestino = opts.campos.hipodromo ? String(opts.campos.hipodromo).trim().toUpperCase() : opts.hipodromo;
  const carreraDestino = opts.campos.carrera != null ? Number(opts.campos.carrera) : Number(opts.carrera);
  const fechaDestino = opts.campos.fecha_carrera ? String(opts.campos.fecha_carrera).slice(0, 10) : opts.fecha;
  const cambioDeCarrera =
    hipoDestino.toUpperCase() !== String(opts.hipodromo).trim().toUpperCase() ||
    carreraDestino !== Number(opts.carrera) ||
    (fechaDestino && opts.fecha && fechaDestino !== String(opts.fecha).slice(0, 10));

  if (cambioDeCarrera) {
    await revertirLiquidacionCarrera({
      hipodromo: hipoDestino,
      carrera: carreraDestino,
      fecha: fechaDestino,
      tasaComision: opts.tasaComision,
    });
  }

  const edit = await editarJugada(opts.id, opts.campos, opts.motivo, opts.usuario);
  if (!edit.ok) {
    // Si la corrección falla, no se deja la carrera revertida: se re-liquida.
    const re = await reliquidar(opts);
    if (cambioDeCarrera) {
      await reliquidar({
        hipodromo: hipoDestino,
        carrera: carreraDestino,
        fecha: fechaDestino,
        tasaComision: opts.tasaComision,
      });
    }
    return { ...re, ok: false, motivo: `No se pudo corregir la jugada: ${edit.error ?? "error"}`, revertidos: rev.revertidos, revertidoTotal: rev.revertidoTotal, errores: [...rev.errores, edit.error ?? "error desconocido"] };
  }
  const re = await reliquidar(opts);
  const esp = await reliquidarEspecialesDeCarrera(opts);
  if (cambioDeCarrera) {
    await reliquidar({
      hipodromo: hipoDestino,
      carrera: carreraDestino,
      fecha: fechaDestino,
      tasaComision: opts.tasaComision,
    });
    await reliquidarEspecialesDeCarrera({
      hipodromo: hipoDestino,
      carrera: carreraDestino,
      fecha: fechaDestino,
      usuario: opts.usuario,
    });
  }
  return {
    ok: rev.ok && re.ok,
    motivo: `Corrección aplicada y carrera recalculada. ${re.motivo}${esp.motivo ? ` ${esp.motivo}` : ""}`,
    revertidos: rev.revertidos,
    revertidoTotal: rev.revertidoTotal,
    reliquidados: re.reliquidados,
    abonoTotal: re.abonoTotal,
    errores: [...rev.errores, ...re.errores, ...esp.errores],
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
  const esp = await reliquidarEspecialesDeCarrera(opts);
  return {
    ok: rev.ok && re.ok,
    motivo: `Jugada anulada y carrera recalculada. ${re.motivo}${esp.motivo ? ` ${esp.motivo}` : ""}`,
    revertidos: rev.revertidos,
    revertidoTotal: rev.revertidoTotal,
    reliquidados: re.reliquidados,
    abonoTotal: re.abonoTotal,
    errores: [...rev.errores, ...re.errores, ...esp.errores],
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

// ============================================================================
// MOTOR MAESTRO DE RE-LIQUIDACIÓN POST-CARRERA
// ============================================================================

export type ResRecalcularCompleto = ResRecalcular & {
  /** Resultado oficial detectado (puestos) para poder haber recalculado. */
  puestos: string[];
  /** Resumen de las modalidades especiales (tablas fijas, marcas, dupletas). */
  jugadas: ResumenJugadas | null;
  /** Remates de esta carrera que se re-cerraron contra el resultado. */
  remates: { reabiertosCerrados: number; omitidosCerrados: number; errores: string[] };
};

const VACIO_JUGADAS: ResumenJugadas = {
  tablasFijas: { ok: true, tablas: 0, pagado: 0, comision: 0 },
  marcas: { ok: true },
  dupletas: { ok: true, liquidadas: 0, pagado: 0 },
};

/**
 * RE-CIERRA los remates de ESTA carrera que siguen 'Abierto' y cuya carrera ya
 * tiene resultado: el operador los reabrió para agregar/editar un ejemplar
 * rezagado y necesita que se cobren/paguen ya contra el resultado oficial.
 *
 * Es SEGURO e idempotente: `club_cerrar_remate` es una sola transacción y un
 * ejemplar YA cobrado no se cobra de nuevo (devuelve `ya_cobrados`). Los
 * remates ya 'Cerrado' se omiten — la RPC de hecho rechaza cerrar dos veces
 * ('Este remate ya esta cerrado'), así que no hay riesgo de doble cobro.
 */
async function reCerrarRematesDeCarrera(
  hipodromo: string,
  carrera: number,
  fecha: string
): Promise<ResRecalcularCompleto["remates"]> {
  const out: ResRecalcularCompleto["remates"] = { reabiertosCerrados: 0, omitidosCerrados: 0, errores: [] };
  if (!supabase) return out;
  const clave = claveHipodromo(hipodromo);
  const dia = String(fecha).slice(0, 10);

  let remates: Remate[] = [];
  try {
    const r = await listarRemates();
    if (!r.ok || !r.datos) return out; // sin lectura no se arriesga un cierre
    remates = r.datos;
  } catch {
    return out;
  }

  const deEstaCarrera = remates.filter(
    (m) =>
      claveHipodromo(String(m.hipodromo ?? "")) === clave &&
      Number(m.carrera) === carrera &&
      String(m.fecha ?? "").slice(0, 10) === dia
  );
  for (const m of deEstaCarrera) {
    const cerrado = String(m.estado ?? "").trim().toLowerCase() === "cerrado";
    if (cerrado) {
      out.omitidosCerrados += 1;
      continue;
    }
    try {
      const c = await cerrarRemateLiquidando(String(m.id));
      if (c.ok) out.reabiertosCerrados += 1;
      else out.errores.push(`Remate ${String(m.id)}: ${c.error ?? "no se pudo cerrar"}`);
    } catch (e) {
      out.errores.push(`Remate ${String(m.id)}: ${(e as Error).message}`);
    }
  }
  return out;
}

/**
 * ============================================================================
 * recalcularCarreraCompleta — REHACE TODA la carrera de forma idempotente
 * ============================================================================
 *
 * Motor maestro para cuando una carrera ya tiene resultado oficial y el
 * operador carga/edita/elimina una jugada REZAGADA (o corrige una existente)
 * en cualquier módulo (Taquilla/WPS/Puestos/Bloques, Tablas Fijas, Marcas,
 * Dupletas, Remates). Garantiza exactitud contable SIN duplicar cobros ni
 * premios, porque cada paso es idempotente por ESTADO:
 *
 *   1. REVERTIR  → los tickets universales ya decididos vuelven a 'Pendiente'
 *                  y se les devuelve el crédito (excluye MARCA/TABLA FIJA, que
 *                  tienen RPC propias). Sin esto, un ticket ya pagado se
 *                  pagaría dos veces.
 *   2. RE-LIQUIDAR universal → `aplicarLiquidacionSaldos` decide TODOS los
 *                  Pendientes (WPS, Puestos, Bloques, REMATE) con la pizarra
 *                  vigente: recomputa ganadores/perdedores, premios y comisión.
 *   3. JUGADAS ESPECIALES → `liquidarJugadasDeCarrera` corre las RPC
 *                  idempotentes de Tablas Fijas, Marcas y Dupletas (solo tocan
 *                  tickets Pendiente/Perdedor, así que reintentar es seguro).
 *   4. REMATES   → re-cobra/paga los remates de esta carrera que quedaron
 *                  'Abierto' tras agregar un ejemplar rezagado.
 *
 * El resultado es el mismo conjunto de jugadas liquidado contra el resultado
 * oficial, sin importar cuántas veces se corra ni en qué orden se cargaron.
 */
export async function recalcularCarreraCompleta(opts: {
  hipodromo: string;
  carrera: number | string;
  fecha?: string;
  tasaComision?: number | null;
  usuario?: string | null;
}): Promise<ResRecalcularCompleto> {
  const vacio: ResRecalcularCompleto = {
    ok: false,
    motivo: "",
    revertidos: 0,
    revertidoTotal: 0,
    reliquidados: 0,
    abonoTotal: 0,
    errores: [],
    puestos: [],
    jugadas: null,
    remates: { reabiertosCerrados: 0, omitidosCerrados: 0, errores: [] },
  };
  if (!supabase) return { ...vacio, motivo: "Sin conexión a Supabase", errores: ["Sin conexión a Supabase."] };
  const fecha = opts.fecha || hoyLocal();
  const carrera = Number(opts.carrera) || 0;
  const dia = String(fecha).slice(0, 10);

  // 0. Detección de resultado oficial: sin él no hay nada que recalcular.
  const oficial = await leerResultadoOficial(opts.hipodromo, opts.carrera, fecha);
  const pizarra = pizarraDePuestos(oficial?.puestos ?? []);
  if (!pizarra) {
    return { ...vacio, motivo: "La carrera no tiene resultado oficial cargado: no se puede re-liquidar." };
  }
  const puestos = (oficial?.puestos ?? []).map((p) => String(p));

  // 1. REVERTIR la liquidación universal previa (devuelve el crédito).
  const rev = await revertirLiquidacionCarrera(opts);

  // 2. RE-LIQUIDAR el motor universal (WPS/Puestos/Bloques/REMATE).
  const re = await reliquidar(opts);

  // 3. JUGADAS ESPECIALES (tablas fijas + marcas + dupletas), RPCs idempotentes.
  let jugadas: ResumenJugadas;
  try {
    jugadas = await liquidarJugadasDeCarrera({
      hipodromo: opts.hipodromo,
      carrera,
      fecha: dia,
      pizarra,
      usuario: opts.usuario ?? null,
    });
  } catch (e) {
    jugadas = { ...VACIO_JUGADAS };
    jugadas.marcas = { ok: false, error: (e as Error).message };
  }

  // 4. REMATES abiertos de esta carrera → cerrar contra el resultado.
  const remates = await reCerrarRematesDeCarrera(opts.hipodromo, carrera, dia);

  const errores = [...rev.errores, ...re.errores, ...remates.errores];
  if (jugadas.tablasFijas && !jugadas.tablasFijas.ok && jugadas.tablasFijas.error) errores.push(`Tablas fijas: ${jugadas.tablasFijas.error}`);
  if (jugadas.marcas && !jugadas.marcas.ok && jugadas.marcas.error) errores.push(`Marcas: ${jugadas.marcas.error}`);
  if (jugadas.dupletas && !jugadas.dupletas.ok && jugadas.dupletas.error) errores.push(`Dupletas: ${jugadas.dupletas.error}`);

  return {
    ok: rev.ok && re.ok,
    motivo:
      `Carrera ${String(carrera)} de ${String(opts.hipodromo).toUpperCase()} (${dia}) re-liquidada contra el resultado. ` +
      `Revertidos ${rev.revertidos} · re-liquidados ${re.reliquidados} · ` +
      `tablas ${jugadas.tablasFijas?.tablas ?? 0} · marcas ok=${jugadas.marcas?.ok ? "sí" : "no"} · ` +
      `dupletas ${jugadas.dupletas?.liquidadas ?? 0} · remates cerrados ${remates.reabiertosCerrados}.`,
    revertidos: rev.revertidos,
    revertidoTotal: rev.revertidoTotal,
    reliquidados: re.reliquidados,
    abonoTotal: re.abonoTotal,
    errores,
    puestos,
    jugadas,
    remates,
  };
}

/**
 * AUTO-TRIGGER post-mutación: si la carrera YA tiene resultado oficial,
 * re-liquidación automáticamente y devuelve el resumen. Si no lo tiene, no hace
 * nada (devuelve `rel liquidada:false`) — la liquidación normal la hará el
 * cierre de carrera.
 *
 * Se invoca en los handlers de guardar/editar/eliminar de cada módulo (Marcas,
 * Tablas Fijas, Dupletas, Remates, Taquilla) para que una jugada rezagada
 * cargada sobre una carrera LIQUIDADA cobre/pague al instante, sin que el
 * usuario tenga que ir a otra pantalla a presionar un botón.
 */
export async function autoReliquidarSiLiquidada(opts: {
  hipodromo: string;
  carrera: number | string;
  fecha?: string;
  tasaComision?: number | null;
  usuario?: string | null;
}): Promise<{ reliquidada: boolean; resumen: ResRecalcularCompleto | null }> {
  if (!supabase) return { reliquidada: false, resumen: null };
  const fecha = opts.fecha || hoyLocal();
  const oficial = await leerResultadoOficial(opts.hipodromo, opts.carrera, fecha);
  if (!oficial?.puestos?.length) return { reliquidada: false, resumen: null };
  const resumen = await recalcularCarreraCompleta(opts);
  return { reliquidada: true, resumen };
}


/**
 * Recalcula TODAS las carreras con resultado oficial de una jornada completa
 * (ej. "2026-10-25") usando el motor SSOT de `puestos.ts` y sincroniza los
 * saldos reales de los clientes en `contabilidad-central.ts`.
 */
export async function recalcularJornadaCompleta(
  fecha = "2026-10-25",
  opts?: { tasaComision?: number | null; usuario?: string | null }
): Promise<{
  ok: boolean;
  fecha: string;
  carrerasRecalculadas: number;
  resultados: Array<{ hipodromo: string; carrera: number; resumen: ResRecalcularCompleto }>;
  errores: string[];
}> {
  const dia = String(fecha || hoyLocal()).slice(0, 10);
  if (!supabase) {
    return {
      ok: false,
      fecha: dia,
      carrerasRecalculadas: 0,
      resultados: [],
      errores: ["Sin conexión a Supabase."],
    };
  }
  const errores: string[] = [];
  const resultados: Array<{ hipodromo: string; carrera: number; resumen: ResRecalcularCompleto }> = [];
  try {
    const { data, error } = await supabase
      .from("resultados_carreras")
      .select("hipodromo, carrera")
      .eq("fecha", dia)
      .order("hipodromo", { ascending: true })
      .order("carrera", { ascending: true });
    if (error) {
      return {
        ok: false,
        fecha: dia,
        carrerasRecalculadas: 0,
        resultados: [],
        errores: [error.message],
      };
    }
    const vistos = new Set<string>();
    for (const r of (data ?? []) as Array<{ hipodromo?: unknown; carrera?: unknown }>) {
      const hip = String(r.hipodromo ?? "").trim().toUpperCase();
      const car = Number(r.carrera) || 0;
      if (!hip || car <= 0) continue;
      const k = `${hip}::${car}`;
      if (vistos.has(k)) continue;
      vistos.add(k);
      const resumen = await recalcularCarreraCompleta({
        hipodromo: hip,
        carrera: car,
        fecha: dia,
        tasaComision: opts?.tasaComision ?? null,
        usuario: opts?.usuario ?? null,
      });
      resultados.push({ hipodromo: hip, carrera: car, resumen });
      if (resumen.errores.length) errores.push(...resumen.errores);
    }
    await sincronizarSaldosRealesClientes([]);
    return {
      ok: errores.length === 0,
      fecha: dia,
      carrerasRecalculadas: resultados.length,
      resultados,
      errores,
    };
  } catch (e) {
    return {
      ok: false,
      fecha: dia,
      carrerasRecalculadas: resultados.length,
      resultados,
      errores: [(e as Error).message],
    };
  }
}
