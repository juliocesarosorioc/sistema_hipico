/**
 * Venta individual de Taquilla ("BetSlip" / Gestión de Jugadas).
 *
 * Hasta ahora la Taquilla vivía SOLO en memoria (zustand/localStorage): el
 * operador cargaba jugadas, pagaba la carrera y la liquidación leía tickets que
 * nadie había escrito. Esta capa llama a `club_vender_jugada`
 * (sql/sql/taquilla_venta.sql), que crea el ticket real y descuenta el saldo en
 * UNA transacción, y a `club_anular_jugada`, que lo devuelve.
 *
 * Patrón espejo de `@/lib/marcas.ts`: RPC directa, sin writes sueltos desde el
 * navegador. La RPC revalida tope saldo+aval, pertenencia al grupo, cliente
 * activo e idempotencia por clave.
 */
import { supabase } from "@/lib/supabase";

const MENSAJE_SIN_RPC =
  "La venta de Taquilla no está activa: ejecutá sql/taquilla_venta.sql en el SQL Editor de Supabase.";

export type VentaJugada = {
  hipodromo: string;
  /** Fecha de la carrera (YYYY-MM-DD). */
  fecha: string;
  carrera: number;
  /** Nomenclatura limpia de la jugada, ej. "2N", "1P", "PP", "W", "2x3 10/8". */
  jugada: string;
  /** Caballo / conjunto de ejemplares, ej. "1", "1-2". */
  caballo: string;
  monto: number;
  /** Cliente que juega (UUID del catálogo). Obligatorio: es a quien se le cobra. */
  clienteId: string;
  /** Grupo de cobro. Si se omite, la RPC usa el grupo principal del cliente. */
  grupoId?: string | null;
  /** Nombre del cliente que "da" (dador), solo informativo. */
  clienteDador?: string | null;
  moneda?: string | null;
  /** Comisión del grupo / de la jugada, en porcentaje. */
  comision?: number | null;
  /**
   * Modalidad para el banquero (clave de `banquero_convenio`): 'WPS' para las
   * americanas W/P/S. Se guarda aparte de `origen` ('TAQUILLA') para que el
   * trigger de banquero del grupo se congele igual que en las otras modalidades.
   */
  modalidad?: string | null;
  usuario?: string | null;
  /** Clave de idempotencia: reintentar con la misma no vuelve a descontar. */
  idempotencia?: string | null;
};

export type ResultadoVentaJugada = {
  ok: boolean;
  ticketId?: number;
  saldoRestante?: number;
  yaExistia?: boolean;
  error?: string;
};

/** Caballo "1" → 1; un pareo "1-2" o "12 13 x 14 15" → null. */
export function numeroDeCaballo(caballo: string): number | null {
  const t = String(caballo ?? "").trim();
  if (!/^[0-9]+$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * Clave de idempotencia de una venta. Se genera UNA vez por jugada y se
 * reutiliza en los reintentos: si la red corta y el cliente repite, la RPC
 * reconoce la clave y devuelve el ticket ya creado en vez de descontar dos
 * veces. El respaldo existe porque `crypto.randomUUID` no está fuera de un
 * contexto seguro (http:// en un IP viejo).
 */
export function claveIdempotenciaJugada(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `taquilla-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Emite el ticket y descuenta el saldo (todo o nada). */
export async function venderJugada(v: VentaJugada): Promise<ResultadoVentaJugada> {
  if (!supabase) return { ok: false, error: "Sin credenciales Supabase (.env.local)." };
  const { data, error } = await supabase.rpc("club_vender_jugada", {
    p_hipodromo: String(v.hipodromo ?? "").trim().toUpperCase(),
    p_fecha: v.fecha,
    p_carrera: Number(v.carrera) || 0,
    p_jugada: String(v.jugada ?? "").trim(),
    p_caballo: String(v.caballo ?? "").trim(),
    p_monto: Number(v.monto) || 0,
    p_cliente_id: v.clienteId,
    p_grupo_id: v.grupoId || null,
    p_cliente_dador: v.clienteDador ?? null,
    p_moneda: v.moneda ?? null,
    p_comision: v.comision ?? null,
    p_modalidad: v.modalidad ?? null,
    p_usuario: v.usuario ?? null,
    p_idem: v.idempotencia ?? null,
  });
  if (error) {
    const texto = error.message ?? String(error);
    return { ok: false, error: /club_vender_jugada|not found|404/i.test(texto) ? MENSAJE_SIN_RPC : texto };
  }
  const r = (data ?? {}) as Record<string, unknown>;
  return {
    ok: true,
    ticketId: r.ticket_id as number | undefined,
    saldoRestante: r.saldo_restante as number | undefined,
    yaExistia: r.ya_existia as boolean | undefined,
  };
}

/** Anula un ticket Pendiente y devuelve el saldo exacto que se descontó. */
export async function anularJugada(
  ticketId: number,
  motivo?: string,
  usuario?: string | null
): Promise<{ ok: boolean; devuelto?: number; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin credenciales Supabase (.env.local)." };
  const { data, error } = await supabase.rpc("club_anular_jugada", {
    p_ticket_id: ticketId,
    p_usuario: usuario ?? null,
    p_motivo: motivo ?? null,
  });
  if (error) {
    const texto = error.message ?? String(error);
    return { ok: false, error: /club_anular_jugada|not found|404/i.test(texto) ? MENSAJE_SIN_RPC : texto };
  }
  const r = (data ?? {}) as Record<string, unknown>;
  return { ok: true, devuelto: r.devuelto as number | undefined };
}
