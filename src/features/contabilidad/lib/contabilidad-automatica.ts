/**
 * ============================================================================
 * MOTOR DE CONTABILIDAD AUTOMÁTICA EN SEGUNDO PLANO Y COLA ASÍNCRONA
 * ============================================================================
 *
 * Ejecuta en segundo plano (background no bloqueante) toda la contabilidad
 * NIIF y partida doble estricta tras cada carrera o transacción:
 *   1. No ralentiza la plataforma: procesa fuera del hilo principal de UI.
 *   2. Cuentas por Cobrar vs Cuentas por Pagar para Avalados:
 *      - Ganadores avalados: Cuentas por Pagar (Pasivo 2.1.01.003).
 *      - Perdedores avalados: Cuentas por Cobrar (Activo 1.2.02.001).
 *      - Clientes prepago/custodia: Fondos en custodia (Pasivo 2.1.01.001).
 *   3. Desglose analítico de comisiones por modalidad (4.1.01.001 a 4.1.01.007).
 *   4. Imputación contable para Grupo Argentina en ventas de Tablas Fijas,
 *      Marcas y Dupletas originadas en otros grupos.
 *   5. Aislamiento contable individual por grupo_id.
 */

import { supabase } from "@/core/supabase";
import {
  generarAsientoLiquidacionCarrera,
  generarAsientoImputacionArgentina,
} from "@/features/contabilidad/lib/plan-cuentas";

export interface ItemColaContable {
  id: string;
  tipo: "LIQUIDACION_CARRERA" | "IMPUTACION_ARGENTINA" | "HONORARIOS_EQUIPO" | "TRANSACCION_TESORERIA";
  grupoId?: string | null;
  fecha: string;
  payload: Record<string, any>;
  estado: "PENDIENTE" | "PROCESANDO" | "COMPLETADO" | "ERROR";
  intentos: number;
  error?: string;
  creadoEl: number;
}

// Cola de procesamiento en memoria
const COLA_CONTABLE: ItemColaContable[] = [];
let procesadorActivo = false;

/**
 * Encola una tarea contable para ejecución inmediata en segundo plano
 */
export function encolarTareaContable(
  tipo: ItemColaContable["tipo"],
  payload: Record<string, any>,
  grupoId?: string | null,
  fecha?: string
): string {
  const id = `cola-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const item: ItemColaContable = {
    id,
    tipo,
    grupoId: grupoId || null,
    fecha: fecha || new Date().toISOString().slice(0, 10),
    payload,
    estado: "PENDIENTE",
    intentos: 0,
    creadoEl: Date.now(),
  };

  COLA_CONTABLE.push(item);

  // Iniciar procesamiento asíncrono desacoplado
  if (typeof setTimeout !== "undefined") {
    setTimeout(() => {
      void procesarColaContableSegundoPlano();
    }, 10);
  }

  return id;
}

/**
 * Procesa todos los elementos pendientes de la cola sin bloquear la UI
 */
export async function procesarColaContableSegundoPlano(): Promise<void> {
  if (procesadorActivo) return;
  procesadorActivo = true;

  try {
    while (true) {
      const proximo = COLA_CONTABLE.find((it) => it.estado === "PENDIENTE");
      if (!proximo) break;

      proximo.estado = "PROCESANDO";
      proximo.intentos += 1;

      try {
        if (proximo.tipo === "LIQUIDACION_CARRERA") {
          await ejecutarLiquidacionCarreraContable(proximo.payload, proximo.grupoId, proximo.fecha);
        } else if (proximo.tipo === "IMPUTACION_ARGENTINA") {
          await generarAsientoImputacionArgentina({
            grupoIdArgentina: proximo.payload.grupoIdArgentina,
            grupoOrigenId: proximo.payload.grupoOrigenId,
            grupoOrigenNombre: proximo.payload.grupoOrigenNombre,
            modalidad: proximo.payload.modalidad,
            referenciaId: proximo.payload.referenciaId,
            montoCobrado: proximo.payload.montoCobrado,
            premioPagar: proximo.payload.premioPagar,
            huboGanador: proximo.payload.huboGanador,
            fecha: proximo.fecha,
            usuario: proximo.payload.usuario,
          });
        }
        proximo.estado = "COMPLETADO";

        // Notificar a la interfaz de usuario de forma reactiva
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("contabilidad:asiento-registrado", {
              detail: { tipo: proximo.tipo, grupoId: proximo.grupoId, fecha: proximo.fecha },
            })
          );
        }
      } catch (err: any) {
        console.error("Error en cola contable segundo plano:", err);
        proximo.estado = "ERROR";
        proximo.error = String(err?.message || err);
      }
    }
  } finally {
    procesadorActivo = false;
  }
}

/**
 * Ejecuta el asiento de liquidación de carrera aplicando las reglas
 * contables estrictas de Avalados y desglose de comisiones
 */
async function ejecutarLiquidacionCarreraContable(
  p: Record<string, any>,
  grupoId?: string | null,
  fecha?: string
) {
  const perdedores = (p.perdedores || []).map((perd: any) => ({
    clienteId: String(perd.clienteId || perd.id || ""),
    clienteNombre: String(perd.clienteNombre || perd.nombre || "Cliente"),
    montoPerdido: Number(perd.montoPerdido || perd.monto || 0),
    esAvalado: Boolean(perd.esAvalado || perd.modo === "aval" || perd.modo_juego === "aval" || (perd.aval && perd.aval > 0)),
  }));

  const ganadores = (p.ganadores || []).map((gan: any) => ({
    clienteId: String(gan.clienteId || gan.id || ""),
    clienteNombre: String(gan.clienteNombre || gan.nombre || "Cliente"),
    montoGanadoNeto: Number(gan.montoGanadoNeto || gan.montoNeto || gan.premio_pagar || 0),
    esAvalado: Boolean(gan.esAvalado || gan.modo === "aval" || gan.modo_juego === "aval" || (gan.aval && gan.aval > 0)),
  }));

  const totalComisionCasa = Number(p.totalComisionCasa || p.comision || 0);

  // Asiento principal en el grupo correspondiente
  await generarAsientoLiquidacionCarrera({
    grupoId: grupoId || p.grupoId || null,
    fecha: fecha || p.fecha,
    carreraId: String(p.carreraId || `${p.hipodromo}-${p.carreraNumero}`),
    carreraNumero: Number(p.carreraNumero || 1),
    hipodromo: String(p.hipodromo || "USA"),
    perdedores,
    ganadores,
    totalComisionCasa,
    comisionesPorModalidad: p.comisionesPorModalidad,
    crucesReembolso: p.crucesReembolso,
    usuario: p.usuario || "SISTEMA_AUTO_CONTABILIDAD",
  });

  // Imputación a Argentina si existen ventas de otros grupos
  if (p.ventasInterGrupoArgentina && Array.isArray(p.ventasInterGrupoArgentina)) {
    for (const v of p.ventasInterGrupoArgentina) {
      await generarAsientoImputacionArgentina({
        grupoIdArgentina: v.grupoIdArgentina || null,
        grupoOrigenId: v.grupoOrigenId || null,
        grupoOrigenNombre: v.grupoOrigenNombre || "Grupo Convenio",
        modalidad: v.modalidad || "TABLAS_FIJAS",
        referenciaId: v.referenciaId || `${p.hipodromo}-C${p.carreraNumero}`,
        montoCobrado: Number(v.montoCobrado || 0),
        premioPagar: Number(v.premioPagar || 0),
        huboGanador: Boolean(v.huboGanador),
        fecha: fecha || p.fecha,
        usuario: p.usuario,
      });
    }
  }
}

/**
 * Disparador que puede invocarse desde cualquier punto (ej. pagarYCerrar.ts,
 * taquilla o modales de cobro/pago) para garantizar actualización contable
 * instantánea sin congelar la pantalla.
 */
export function sincronizarContabilidadCarreraEnSegundoPlano(params: {
  grupoId?: string | null;
  fecha?: string;
  carreraId?: string;
  carreraNumero: number | string;
  hipodromo: string;
  perdedores?: Array<{ clienteId: string; clienteNombre: string; montoPerdido: number; esAvalado?: boolean }>;
  ganadores?: Array<{ clienteId: string; clienteNombre: string; montoGanadoNeto: number; esAvalado?: boolean }>;
  totalComisionCasa?: number;
  comisionesPorModalidad?: {
    entreTercios?: number;
    tablasFijas?: number;
    marcas?: number;
    dupletas?: number;
    pollas?: number;
    wps?: number;
    eventosEspeciales?: number;
  };
  crucesReembolso?: Array<{ clienteId: string; clienteNombre: string; montoReembolso: number }>;
  ventasInterGrupoArgentina?: Array<{
    grupoIdArgentina?: string | null;
    grupoOrigenId?: string | null;
    grupoOrigenNombre?: string;
    modalidad: "TABLAS_FIJAS" | "MARCAS" | "DUPLETAS";
    referenciaId: string;
    montoCobrado: number;
    premioPagar: number;
    huboGanador: boolean;
  }>;
  usuario?: string | null;
}): string {
  return encolarTareaContable("LIQUIDACION_CARRERA", params, params.grupoId, params.fecha);
}

/**
 * Obtiene el estado actual de la cola de procesamiento
 */
export function obtenerEstadoColaContable() {
  return {
    total: COLA_CONTABLE.length,
    pendientes: COLA_CONTABLE.filter((c) => c.estado === "PENDIENTE").length,
    procesando: COLA_CONTABLE.filter((c) => c.estado === "PROCESANDO").length,
    completados: COLA_CONTABLE.filter((c) => c.estado === "COMPLETADO").length,
    errores: COLA_CONTABLE.filter((c) => c.estado === "ERROR").length,
  };
}
