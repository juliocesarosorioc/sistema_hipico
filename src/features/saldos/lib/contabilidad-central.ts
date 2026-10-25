/**
 * MOTOR CONTABLE CENTRALIZADO DE SALDOS POR CLIENTE
 * SINGLE SOURCE OF TRUTH - Unifica todos los módulos
 * 
 * Todos los módulos deben leer/escribir a través de este servicio
 */

import { supabase } from "@/core/supabase";

export interface ResumenContableCliente {
  clienteId: string;
  grupoId: string | null;
  nombre: string;
  esLibre: boolean;
  depositos: number;
  retiros: number;
  avalVigente: number;
  jugadasRealizadasCount: number;
  jugadasAnuladasCount: number;
  jugadasGanadasBruto: number;
  comisionesCobradas: number;
  jugadasGanadasNeto: number;
  jugadasPerdidas: number;
  saldoContable: number;      // Saldo neto real (sin aval)
  riesgoEnCurso: number;      // Comprometido en carreras abiertas
  disponibleParaJugar: number; // saldoContable + avalVigente - riesgoEnCurso
}

const NUM = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export async function obtenerResumenContableCliente(clienteId: string): Promise<ResumenContableCliente | null> {
  if (!supabase) return null;
  
  try {
    const { data, error } = await supabase
      .rpc("calcular_estado_cuenta_cliente", { p_cliente_id: clienteId })
      .single();
    
    if (error || !data) return null;
    
    return {
      clienteId: data.cliente_id,
      grupoId: data.grupo_id,
      nombre: data.nombre || "",
      esLibre: !!data.es_libre,
      depositos: NUM(data.total_depositos),
      retiros: NUM(data.total_retiros),
      avalVigente: NUM(data.aval_vigente),
      jugadasRealizadasCount: NUM(data.jugadas_activas_count) + NUM(data.jugadas_anuladas_count),
      jugadasAnuladasCount: NUM(data.jugadas_anuladas_count),
      jugadasGanadasBruto: NUM(data.jugadas_ganadas_bruto),
      comisionesCobradas: NUM(data.comisiones_cobradas),
      jugadasGanadasNeto: NUM(data.jugadas_ganadas_neto),
      jugadasPerdidas: NUM(data.jugadas_perdidas),
      saldoContable: NUM(data.saldo_contable_real),
      riesgoEnCurso: NUM(data.riesgo_en_curso),
      disponibleParaJugar: NUM(data.disponible_real),
    };
  } catch {
    return null;
  }
}

export async function obtenerSaldosCentralizadosTodos(grupoId?: string | null): Promise<ResumenContableCliente[]> {
  if (!supabase) return [];
  
  try {
    let query = supabase.from("v_saldos_centralizados_clientes").select("*");
    if (grupoId) query = query.eq("grupo_id", grupoId);
    
    const { data, error } = await query;
    if (error || !data) return [];
    
    return data.map((d: any) => ({
      clienteId: d.cliente_id,
      grupoId: d.grupo_id,
      nombre: d.nombre || "",
      esLibre: !!d.es_libre,
      depositos: NUM(d.total_depositos),
      retiros: NUM(d.total_retiros),
      avalVigente: NUM(d.aval_vigente),
      jugadasRealizadasCount: NUM(d.jugadas_activas_count) + NUM(d.jugadas_anuladas_count),
      jugadasAnuladasCount: NUM(d.jugadas_anuladas_count),
      jugadasGanadasBruto: NUM(d.jugadas_ganadas_bruto),
      comisionesCobradas: NUM(d.comisiones_cobradas),
      jugadasGanadasNeto: NUM(d.jugadas_ganadas_neto),
      jugadasPerdidas: NUM(d.jugadas_perdidas),
      saldoContable: NUM(d.saldo_contable_real),
      riesgoEnCurso: NUM(d.riesgo_en_curso),
      disponibleParaJugar: NUM(d.disponible_real),
    }));
  } catch {
    return [];
  }
}

export async function reconciliarSaldos(grupoId?: string | null, clienteId?: string | null): Promise<{
  ok: boolean;
  corregidos: number;
  detalles: Array<{ clienteId: string; nombre: string; saldoAnterior: number; saldoNuevo: number; diferencia: number }>;
}> {
  if (!supabase) return { ok: false, corregidos: 0, detalles: [] };
  
  try {
    const { data, error } = await supabase.rpc("reconciliar_saldos_clientes", {
      p_grupo_id: grupoId || null,
      p_cliente_id: clienteId || null,
    });
    
    if (error) return { ok: false, corregidos: 0, detalles: [] };
    
    const detalles = (data || []).map((d: any) => ({
      clienteId: d.cliente_id,
      nombre: d.nombre,
      saldoAnterior: NUM(d.saldo_anterior),
      saldoNuevo: NUM(d.saldo_nuevo),
      diferencia: NUM(d.diferencia),
    }));
    
    const corregidos = detalles.filter((d) => Math.abs(d.diferencia) > 0.001).length;
    
    return { ok: true, corregidos, detalles };
  } catch {
    return { ok: false, corregidos: 0, detalles: [] };
  }
}

export function formatearMoneda(n: number): string {
  return new Intl.NumberFormat("es-VE", { style: "decimal", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}
