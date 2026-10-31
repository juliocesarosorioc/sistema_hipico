/**
 * ============================================================================
 * SERVICIO: Honorarios del Equipo de Trabajo y Gestión de Colaboradores
 * ============================================================================
 * Permite registrar, identificar y pagar a los miembros del equipo (Operadores,
 * Administradores de Grupo, Liquidadores, etc.), generando automáticamente el
 * asiento contable de partida doble:
 *   - Si es PAGADO: Debe Gastos de Honorarios (6.1.03.001) / Haber Bancos o Caja (1.1.x)
 *   - Si es POR PAGAR: Debe Gastos de Honorarios (6.1.03.001) / Haber Cuentas por Pagar Honorarios (2.1.06.001)
 */

import { supabase } from "@/core/supabase";
import { generarAsientoHonorariosEquipo } from "@/features/contabilidad/lib/plan-cuentas";

export interface MiembroEquipo {
  id: string;
  grupo_id?: string | null;
  usuario_id?: string | null;
  nombre_completo: string;
  cedula_rif?: string | null;
  cargo_rol: string;
  telefono?: string | null;
  metodo_pago?: string | null;
  datos_pago?: string | null;
  monto_pactado: number;
  frecuencia_pago: "DIARIO" | "SEMANAL" | "QUINCENAL" | "MENSUAL" | "POR_CARRERA";
  activo: boolean;
  notas?: string | null;
  creado_el?: string;
}

export interface RegistroHonorario {
  id: string;
  grupo_id?: string | null;
  miembro_id: string;
  miembro_nombre: string;
  fecha_registro: string;
  periodo_desde?: string | null;
  periodo_hasta?: string | null;
  concepto: string;
  monto: number;
  estado: "POR_PAGAR" | "PAGADO" | "ANULADO";
  medio_pago?: string | null;
  banco_referencia?: string | null;
  asiento_id?: string | null;
  registrado_por?: string | null;
  creado_el?: string;
}

// Memoria local reactiva para entornos sin conexión o fallback
const MIEMBROS_MEMORIA: MiembroEquipo[] = [
  {
    id: "eq-1",
    nombre_completo: "Carlos Mendoza",
    cedula_rif: "V-18452901",
    cargo_rol: "Operador Principal de Taquilla",
    telefono: "+58 412 3019842",
    metodo_pago: "Pago Móvil",
    datos_pago: "Banesco (0134) - 04123019842 - V18452901",
    monto_pactado: 120.0,
    frecuencia_pago: "SEMANAL",
    activo: true,
    notas: "Responsable de carga de tickets y cuadre diario",
  },
  {
    id: "eq-2",
    nombre_completo: "Andrea Rivas",
    cedula_rif: "V-22104882",
    cargo_rol: "Liquidadora y Supervisora de Carreras",
    telefono: "+58 424 5590112",
    metodo_pago: "Zelle / USDT",
    datos_pago: "andrea.rivas.hipico@gmail.com",
    monto_pactado: 150.0,
    frecuencia_pago: "SEMANAL",
    activo: true,
    notas: "Validación de pizarras oficiales y cruces entre tercios",
  },
  {
    id: "eq-3",
    nombre_completo: "Gustavo Silva",
    cedula_rif: "V-15890234",
    cargo_rol: "Administrador de Grupo y Tesorería",
    telefono: "+58 414 1128945",
    metodo_pago: "Transferencia Banesco",
    datos_pago: "0134-0012-34-1234567890",
    monto_pactado: 200.0,
    frecuencia_pago: "SEMANAL",
    activo: true,
    notas: "Conciliación bancaria y cuadre semanal NIIF",
  },
];

const REGISTROS_MEMORIA: RegistroHonorario[] = [];

/**
 * Obtiene la lista de miembros del equipo de trabajo (filtrable por grupo)
 */
export async function listarMiembrosEquipo(grupoId?: string | null): Promise<MiembroEquipo[]> {
  if (!supabase) return [...MIEMBROS_MEMORIA];
  try {
    let q = supabase
      .from("equipo_trabajo_honorarios")
      .select("*")
      .order("nombre_completo", { ascending: true });

    if (grupoId) {
      q = q.or(`grupo_id.eq.${grupoId},grupo_id.is.null`);
    }

    const { data, error } = await q;
    if (error || !data || data.length === 0) {
      return [...MIEMBROS_MEMORIA];
    }
    return data as MiembroEquipo[];
  } catch (err) {
    console.warn("Fallo cargando equipo de trabajo desde BD, usando memoria:", err);
    return [...MIEMBROS_MEMORIA];
  }
}

/**
 * Guarda o actualiza un miembro del equipo de trabajo
 */
export async function guardarMiembroEquipo(
  miembro: Partial<MiembroEquipo>
): Promise<{ ok: boolean; miembro?: MiembroEquipo; error?: string }> {
  const obj: MiembroEquipo = {
    id: miembro.id || `eq-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    grupo_id: miembro.grupo_id || null,
    usuario_id: miembro.usuario_id || null,
    nombre_completo: (miembro.nombre_completo || "").trim().toUpperCase(),
    cedula_rif: miembro.cedula_rif ? miembro.cedula_rif.trim().toUpperCase() : null,
    cargo_rol: (miembro.cargo_rol || "Colaborador").trim(),
    telefono: miembro.telefono ? miembro.telefono.trim() : null,
    metodo_pago: miembro.metodo_pago || "Efectivo",
    datos_pago: miembro.datos_pago ? miembro.datos_pago.trim() : null,
    monto_pactado: Number(miembro.monto_pactado || 0),
    frecuencia_pago: miembro.frecuencia_pago || "SEMANAL",
    activo: miembro.activo !== false,
    notas: miembro.notas ? miembro.notas.trim() : null,
    creado_el: miembro.creado_el || new Date().toISOString(),
  };

  if (!obj.nombre_completo) {
    return { ok: false, error: "El nombre completo del colaborador es obligatorio." };
  }

  // Actualizar memoria
  const idx = MIEMBROS_MEMORIA.findIndex((m) => m.id === obj.id);
  if (idx >= 0) {
    MIEMBROS_MEMORIA[idx] = obj;
  } else {
    MIEMBROS_MEMORIA.push(obj);
  }

  // Persistir en Supabase si está disponible
  if (supabase) {
    try {
      const { error } = await supabase.from("equipo_trabajo_honorarios").upsert(obj);
      if (error) {
        console.warn("Advertencia al guardar miembro en BD:", error.message);
      }
    } catch {
      /* ignore */
    }
  }

  return { ok: true, miembro: obj };
}

/**
 * Elimina o desactiva un colaborador del equipo
 */
export async function eliminarMiembroEquipo(id: string): Promise<{ ok: boolean; error?: string }> {
  const idx = MIEMBROS_MEMORIA.findIndex((m) => m.id === id);
  if (idx >= 0) {
    MIEMBROS_MEMORIA.splice(idx, 1);
  }

  if (supabase) {
    try {
      await supabase.from("equipo_trabajo_honorarios").delete().eq("id", id);
    } catch {
      /* ignore */
    }
  }

  return { ok: true };
}

/**
 * Registra el pago o causación de honorarios a un colaborador y genera el asiento contable de partida doble
 */
export async function registrarPagoHonorario(p: {
  grupoId?: string | null;
  miembroId: string;
  miembroNombre: string;
  fecha?: string;
  periodoDesde?: string;
  periodoHasta?: string;
  concepto: string;
  monto: number;
  estado: "PAGADO" | "POR_PAGAR";
  medioPago?: string;
  cuentaPagoCodigo?: string;
  bancoReferencia?: string;
  usuario?: string | null;
}): Promise<{ ok: boolean; registro?: RegistroHonorario; error?: string }> {
  const monto = Math.round(Number(p.monto) * 100) / 100;
  if (monto <= 0) {
    return { ok: false, error: "El monto de los honorarios debe ser mayor a cero." };
  }

  const fechaReg = p.fecha || new Date().toISOString().slice(0, 10);
  const regId = `hon-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

  // 1. Generar Asiento Contable Automático en Partida Doble
  const resAsiento = await generarAsientoHonorariosEquipo({
    grupoId: p.grupoId,
    fecha: fechaReg,
    miembroId: p.miembroId,
    miembroNombre: p.miembroNombre,
    monto,
    concepto: p.concepto,
    estado: p.estado,
    cuentaPagoCodigo: p.cuentaPagoCodigo || "1.1.02.001",
    usuario: p.usuario,
  });

  const reg: RegistroHonorario = {
    id: regId,
    grupo_id: p.grupoId || null,
    miembro_id: p.miembroId,
    miembro_nombre: p.miembroNombre,
    fecha_registro: fechaReg,
    periodo_desde: p.periodoDesde || null,
    periodo_hasta: p.periodoHasta || null,
    concepto: p.concepto,
    monto,
    estado: p.estado,
    medio_pago: p.medioPago || "Transferencia",
    banco_referencia: p.bancoReferencia || null,
    asiento_id: resAsiento?.asiento?.id || null,
    registrado_por: p.usuario || "ADMINISTRADOR",
    creado_el: new Date().toISOString(),
  };

  REGISTROS_MEMORIA.unshift(reg);

  if (supabase) {
    try {
      await supabase.from("registros_honorarios_pagos").insert(reg);
    } catch {
      /* ignore */
    }
  }

  return { ok: true, registro: reg };
}

/**
 * Lista el historial de registros de honorarios pagados o por pagar
 */
export async function listarRegistrosHonorarios(grupoId?: string | null): Promise<RegistroHonorario[]> {
  if (!supabase) {
    if (grupoId) {
      return REGISTROS_MEMORIA.filter((r) => !r.grupo_id || r.grupo_id === grupoId);
    }
    return [...REGISTROS_MEMORIA];
  }

  try {
    let q = supabase
      .from("registros_honorarios_pagos")
      .select("*")
      .order("fecha_registro", { ascending: false });

    if (grupoId) {
      q = q.or(`grupo_id.eq.${grupoId},grupo_id.is.null`);
    }

    const { data, error } = await q;
    if (error || !data || data.length === 0) {
      if (grupoId) {
        return REGISTROS_MEMORIA.filter((r) => !r.grupo_id || r.grupo_id === grupoId);
      }
      return [...REGISTROS_MEMORIA];
    }
    return data as RegistroHonorario[];
  } catch {
    return [...REGISTROS_MEMORIA];
  }
}
