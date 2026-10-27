"use client";

import { supabase } from "@/core/supabase";
import { limpiarCacheClientes } from "@/features/clientes/lib/clientes";
import { limpiarCacheClientesVenta, grupoDeVentaVigente, registrarAuditoria } from "@/features/grupos/lib/grupos";
import { usuarioVigente, grupoActivoVigente, grupoVigente } from "@/features/seguridad/lib/vigente";
import { round2 } from "@/features/contabilidad/lib/contabilidad";

export type TipoMovimientoOperador = "INGRESO" | "EGRESO";

export type MovimientoOperadorPendiente = {
  id: string;
  notificacion_id?: string | number | null;
  deposito_id?: number | null;
  transaccion_id?: number | null;
  grupo_id: string | null;
  cliente_id: string;
  cliente_nombre: string;
  tipo: TipoMovimientoOperador;
  monto: number;
  saldo_anterior: number;
  saldo_nuevo: number;
  concepto: string;
  comprobante_imagen: string;
  fecha_creacion: string;
  operador: string;
  estado: "PENDIENTE" | "COMPLETADO";
  banco_id?: string | null;
  banco_nombre?: string | null;
  referencia?: string | null;
  fecha_movimiento?: string | null;
  modalidad?: string | null;
  nota?: string | null;
  completado_por?: string | null;
  completado_at?: string | null;
};

const STORAGE_KEY = "hipico_movimientos_operador_pendientes_v1";
export const CONCEPTO_RESUMEN_DUENO = "Por instrucciones del Dueño del grupo (Resumen)";

function leerLocalPendientes(): MovimientoOperadorPendiente[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as MovimientoOperadorPendiente[]) : [];
  } catch {
    return [];
  }
}

function guardarLocalPendientes(lista: MovimientoOperadorPendiente[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(lista.slice(0, 100)));
    window.dispatchEvent(new CustomEvent("hipico:movimientos-operador-actualizados"));
  } catch {
    /* ignore quota errors */
  }
}

/**
 * Registra desde la Vista de Operador un incremento (+ Ingreso) o disminución (- Egreso)
 * rápido de saldo de cliente adjuntando únicamente el capture de pantalla del comprobante.
 *
 * Contablemente:
 *  - Ajusta el saldo del cliente de inmediato (+monto o -monto).
 *  - Se imputa como Ingreso o Egreso "Por instrucciones del Dueño del grupo (Resumen)".
 *  - Se reporta al administrador del grupo como PENDIENTE por registrar el resto de la
 *    información (banco, referencia, día y demás información de movimientos).
 */
export async function registrarMovimientoSaldoOperador(params: {
  cliente_id: string;
  cliente_nombre: string;
  grupo_id?: string | null;
  tipo: TipoMovimientoOperador;
  monto: number;
  comprobante_imagen: string;
}): Promise<{
  ok: boolean;
  error?: string;
  saldo_anterior?: number;
  saldo_nuevo?: number;
  movimiento?: MovimientoOperadorPendiente;
}> {
  const clienteId = String(params.cliente_id ?? "").trim();
  const clienteNombre = String(params.cliente_nombre ?? "").trim();
  const monto = round2(Number(params.monto) || 0);
  const imagen = String(params.comprobante_imagen ?? "").trim();

  if (!clienteId || !clienteNombre) {
    return { ok: false, error: "Debe seleccionar un cliente válido." };
  }
  if (!(monto > 0)) {
    return { ok: false, error: "El monto debe ser mayor a $0." };
  }
  if (!imagen) {
    return { ok: false, error: "Es obligatorio anexar el capture de pantalla (imagen) del comprobante." };
  }
  if (!supabase) {
    return { ok: false, error: "Sin conexión a Supabase." };
  }

  const operador = usuarioVigente() || "operador";
  const grupoEfectivo =
    params.grupo_id ||
    grupoDeVentaVigente() ||
    grupoActivoVigente() ||
    grupoVigente() ||
    null;

  try {
    // 1. Leer saldo actual del cliente
    const { data: cliData, error: cliErr } = await supabase
      .from("clientes")
      .select("id, nombre, saldo_actual, grupo_id")
      .eq("id", clienteId)
      .maybeSingle();

    if (cliErr || !cliData) {
      return {
        ok: false,
        error: cliErr?.message || "No se pudo consultar el saldo actual del cliente.",
      };
    }

    const saldoAnterior = round2(Number((cliData as { saldo_actual?: unknown }).saldo_actual ?? 0));
    const delta = params.tipo === "INGRESO" ? monto : -monto;
    const saldoNuevo = round2(saldoAnterior + delta);
    const grupoCliente =
      grupoEfectivo ||
      ((cliData as { grupo_id?: unknown }).grupo_id ? String((cliData as { grupo_id?: unknown }).grupo_id) : null);

    // 2. Actualizar el saldo del cliente en la tabla `clientes`
    const { error: updErr } = await supabase
      .from("clientes")
      .update({ saldo_actual: saldoNuevo })
      .eq("id", clienteId);

    if (updErr) {
      return { ok: false, error: `No se pudo actualizar el saldo del cliente: ${updErr.message}` };
    }

    const ahoraIso = new Date().toISOString();
    const hoyStr = ahoraIso.slice(0, 10);
    const notaResumen = `${
      params.tipo === "INGRESO" ? "Ingreso" : "Egreso"
    } ${CONCEPTO_RESUMEN_DUENO} · Pendiente por completar banco, referencia, día y demás datos (Operador: ${operador})`;

    let depositoId: number | null = null;
    let transaccionId: number | null = null;

    // 3. Registrar asiento contable preliminar en `depositos` (Ingreso) o `transacciones_financieras` (Egreso)
    if (params.tipo === "INGRESO") {
      try {
        const { data: depIns } = await supabase
          .from("depositos")
          .insert({
            fecha: hoyStr,
            cliente_id: clienteId,
            cliente_nombre: clienteNombre,
            tipo_operacion: "Normal",
            monto,
            monto_usd: monto,
            moneda: "USD",
            tasa_cambio: 1,
            modalidad: CONCEPTO_RESUMEN_DUENO,
            banco_id: null,
            banco_nombre: "PENDIENTE POR REGISTRAR",
            referencia: "PENDIENTE",
            nota: notaResumen,
          })
          .select("id")
          .maybeSingle();
        if (depIns && (depIns as { id?: unknown }).id != null) {
          depositoId = Number((depIns as { id?: unknown }).id);
        }
      } catch {
        /* best effort si RLS restringe depositos directo */
      }
    } else {
      try {
        const { data: txIns } = await supabase
          .from("transacciones_financieras")
          .insert({
            fecha: hoyStr,
            tipo_operacion: "RETIRO",
            cliente_origen_id: clienteId,
            cliente_origen_nombre: clienteNombre,
            monto,
            monto_usd: monto,
            tasa_cambio: 1,
            moneda: "USD",
            modalidad: CONCEPTO_RESUMEN_DUENO,
            banco_id: null,
            banco_nombre: "PENDIENTE POR REGISTRAR",
            referencia: "PENDIENTE",
            nota: notaResumen,
          })
          .select("id")
          .maybeSingle();
        if (txIns && (txIns as { id?: unknown }).id != null) {
          transaccionId = Number((txIns as { id?: unknown }).id);
        }
      } catch {
        /* best effort */
      }
    }

    const movId = `op-mov-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const movimiento: MovimientoOperadorPendiente = {
      id: movId,
      deposito_id: depositoId,
      transaccion_id: transaccionId,
      grupo_id: grupoCliente,
      cliente_id: clienteId,
      cliente_nombre: clienteNombre,
      tipo: params.tipo,
      monto,
      saldo_anterior: saldoAnterior,
      saldo_nuevo: saldoNuevo,
      concepto: CONCEPTO_RESUMEN_DUENO,
      comprobante_imagen: imagen,
      fecha_creacion: ahoraIso,
      operador,
      estado: "PENDIENTE",
    };

    // 4. Reportar al Administrador del Grupo en `notificaciones` (con el capture adjunto)
    try {
      const { data: notifIns } = await supabase
        .from("notificaciones")
        .insert({
          tipo: "MOVIMIENTO_OPERADOR_PENDIENTE",
          titulo: `${params.tipo === "INGRESO" ? "➕ Ingreso" : "➖ Egreso"} Rápido ($${monto.toFixed(2)}) · ${clienteNombre}`,
          mensaje: `${CONCEPTO_RESUMEN_DUENO}. Pendiente por registrar banco, referencia, día y demás información de movimientos.`,
          cliente_id: clienteId,
          cliente_nombre: clienteNombre,
          datos: movimiento,
          estado: "Pendiente",
        })
        .select("id")
        .maybeSingle();
      if (notifIns && (notifIns as { id?: unknown }).id != null) {
        movimiento.notificacion_id = (notifIns as { id?: string | number }).id;
      }
    } catch {
      /* continúa con respaldo local + auditoría */
    }

    // 5. Persistir en respaldo local y registrar auditoría
    const actuales = leerLocalPendientes();
    guardarLocalPendientes([movimiento, ...actuales]);

    void registrarAuditoria(
      "CONTABILIDAD_OPERADOR",
      params.tipo === "INGRESO" ? "INCREMENTO_RAPIDO_SALDO" : "DISMINUCION_RAPIDA_SALDO",
      `${params.tipo} rápido de $${monto.toFixed(2)} a ${clienteNombre} (${CONCEPTO_RESUMEN_DUENO}). Saldo: $${saldoAnterior.toFixed(2)} → $${saldoNuevo.toFixed(2)}. Pendiente por completar datos bancarios.`
    );

    limpiarCacheClientes();
    try {
      limpiarCacheClientesVenta();
    } catch {
      /* ignore */
    }

    return {
      ok: true,
      saldo_anterior: saldoAnterior,
      saldo_nuevo: saldoNuevo,
      movimiento,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Error inesperado al ajustar el saldo.",
    };
  }
}

/**
 * Lista los movimientos rápidos de operador pendientes por completar datos
 * (banco, referencia, día, modalidad) para el administrador del grupo.
 */
export async function listarMovimientosOperadorPendientes(
  grupoIdFiltro?: string | null
): Promise<MovimientoOperadorPendiente[]> {
  const grupoActivo = grupoIdFiltro !== undefined ? grupoIdFiltro : (grupoActivoVigente() || grupoVigente() || null);
  const locales = leerLocalPendientes();
  const porId = new Map<string, MovimientoOperadorPendiente>();

  for (const m of locales) {
    if (m && m.id) porId.set(m.id, m);
  }

  if (supabase) {
    try {
      const { data } = await supabase
        .from("notificaciones")
        .select("id, created_at, tipo, cliente_id, cliente_nombre, datos, estado")
        .eq("tipo", "MOVIMIENTO_OPERADOR_PENDIENTE")
        .order("created_at", { ascending: false })
        .limit(80);

      for (const row of (data ?? []) as Array<Record<string, unknown>>) {
        const d = (row.datos ?? {}) as Partial<MovimientoOperadorPendiente>;
        const id = String(d.id ?? `notif-${String(row.id)}`);
        const estNotif = String(row.estado ?? "").toUpperCase();
        const estado: "PENDIENTE" | "COMPLETADO" =
          d.estado === "COMPLETADO" || estNotif === "APLICADA" || estNotif === "COMPLETADO"
            ? "COMPLETADO"
            : "PENDIENTE";
        const item: MovimientoOperadorPendiente = {
          id,
          notificacion_id: row.id as string | number,
          deposito_id: d.deposito_id ?? null,
          transaccion_id: d.transaccion_id ?? null,
          grupo_id: d.grupo_id ?? null,
          cliente_id: String(d.cliente_id ?? row.cliente_id ?? ""),
          cliente_nombre: String(d.cliente_nombre ?? row.cliente_nombre ?? "Cliente"),
          tipo: d.tipo === "EGRESO" ? "EGRESO" : "INGRESO",
          monto: Number(d.monto ?? 0),
          saldo_anterior: Number(d.saldo_anterior ?? 0),
          saldo_nuevo: Number(d.saldo_nuevo ?? 0),
          concepto: d.concepto || CONCEPTO_RESUMEN_DUENO,
          comprobante_imagen: String(d.comprobante_imagen ?? ""),
          fecha_creacion: String(d.fecha_creacion ?? row.created_at ?? new Date().toISOString()),
          operador: String(d.operador ?? "operador"),
          estado,
          banco_id: d.banco_id ?? null,
          banco_nombre: d.banco_nombre ?? null,
          referencia: d.referencia ?? null,
          fecha_movimiento: d.fecha_movimiento ?? null,
          modalidad: d.modalidad ?? null,
          nota: d.nota ?? null,
          completado_por: d.completado_por ?? null,
          completado_at: d.completado_at ?? null,
        };
        const previo = porId.get(id);
        if (!previo || previo.estado !== "COMPLETADO") {
          porId.set(id, item);
        }
      }
    } catch {
      /* usa copia local */
    }
  }

  return [...porId.values()]
    .filter((m) => {
      if (m.estado !== "PENDIENTE") return false;
      if (grupoActivo && m.grupo_id && String(m.grupo_id) !== String(grupoActivo)) return false;
      return true;
    })
    .sort((a, b) => b.fecha_creacion.localeCompare(a.fecha_creacion));
}

/**
 * Permite al Administrador del Grupo completar la información faltante (banco,
 * referencia, día y demás detalles) de un Ingreso o Egreso cargado por el operador.
 */
export async function completarMovimientoOperadorPendiente(params: {
  movimiento: MovimientoOperadorPendiente;
  banco_id: string;
  banco_nombre: string;
  referencia: string;
  fecha_movimiento: string;
  modalidad: string;
  nota?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const { movimiento } = params;
  const bancoId = String(params.banco_id ?? "").trim();
  const bancoNombre = String(params.banco_nombre ?? "").trim();
  const referencia = String(params.referencia ?? "").trim();
  const fechaMov = String(params.fecha_movimiento ?? "").trim() || new Date().toISOString().slice(0, 10);
  const modalidad = String(params.modalidad ?? "").trim() || CONCEPTO_RESUMEN_DUENO;
  const admin = usuarioVigente() || "admin";

  if (!bancoId && !bancoNombre) {
    return { ok: false, error: "Seleccione el banco del movimiento." };
  }
  if (!referencia) {
    return { ok: false, error: "Indique el número de referencia del comprobante." };
  }

  const notaFinal = [
    CONCEPTO_RESUMEN_DUENO,
    params.nota?.trim() || "",
    `Completado por ${admin} (Ref: ${referencia})`,
  ]
    .filter(Boolean)
    .join(" · ");

  if (supabase) {
    try {
      if (movimiento.tipo === "INGRESO") {
        if (movimiento.deposito_id) {
          await supabase
            .from("depositos")
            .update({
              fecha: fechaMov,
              banco_id: bancoId || null,
              banco_nombre: bancoNombre || null,
              referencia,
              modalidad,
              nota: notaFinal,
            })
            .eq("id", movimiento.deposito_id);
        } else {
          await supabase.from("depositos").insert({
            fecha: fechaMov,
            cliente_id: movimiento.cliente_id,
            cliente_nombre: movimiento.cliente_nombre,
            tipo_operacion: "Normal",
            monto: movimiento.monto,
            monto_usd: movimiento.monto,
            moneda: "USD",
            tasa_cambio: 1,
            modalidad,
            banco_id: bancoId || null,
            banco_nombre: bancoNombre || null,
            referencia,
            nota: notaFinal,
          });
        }
        // Actualizar saldo del banco receptor (+monto)
        if (bancoId) {
          const { data: bRow } = await supabase
            .from("bancos")
            .select("saldo_local")
            .eq("id", bancoId)
            .maybeSingle();
          if (bRow) {
            const actual = Number((bRow as { saldo_local?: unknown }).saldo_local ?? 0);
            await supabase
              .from("bancos")
              .update({ saldo_local: round2(actual + movimiento.monto) })
              .eq("id", bancoId);
          }
        }
      } else {
        if (movimiento.transaccion_id) {
          await supabase
            .from("transacciones_financieras")
            .update({
              fecha: fechaMov,
              banco_id: bancoId || null,
              banco_nombre: bancoNombre || null,
              referencia,
              modalidad,
              nota: notaFinal,
            })
            .eq("id", movimiento.transaccion_id);
        } else {
          await supabase.from("transacciones_financieras").insert({
            fecha: fechaMov,
            tipo_operacion: "RETIRO",
            cliente_origen_id: movimiento.cliente_id,
            cliente_origen_nombre: movimiento.cliente_nombre,
            monto: movimiento.monto,
            monto_usd: movimiento.monto,
            tasa_cambio: 1,
            moneda: "USD",
            modalidad,
            banco_id: bancoId || null,
            banco_nombre: bancoNombre || null,
            referencia,
            nota: notaFinal,
          });
        }
        // Actualizar saldo del banco emisor (-monto)
        if (bancoId) {
          const { data: bRow } = await supabase
            .from("bancos")
            .select("saldo_local")
            .eq("id", bancoId)
            .maybeSingle();
          if (bRow) {
            const actual = Number((bRow as { saldo_local?: unknown }).saldo_local ?? 0);
            await supabase
              .from("bancos")
              .update({ saldo_local: round2(actual - movimiento.monto) })
              .eq("id", bancoId);
          }
        }
      }

      const actualizado: MovimientoOperadorPendiente = {
        ...movimiento,
        estado: "COMPLETADO",
        banco_id: bancoId || null,
        banco_nombre: bancoNombre || null,
        referencia,
        fecha_movimiento: fechaMov,
        modalidad,
        nota: notaFinal,
        completado_por: admin,
        completado_at: new Date().toISOString(),
      };

      if (movimiento.notificacion_id != null) {
        await supabase
          .from("notificaciones")
          .update({
            estado: "Aplicada",
            atendida_por: admin,
            atendida_at: new Date().toISOString(),
            datos: actualizado,
          })
          .eq("id", movimiento.notificacion_id);
      }
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : "No se pudo completar el movimiento en la base de datos.",
      };
    }
  }

  const locales = leerLocalPendientes().map((m) =>
    m.id === movimiento.id
      ? {
          ...m,
          estado: "COMPLETADO" as const,
          banco_id: bancoId || null,
          banco_nombre: bancoNombre || null,
          referencia,
          fecha_movimiento: fechaMov,
          modalidad,
          nota: notaFinal,
          completado_por: admin,
          completado_at: new Date().toISOString(),
        }
      : m
  );
  guardarLocalPendientes(locales);

  void registrarAuditoria(
    "CONTABILIDAD_ADMIN",
    "COMPLETAR_MOVIMIENTO_OPERADOR",
    `Completado ${movimiento.tipo} de $${movimiento.monto.toFixed(2)} de ${movimiento.cliente_nombre} · Banco: ${bancoNombre} · Ref: ${referencia} · Fecha: ${fechaMov}`
  );

  return { ok: true };
}
