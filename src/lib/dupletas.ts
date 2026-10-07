import { supabase } from "@/lib/supabase";
import { exigirCapacidad } from "@/lib/seguridad/vigente";

export type CaballoDupleta = {
  numero: string;
  nombre: string;
  nacionalidad?: string | null;
  retirado?: boolean;
};

export type CeldaDupleta = {
  vendida: boolean;
  cliente_id?: string | number | null;
  cliente_nombre?: string;
  /**
   * Grupo del jugador. Se deduce del cliente al vender (grupo_id + la lista
   * `grupos` de clientes_grupos), igual que en Tablas Fijas. Es lo que define
   * la moneda y el convenio de comisión de la venta, asi que se guarda con la
   * celda y no se vuelve a pedir al liquidar.
   */
  grupo_id?: string | number | null;
  grupo_nombre?: string | null;
  precio?: number | null;
  /**
   * Ticket emitido al vender. Es lo que permite editar el jugador (reasignar)
   * o anular la venta sin volver a vender la combinación.
   */
  ticket_id?: number | null;
};

export type DupletaEstado = {
  clave?: string;
  hipodromo: string;
  fecha: string;
  carrera1: number | string;
  carrera2: number | string;
  premio: number;
  precio: number;
  caballos1: CaballoDupleta[];
  caballos2: CaballoDupleta[];
  celdas: Record<string, CeldaDupleta>;
  updatedAt?: string;
};

export function claveDupleta(e: {
  hipodromo: string;
  fecha: string;
  carrera1: number | string;
  carrera2: number | string;
}): string {
  return `${String(e.hipodromo).trim().toUpperCase()}|${e.fecha ?? ""}|${e.carrera1}|${e.carrera2}`;
}

export function claveCelda(n1: string | number, n2: string | number): string {
  return `${n1}|${n2}`;
}

/** Se avisa con un mensaje claro si la RPC no está instalada. */
const MENSAJE_SIN_RPC =
  "Falta la RPC club_vender_dupleta en Supabase. Ejecuta sql/dupleta_venta.sql en el SQL Editor.";

export type VentaDupleta = {
  hipodromo: string;
  fecha: string;
  carrera1: number | string;
  carrera2: number | string;
  numero1: string;
  numero2: string;
  monto: number;
  clienteId: string;
  grupoId: string;
  premio?: number;
  usuario?: string | null;
  idempotencia?: string | null;
};

export type ResultadoVentaDupleta = {
  ok: boolean;
  ticketId?: number;
  saldoRestante?: number;
  error?: string;
};

export async function venderDupleta(v: VentaDupleta): Promise<ResultadoVentaDupleta> {
  if (!supabase) return { ok: false, error: "Sin credenciales Supabase (.env.local)." };
  const { data, error } = await supabase.rpc("club_vender_dupleta", {
    p_hipodromo: String(v.hipodromo ?? "").trim().toUpperCase(),
    p_fecha: v.fecha,
    p_carrera1: Number(v.carrera1) || 0,
    p_carrera2: Number(v.carrera2) || 0,
    p_numero1: String(v.numero1 ?? "").trim(),
    p_numero2: String(v.numero2 ?? "").trim(),
    p_monto: Number(v.monto) || 0,
    p_cliente_id: v.clienteId,
    p_grupo_id: v.grupoId || null,
    p_premio: Number(v.premio) || 0,
    p_usuario: v.usuario ?? null,
    p_idem: v.idempotencia ?? null,
  });
  if (error) {
    const texto = error.message ?? String(error);
    return { ok: false, error: /club_vender_dupleta|not found|404/i.test(texto) ? MENSAJE_SIN_RPC : texto };
  }
  const r = (data ?? {}) as Record<string, unknown>;
  return {
    ok: true,
    ticketId: r.ticket_id as number | undefined,
    saldoRestante: r.saldo_restante as number | undefined,
  };
}

const MENSAJE_SIN_RPC_EDICION =
  "Falta la RPC de edicion de dupleta en Supabase. Ejecuta sql/dupleta_edicion.sql en el SQL Editor.";

/**
 * Reasigna el JUGADOR de una combinacion ya vendida.
 *
 * Una dupleta no se vuelve a vender: se cambia de dueño. La RPC devuelve el
 * monto al jugador anterior, cobra al nuevo y transfiere el ticket dentro de una
 * transaccion. El nuevo cliente debe pertenecer al mismo grupo de la venta.
 */
export async function reasignarJugadorDupleta(v: {
  ticketId: number | string;
  clienteId: string;
  usuario?: string | null;
}): Promise<ResultadoVentaDupleta> {
  if (!supabase) return { ok: false, error: "Sin credenciales Supabase (.env.local)." };
  if (!v.ticketId) return { ok: false, error: "Falta el ticket de la dupleta." };
  try {
    exigirCapacidad("dupleta:fn_armar_dupleta");
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  const { data, error } = await supabase.rpc("club_reasignar_dupleta", {
    p_ticket_id: Number(v.ticketId) || 0,
    p_cliente_id: v.clienteId,
    p_usuario: v.usuario ?? null,
  });
  if (error) {
    const texto = error.message ?? String(error);
    return {
      ok: false,
      error: /club_reasignar_dupleta|not found|404/i.test(texto) ? MENSAJE_SIN_RPC_EDICION : texto,
    };
  }
  const r = (data ?? {}) as Record<string, unknown>;
  return {
    ok: true,
    ticketId: r.ticket_id as number | undefined,
    saldoRestante: r.saldo_restante as number | undefined,
  };
}

/** Anula una combinacion vendida: devuelve el monto y marca el ticket anulado. */
export async function anularDupleta(v: {
  ticketId: number | string;
  usuario?: string | null;
  motivo?: string | null;
}): Promise<ResultadoVentaDupleta> {
  if (!supabase) return { ok: false, error: "Sin credenciales Supabase (.env.local)." };
  if (!v.ticketId) return { ok: false, error: "Falta el ticket de la dupleta." };
  try {
    exigirCapacidad("dupleta:fn_armar_dupleta");
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  const { data, error } = await supabase.rpc("club_anular_dupleta", {
    p_ticket_id: Number(v.ticketId) || 0,
    p_usuario: v.usuario ?? null,
    p_motivo: v.motivo ?? null,
  });
  if (error) {
    const texto = error.message ?? String(error);
    return {
      ok: false,
      error: /club_anular_dupleta|not found|404/i.test(texto) ? MENSAJE_SIN_RPC_EDICION : texto,
    };
  }
  const r = (data ?? {}) as Record<string, unknown>;
  return { ok: true, ticketId: r.ticket_id as number | undefined };
}

export type ResultadoLiquidacionDupleta = {
  ok: boolean;
  liquidados?: number;
  ganadores?: number;
  perdedores?: number;
  anulados?: number;
  pagado?: number;
  error?: string;
};

export async function liquidarDupleta(v: {
  hipodromo: string;
  fecha: string;
  carrera1: number | string;
  carrera2: number | string;
}): Promise<ResultadoLiquidacionDupleta> {
  if (!supabase) return { ok: false, error: "Sin credenciales Supabase (.env.local)." };
  try {
    exigirCapacidad("dupleta:fn_armar_dupleta");
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  const { data, error } = await supabase.rpc("club_liquidar_dupleta", {
    p_hipodromo: String(v.hipodromo ?? "").trim().toUpperCase(),
    p_fecha: v.fecha,
    p_carrera1: Number(v.carrera1) || 0,
    p_carrera2: Number(v.carrera2) || 0,
  });
  if (error) {
    const texto = error.message ?? String(error);
    return {
      ok: false,
      error: /club_liquidar_dupleta|not found|404/i.test(texto)
        ? "Falta la RPC club_liquidar_dupleta en Supabase. Ejecuta sql/dupleta_liquidacion.sql en el SQL Editor."
        : texto,
    };
  }
  const r = (data ?? {}) as Record<string, unknown>;
  return {
    ok: true,
    liquidados: r.liquidados as number | undefined,
    ganadores: r.ganadores as number | undefined,
    perdedores: r.perdedores as number | undefined,
    anulados: r.anulados as number | undefined,
    pagado: r.pagado as number | undefined,
  };
}

export async function guardarDupleta(estado: DupletaEstado): Promise<{ ok: boolean; error?: string }> {
    if (!supabase) return { ok: false, error: "Sin credenciales Supabase (.env.local)." };
    try {
      exigirCapacidad("dupleta:fn_armar_dupleta");
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
    const payload = {
    clave: claveDupleta(estado),
    hipodromo: String(estado.hipodromo).trim().toUpperCase(),
    fecha: estado.fecha || new Date().toISOString().slice(0, 10),
    carrera1: Number(estado.carrera1) || String(estado.carrera1),
    carrera2: Number(estado.carrera2) || String(estado.carrera2),
    premio: estado.premio ?? 0,
    precio: estado.precio ?? 0,
    estado: JSON.stringify(estado),
    updated_at: new Date().toISOString(),
  };
  try {
    const r = await supabase.from("dupletas").upsert(payload, { onConflict: "clave" }).select("id").single();
    if (r.error) return { ok: false, error: r.error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function eliminarDupleta(clave: string): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin credenciales Supabase (.env.local)." };
  try {
    exigirCapacidad("dupleta:fn_armar_dupleta");
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  const { error } = await supabase.from("dupletas").delete().eq("clave", clave);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}


export async function listarDupletasGuardadas(): Promise<DupletaEstado[]> {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from("dupletas")
      .select("clave, hipodromo, fecha, carrera1, carrera2, estado, updated_at")
      .order("updated_at", { ascending: false });
    if (error || !data) return [];
    const out: DupletaEstado[] = [];
    for (const r of data as Array<Record<string, unknown>>) {
      try {
        const e = JSON.parse(String(r.estado)) as DupletaEstado;
        if (e && Array.isArray(e.caballos1)) out.push(e);
      } catch {
        /* fila inválida */
      }
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Clave de idempotencia para una venta de dupleta. Se genera UNA vez por jugada
 * y se reutiliza en los reintentos: si la RPC reconoce la clave, devuelve el
 * ticket ya creado en vez de descontar el monto por segunda vez. El respaldo
 * existe porque `crypto.randomUUID` no esta fuera de un contexto seguro.
 */
export function claveIdempotenciaDupleta(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `dupleta-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

