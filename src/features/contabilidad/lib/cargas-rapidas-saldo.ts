"use client";

import { supabase } from "@/core/supabase";
import { limpiarCacheClientes } from "@/features/clientes/lib/clientes";
import { limpiarCacheClientesVenta, grupoDeVentaVigente, registrarAuditoria } from "@/features/grupos/lib/grupos";
import { usuarioVigente, grupoActivoVigente, grupoVigente } from "@/features/seguridad/lib/vigente";
import { round2 } from "@/features/contabilidad/lib/contabilidad";

export type ModalidadCargaRapida =
  | "COLOCAR_AVAL"
  | "SUMAR_AVAL"
  | "COLOCAR_POZO"
  | "SUMAR_POZO";

export type EstadoSoporteCarga =
  | "PENDIENTE_SOPORTE"
  | "SOPORTE_ANEXADO"
  | "VERIFICADO_ADMIN";

export interface CargaRapidaRegistro {
  id: string;
  cliente_id: string;
  cliente_nombre: string;
  grupo_id: string | null;
  modalidad: ModalidadCargaRapida;
  monto: number;
  valor_anterior: number;
  valor_nuevo: number;
  campo_modificado: "aval" | "saldo_actual";
  operador: string;
  fecha_creacion: string;
  nota: string;
  estado_soporte: EstadoSoporteCarga;
  comprobante_imagen?: string | null;
  banco_nombre?: string | null;
  referencia?: string | null;
  fecha_soporte?: string | null;
  anexado_por?: string | null;
  verificado_por?: string | null;
  fecha_verificacion?: string | null;
  notificacion_id?: string | number | null;
  deposito_id?: number | null;
}

const STORAGE_KEY_CARGAS = "hipico_cargas_rapidas_saldo_v1";

export const ETIQUETAS_MODALIDAD: Record<
  ModalidadCargaRapida,
  { titulo: string; desc: string; emoji: string; color: string; campo: "aval" | "saldo_actual" }
> = {
  COLOCAR_AVAL: {
    titulo: "Colocar Aval",
    desc: "Fija el límite o aval del cliente al monto especificado.",
    emoji: "🛡️",
    color: "from-amber-500 to-amber-600",
    campo: "aval",
  },
  SUMAR_AVAL: {
    titulo: "Sumar más al Aval",
    desc: "Incrementa el monto de aval actual del cliente.",
    emoji: "➕🛡️",
    color: "from-amber-600 to-amber-700",
    campo: "aval",
  },
  COLOCAR_POZO: {
    titulo: "Colocar Pozo / Saldo",
    desc: "Fija el saldo disponible directo del jugador.",
    emoji: "💰",
    color: "from-emerald-500 to-emerald-600",
    campo: "saldo_actual",
  },
  SUMAR_POZO: {
    titulo: "Sumar Pozo / Saldo",
    desc: "Adiciona saldo disponible inmediato al pozo del jugador.",
    emoji: "➕💰",
    color: "from-emerald-600 to-emerald-700",
    campo: "saldo_actual",
  },
};

function leerLocales(): CargaRapidaRegistro[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_CARGAS);
    if (!raw) return [];
    const p = JSON.parse(raw);
    return Array.isArray(p) ? (p as CargaRapidaRegistro[]) : [];
  } catch {
    return [];
  }
}

function guardarLocales(lista: CargaRapidaRegistro[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY_CARGAS, JSON.stringify(lista.slice(0, 150)));
    window.dispatchEvent(new CustomEvent("hipico:cargas-rapidas-actualizadas"));
    window.dispatchEvent(new CustomEvent("hipico:saldos-actualizados"));
  } catch {
    /* ignore */
  }
}

/**
 * Realiza la Carga Rápida de Saldo o Aval inmediatamente:
 * - NO exige comprobante en el momento.
 * - Actualiza de inmediato el aval o saldo del cliente.
 * - Registra la operación como tarea pendiente de soporte para el operador / verificación para la administración.
 */
export async function realizarCargaRapidaSaldoYAval(params: {
  cliente_id: string;
  cliente_nombre: string;
  modalidad: ModalidadCargaRapida;
  monto: number;
  nota?: string;
  comprobante_imagen?: string | null;
  banco_nombre?: string | null;
  referencia?: string | null;
}): Promise<{
  ok: boolean;
  error?: string;
  valor_anterior?: number;
  valor_nuevo?: number;
  registro?: CargaRapidaRegistro;
}> {
  const clienteId = String(params.cliente_id ?? "").trim();
  const clienteNombre = String(params.cliente_nombre ?? "").trim();
  const monto = round2(Number(params.monto) || 0);

  if (!clienteId || !clienteNombre) {
    return { ok: false, error: "Seleccione un cliente válido." };
  }
  if (!(monto > 0)) {
    return { ok: false, error: "El monto debe ser un valor numérico mayor a 0." };
  }

  const operador = usuarioVigente() || "operador";
  const grupoEfectivo =
    grupoDeVentaVigente() || grupoActivoVigente() || grupoVigente() || null;
  const config = ETIQUETAS_MODALIDAD[params.modalidad];

  try {
    if (!supabase) {
      return { ok: false, error: "Sin conexión a Supabase." };
    }

    // 1. Consultar estado actual del cliente
    const { data: cliData, error: cliErr } = await supabase
      .from("clientes")
      .select("id, nombre, saldo_actual, aval, grupo_id")
      .eq("id", clienteId)
      .maybeSingle();

    if (cliErr || !cliData) {
      return {
        ok: false,
        error: cliErr?.message || "No se pudo consultar la información del cliente.",
      };
    }

    const saldoActual = round2(Number((cliData as { saldo_actual?: unknown }).saldo_actual ?? 0));
    const avalActual = round2(Number((cliData as { aval?: unknown }).aval ?? 0));

    let valorAnterior = 0;
    let valorNuevo = 0;
    const campo = config.campo;
    const objetoUpdate: Record<string, number> = {};

    if (params.modalidad === "COLOCAR_AVAL") {
      valorAnterior = avalActual;
      valorNuevo = monto;
      objetoUpdate.aval = valorNuevo;
    } else if (params.modalidad === "SUMAR_AVAL") {
      valorAnterior = avalActual;
      valorNuevo = round2(avalActual + monto);
      objetoUpdate.aval = valorNuevo;
    } else if (params.modalidad === "COLOCAR_POZO") {
      valorAnterior = saldoActual;
      valorNuevo = monto;
      objetoUpdate.saldo_actual = valorNuevo;
    } else if (params.modalidad === "SUMAR_POZO") {
      valorAnterior = saldoActual;
      valorNuevo = round2(saldoActual + monto);
      objetoUpdate.saldo_actual = valorNuevo;
    }

    // 2. Actualizar el cliente de inmediato en la base de datos
    const { error: updErr } = await supabase
      .from("clientes")
      .update(objetoUpdate)
      .eq("id", clienteId);

    if (updErr) {
      return { ok: false, error: `Error al actualizar saldo/aval: ${updErr.message}` };
    }

    const ahoraIso = new Date().toISOString();
    const hoyStr = ahoraIso.slice(0, 10);
    const tieneCapture = Boolean(params.comprobante_imagen?.trim());
    const estadoSoporte: EstadoSoporteCarga = tieneCapture
      ? "SOPORTE_ANEXADO"
      : "PENDIENTE_SOPORTE";

    let depositoId: number | null = null;
    // Si incrementa el pozo, registrar asiento preliminar en depositos para control contable
    if (campo === "saldo_actual") {
      const deltaMonto = params.modalidad === "SUMAR_POZO" ? monto : Math.max(0, valorNuevo - valorAnterior);
      if (deltaMonto > 0) {
        try {
          const { data: depData } = await supabase
            .from("depositos")
            .insert({
              fecha: hoyStr,
              cliente_id: clienteId,
              cliente_nombre: clienteNombre,
              tipo_operacion: "Carga Rápida Pozo",
              monto: deltaMonto,
              monto_usd: deltaMonto,
              moneda: "USD",
              tasa_cambio: 1,
              modalidad: config.titulo,
              banco_id: null,
              banco_nombre: params.banco_nombre || "PENDIENTE POR ANEXAR",
              referencia: params.referencia || "PENDIENTE",
              nota: `⚡ ${config.titulo}: $${valorAnterior.toFixed(2)} → $${valorNuevo.toFixed(2)} (${params.nota || "Sin comprobante inicial"}). Operador: ${operador}`,
            })
            .select("id")
            .maybeSingle();
          if (depData && (depData as { id?: unknown }).id != null) {
            depositoId = Number((depData as { id?: unknown }).id);
          }
        } catch {
          /* best effort */
        }
      }
    }

    const idCarga = `carga-rapida-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const nuevoRegistro: CargaRapidaRegistro = {
      id: idCarga,
      cliente_id: clienteId,
      cliente_nombre: clienteNombre,
      grupo_id: grupoEfectivo || (cliData as { grupo_id?: string | null }).grupo_id || null,
      modalidad: params.modalidad,
      monto,
      valor_anterior: valorAnterior,
      valor_nuevo: valorNuevo,
      campo_modificado: campo,
      operador,
      fecha_creacion: ahoraIso,
      nota: params.nota?.trim() || "Carga rápida efectuada sin comprobante inicial",
      estado_soporte: estadoSoporte,
      comprobante_imagen: params.comprobante_imagen || null,
      banco_nombre: params.banco_nombre || null,
      referencia: params.referencia || null,
      fecha_soporte: tieneCapture ? ahoraIso : null,
      anexado_por: tieneCapture ? operador : null,
      deposito_id: depositoId,
    };

    // 3. Registrar notificación / tarea pendiente en Supabase
    try {
      const { data: notifData } = await supabase
        .from("notificaciones")
        .insert({
          tipo: "CARGA_RAPIDA_SALDO_PENDIENTE",
          titulo: `⚡ ${config.titulo} ($${monto.toFixed(2)}) · ${clienteNombre}`,
          mensaje: `Se realizó ${config.titulo.toLowerCase()} por $${monto.toFixed(2)}. ${
            tieneCapture ? "Soporte preliminar anexado." : "Pendiente por anexar comprobante o verificar por administración."
          }`,
          cliente_id: clienteId,
          cliente_nombre: clienteNombre,
          datos: nuevoRegistro,
          estado: estadoSoporte === "PENDIENTE_SOPORTE" ? "Pendiente" : "Procesada",
        })
        .select("id")
        .maybeSingle();
      if (notifData && (notifData as { id?: unknown }).id != null) {
        nuevoRegistro.notificacion_id = (notifData as { id?: string | number }).id;
      }
    } catch {
      /* continúa con persistencia local */
    }

    // 4. Guardar en memoria local y auditoría
    const locales = leerLocales();
    guardarLocales([nuevoRegistro, ...locales]);

    void registrarAuditoria(
      "CARGA_RAPIDA_SALDO",
      params.modalidad,
      `Operador ${operador} aplicó ${config.titulo} por $${monto.toFixed(2)} a ${clienteNombre}. ${campo.toUpperCase()}: $${valorAnterior.toFixed(2)} → $${valorNuevo.toFixed(2)}. ${
        estadoSoporte === "PENDIENTE_SOPORTE" ? "Pendiente de comprobante/soporte." : "Con soporte."
      }`
    );

    limpiarCacheClientes();
    try {
      limpiarCacheClientesVenta();
    } catch {
      /* ignore */
    }

    return {
      ok: true,
      valor_anterior: valorAnterior,
      valor_nuevo: valorNuevo,
      registro: nuevoRegistro,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Error inesperado al ejecutar carga rápida.";
    return { ok: false, error: msg };
  }
}

/**
 * Anexa o actualiza el comprobante de soporte (Voucher / Foto / Referencia) a una carga rápida pendiente.
 */
export async function anexarSoporteCargaRapida(params: {
  id: string;
  comprobante_imagen: string;
  banco_nombre?: string;
  referencia?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const operador = usuarioVigente() || "operador";
  const ahoraIso = new Date().toISOString();
  const locales = leerLocales();
  const idx = locales.findIndex((c) => c.id === params.id);

  if (idx < 0) {
    return { ok: false, error: "Registro no encontrado." };
  }

  const reg = { ...locales[idx] };
  reg.comprobante_imagen = params.comprobante_imagen;
  reg.banco_nombre = params.banco_nombre || reg.banco_nombre || "Banco no especificado";
  reg.referencia = params.referencia || reg.referencia || "Sin referencia";
  reg.fecha_soporte = ahoraIso;
  reg.anexado_por = operador;
  if (reg.estado_soporte === "PENDIENTE_SOPORTE") {
    reg.estado_soporte = "SOPORTE_ANEXADO";
  }

  locales[idx] = reg;
  guardarLocales(locales);

  // Sincronizar con Supabase si tenía notificación asociada
  if (supabase && reg.notificacion_id) {
    try {
      await supabase
        .from("notificaciones")
        .update({
          datos: reg,
          estado: "Soporte_Anexado",
        })
        .eq("id", reg.notificacion_id);
    } catch {
      /* ignore */
    }
  }

  void registrarAuditoria(
    "CARGA_RAPIDA_SOPORTE",
    "ANEXAR_SOPORTE",
    `Operador ${operador} anexó comprobante/soporte a carga rápida ${reg.id} (${reg.cliente_nombre}). Ref: ${reg.referencia}`
  );

  return { ok: true };
}

/**
 * La Administración verifica y concilia el incremento de saldo / aval.
 */
export async function verificarCargaRapidaAdmin(id: string): Promise<{ ok: boolean; error?: string }> {
  const adminUsuario = usuarioVigente() || "admin";
  const ahoraIso = new Date().toISOString();
  const locales = leerLocales();
  const idx = locales.findIndex((c) => c.id === id);

  if (idx < 0) {
    return { ok: false, error: "Registro no encontrado." };
  }

  const reg = { ...locales[idx] };
  reg.estado_soporte = "VERIFICADO_ADMIN";
  reg.verificado_por = adminUsuario;
  reg.fecha_verificacion = ahoraIso;

  locales[idx] = reg;
  guardarLocales(locales);

  if (supabase && reg.notificacion_id) {
    try {
      await supabase
        .from("notificaciones")
        .update({
          datos: reg,
          estado: "Verificado",
        })
        .eq("id", reg.notificacion_id);
    } catch {
      /* ignore */
    }
  }

  void registrarAuditoria(
    "CARGA_RAPIDA_AUDITORIA",
    "VERIFICADO_ADMIN",
    `Administrador ${adminUsuario} verificó y concilió la carga rápida ${reg.id} de ${reg.cliente_nombre} ($${reg.monto.toFixed(2)})`
  );

  return { ok: true };
}

/**
 * Lista todas las cargas rápidas registradas, combinando datos locales y de Supabase.
 */
export async function listarCargasRapidas(): Promise<CargaRapidaRegistro[]> {
  const locales = leerLocales();
  const map = new Map<string, CargaRapidaRegistro>();
  for (const c of locales) {
    map.set(c.id, c);
  }

  if (supabase) {
    try {
      const { data } = await supabase
        .from("notificaciones")
        .select("id, created_at, datos, estado")
        .eq("tipo", "CARGA_RAPIDA_SALDO_PENDIENTE")
        .order("created_at", { ascending: false })
        .limit(60);

      for (const row of (data ?? []) as Array<Record<string, unknown>>) {
        const d = (row.datos ?? {}) as Partial<CargaRapidaRegistro>;
        if (d && d.id) {
          const id = String(d.id);
          const previo = map.get(id);
          if (!previo || previo.estado_soporte !== "VERIFICADO_ADMIN") {
            map.set(id, {
              id,
              cliente_id: String(d.cliente_id || ""),
              cliente_nombre: String(d.cliente_nombre || "Cliente"),
              grupo_id: d.grupo_id || null,
              modalidad: (d.modalidad as ModalidadCargaRapida) || "SUMAR_POZO",
              monto: Number(d.monto || 0),
              valor_anterior: Number(d.valor_anterior || 0),
              valor_nuevo: Number(d.valor_nuevo || 0),
              campo_modificado: d.campo_modificado || "saldo_actual",
              operador: String(d.operador || "operador"),
              fecha_creacion: String(d.fecha_creacion || row.created_at || new Date().toISOString()),
              nota: String(d.nota || ""),
              estado_soporte: (d.estado_soporte as EstadoSoporteCarga) || "PENDIENTE_SOPORTE",
              comprobante_imagen: d.comprobante_imagen || null,
              banco_nombre: d.banco_nombre || null,
              referencia: d.referencia || null,
              fecha_soporte: d.fecha_soporte || null,
              anexado_por: d.anexado_por || null,
              verificado_por: d.verificado_por || null,
              fecha_verificacion: d.fecha_verificacion || null,
              notificacion_id: row.id as string | number,
            });
          }
        }
      }
    } catch {
      /* ignore */
    }
  }

  return Array.from(map.values()).sort(
    (a, b) => new Date(b.fecha_creacion).getTime() - new Date(a.fecha_creacion).getTime()
  );
}

/**
 * Cuenta cuántas tareas de soporte o verificación están pendientes.
 */
export async function contarTareasPendientes(): Promise<number> {
  const lista = await listarCargasRapidas();
  return lista.filter((c) => c.estado_soporte !== "VERIFICADO_ADMIN").length;
}
