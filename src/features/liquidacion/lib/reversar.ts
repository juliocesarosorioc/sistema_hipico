/**
 * ============================================================================
 * REVERSAR LA LIQUIDACIÓN DE UNA CARRERA (Bloque 1)
 * ============================================================================
 *
 * Revierte por completo la liquidación de una carrera para dejarla ABIERTA de
 * nuevo (sin resultado oficial), devolviendo a los clientes TODO el dinero que
 * se les había acreditado y volviendo cada ticket decidido a 'Pendiente'. Es la
 * inversa exacta de liquidar: después de reversar se puede volver a cargar el
 * resultado y liquidar de cero.
 *
 * QUÉ REVIERTE (cada modalidad con su fórmula de pago, no una genérica):
 *   1. UNIVERSAL (WPS/Puestos/Bloques/ninis) → `revertirLiquidacionCarrera`, que
 *      re-decide con la MISMA fórmula del motor (`decidirTickets`) y descuenta
 *      el crédito exacto.
 *   2. TABLA FIJA / MARCA / DUPLETA → su RPC acredita el premio en
 *      `monto_decidido` (Ganador) o reintegra `monto_jugado` (Retirado); acá se
 *      descuenta ese mismo monto y el ticket vuelve a 'Pendiente'.
 *   3. REMATES → se reabren los remates cerrados de la carrera (`club_reabrir_remate`).
 *   4. POLLAS → las pollas líquidadas del día vuelven a 'Cerrada' (best-effort).
 *   5. RESULTADO CENTRAL → se borra el resultado oficial (`aplicado_a_tablas=false`),
 *      con lo que la carrera vuelve a "Programada"/ABIERTA.
 *
 * Orden importante: las modalidades ESPECIALES se revierten ANTES de
 * `revertirLiquidacionCarrera`, porque ese paso también relee los tickets por
 * estado y, al dejarlos ya en 'Pendiente', quedan fuera de su barrido.
 *
 * El paso de reversión de las especiales es lógica pura (ver `reversar-nucleo.ts`),
 * testeable en node.
 */
import { supabase } from "@/core/supabase";
import { hoyLocal } from "@/features/gaceta/lib/programa";
import { filtroDiaJornada } from "@/features/liquidacion/lib/fecha";
import { revertirLiquidacionCarrera } from "@/features/liquidacion/lib/recalcular";
import { revertirResultadoCentral } from "@/features/carreras/lib/carreras-dia";
import { claveHipodromo } from "@/features/carreras/lib/claves";
import { exigirPermiso, tieneCapacidad } from "@/features/seguridad/lib/vigente";
import { registrarAuditoria } from "@/features/grupos/lib/grupos";
import { reabrirRemate } from "@/features/remates/lib/remates";
import { listarRemates } from "@/features/remates/lib/remates";
import { listarPollas, cambiarEstadoPolla } from "@/features/pollas/lib/pollas";
import { modalidadDeTicket, planearReversion, resumirReversion } from "@/features/liquidacion/lib/reversar-nucleo";
import { useTablasFijasStore } from "@/shared/store/useTablasFijasStore";
import { useCarrerasDiaStore } from "@/shared/store/useCarrerasDiaStore";

const NUM = (v: unknown): number => {
  const n = parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
};

export type ResReversar = {
  ok: boolean;
  motivo: string;
  /** Tickets (universales + especiales) devueltos a 'Pendiente'. */
  tickets: number;
  /** Dinero total devuelto a los clientes. */
  revertido: number;
  /** Desglose por modalidad especial revertida. */
  tablasFijas: number;
  marcas: number;
  dupletas: number;
  /** Remates reabiertos y pollas regresadas a 'Cerrada'. */
  remates: number;
  pollas: number;
  /** ¿Se pudo borrar el resultado central (carrera ABIERTA)? */
  resultadoCentral: boolean;
  errores: string[];
};

export type ReversarInput = {
  /** Nombre del hipódromo (como se usa en el resto del sistema). */
  hipodromo: string;
  /** Número de carrera. */
  carrera: number | string;
  fecha?: string;
  usuario?: string | null;
  tasaComision?: number | null;
  /** Del contrato del prompt; opcionales (no hacen falta para la reversión). */
  grupoId?: string | null;
  hipodromoId?: string | null;
  carreraId?: string | number | null;
};

/**
 * Devuelve a 'Pendiente' los tickets de modalidades ESPECIALES de la carrera
 * (Tabla Fija / Marca / Dupleta) que ya fueron decididos y le quita al cliente
 * el crédito acreditado. Devuelve el conteo por modalidad.
 */
async function revertirEspecialesDeCarrera(opts: {
  hipodromo: string;
  carrera: number;
  dia: string;
}): Promise<{ tablas: number; marcas: number; dupletas: number; revertido: number; tickets: number; errores: string[] }> {
  const out = { tablas: 0, marcas: 0, dupletas: 0, revertido: 0, tickets: 0, errores: [] as string[] };
  if (!supabase) return out;
  const sdb = supabase;

  let filas: Array<Record<string, unknown>> = [];
  try {
    const { data, error } = await sdb
      .from("tickets_apuestas")
      .select("*")
      .or(filtroDiaJornada(opts.dia))
      .eq("hipodromo", opts.hipodromo.trim().toUpperCase())
      .eq("carrera", opts.carrera)
      .in("estado", ["Ganador", "Perdedor", "Retirado"])
      .limit(2000);
    if (error) throw error;
    filas = (data ?? []) as Array<Record<string, unknown>>;
  } catch (e) {
    out.errores.push(`No se pudieron leer los tickets de las especiales: ${(e as Error).message}`);
    return out;
  }

  const plan = planearReversion(filas);
  if (!plan.length) return out;
  const resumen = resumirReversion(plan);
  out.tablas = resumen.porModalidad.TABLA.tickets;
  out.marcas = resumen.porModalidad.MARCA.tickets;
  out.dupletas = resumen.porModalidad.DUPLETA.tickets;

  const updates: Promise<unknown>[] = [];
  let deltaReversionMarcas = 0;

  for (const f of filas) {
    if (modalidadDeTicket(f) === "MARCA") {
      const est = String(f.estado ?? "").trim().toUpperCase();
      const monto = NUM(f.monto_jugado);
      const tasa = f.comision_porcentaje != null && String(f.comision_porcentaje).trim() !== "" ? NUM(f.comision_porcentaje) : 5;
      if (est === "GANADOR") {
        const pagoMarca = Math.round(((monto * 5) / 6) * 100) / 100;
        const comGrupo = Math.round(pagoMarca * (tasa / 100) * 100) / 100;
        deltaReversionMarcas = Math.round((deltaReversionMarcas + (pagoMarca + comGrupo)) * 100) / 100;
      } else if (est === "PERDEDOR") {
        const comGrupo = Math.round(monto * (tasa / 100) * 100) / 100;
        const cobroNeto = Math.round((monto - comGrupo) * 100) / 100;
        deltaReversionMarcas = Math.round((deltaReversionMarcas - cobroNeto) * 100) / 100;
      }
    }
  }

  for (const op of plan) {
    const credito = op.credito;
    if (credito > 0 && op.clienteId != null) {
      updates.push(
        (async () => {
          const { data: c, error: eSel } = await sdb.from("clientes").select("saldo_actual").eq("id", op.clienteId as never).maybeSingle();
          if (eSel) {
            out.errores.push(`Saldo cliente ${String(op.clienteId)}: no se pudo leer (${eSel.message})`);
            return;
          }
          const actual = NUM(((c ?? {}) as Record<string, unknown>).saldo_actual);
          const { error: eUpd } = await sdb.from("clientes").update({ saldo_actual: actual - credito }).eq("id", op.clienteId as never);
          if (eUpd) out.errores.push(`Saldo cliente ${String(op.clienteId)}: no se pudo revertir (${eUpd.message})`);
        })()
      );
    }
    out.tickets += 1;
    out.revertido += credito;
    updates.push(
      Promise.all([
        sdb
          .from("tickets_apuestas")
          .update({ estado: "Pendiente", premio_pagar: 0, monto_decidido: 0, comision_pagada: 0 })
          .eq("id", op.id as never),
      ]).catch((e) => {
        out.errores.push(`Ticket ${String(op.id)}: ${(e as Error).message}`);
      })
    );
  }

  if (Math.abs(deltaReversionMarcas) >= 0.005) {
    updates.push(
      (async () => {
        try {
          const { data: cliM } = await sdb
            .from("clientes")
            .select("id, saldo_actual")
            .ilike("nombre", "MARCAS")
            .limit(1)
            .maybeSingle();
          if (cliM?.id != null) {
            const act = NUM((cliM as Record<string, unknown>).saldo_actual);
            await sdb
              .from("clientes")
              .update({ saldo_actual: Math.round((act + deltaReversionMarcas) * 100) / 100 })
              .eq("id", cliM.id as never);
          }
        } catch {
          /* best-effort */
        }
      })()
    );
  }

  await Promise.all(updates);
  return out;
}

/** Reabre los remates CERRADOS de la carrera (revierte el cobro del cierre). */
async function reabrirRematesDeCarrera(opts: {
  hipodromo: string;
  carrera: number;
  dia: string;
}): Promise<{ reabiertos: number; errores: string[] }> {
  const out = { reabiertos: 0, errores: [] as string[] };
  if (!supabase) return out;
  let remates: Array<Record<string, unknown>> = [];
  try {
    const r = await listarRemates();
    if (!r.ok || !r.datos) return out;
    remates = r.datos as unknown as Array<Record<string, unknown>>;
  } catch {
    return out;
  }
  const clave = claveHipodromo(opts.hipodromo);
  for (const m of remates) {
    if (claveHipodromo(String(m.hipodromo ?? "")) !== clave) continue;
    if (Number(m.carrera) !== opts.carrera) continue;
    if (String(m.fecha ?? "").slice(0, 10) !== opts.dia) continue;
    if (String(m.estado ?? "").trim().toLowerCase() !== "cerrado") continue;
    try {
      const r = await reabrirRemate(String(m.id));
      if (r.ok) out.reabiertos += 1;
      else out.errores.push(`Remate ${String(m.id)}: ${r.error ?? "no se pudo reabrir"}`);
    } catch (e) {
      out.errores.push(`Remate ${String(m.id)}: ${(e as Error).message}`);
    }
  }
  return out;
}

/** Regresa a 'Cerrada' las pollas LIQUIDADAS del día (best-effort). */
async function reabrirPollasDelDia(dia: string): Promise<{ reabiertas: number; errores: string[] }> {
  const out = { reabiertas: 0, errores: [] as string[] };
  if (!supabase) return out;
  if (!tieneCapacidad("pollas:fn_guardar_polla")) return out; // sin permiso: se omite
  try {
    const r = await listarPollas(dia);
    if (!r.ok || !r.datos) return out;
    for (const p of r.datos) {
      if (String(p.estado ?? "") !== "Liquidada") continue;
      const c = await cambiarEstadoPolla(String(p.id), "Cerrada");
      if (c.ok) out.reabiertas += 1;
      else out.errores.push(`Polla ${String(p.id)}: ${c.error ?? "no se pudo reabrir"}`);
    }
  } catch (e) {
    out.errores.push(`Pollas: ${(e as Error).message}`);
  }
  return out;
}

/**
 * REVIERTE la liquidación completa de una carrera. Ver el encabezado del
 * archivo. Exige la capacidad `gestion_jugadas:fn_reabrir_carrera`.
 */
export async function reversarLiquidacionCarrera(opts: ReversarInput): Promise<ResReversar> {
  const vacio: ResReversar = {
    ok: false,
    motivo: "",
    tickets: 0,
    revertido: 0,
    tablasFijas: 0,
    marcas: 0,
    dupletas: 0,
    remates: 0,
    pollas: 0,
    resultadoCentral: false,
    errores: [],
  };
  if (!supabase) return { ...vacio, motivo: "Sin conexión a Supabase", errores: ["Sin conexión a Supabase."] };

  const hipodromo = String(opts.hipodromo ?? "").trim();
  const carrera = Number(opts.carrera) || 0;
  const fecha = opts.fecha || hoyLocal();
  const dia = String(fecha).slice(0, 10);
  if (!hipodromo || !carrera) {
    return { ...vacio, motivo: "Falta el hipódromo o el número de carrera.", errores: ["Hipódromo/carrera inválidos."] };
  }

  try {
    exigirPermiso("gestion_jugadas:fn_reabrir_carrera", { hipodromo, monto: 0 });
  } catch (e) {
    return {
      ...vacio,
      ok: false,
      motivo: `Sin permiso para reversar la liquidación: ${(e as Error).message}`,
      errores: [(e as Error).message],
    };
  }

  const errores: string[] = [];

  // 1) Especiales (Tabla Fija / Marca / Dupleta) — antes que el barrido universal.
  const esp = await revertirEspecialesDeCarrera({ hipodromo, carrera, dia });
  errores.push(...esp.errores);

  // 2) Universal (WPS/Puestos/Bloques/ninis) — devuelve el crédito exacto.
  let universales = 0;
  let revertidoUniversal = 0;
  try {
    const rev = await revertirLiquidacionCarrera({ hipodromo, carrera, fecha, tasaComision: opts.tasaComision ?? null });
    universales = rev.revertidos;
    revertidoUniversal = rev.revertidoTotal;
    errores.push(...rev.errores);
    if (!rev.ok && !rev.revertidos) errores.push(`Universal: ${rev.motivo}`);
  } catch (e) {
    errores.push(`Universal: ${(e as Error).message}`);
  }

  // 3) Remates cerrados de la carrera → reabrir.
  const rem = await reabrirRematesDeCarrera({ hipodromo, carrera, dia });
  errores.push(...rem.errores);

  // 4) Pollas liquidadas del día → Cerrada.
  const pol = await reabrirPollasDelDia(dia);
  errores.push(...pol.errores);

  // 5) Resultado central → la carrera vuelve a "Programada" (ABIERTA).
  let resultadoCentral = false;
  try {
    const central = await revertirResultadoCentral({ fecha: dia, hipodromo, carrera });
    resultadoCentral = central.ok;
    if (!central.ok && central.error) errores.push(`Resultado central: ${central.error}`);
  } catch (e) {
    errores.push(`Resultado central: ${(e as Error).message}`);
  }

  // 5b) Reabrir Tablas Fijas en BD y sincronizar stores locales (useTablasFijasStore + useCarrerasDiaStore)
  // para que el Semáforo pase de Rojo (Liquidada) a Amarillo (Con jugadas) o Verde (Abierta) de inmediato.
  try {
    const { data: tablasRows } = await supabase
      .from("tablas_fijas")
      .select("id, hipodromo, carrera, fecha, fecha_creacion, estado")
      .eq("carrera", carrera)
      .or(`fecha.eq.${dia},fecha.is.null`)
      .limit(100);
    const clave = claveHipodromo(hipodromo);
    const idsReabrir = ((tablasRows ?? []) as Array<Record<string, unknown>>)
      .filter((t) => claveHipodromo(String(t.hipodromo ?? "")) === clave)
      .filter((t) => String(t.fecha ?? t.fecha_creacion ?? "").slice(0, 10) === dia)
      .filter((t) => String(t.estado ?? "").toLowerCase() === "cerrada")
      .map((t) => t.id);
    if (idsReabrir.length > 0) {
      await supabase.from("tablas_fijas").update({ estado: "Abierta" }).in("id", idsReabrir as never[]);
    }
  } catch {
    // best-effort
  }
  try {
    useTablasFijasStore.getState().marcarAbierta(hipodromo, carrera);
    const prevCarrera = useCarrerasDiaStore.getState().estadoDe(hipodromo, carrera, dia);
    if (prevCarrera) {
      useCarrerasDiaStore.getState().upsert({
        ...prevCarrera,
        fecha: dia,
        hipodromo,
        carrera,
        estado: "Programada",
        ganadores: [],
        aplicado_a_tablas: false,
        pago: null,
      });
    }
  } catch {
    // best-effort en entorno node/test
  }

  const tickets = universales + esp.tickets;
  const revertido = Math.round((revertidoUniversal + esp.revertido) * 100) / 100;
  const ok = errores.length === 0;

  // 6) Trazabilidad.
  void registrarAuditoria(
    "GESTION_JUGADAS",
    "REVERSAR_LIQUIDACION",
    `Reversión de liquidación de ${hipodromo.toUpperCase()} C${carrera} (${dia}) por ${opts.usuario || "usuario"}: ` +
      `${tickets} ticket(s) a Pendiente · $${revertido.toFixed(2)} devuelto · ` +
      `tablas ${esp.tablas} · marcas ${esp.marcas} · dupletas ${esp.dupletas} · ` +
      `remates ${rem.reabiertos} · pollas ${pol.reabiertas} · resultado central revertido ${resultadoCentral ? "sí" : "no"}.`
  );

  return {
    ok,
    motivo: ok
      ? `Liquidación de ${hipodromo.toUpperCase()} C${carrera} (${dia}) REVERTIDA: ${tickets} ticket(s) a Pendiente · $${revertido.toFixed(2)} devuelto · ` +
        `tablas ${esp.tablas} · marcas ${esp.marcas} · dupletas ${esp.dupletas} · remates ${rem.reabiertos} · pollas ${pol.reabiertas}. ` +
        `La carrera quedó ABIERTA.`
      : `Reversión parcial de ${hipodromo.toUpperCase()} C${carrera} (${dia}) con ${errores.length} error(es).`,
    tickets,
    revertido,
    tablasFijas: esp.tablas,
    marcas: esp.marcas,
    dupletas: esp.dupletas,
    remates: rem.reabiertos,
    pollas: pol.reabiertas,
    resultadoCentral,
    errores,
  };
}

/** Clasifica la modalidad de un ticket (re-export para la UI/tests). */
export { modalidadDeTicket };
