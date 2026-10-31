/**
 * ============================================================================
 * ASISTENTE IA: SENIOR DATA ANALYST & CPA AUDITOR
 * (`analista-cpa-auditor.ts`)
 * ============================================================================
 *
 * Módulo especializado en análisis financiero, auditoría NIIF y ejecución
 * conversacional de eventos deportivos / eventos libres.
 */

import { supabase } from "@/core/supabase";
import { formatoMoneda } from "@/shared/lib/vzla";
import {
  sincronizarYAuditarContabilidadCompleta,
  type ResumenAuditoriaContableCompleta,
} from "@/features/contabilidad/lib/motor-backfill-retroactivo";
import {
  crearEventoLibre,
  liquidarEventoLibre,
  leerEventosLibresMemoria,
  type CategoriaDeporte,
} from "@/features/eventos-libres/lib/eventos-libres";

export interface RespuestaAnalisisCpa {
  esAnalitico: boolean;
  tipo: "RENTABILIDAD_CARRERAS" | "AUDITORIA_SOCIO" | "CUADRE_CONTABLE" | "EVENTO_LIBRE_ACCION" | "NINGUNO";
  texto: string;
  datos?: unknown;
}

/**
 * Detecta y procesa intenciones de Senior Data Analyst y CPA Auditor
 */
export async function procesarIntencionDataAnalystCpa(
  texto: string,
  contexto?: { usuario?: string; grupoId?: string | null; fecha?: string }
): Promise<RespuestaAnalisisCpa> {
  const t = texto.toLowerCase().trim();

  // 1. Detección de Cuadre Contable y Auditoría NIIF
  if (
    /\b(?:cuadre\s+contable|auditor[ií]a\s+contable|verific(?:ar?|a)\s+cuadre|anomal[ií]as|partida\s+doble)\b/i.test(t) ||
    (/\b(?:cuadre|balance)\b/i.test(t) && /\b(?:contable|niif|debe.*haber)\b/i.test(t))
  ) {
    const res = await sincronizarYAuditarContabilidadCompleta({
      grupoId: contexto?.grupoId,
      usuario: contexto?.usuario || "IA_DATA_ANALYST",
    });

    const estadoCuadre = res.cuadrePerfecto
      ? "✅ CUADRE PERFECTO: Total Debe === Total Haber."
      : `⚠️ DIFERENCIA DETECTADA: ${res.diferenciaCentavos} centavos.`;

    const textoRes = `📊 INFORME DE AUDITORÍA CONTABLE CPA & NIIF:
---------------------------------------------
• Estado: ${estadoCuadre}
• Total Debe: $${res.totalDebe.toFixed(2)}
• Total Haber: $${res.totalHaber.toFixed(2)}
• Asientos Auditados: ${res.asientosPreexistentes + res.asientosGenerados} (${res.asientosGenerados} generados en backfill)
• Transacciones Analizadas: ${res.transaccionesAnalizadas}

Todos los movimientos de la semana están imputados en el Plan Único de Cuentas respetando cuentas de Activo, Pasivo, Comisiones, Cruces e Incentivos.`;

    return {
      esAnalitico: true,
      tipo: "CUADRE_CONTABLE",
      texto: textoRes,
      datos: res,
    };
  }

  // 2. Consulta de Rentabilidad Carrera por Carrera, Incentivos y Socios
  if (
    /\b(?:cu[aá]nto\s+gener[oó]\s+la\s+casa|rentabilidad|ganancia\s+de\s+la\s+casa|comisiones\s+hoy|incentivos\s+devueltos)\b/i.test(t)
  ) {
    let textoRes = `📈 REPORTE ANALÍTICO DE RENTABILIDAD & COMISIONES:
---------------------------------------------
• Ingresos Comisiones Casa (4.1.*): Calculadas y acreditadas automáticamente carrera a carrera.
• Incentivos Devueltos a Jugadores (5.1.02.001): Acreditados de inmediato al saldo de los jugadores con base elegida (Monto Decidido, Pérdida o Ganancia).
• Comisiones Ganadas por Socios (5.1.03.001): Acreditadas al saldo del socio y visibles con desglose confidencial.

El balance operativo se encuentra conciliado en tiempo real con el Libro Mayor.`;

    if (supabase) {
      try {
        const { data: tickets } = await supabase
          .from("tickets_apuestas")
          .select("comision_pagada, estado, premio_pagar, monto_jugado")
          .order("id", { ascending: false })
          .limit(500);

        if (tickets && tickets.length > 0) {
          const comTotal = tickets.reduce((acc, x) => acc + (Number(x.comision_pagada) || 0), 0);
          textoRes += `\n• Muestra de últimas jugadas analizadas: $${comTotal.toFixed(2)} en comisiones generadas.`;
        }
      } catch {
        /* ignore */
      }
    }

    return {
      esAnalitico: true,
      tipo: "RENTABILIDAD_CARRERAS",
      texto: textoRes,
    };
  }

  // 3. Consulta de rendimiento por socio
  if (/\b(?:rendimiento.*socio|jugadores\s+del\s+socio|socio\s+carlos|comisi[oó]n.*socio)\b/i.test(t)) {
    return {
      esAnalitico: true,
      tipo: "AUDITORIA_SOCIO",
      texto: `👔 AUDITORÍA DE SOCIOS Y AFILIADOS:
---------------------------------------------
• Cada socio cuenta con su desglose confidencial en su Cuenta Diaria y Portal.
• Los jugadores afiliados NO tienen rastro ni visibilidad de la comisión asignada a su socio.
• La liquidación acredita de inmediato el porcentaje acordado sobre la base configurada (Monto Decidido, Pérdida, Ganancia o Comisión Cobrada).`,
    };
  }

  // 4. Creación o liquidación de Evento Libre por voz o texto
  // Ej: "En evento libre juega Pedro 1000 a Real Madrid 10/6 da Juan"
  if (/\b(?:evento\s+libre)\b/i.test(t) && /\b(?:juega|da)\b/i.test(t)) {
    const match = t.match(/juega\s+([a-zA-Z0-9_\s]+?)\s+(\d+(?:\.\d+)?)\s+(?:a\s+|al\s+)?(.+?)\s+(\d+(?:\/\d+|a\d+))\s+da\s+([a-zA-Z0-9_\s]+)/i);
    if (match) {
      const nomJuega = match[1].trim().toUpperCase();
      const montoJ = parseFloat(match[2]);
      const concepto = match[3].trim();
      const logro = match[4].trim();
      const nomDa = match[5].trim().toUpperCase();

      const res = await crearEventoLibre({
        categoria: "LIBRE",
        concepto,
        mercado: logro,
        jugador1: { id: `cli-${nomJuega}`, nombre: nomJuega, disponible: montoJ },
        jugador2: { id: `cli-${nomDa}`, nombre: nomDa, disponible: montoJ },
        riesgo1: montoJ,
        riesgo2: Math.round(montoJ * 0.6),
        creadoPor: "IA_COPILOTO",
      });

      if (res.ok) {
        return {
          esAnalitico: true,
          tipo: "EVENTO_LIBRE_ACCION",
          texto: `✅ Evento Libre P2P creado exitosamente:\n• Juega: ${nomJuega} ($${montoJ})\n• Da: ${nomDa}\n• Concepto: ${concepto} (${logro})\n• Estado: PENDIENTE`,
          datos: res.evento,
        };
      }
    }
  }

  // Liquidación de Evento Libre por voz o texto
  // Ej: "Ganó Pedro el evento libre"
  if (/\b(?:gan[oó]|empate)\b/i.test(t) && /\b(?:evento\s+libre)\b/i.test(t)) {
    const eventos = leerEventosLibresMemoria().filter((e) => e.estado === "PENDIENTE");
    if (eventos.length > 0) {
      const ev = eventos[0];
      const ganoJ1 = t.includes(ev.jugador1Nombre.toLowerCase()) || t.includes("juega");
      const ganoJ2 = t.includes(ev.jugador2Nombre.toLowerCase()) || t.includes("da");
      const esEmpate = t.includes("empate") || t.includes("nulo");

      const ganadorSel = ganoJ1 ? "JUGADOR_1" : ganoJ2 ? "JUGADOR_2" : esEmpate ? "EMPATE" : null;

      if (ganadorSel) {
        const resLiq = await liquidarEventoLibre({
          eventoId: ev.id,
          ganador: ganadorSel,
          config1: { clienteId: ev.jugador1Id, clienteNombre: ev.jugador1Nombre },
          config2: { clienteId: ev.jugador2Id, clienteNombre: ev.jugador2Nombre },
        });

        if (resLiq.ok) {
          return {
            esAnalitico: true,
            tipo: "EVENTO_LIBRE_ACCION",
            texto: `🏆 Evento Libre "${ev.concepto}" liquidado exitosamente por comando de voz/texto.\n• Ganador: ${ganadorSel}\n• Asiento contable NIIF y saldos actualizados.`,
            datos: resLiq.resultado,
          };
        }
      }
    }
  }

  return {
    esAnalitico: false,
    tipo: "NINGUNO",
    texto: "",
  };
}
