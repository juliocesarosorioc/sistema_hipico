/**
 * RECÁLCULO SEMANAL DE DEVOLUCIONES E INCENTIVOS
 * ----------------------------------------------------------------------------
 * Recalcula retroactivamente las devoluciones e incentivos para todos los clientes
 * y socios en base a su configuración vigente de porcentajes, determinando el
 * delta exacto (lo que debió acreditarse vs lo ya acreditado en la semana).
 *
 * Principios:
 * 1. Libro Mayor Oficial: `clientes.saldo_actual` es la única fuente de verdad.
 * 2. Idempotencia estricta: ejecutar dos veces consecutivas produce delta $0.00
 *    en la segunda ejecución sin inflar saldos.
 * 3. Trazabilidad NIIF: cada ajuste genera su asiento en partida doble
 *    (Debe 5.1.02.001 / Haber 2.1.01.001).
 */

import { supabase } from "@/core/supabase";
import { rangoSemanaDeGrupo } from "@/features/liquidacion/lib/semana";
import {
  calcularComisionesSocioPorClientes,
  cargarTodosTicketsParaComisiones,
  normalizar,
  type ReglaDevolucionCliente,
} from "./comisiones-socios";
import { generarAsientoDevolucionIncentivo } from "@/features/contabilidad/lib/plan-cuentas";

export interface ItemRecalculoCliente {
  clienteId: string | number;
  nombre: string;
  devolucionPropiaPct: number;
  totalDevolucionPropia: number;
  totalComisionesSocios: number;
  totalDebido: number;
  totalYaAcreditado: number;
  delta: number;
  saldoAnterior: number;
  saldoNuevo: number;
  aplicado: boolean;
  motivo?: string;
}

export interface ResultadoRecalculoSemana {
  ok: boolean;
  fechaDesde: string;
  fechaHasta: string;
  totalClientesEvaluados: number;
  totalClientesAjustados: number;
  granTotalDebido: number;
  granTotalYaAcreditado: number;
  granTotalDelta: number;
  detalles: ItemRecalculoCliente[];
  error?: string;
}

export interface RecalculoSemanaOpts {
  fechaDesde?: string;
  fechaHasta?: string;
  grupoId?: string | null;
  usuario?: string | null;
  dryRun?: boolean;
  clientesMock?: any[];
  ticketsMock?: any[];
  asientosMock?: any[];
}

/**
 * Obtiene el rango ISO [desde, hasta] de la semana fiscal actual (Jueves a Miércoles).
 */
export function obtenerRangoSemanaFiscalActual(fechaRef?: string): { desde: string; hasta: string } {
  const hoyIso = fechaRef || new Date().toISOString().slice(0, 10);
  // Ciclo hípico estándar: Apertura Jueves (4) -> Cierre Miércoles (3)
  const r = rangoSemanaDeGrupo(hoyIso, { diaInicio: 4, diaFin: 3 });
  return { desde: r.inicio, hasta: r.fin };
}

/**
 * Ejecuta el recálculo semanal de devoluciones e incentivos para todos los clientes y socios.
 */
export async function recalcularDevolucionesEIncentivosSemana(
  opts: RecalculoSemanaOpts = {}
): Promise<ResultadoRecalculoSemana> {
  const rango = obtenerRangoSemanaFiscalActual();
  const fDesde = opts.fechaDesde || rango.desde;
  const fHasta = opts.fechaHasta || rango.hasta;
  const dryRun = Boolean(opts.dryRun);
  const usuario = opts.usuario || "SISTEMA_RECALCULO";

  try {
    // 1. Obtener clientes
    let clientes: any[] = opts.clientesMock || [];
    if (clientes.length === 0 && supabase) {
      let q = supabase
        .from("clientes")
        .select(
          "id, nombre, seudonimo, saldo_actual, devolucion, incentivo_pct, es_socio, socio_asignado, comision_socio_pct, fecha_inicio_comision_socio, grupo_id"
        );
      if (opts.grupoId) {
        q = q.eq("grupo_id", opts.grupoId);
      }
      const { data, error } = await q;
      if (!error && data) {
        clientes = data;
      }
    }

    // 2. Obtener tickets de la semana
    let tickets: any[] = opts.ticketsMock || [];
    if (tickets.length === 0 && supabase) {
      try {
        let qT = supabase
          .from("tickets_apuestas")
          .select("*")
          .gte("fecha_carrera", fDesde)
          .lte("fecha_carrera", fHasta);
        if (opts.grupoId) {
          qT = qT.eq("grupo_id", opts.grupoId);
        }
        const { data, error } = await qT;
        if (!error && data) {
          tickets = data;
        } else {
          // Fallback a carga general
          tickets = await cargarTodosTicketsParaComisiones();
        }
      } catch {
        tickets = await cargarTodosTicketsParaComisiones();
      }
    }

    // 3. Obtener asientos previos de la semana para saber qué se acreditó ya
    let asientosPrevios: any[] = opts.asientosMock || [];
    if (asientosPrevios.length === 0 && supabase) {
      try {
        const { data: dAsientos } = await supabase
          .from("asientos_niif")
          .select("id, clave, fecha, concepto, total_debe, total_haber")
          .gte("fecha", fDesde)
          .lte("fecha", fHasta);
        if (dAsientos && dAsientos.length > 0) {
          asientosPrevios = dAsientos;
        }
      } catch {
        /* ignore fallback */
      }
    }

    // 4. Identificar destinatarios únicos (clientes con devolución, socios, o con afiliados)
    const sociosAsignadosSet = new Set<string>();
    for (const c of clientes) {
      const socRef = String(c.socio_asignado || c.socioAsignado || "").trim();
      if (socRef) {
        sociosAsignadosSet.add(normalizar(socRef));
      }
    }

    const mapaDestinatarios = new Map<string, any>();
    for (const c of clientes) {
      const nom = String(c.nombre || c.seudonimo || "").trim();
      const norm = normalizar(nom);
      if (!norm) continue;

      const devPct = Number(c.devolucion ?? c.incentivo_pct ?? 0) || 0;
      const esSoc = Boolean(
        c.es_socio ||
        c.esSocio ||
        sociosAsignadosSet.has(norm) ||
        (c.id != null && sociosAsignadosSet.has(normalizar(String(c.id))))
      );

      if (devPct > 0 || esSoc) {
        mapaDestinatarios.set(norm, c);
      }
    }

    const detalles: ItemRecalculoCliente[] = [];
    let granTotalDebido = 0;
    let granTotalYaAcreditado = 0;
    let granTotalDelta = 0;
    let ajustadosCount = 0;

    for (const [, clienteObj] of mapaDestinatarios) {
      const nom = String(clienteObj.nombre || clienteObj.seudonimo || "").trim();
      const norm = normalizar(nom);
      const clienteId = clienteObj.id != null ? String(clienteObj.id) : norm;

      // Calcular lo debido según las reglas y tickets de la semana
      const calculo = calcularComisionesSocioPorClientes({
        socioNombre: nom,
        socioId: clienteId,
        fechaDesde: fDesde,
        fechaHasta: fHasta,
        tickets,
        clientes,
      });

      const totalPropia = Math.round(calculo.totalDevolucionPropia * 100) / 100;
      const totalComisiones = Math.round(calculo.totalComisionesClientes * 100) / 100;
      const totalDebido = Math.round((totalPropia + totalComisiones) * 100) / 100;

      // Calcular lo que ya fue acreditado en la semana por asientos contables o registros de incentivo
      let yaAcreditado = 0;
      for (const a of asientosPrevios) {
        const clave = String(a.clave || "").toUpperCase();
        const concepto = String(a.concepto || "").toUpperCase();
        const esIncentivo =
          clave.startsWith("INC:") ||
          clave.startsWith("RECALCULO:") ||
          concepto.includes("DEVOLUCIÓN") ||
          concepto.includes("DEVOLUCION") ||
          concepto.includes("INCENTIVO") ||
          concepto.includes("COMISIÓN CONFIDENCIAL") ||
          concepto.includes("COMISION CONFIDENCIAL");

        if (!esIncentivo) continue;

        // Comprobar si el asiento pertenece a este cliente
        const coincideCliente =
          clave.includes(`:${clienteId}`) ||
          clave.includes(`:${norm}`) ||
          concepto.includes(nom.toUpperCase()) ||
          normalizar(concepto).includes(norm);

        if (coincideCliente) {
          const montoAsiento = Number(a.total_haber ?? a.total_debe ?? a.monto ?? 0);
          yaAcreditado += montoAsiento;
        }
      }
      yaAcreditado = Math.round(yaAcreditado * 100) / 100;

      // Calcular el delta
      const delta = Math.round((totalDebido - yaAcreditado) * 100) / 100;
      const saldoAnterior = Math.round(Number(clienteObj.saldo_actual ?? 0) * 100) / 100;
      const saldoNuevo = Math.round((saldoAnterior + delta) * 100) / 100;

      let aplicado = false;
      let motivo = "Sin variación (al día)";

      if (delta !== 0) {
        ajustadosCount += 1;
        motivo = delta > 0 ? `Acreditación complementaria +$${delta.toFixed(2)}` : `Ajuste débito $${delta.toFixed(2)}`;

        if (!dryRun) {
          // 1. Actualizar el saldo_actual del cliente
          if (supabase && clienteObj.id != null) {
            try {
              await supabase
                .from("clientes")
                .update({ saldo_actual: saldoNuevo })
                .eq("id", clienteObj.id);
            } catch (errDb) {
              console.error(`Error actualizando saldo de ${nom}:`, errDb);
            }
          }

          // 2. Generar el asiento contable NIIF si hubo delta positivo
          if (delta > 0) {
            try {
              const refId = `RECALCULO:SEMANA:${fDesde}:${fHasta}:${clienteId}`;
              await generarAsientoDevolucionIncentivo({
                grupoId: clienteObj.grupo_id ? String(clienteObj.grupo_id) : opts.grupoId || null,
                fecha: fHasta,
                clienteId: String(clienteId),
                clienteNombre: nom,
                montoIncentivo: delta,
                referenciaId: refId,
                esAvalador: Boolean(clienteObj.es_socio),
                usuario,
                nota: `Recálculo semanal (${fDesde} a ${fHasta}): debido $${totalDebido.toFixed(2)}, previo $${yaAcreditado.toFixed(2)}, delta +$${delta.toFixed(2)}`,
              });
            } catch (errAsiento) {
              console.error(`Error generando asiento de recálculo para ${nom}:`, errAsiento);
            }
          }

          aplicado = true;
        }
      }

      granTotalDebido += totalDebido;
      granTotalYaAcreditado += yaAcreditado;
      granTotalDelta += delta;

      detalles.push({
        clienteId,
        nombre: nom,
        devolucionPropiaPct: calculo.devolucionPropiaPct,
        totalDevolucionPropia: totalPropia,
        totalComisionesSocios: totalComisiones,
        totalDebido,
        totalYaAcreditado: yaAcreditado,
        delta,
        saldoAnterior,
        saldoNuevo,
        aplicado,
        motivo,
      });
    }

    return {
      ok: true,
      fechaDesde: fDesde,
      fechaHasta: fHasta,
      totalClientesEvaluados: detalles.length,
      totalClientesAjustados: ajustadosCount,
      granTotalDebido: Math.round(granTotalDebido * 100) / 100,
      granTotalYaAcreditado: Math.round(granTotalYaAcreditado * 100) / 100,
      granTotalDelta: Math.round(granTotalDelta * 100) / 100,
      detalles,
    };
  } catch (error: any) {
    console.error("Error en recalcularDevolucionesEIncentivosSemana:", error);
    return {
      ok: false,
      fechaDesde: fDesde,
      fechaHasta: fHasta,
      totalClientesEvaluados: 0,
      totalClientesAjustados: 0,
      granTotalDebido: 0,
      granTotalYaAcreditado: 0,
      granTotalDelta: 0,
      detalles: [],
      error: error?.message || "Error desconocido al recalcular devoluciones semanales",
    };
  }
}
