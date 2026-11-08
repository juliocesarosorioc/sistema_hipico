import { supabase } from "@/core/supabase";
import { redondearCentavos, sumarDinero, restarDinero } from "@/shared/lib/dinero";
import { normalizarNombreCliente } from "@/features/taquilla/lib/cruces-y-tapas";
import { emitirToast } from "@/shared/lib/mensajeria";

export interface ResumenAjusteCliente {
  id: string | number;
  nombre: string;
  saldoAnterior: number;
  saldoNuevo: number;
  diferencia: number;
  pctDevolucion: number;
  totalDevolucion: number;
}

export interface ResultadoRecalculoOficial {
  ok: boolean;
  totalClientes: number;
  totalAjustados: number;
  detalles: ResumenAjusteCliente[];
  error?: string;
}

/**
 * RECALCULAR Y ACTUALIZAR SALDOS OFICIALES EN SUPABASE
 * Regla de negocio estricta:
 * 1. Base de devolución / incentivo: sobre el MONTO DECIDIDO neto de la carrera SIN comisión.
 *    - Si perdió 50 -> base = 50.
 *    - Si ganó 50 -> base = 50.
 *    - Si hubo cruce (ganó 50 y perdió 20) -> base = |50 - 20| = 30.
 *    - La devolución SIEMPRE suma (+) a favor del cliente.
 * 2. Comisión de la casa: SOLO sobre la diferencia neta positiva si termina a favor.
 * 3. Actualiza inmediatamente `clientes.saldo_actual` en la base de datos de Supabase.
 */
export async function recalcularYActualizarSaldosOficiales(
  grupoId?: string | null
): Promise<ResultadoRecalculoOficial> {
  if (!supabase) {
    return { ok: false, totalClientes: 0, totalAjustados: 0, detalles: [], error: "Sin conexión a Supabase" };
  }

  try {
    // 1. Cargar clientes
    let qCli = supabase
      .from("clientes")
      .select("id, nombre, seudonimo, saldo_actual, devolucion, incentivo_pct, grupo_id");
    if (grupoId) {
      qCli = qCli.eq("grupo_id", grupoId);
    }
    const { data: dbClientes, error: eCli } = await qCli;
    if (eCli) throw eCli;

    const clientes = (dbClientes ?? []).filter((c) => {
      const nom = String(c.nombre ?? "").toUpperCase();
      return !["MARCAS", "TF", "REMATES", "DUPLETA", "POLLAS"].includes(nom);
    });

    if (clientes.length === 0) {
      return { ok: true, totalClientes: 0, totalAjustados: 0, detalles: [] };
    }

    // 2. Cargar comisiones por grupo
    const { data: dbGrupos } = await supabase
      .from("grupos_venta")
      .select("id, comision_default");
    const comisionesGrupo = new Map<string, number>();
    for (const g of (dbGrupos ?? []) as Array<{ id?: unknown; comision_default?: unknown }>) {
      if (g.id != null) {
        comisionesGrupo.set(String(g.id), Number(g.comision_default) || 5);
      }
    }

    // 3. Cargar depósitos / retiros si existe la tabla
    const depositosPorCliente = new Map<string, number>();
    try {
      const { data: dbDepositos } = await supabase
        .from("depositos")
        .select("cliente_id, cliente_nombre, tipo_operacion, monto");
      for (const d of (dbDepositos ?? []) as Array<{ cliente_id?: unknown; cliente_nombre?: unknown; tipo_operacion?: unknown; monto?: unknown }>) {
        const cid = d.cliente_id ? String(d.cliente_id) : "";
        const cnom = d.cliente_nombre ? normalizarNombreCliente(d.cliente_nombre) : "";
        const tipo = String(d.tipo_operacion ?? "").toLowerCase();
        const esRetiro = tipo.includes("retiro") || tipo.includes("disminuci");
        const monto = Number(d.monto) || 0;
        const valor = esRetiro ? -Math.abs(monto) : Math.abs(monto);
        if (cid) {
          depositosPorCliente.set(cid, sumarDinero(depositosPorCliente.get(cid) ?? 0, valor));
        }
        if (cnom) {
          depositosPorCliente.set(`nom:${cnom}`, sumarDinero(depositosPorCliente.get(`nom:${cnom}`) ?? 0, valor));
        }
      }
    } catch {
      /* ignore if depositos table does not exist */
    }

    // 4. Cargar tickets de apuestas decididos
    const { data: dbTickets, error: eT } = await supabase
      .from("tickets_apuestas")
      .select("id, cliente_juega_id, cliente_juega_nombre, cliente_consigue_id, cliente_consigue_nombre, banquero_nombre, hipodromo, carrera, fecha_carrera, fecha_registro, nombre_jugada, monto_jugado, premio_pagar, monto_decidido, comision_pagada, estado, anulada")
      .or("anulada.is.null,anulada.eq.false")
      .limit(10000);

    if (eT) throw eT;

    const ticketsValidos = (dbTickets ?? []).filter((t) => {
      if (t.anulada === true) return false;
      const st = String(t.estado ?? "").trim().toUpperCase();
      return ["GANADOR", "GANO", "PERDEDOR", "PERDIO", "SOLUCIONADO"].includes(st);
    });

    const detalles: ResumenAjusteCliente[] = [];
    let ajustados = 0;

    // 5. Procesar cliente por cliente
    for (const cli of clientes) {
      const cid = String(cli.id);
      const cnomNorm = normalizarNombreCliente(cli.nombre ?? "");
      const cseuNorm = normalizarNombreCliente(cli.seudonimo ?? "");
      const saldoAnterior = redondearCentavos(Number(cli.saldo_actual) || 0);

      const devPct = Math.max(
        0,
        Number(cli.devolucion ?? cli.incentivo_pct ?? 0) || 0
      );
      const comPct = comisionesGrupo.get(String(cli.grupo_id ?? "")) ?? 5;

      // Filtrar tickets del cliente
      const ticketsCliente = ticketsValidos.filter((t) => {
        const jId = String(t.cliente_juega_id ?? "").trim();
        const cId = String(t.cliente_consigue_id ?? "").trim();
        const jNom = normalizarNombreCliente(t.cliente_juega_nombre ?? "");
        const cNom = normalizarNombreCliente(t.cliente_consigue_nombre ?? t.banquero_nombre ?? "");

        const coincideJuega = (cid && jId === cid) || (cnomNorm && jNom === cnomNorm) || (cseuNorm && jNom === cseuNorm);
        const coincideConsigue = (cid && cId === cid) || (cnomNorm && cNom === cnomNorm) || (cseuNorm && cNom === cseuNorm);
        return coincideJuega || coincideConsigue;
      });

      // Agrupar por carrera
      const carrerasMap = new Map<string, typeof ticketsCliente>();
      for (const t of ticketsCliente) {
        const f = String(t.fecha_carrera || t.fecha_registro || "").slice(0, 10) || "fecha";
        const h = String(t.hipodromo ?? "").trim().toUpperCase();
        const c = String(t.carrera ?? 0);
        const k = `${f}|${h}|${c}`;
        const prev = carrerasMap.get(k) ?? [];
        prev.push(t);
        carrerasMap.set(k, prev);
      }

      let netoTotalJugadas = 0;
      let totalDevoluciones = 0;

      for (const listT of carrerasMap.values()) {
        let ganadoBruto = 0;
        let perdidoBruto = 0;
        let esPuestos = false;

        for (const t of listT) {
          const m = Number(t.monto_jugado) || 0;
          const prem = Number(t.premio_pagar) || 0;
          const mDec = Number((t as any).monto_decidido) || 0;
          const comPag = Number((t as any).comision_pagada) || 0;
          const st = String(t.estado ?? "").trim().toUpperCase();
          const esG = ["GANADOR", "GANO", "SOLUCIONADO"].includes(st);

          const jId = String(t.cliente_juega_id ?? "").trim();
          const jNom = normalizarNombreCliente(t.cliente_juega_nombre ?? "");
          const esJuega = (cid && jId === cid) || (cnomNorm && jNom === cnomNorm) || (cseuNorm && jNom === cseuNorm);

          const nj = String(t.nombre_jugada ?? "").toUpperCase();
          if (!nj.includes("TABLA") && !nj.includes("MARCA") && !nj.includes("DUPLETA") && !nj.includes("POLLA") && !nj.includes("REMATE")) {
            esPuestos = true;
          }

          // Ganancia bruta SIN comisión:
          // Si mDec > 0 -> mDec
          // Si prem > m -> (prem - m) + comPag (por si prem se guardó neteado de comisión en carreras viejas)
          // Else -> m
          const gananciaBruta = prem > m
            ? (prem - m) + comPag
            : mDec > m
              ? (mDec - m)
              : mDec > 0
                ? mDec
                : m;
          const perdidaBruta = prem > 0 && prem < m ? m - prem : mDec > 0 && mDec <= m ? mDec : m;

          if (esJuega) {
            if (esG) {
              ganadoBruto = sumarDinero(ganadoBruto, gananciaBruta);
            } else {
              perdidoBruto = sumarDinero(perdidoBruto, perdidaBruta);
            }
          } else {
            // Consigue
            if (esG) {
              perdidoBruto = sumarDinero(perdidoBruto, gananciaBruta);
            } else {
              ganadoBruto = sumarDinero(ganadoBruto, perdidaBruta);
            }
          }
        }

        // Regla oficial de cruce por carrera:
        // Monto decidido = |ganadoBruto - perdidoBruto| sin comisión
        const difBruta = restarDinero(ganadoBruto, perdidoBruto);
        const montoDecidido = Math.abs(difBruta);

        let comisionCasa = 0;
        let netoCarrera = 0;

        if (difBruta > 0) {
          comisionCasa = redondearCentavos(difBruta * (comPct / 100));
          netoCarrera = restarDinero(difBruta, comisionCasa);
        } else {
          netoCarrera = difBruta;
        }

        let devCarrera = 0;
        if (esPuestos && devPct > 0 && montoDecidido > 0) {
          devCarrera = redondearCentavos(montoDecidido * (devPct / 100));
        }

        netoTotalJugadas = sumarDinero(netoTotalJugadas, netoCarrera);
        totalDevoluciones = sumarDinero(totalDevoluciones, devCarrera);
      }

      const depositos = depositosPorCliente.get(cid) ?? depositosPorCliente.get(`nom:${cnomNorm}`) ?? 0;
      let nuevoSaldo = saldoAnterior;

      if (ticketsCliente.length > 0 || depositos !== 0) {
        nuevoSaldo = redondearCentavos(depositos + netoTotalJugadas + totalDevoluciones);
      }

      const diferencia = restarDinero(nuevoSaldo, saldoAnterior);

      if (Math.abs(diferencia) >= 0.01) {
        ajustados++;
        await supabase
          .from("clientes")
          .update({ saldo_actual: nuevoSaldo })
          .eq("id", cli.id);
      }

      detalles.push({
        id: cli.id,
        nombre: cli.nombre || cli.seudonimo || "Cliente",
        saldoAnterior,
        saldoNuevo: nuevoSaldo,
        diferencia,
        pctDevolucion: devPct,
        totalDevolucion: totalDevoluciones,
      });
    }

    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("hipico:saldos-actualizados"));
    }

    return {
      ok: true,
      totalClientes: clientes.length,
      totalAjustados: ajustados,
      detalles,
    };
  } catch (err: any) {
    return {
      ok: false,
      totalClientes: 0,
      totalAjustados: 0,
      detalles: [],
      error: err?.message || String(err),
    };
  }
}
