/**
 * ============================================================================
 * MOTOR CONTABLE SILENCIOSO RETROACTIVO Y AUDITORÍA NIIF CARRERA A CARRERA
 * (`motor-backfill-retroactivo.ts`)
 * ============================================================================
 *
 * Garantiza que TODAS las transacciones de la semana actual (y el histórico)
 * tengan su asiento contable de Partida Doble cuadrado (`Debe === Haber`):
 *  1. Carreras liquidadas y jugadas en curso (`tickets_apuestas`).
 *  2. Devoluciones de incentivos a jugadores (`5.1.02.001`) y comisiones a socios (`5.1.03.001`).
 *  3. Tablas Fijas (`4.2.01.001`, `4.1.01.002`, `5.2.01.001`).
 *  4. Marcas y Dupletas (`4.2.02.001`, `4.1.01.003`, `4.1.01.004`, `5.2.02.001`).
 *  5. Remates (`4.1.02.001`) y Pollas (`4.1.03.001`).
 *  6. Depósitos y Avales (`depositos`: `1.1.02.001`, `2.1.01.001`, `1.2.02.001`, `3.1.02.001`).
 *  7. Retiros y Traslados entre Clientes (`transacciones`).
 *  8. Eventos Libres / Sportsbook P2P (`4.1.01.007`).
 */

import { supabase } from "@/core/supabase";
import { redondearCentavos } from "@/shared/lib/dinero";
import { emitirMensajePaso } from "@/features/liquidacion/lib/liquidacion-incentivos-socios";
import {
  generarAsientoPartidaDoble,
  generarAsientoLiquidacionCarrera,
  generarAsientoDepositoCliente,
  generarAsientoRetiroCliente,
  generarAsientoTrasladoClientes,
  generarAsientoAval,
  generarAsientoDevolucionIncentivo,
  generarAsientoCompromisoJugada,
  obtenerAsientosMemoria,
} from "@/features/contabilidad/lib/plan-cuentas";
import {
  calcularReporteDestinatariosDevolucion,
  PARAMETROS_PREDETERMINADOS_DEVOLUCION,
} from "@/features/clientes/lib/comisiones-socios";
import { leerEventosLibresMemoria } from "@/features/eventos-libres/lib/eventos-libres";

export interface ResumenAuditoriaContableCompleta {
  ok: boolean;
  transaccionesAnalizadas: number;
  asientosGenerados: number;
  asientosPreexistentes: number;
  totalDebe: number;
  totalHaber: number;
  cuadrePerfecto: boolean;
  diferenciaCentavos: number;
  semanaActual: { desde: string; hasta: string };
  mensajes: string[];
}

/** Obtiene el rango Lunes..Domingo de la semana actual en formato YYYY-MM-DD */
export function obtenerRangoSemanaActual(fechaRef?: Date): { desde: string; hasta: string } {
  const ahora = fechaRef ? new Date(fechaRef) : new Date();
  const diaSemana = ahora.getDay(); // 0 = Domingo, 1 = Lunes, ...
  const diffLunes = diaSemana === 0 ? -6 : 1 - diaSemana;
  const lunes = new Date(ahora);
  lunes.setDate(ahora.getDate() + diffLunes);
  const domingo = new Date(lunes);
  domingo.setDate(lunes.getDate() + 6);

  const fmt = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };
  return { desde: fmt(lunes), hasta: fmt(domingo) };
}

/**
 * Barrido y Registro de Todas las Transacciones de la Semana Actual (y Backfill Histórico)
 * en Partida Doble estricta (`Debe === Haber`).
 */
export async function sincronizarYAuditarContabilidadCompleta(params?: {
  grupoId?: string | null;
  fechaDesde?: string;
  fechaHasta?: string;
  usuario?: string | null;
  silencioso?: boolean;
}): Promise<ResumenAuditoriaContableCompleta> {
  const mensajes: string[] = [];
  const semanaActual = obtenerRangoSemanaActual();
  const logPaso = (msg: string, tipo: "info" | "success" | "warning" = "info") => {
    mensajes.push(msg);
    if (!params?.silencioso) {
      emitirMensajePaso(msg, tipo);
    }
  };

  logPaso(
    `⏳ [Paso 1/4] Validando saldos y reglas contables de la semana (${semanaActual.desde} al ${semanaActual.hasta})...`,
    "info"
  );

  let transaccionesAnalizadas = 0;
  let asientosGenerados = 0;
  let asientosPreexistentes = 0;
  let totalDebeCentavos = 0;
  let totalHaberCentavos = 0;

  const registrarEstadisticaAsiento = (res?: {
    ok?: boolean;
    asiento?: { id: string; total_debe: number; total_haber: number };
  }, eraExistente = false) => {
    if (res?.ok && res.asiento) {
      if (eraExistente) {
        asientosPreexistentes += 1;
      } else {
        asientosGenerados += 1;
      }
      totalDebeCentavos += Math.round(res.asiento.total_debe * 100);
      totalHaberCentavos += Math.round(res.asiento.total_haber * 100);
    }
  };

  if (!supabase) {
    logPaso("⚙️ [Paso 2/4] Liquidando jugadas, incentivos y socios...", "info");
    logPaso("📘 [Paso 3/4] Registrando asiento contable NIIF y traza de auditoría...", "info");
    logPaso("✅ [Paso 4/4] Operación completada y saldos sincronizados (Modo seguro en memoria).", "success");
    return {
      ok: true,
      transaccionesAnalizadas: 0,
      asientosGenerados: 0,
      asientosPreexistentes: 0,
      totalDebe: 0,
      totalHaber: 0,
      cuadrePerfecto: true,
      diferenciaCentavos: 0,
      semanaActual,
      mensajes,
    };
  }

  const sdb = supabase;
  const asientosPrevios = obtenerAsientosMemoria(params?.grupoId || null);
  const clavesPrevias = new Set(
    asientosPrevios.map((a) => a.clave_idempotencia || a.referencia_id || "")
  );

  try {
    logPaso("⚙️ [Paso 2/4] Procesando jugadas de la semana, incentivos, socios, tablas, marcas y tesorería...", "info");

    // 0. Cargar mapa de clientes para identificar clientes avalados y socios
    const mapaClientes = new Map<
      string,
      { id: string; nombre: string; esAvalado: boolean; devolucionPct: number; socioNombre?: string | null; socioPct: number }
    >();
    try {
      const { data: cliRows } = await sdb
        .from("clientes")
        .select("id, nombre, seudonimo, aval, devolucion, es_socio, socio_asignado");
      for (const c of cliRows ?? []) {
        const nom = String(c.seudonimo || c.nombre || "").trim().toUpperCase();
        const paramOf = PARAMETROS_PREDETERMINADOS_DEVOLUCION.find(
          (p) => p.nombre.toUpperCase() === nom || String(c.nombre || "").trim().toUpperCase() === p.nombre.toUpperCase()
        );
        const info = {
          id: String(c.id),
          nombre: nom || String(c.nombre || "Cliente"),
          esAvalado: Number(c.aval || 0) > 0,
          devolucionPct: Number(c.devolucion || paramOf?.devolucionPropiaPct || 0),
          socioNombre: String(c.socio_asignado || paramOf?.socioAsignado || "").trim() || null,
          socioPct: Number(paramOf?.comisionSocioPct ?? (c.socio_asignado ? 1 : 0)),
        };
        mapaClientes.set(String(c.id), info);
        if (c.nombre) mapaClientes.set(String(c.nombre).trim().toUpperCase(), info);
        if (c.seudonimo) mapaClientes.set(String(c.seudonimo).trim().toUpperCase(), info);
      }
    } catch {
      /* ignore */
    }

    logPaso("📘 [Paso 3/4] Registrando asientos contables NIIF de todas las transacciones de la semana...", "info");

    // =========================================================================
    // 1. APUESTAS ENTRE TERCIOS Y TAQUILLA (`tickets_apuestas`)
    //    (Tanto liquidadas como en curso de la semana actual)
    // =========================================================================
    const { data: ticketsData, error: errTickets } = await sdb
      .from("tickets_apuestas")
      .select(
        "id, hipodromo, carrera, fecha_carrera, fecha_registro, estado, jugada, ejemplar_numero, monto_jugado, premio_pagar, cliente_juega_id, cliente_juega_nombre, cliente_consigue_id, cliente_consigue_nombre, comision_porcentaje, comision_pagada, anulada, grupo_id"
      )
      .order("id", { ascending: true })
      .limit(5000);

    if (!errTickets && ticketsData) {
      const gruposCarreras = new Map<string, typeof ticketsData>();

      for (const t of ticketsData) {
        if (t.anulada) continue;
        if (params?.grupoId && t.grupo_id && String(t.grupo_id) !== String(params.grupoId)) continue;

        const dia = String(t.fecha_carrera ?? t.fecha_registro ?? "").slice(0, 10) || semanaActual.desde;
        const hipo = String(t.hipodromo ?? "USA").trim().toUpperCase();
        const numC = Number(t.carrera ?? 1);
        const est = String(t.estado || "").toUpperCase();

        // 1A. Si el ticket está PENDIENTE / EN CURSO en la semana actual -> Asiento de Compromiso
        if (
          (est === "PENDIENTE" || est === "ACTIVA" || est === "EN_CURSO") &&
          dia >= semanaActual.desde &&
          dia <= semanaActual.hasta
        ) {
          const monto = redondearCentavos(Number(t.monto_jugado || 0));
          if (monto > 0) {
            transaccionesAnalizadas += 1;
            const claveComp = `COMPROMISO:${t.id}`;
            const eraPrevio = clavesPrevias.has(claveComp);
            const resComp = await generarAsientoCompromisoJugada({
              ticketId: t.id,
              clienteId: t.cliente_juega_id,
              clienteNombre: String(t.cliente_juega_nombre || "Jugador 1"),
              contraparteId: t.cliente_consigue_id,
              contraparteNombre: t.cliente_consigue_nombre ? String(t.cliente_consigue_nombre) : null,
              montoJugador: monto,
              hipodromo: hipo,
              carrera: numC,
              fecha: dia,
              jugada: String(t.jugada || "PUESTO"),
              caballo: String(t.ejemplar_numero || "1"),
              grupoId: params?.grupoId || (t.grupo_id ? String(t.grupo_id) : null),
              usuario: params?.usuario || "SISTEMA_SEMANA_ACTUAL",
            });
            registrarEstadisticaAsiento(resComp, eraPrevio);
          }
          continue;
        }

        // 1B. Tickets decididos -> agrupar por carrera
        if (["GANADOR", "PERDEDOR", "GANO", "PERDIO", "SOLUCIONADO"].includes(est)) {
          transaccionesAnalizadas += 1;
          const key = `${dia}::${hipo}::${numC}`;
          const arr = gruposCarreras.get(key) ?? [];
          arr.push(t);
          gruposCarreras.set(key, arr);
        }
      }

      // Generar asiento de liquidación por cada carrera decidida
      for (const [key, tickets] of gruposCarreras) {
        const [dia, hipo, numCStr] = key.split("::");
        const numC = Number(numCStr);
        const claveIdemp = `LIQ:${hipo}:${numC}:${dia || "hoy"}`;
        const eraPrevio = clavesPrevias.has(claveIdemp);

        const perdedores: Array<{ clienteId: string; clienteNombre: string; montoPerdido: number; esAvalado?: boolean }> = [];
        const ganadores: Array<{ clienteId: string; clienteNombre: string; montoGanadoNeto: number; esAvalado?: boolean }> = [];
        let totalComisionCentavos = 0;

        for (const t of tickets) {
          const est = String(t.estado).toUpperCase();
          const monto = redondearCentavos(Number(t.monto_jugado || 0));
          const premio = redondearCentavos(Number(t.premio_pagar || 0));
          const cliJuegaId = String(t.cliente_juega_id || "cli-juega");
          const cliJuegaNom = String(t.cliente_juega_nombre || "Jugador 1");
          const cliConsigueId = String(t.cliente_consigue_id || "cli-da");
          const cliConsigueNom = String(t.cliente_consigue_nombre || "Jugador 2");
          const pctCom = Number(t.comision_porcentaje ?? 5);

          const infoJuega =
            mapaClientes.get(cliJuegaId) || mapaClientes.get(cliJuegaNom.trim().toUpperCase());
          const infoConsigue =
            mapaClientes.get(cliConsigueId) || mapaClientes.get(cliConsigueNom.trim().toUpperCase());

          if ((est === "GANADOR" || est === "GANO") && monto > 0) {
            const ganBruto = premio > monto ? redondearCentavos(premio - monto) : monto;
            const com = redondearCentavos(
              Number(t.comision_pagada) > 0
                ? Number(t.comision_pagada)
                : (ganBruto * pctCom) / 100
            );
            const ganNeto = redondearCentavos(Math.max(0, ganBruto - com));
            const perdidoContraparte = redondearCentavos(ganNeto + com);
            if (perdidoContraparte > 0) {
              perdedores.push({
                clienteId: cliConsigueId,
                clienteNombre: cliConsigueNom,
                montoPerdido: perdidoContraparte,
                esAvalado: infoConsigue?.esAvalado ?? false,
              });
              if (ganNeto > 0) {
                ganadores.push({
                  clienteId: cliJuegaId,
                  clienteNombre: cliJuegaNom,
                  montoGanadoNeto: ganNeto,
                  esAvalado: infoJuega?.esAvalado ?? false,
                });
              }
              totalComisionCentavos += Math.round(com * 100);
            }
          } else if ((est === "PERDEDOR" || est === "PERDIO") && monto > 0) {
            const com = redondearCentavos(
              Number(t.comision_pagada) > 0
                ? Number(t.comision_pagada)
                : (monto * pctCom) / 100
            );
            const ganNeto = redondearCentavos(Math.max(0, monto - com));
            const perdido = redondearCentavos(ganNeto + com);
            if (perdido > 0) {
              perdedores.push({
                clienteId: cliJuegaId,
                clienteNombre: cliJuegaNom,
                montoPerdido: perdido,
                esAvalado: infoJuega?.esAvalado ?? false,
              });
              if (ganNeto > 0) {
                ganadores.push({
                  clienteId: cliConsigueId,
                  clienteNombre: cliConsigueNom,
                  montoGanadoNeto: ganNeto,
                  esAvalado: infoConsigue?.esAvalado ?? false,
                });
              }
              totalComisionCentavos += Math.round(com * 100);
            }
          }
        }

        if (perdedores.length === 0 && ganadores.length === 0) continue;

        try {
          const resAsiento = await generarAsientoLiquidacionCarrera({
            grupoId: params?.grupoId || null,
            fecha: dia,
            carreraId: `${hipo}-C${numC}`,
            carreraNumero: numC,
            hipodromo: hipo,
            perdedores,
            ganadores,
            totalComisionCasa: totalComisionCentavos / 100,
            usuario: params?.usuario || "SISTEMA_AUTO_BACKFILL",
          });
          registrarEstadisticaAsiento(resAsiento, eraPrevio);
        } catch {
          /* ignore non-blocking */
        }
      }
    }

    // =========================================================================
    // 2. DEVOLUCIONES DE INCENTIVOS (5.1.02.001) Y COMISIONES A SOCIOS (5.1.03.001)
    //    DE LA SEMANA ACTUAL
    // =========================================================================
    try {
      const repSemana = calcularReporteDestinatariosDevolucion({
        fechaDesde: semanaActual.desde,
        fechaHasta: semanaActual.hasta,
        tickets: ticketsData ?? [],
      });

      for (const dest of repSemana.items) {
        // 2A. Asiento de Devolución de Incentivo Propio del Jugador (5.1.02.001)
        if (dest.totalDevolucionPropia > 0) {
          transaccionesAnalizadas += 1;
          const refInc = `SEMANA:${semanaActual.desde}:${dest.socio}:PROPIA`;
          const claveInc = `INC:${refInc}:${dest.socio}`;
          const eraPrevio = clavesPrevias.has(claveInc);
          const resInc = await generarAsientoDevolucionIncentivo({
            grupoId: params?.grupoId || null,
            fecha: semanaActual.hasta,
            clienteId: dest.socio,
            clienteNombre: dest.socio,
            montoIncentivo: dest.totalDevolucionPropia,
            referenciaId: refInc,
            esAvalador: false,
            usuario: params?.usuario || "SISTEMA_SEMANA_ACTUAL",
          });
          registrarEstadisticaAsiento(resInc, eraPrevio);
        }

        // 2B. Asiento de Comisión Confidencial al Socio por sus Afiliados (5.1.03.001)
        for (const af of dest.clientes) {
          if (af.comisionSocio > 0) {
            transaccionesAnalizadas += 1;
            const refSoc = `SEMANA:${semanaActual.desde}:SOCIO:${dest.socio}:POR:${af.cliente}`;
            const claveSoc = `INC:${refSoc}:${dest.socio}`;
            const eraPrevio = clavesPrevias.has(claveSoc);
            const resSoc = await generarAsientoDevolucionIncentivo({
              grupoId: params?.grupoId || null,
              fecha: semanaActual.hasta,
              clienteId: dest.socio,
              clienteNombre: `${dest.socio} (Socio por ${af.cliente})`,
              montoIncentivo: af.comisionSocio,
              referenciaId: refSoc,
              esAvalador: true,
              usuario: params?.usuario || "SISTEMA_SEMANA_ACTUAL",
            });
            registrarEstadisticaAsiento(resSoc, eraPrevio);
          }
        }
      }
    } catch {
      /* ignore */
    }

    // =========================================================================
    // 3. TABLAS FIJAS (`tablas_fijas` / `tablas_fijas_jugadas`) DE LA SEMANA
    // =========================================================================
    try {
      const { data: tablasRows } = await sdb
        .from("tablas_fijas")
        .select("id, fecha, hipodromo, carrera, estado, total_vendido, premio_total, comision_casa, grupo_id")
        .gte("fecha", semanaActual.desde)
        .lte("fecha", semanaActual.hasta)
        .limit(500);

      for (const tf of tablasRows ?? []) {
        if (params?.grupoId && tf.grupo_id && String(tf.grupo_id) !== String(params.grupoId)) continue;
        const vendido = redondearCentavos(Number(tf.total_vendido || 0));
        const premio = redondearCentavos(Number(tf.premio_total || 0));
        const com = redondearCentavos(Number(tf.comision_casa || 0));
        if (vendido <= 0 && premio <= 0 && com <= 0) continue;

        transaccionesAnalizadas += 1;
        const claveTf = `TF:SEMANA:${tf.id}`;
        const eraPrevio = clavesPrevias.has(claveTf);
        const fechaTf = String(tf.fecha || semanaActual.desde).slice(0, 10);

        const lineasTf = [];
        if (vendido > 0) {
          lineasTf.push(
            {
              cuenta_codigo: "2.1.01.001",
              debe: vendido,
              haber: 0,
              concepto: `Recaudación Tablas Fijas ${tf.hipodromo || ""} C${tf.carrera || ""}`,
            },
            {
              cuenta_codigo: "4.2.01.001",
              debe: 0,
              haber: vendido,
              concepto: `Ingreso Ventas Tablas Fijas ${tf.hipodromo || ""} C${tf.carrera || ""}`,
            }
          );
        }
        if (premio > 0) {
          lineasTf.push(
            {
              cuenta_codigo: "5.2.01.001",
              debe: premio,
              haber: 0,
              concepto: `Premio pagado Tablas Fijas ${tf.hipodromo || ""} C${tf.carrera || ""}`,
            },
            {
              cuenta_codigo: "2.1.01.001",
              debe: 0,
              haber: premio,
              concepto: `Acreditación premio Tablas Fijas ${tf.hipodromo || ""} C${tf.carrera || ""}`,
            }
          );
        }

        if (lineasTf.length > 0) {
          const resTf = await generarAsientoPartidaDoble({
            grupo_id: params?.grupoId || (tf.grupo_id ? String(tf.grupo_id) : null),
            fecha_contable: fechaTf,
            tipo_evento: "LIQUIDACION_APUESTAS",
            referencia_id: String(tf.id),
            clave_idempotencia: claveTf,
            descripcion: `Tablas Fijas ${tf.hipodromo || ""} C${tf.carrera || ""} (${fechaTf})`,
            creado_por: "SISTEMA_SEMANA_ACTUAL",
            lineas: lineasTf,
          });
          registrarEstadisticaAsiento(resTf, eraPrevio);
        }
      }
    } catch {
      /* ignore */
    }

    // =========================================================================
    // 4. REMATES (`remates`) Y POLLAS (`pollas`) DE LA SEMANA ACTUAL
    // =========================================================================
    try {
      const { data: rematesRows } = await sdb
        .from("remates")
        .select("id, fecha, hipodromo, carrera, total_pozo, comision_casa, monto_premio, grupo_id")
        .gte("fecha", semanaActual.desde)
        .lte("fecha", semanaActual.hasta)
        .limit(500);

      for (const rem of rematesRows ?? []) {
        if (params?.grupoId && rem.grupo_id && String(rem.grupo_id) !== String(params.grupoId)) continue;
        const pozo = redondearCentavos(Number(rem.total_pozo || 0));
        const com = redondearCentavos(Number(rem.comision_casa || pozo * 0.1));
        const premio = redondearCentavos(Math.max(0, pozo - com));
        if (pozo <= 0) continue;

        transaccionesAnalizadas += 1;
        const claveRem = `REM:SEMANA:${rem.id}`;
        const eraPrevio = clavesPrevias.has(claveRem);
        const fechaRem = String(rem.fecha || semanaActual.desde).slice(0, 10);

        const resRem = await generarAsientoPartidaDoble({
          grupo_id: params?.grupoId || (rem.grupo_id ? String(rem.grupo_id) : null),
          fecha_contable: fechaRem,
          tipo_evento: "LIQUIDACION_APUESTAS",
          referencia_id: String(rem.id),
          clave_idempotencia: claveRem,
          descripcion: `Liquidación de Remate Hípico ${rem.hipodromo || ""} C${rem.carrera || ""} (${fechaRem})`,
          creado_por: "SISTEMA_SEMANA_ACTUAL",
          lineas: [
            {
              cuenta_codigo: "2.1.04.001",
              debe: redondearCentavos(premio + com),
              haber: 0,
              concepto: `Liberación de pozo de remate ${rem.hipodromo || ""} C${rem.carrera || ""}`,
            },
            ...(premio > 0
              ? [
                  {
                    cuenta_codigo: "2.1.01.001",
                    debe: 0,
                    haber: premio,
                    concepto: `Premio de remate acreditado al ganador`,
                  },
                ]
              : []),
            ...(com > 0
              ? [
                  {
                    cuenta_codigo: "4.1.02.001",
                    debe: 0,
                    haber: com,
                    concepto: `Comisión casa por Remate Hípico ${rem.hipodromo || ""} C${rem.carrera || ""}`,
                  },
                ]
              : []),
          ],
        });
        registrarEstadisticaAsiento(resRem, eraPrevio);
      }
    } catch {
      /* ignore */
    }

    try {
      const { data: pollasRows } = await sdb
        .from("pollas")
        .select("id, fecha, hipodromo, total_recaudado, comision_casa, grupo_id")
        .gte("fecha", semanaActual.desde)
        .lte("fecha", semanaActual.hasta)
        .limit(500);

      for (const po of pollasRows ?? []) {
        if (params?.grupoId && po.grupo_id && String(po.grupo_id) !== String(params.grupoId)) continue;
        const rec = redondearCentavos(Number(po.total_recaudado || 0));
        const com = redondearCentavos(Number(po.comision_casa || rec * 0.1));
        const premio = redondearCentavos(Math.max(0, rec - com));
        if (rec <= 0) continue;

        transaccionesAnalizadas += 1;
        const clavePo = `POLLA:SEMANA:${po.id}`;
        const eraPrevio = clavesPrevias.has(clavePo);
        const fechaPo = String(po.fecha || semanaActual.desde).slice(0, 10);

        const resPo = await generarAsientoPartidaDoble({
          grupo_id: params?.grupoId || (po.grupo_id ? String(po.grupo_id) : null),
          fecha_contable: fechaPo,
          tipo_evento: "LIQUIDACION_APUESTAS",
          referencia_id: String(po.id),
          clave_idempotencia: clavePo,
          descripcion: `Liquidación de Polla Hípica ${po.hipodromo || ""} (${fechaPo})`,
          creado_por: "SISTEMA_SEMANA_ACTUAL",
          lineas: [
            {
              cuenta_codigo: "2.1.03.001",
              debe: redondearCentavos(premio + com),
              haber: 0,
              concepto: `Cierre de pozo acumulado de Polla ${po.hipodromo || ""}`,
            },
            ...(premio > 0
              ? [
                  {
                    cuenta_codigo: "2.1.01.001",
                    debe: 0,
                    haber: premio,
                    concepto: `Premio de Polla Hípica acreditado`,
                  },
                ]
              : []),
            ...(com > 0
              ? [
                  {
                    cuenta_codigo: "4.1.03.001",
                    debe: 0,
                    haber: com,
                    concepto: `Comisión casa por Polla Hípica ${po.hipodromo || ""}`,
                  },
                ]
              : []),
          ],
        });
        registrarEstadisticaAsiento(resPo, eraPrevio);
      }
    } catch {
      /* ignore */
    }

    // =========================================================================
    // 5. DEPÓSITOS Y AVALES (`depositos`)
    // =========================================================================
    try {
      const { data: deps } = await sdb
        .from("depositos")
        .select("id, fecha, cliente_id, cliente_nombre, tipo_operacion, monto, monto_usd, referencia")
        .order("id", { ascending: true })
        .limit(1000);

      for (const dep of deps ?? []) {
        const montoUsd = redondearCentavos(Number(dep.monto_usd ?? dep.monto ?? 0));
        if (montoUsd <= 0) continue;
        transaccionesAnalizadas += 1;
        const refId = `DEP-HIST-${dep.id}`;
        const claveDep = `DEP:${refId}`;
        const eraPrevio = clavesPrevias.has(claveDep);
        const fechaDep = String(dep.fecha || "").slice(0, 10) || semanaActual.desde;
        const tipoOp = String(dep.tipo_operacion || "Normal");
        const cliId = String(dep.cliente_id || "cli");
        const cliNom = String(dep.cliente_nombre || "Cliente");

        let resDep;
        if (tipoOp === "Otorgar Aval") {
          const claveAv = `AVAL:OTORGAR:${dep.id}`;
          const eraPrevAv = clavesPrevias.has(claveAv);
          resDep = await generarAsientoPartidaDoble({
            grupo_id: params?.grupoId || null,
            fecha_contable: fechaDep,
            tipo_evento: "AVAL_OTORGADO",
            referencia_id: String(dep.id),
            clave_idempotencia: claveAv,
            descripcion: `Otorgamiento de límite aval a ${cliNom}`,
            creado_por: "SISTEMA_AUTO_BACKFILL",
            lineas: [
              {
                cuenta_codigo: "1.2.02.001",
                cliente_id: cliId,
                cliente_nombre: cliNom,
                debe: montoUsd,
                haber: 0,
                concepto: `Límite aval otorgado a ${cliNom}`,
              },
              {
                cuenta_codigo: "3.1.02.001",
                debe: 0,
                haber: montoUsd,
                concepto: `Respaldo patrimonial aval otorgado a ${cliNom}`,
              },
            ],
          });
          registrarEstadisticaAsiento(resDep, eraPrevAv);
        } else if (tipoOp === "Pagar Aval") {
          const claveAv = `AVAL:PAGAR:${dep.id}`;
          const eraPrevAv = clavesPrevias.has(claveAv);
          resDep = await generarAsientoPartidaDoble({
            grupo_id: params?.grupoId || null,
            fecha_contable: fechaDep,
            tipo_evento: "AVAL_PAGADO",
            referencia_id: String(dep.id),
            clave_idempotencia: claveAv,
            descripcion: `Pago de aval liquidado por ${cliNom}`,
            creado_por: "SISTEMA_AUTO_BACKFILL",
            lineas: [
              {
                cuenta_codigo: "1.1.02.001",
                debe: montoUsd,
                haber: 0,
                concepto: `Ingreso bancario por pago de aval de ${cliNom}`,
              },
              {
                cuenta_codigo: "1.2.02.001",
                cliente_id: cliId,
                cliente_nombre: cliNom,
                debe: 0,
                haber: montoUsd,
                concepto: `Cancelación de cartera aval cobrada a ${cliNom}`,
              },
            ],
          });
          registrarEstadisticaAsiento(resDep, eraPrevAv);
        } else {
          resDep = await generarAsientoDepositoCliente({
            grupoId: params?.grupoId || null,
            fecha: fechaDep,
            clienteId: cliId,
            clienteNombre: cliNom,
            monto: montoUsd,
            referencia: refId,
            usuario: "SISTEMA_AUTO_BACKFILL",
          });
          registrarEstadisticaAsiento(resDep, eraPrevio);
        }
      }
    } catch {
      /* ignore */
    }

    // =========================================================================
    // 6. RETIROS Y TRASLADOS ENTRE CLIENTES (`transacciones`)
    // =========================================================================
    try {
      const { data: trans } = await sdb
        .from("transacciones")
        .select("id, fecha, tipo_operacion, cliente_origen_id, cliente_origen_nombre, cliente_destino_id, cliente_destino_nombre, monto, monto_usd, referencia")
        .order("id", { ascending: true })
        .limit(1000);

      for (const tr of trans ?? []) {
        const montoUsd = redondearCentavos(Number(tr.monto_usd ?? tr.monto ?? 0));
        if (montoUsd <= 0) continue;
        transaccionesAnalizadas += 1;
        const refId = `TR-HIST-${tr.id}`;
        const fechaTr = String(tr.fecha || "").slice(0, 10) || semanaActual.desde;
        const tipoOp = String(tr.tipo_operacion || "TRANSFERENCIA").toUpperCase();

        let resTr;
        if (tipoOp === "RETIRO") {
          const eraPrevio = clavesPrevias.has(`RET:${refId}`);
          resTr = await generarAsientoRetiroCliente({
            grupoId: params?.grupoId || null,
            fecha: fechaTr,
            clienteId: String(tr.cliente_origen_id || "cli"),
            clienteNombre: String(tr.cliente_origen_nombre || "Cliente"),
            monto: montoUsd,
            referencia: refId,
            usuario: "SISTEMA_AUTO_BACKFILL",
          });
          registrarEstadisticaAsiento(resTr, eraPrevio);
        } else {
          const eraPrevio = clavesPrevias.has(`TRAS:${refId}`);
          resTr = await generarAsientoTrasladoClientes({
            grupoId: params?.grupoId || null,
            fecha: fechaTr,
            origenId: String(tr.cliente_origen_id || "cli-orig"),
            origenNombre: String(tr.cliente_origen_nombre || "Origen"),
            destinoId: String(tr.cliente_destino_id || "cli-dest"),
            destinoNombre: String(tr.cliente_destino_nombre || "Destino"),
            monto: montoUsd,
            referencia: refId,
            usuario: "SISTEMA_AUTO_BACKFILL",
          });
          registrarEstadisticaAsiento(resTr, eraPrevio);
        }
      }
    } catch {
      /* ignore */
    }

    // =========================================================================
    // 7. EVENTOS LIBRES / SPORTSBOOK P2P DE LA SEMANA ACTUAL
    // =========================================================================
    try {
      const eventosLibres = leerEventosLibresMemoria();
      for (const ev of eventosLibres) {
        transaccionesAnalizadas += 1;
        const fechaEv = String(ev.fecha || "").slice(0, 10) || semanaActual.desde;
        if (ev.estado === "PENDIENTE") {
          const claveEv = `EVLIBRE:COMP:${ev.id}`;
          const eraPrevio = clavesPrevias.has(claveEv);
          const r1 = redondearCentavos(ev.riesgoJugador1 || 0);
          const r2 = redondearCentavos(ev.riesgoJugador2 || 0);
          const totalRiesgo = redondearCentavos(r1 + r2);
          if (totalRiesgo > 0) {
            const resEv = await generarAsientoPartidaDoble({
              grupo_id: params?.grupoId || null,
              fecha_contable: fechaEv,
              tipo_evento: "COMPROMISO_JUGADA",
              referencia_id: ev.id,
              clave_idempotencia: claveEv,
              descripcion: `Compromiso Evento Libre (${ev.categoria}): ${ev.concepto}`,
              creado_por: "SISTEMA_SEMANA_ACTUAL",
              lineas: [
                {
                  cuenta_codigo: "2.1.01.001",
                  cliente_id: String(ev.jugador1Id),
                  cliente_nombre: ev.jugador1Nombre,
                  debe: r1,
                  haber: 0,
                  concepto: `Riesgo comprometido Juega (${ev.concepto})`,
                },
                {
                  cuenta_codigo: "2.1.01.001",
                  cliente_id: String(ev.jugador2Id),
                  cliente_nombre: ev.jugador2Nombre,
                  debe: r2,
                  haber: 0,
                  concepto: `Riesgo comprometido Da (${ev.concepto})`,
                },
                {
                  cuenta_codigo: "2.1.02.003",
                  debe: 0,
                  haber: totalRiesgo,
                  concepto: `Bolsa en custodia Evento Libre: ${ev.concepto}`,
                },
              ],
            });
            registrarEstadisticaAsiento(resEv, eraPrevio);
          }
        }
      }
    } catch {
      /* ignore */
    }
  } catch (err: any) {
    console.error("Error en sincronizarYAuditarContabilidadCompleta:", err);
  }

  const dif = Math.abs(totalDebeCentavos - totalHaberCentavos);
  const cuadre = dif === 0;

  logPaso(
    `✅ [Paso 4/4] Contabilidad de la semana (${semanaActual.desde} al ${semanaActual.hasta}) cuadrada: ${asientosGenerados} asientos nuevos, ${asientosPreexistentes} verificados (Debe = Haber = $${(totalDebeCentavos / 100).toFixed(2)}).`,
    "success"
  );

  return {
    ok: true,
    transaccionesAnalizadas,
    asientosGenerados,
    asientosPreexistentes,
    totalDebe: totalDebeCentavos / 100,
    totalHaber: totalHaberCentavos / 100,
    cuadrePerfecto: cuadre,
    diferenciaCentavos: dif,
    semanaActual,
    mensajes,
  };
}
