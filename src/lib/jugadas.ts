/**
 * Monitor de Jugadas — lectura de progreso + corrección/anulación auditada.
 *
 *  - `v_jugadas_monitor` (sql/jugadas_monitor.sql) agrega los tickets por
 *    (hipódromo, carrera, fecha de carrera) y marca si el resultado está
 *    cargado en `resultados_carreras`.
 *  - El detalle sale de `tickets_apuestas` filtrando por hipódromo + carrera.
 *  - Editar / Anular / Restaurar / Marcar pagada escriben el ticket y dejan
 *    rastro en `jugadas_auditoria` (motivo, snapshot antes/después, imagen).
 *
 * La fecha de la carrera NO es `fecha_registro` (timestamp de venta): se lee de
 * `nota_auditoria::jsonb->>'fecha_carrera'`, que sellan los RPC de venta.
 */
import { supabase } from "@/lib/supabase";
import { exigirCapacidad } from "@/lib/seguridad/vigente";

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type FilaMonitorJugada = {
  hipodromo: string;
  carrera: number;
  fecha_carrera: string | null;
  total_jugadas: number;
  total_monto: number;
  total_premio: number;
  en_juego: number;
  por_pagar: number;
  liquidadas: number;
  anuladas: number;
  monto_vigente: number;
  premio_ganador: number;
  usuarios: string[] | null;
  origenes: string | null;
  resultado_cargado: boolean;
};

export type JugadaAdmin = {
  id: string;
  hipodromo: string;
  carrera: number;
  nombre_jugada?: string | null;
  caballo?: string | null;
  ejemplar_numero?: number | null;
  monto_jugado?: number | null;
  monto_decidido?: number | null;
  premio_pagar?: number | null;
  comision_porcentaje?: number | null;
  estado?: string | null;
  cliente_juega_nombre?: string | null;
  cliente_consigue_nombre?: string | null;
  moneda?: string | null;
  nota_auditoria?: string | null;
  fecha_registro?: string | null;
  anulada?: boolean | null;
  anulada_motivo?: string | null;
  anulada_por?: string | null;
  anulada_at?: string | null;
  pagado_en?: string | null;
  pagado_por?: string | null;
};

export type AuditoriaJugada = {
  id: number | string;
  ticket_id: string;
  hipodromo?: string | null;
  carrera?: number | null;
  accion: string;
  motivo?: string | null;
  detalle?: unknown;
  imagen?: string | null;
  usuario?: string | null;
  creado_at?: string | null;
};

export type EditablesJugada = {
  nombre_jugada?: string | null;
  caballo?: string | null;
  ejemplar_numero?: number | null;
  monto_jugado?: number | null;
  monto_decidido?: number | null;
  premio_pagar?: number | null;
  estado?: string | null;
};

export type Resultado = { ok: boolean; error?: string };

export const MOTIVOS_ANULACION = [
  "Error de carga del operador",
  "Reclamo del cliente atendido",
  "Jugada duplicada",
  "Ejemplar retirado",
  "Carrera anulada",
  "Saldo insuficiente / venta inválida",
  "Orden administrativa",
  "Otro (detallar)",
] as const;

const COLS_DETALLE =
  "id, hipodromo, carrera, nombre_jugada, caballo, ejemplar_numero, monto_jugado, monto_decidido, premio_pagar, comision_porcentaje, estado, cliente_juega_nombre, cliente_consigue_nombre, moneda, nota_auditoria, fecha_registro, anulada, anulada_motivo, anulada_por, anulada_at, pagado_en, pagado_por";

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function texto(v: unknown): string {
  return String(v ?? "").trim();
}

/** `nota_auditoria` es TEXT con un JSON serializado: se parsea siempre. */
export function leerNotaAuditoria(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  const s = String(raw ?? "").trim();
  if (!s || !/^[\[{]/.test(s)) return {};
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function usuarioDeJugada(j: JugadaAdmin): string {
  return texto(leerNotaAuditoria(j.nota_auditoria).usuario);
}

export function origenDeJugada(j: JugadaAdmin): string {
  return texto(leerNotaAuditoria(j.nota_auditoria).origen);
}

export function fechaCarreraDeJugada(j: JugadaAdmin): string | null {
  const f = texto(leerNotaAuditoria(j.nota_auditoria).fecha_carrera).slice(0, 10);
  if (f) return f;
  // Respaldo duro: una jugada nunca debe quedar sin fecha. Si el JSON no trae
  // fecha de carrera (filas heredadas), se usa la fecha en que se registró.
  return texto(j.fecha_registro).slice(0, 10) || null;
}

// ---------------------------------------------------------------------------
// Lecturas
// ---------------------------------------------------------------------------

export async function listarMonitorJugadas(): Promise<{
  ok: boolean;
  filas: FilaMonitorJugada[];
  error?: string;
}> {
  if (!supabase) return { ok: false, filas: [], error: "Sin conexión a Supabase." };
  try {
    const { data, error } = await supabase
      .from("v_jugadas_monitor")
      .select("*")
      .order("hipodromo")
      .order("carrera");
    if (error) throw error;
    const filas: FilaMonitorJugada[] = (data ?? []).map((r) => {
      const x = r as Record<string, unknown>;
      return {
        hipodromo: texto(x.hipodromo),
        carrera: num(x.carrera),
        fecha_carrera: x.fecha_carrera ? String(x.fecha_carrera).slice(0, 10) : null,
        total_jugadas: num(x.total_jugadas),
        total_monto: num(x.total_monto),
        total_premio: num(x.total_premio),
        en_juego: num(x.en_juego),
        por_pagar: num(x.por_pagar),
        liquidadas: num(x.liquidadas),
        anuladas: num(x.anuladas),
        monto_vigente: num(x.monto_vigente),
        premio_ganador: num(x.premio_ganador),
        usuarios: Array.isArray(x.usuarios) ? (x.usuarios as unknown[]).map(String) : null,
        origenes: x.origenes ? String(x.origenes) : null,
        resultado_cargado: x.resultado_cargado === true,
      };
    });
    return { ok: true, filas };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const aplica = /does not exist|schema cache|PGRST20[45]/i.test(msg)
      ? "Falta aplicar sql/jugadas_monitor.sql en Supabase."
      : msg;
    return { ok: false, filas: [], error: aplica };
  }
}

export async function listarJugadasDeCarrera(
  hipodromo: string,
  carrera: number | string,
  fecha?: string | null
): Promise<{ ok: boolean; jugadas: JugadaAdmin[]; error?: string }> {
  if (!supabase) return { ok: false, jugadas: [], error: "Sin conexión a Supabase." };
  try {
    const { data, error } = await supabase
      .from("v_jugadas_carrera")
      .select(COLS_DETALLE)
      .eq("hipodromo", texto(hipodromo).toUpperCase())
      .eq("carrera", num(carrera))
      .order("fecha_registro")
      .limit(1000);
    if (error) throw error;
    let jugadas = (data ?? []) as unknown as JugadaAdmin[];
    if (fecha) jugadas = jugadas.filter((j) => (fechaCarreraDeJugada(j) ?? "") === String(fecha).slice(0, 10));
    return { ok: true, jugadas };
  } catch (e) {
    return { ok: false, jugadas: [], error: e instanceof Error ? e.message : String(e) };
  }
}

async function leerJugada(id: string | number): Promise<JugadaAdmin | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from("v_jugadas_carrera").select(COLS_DETALLE).eq("id", id).maybeSingle();
  if (error || !data) return null;
  return data as unknown as JugadaAdmin;
}

export async function listarAuditoriaJugadas(ticketId?: string | number): Promise<AuditoriaJugada[]> {
  if (!supabase) return [];
  try {
    let q = supabase
      .from("jugadas_auditoria")
      .select("id, ticket_id, hipodromo, carrera, accion, motivo, detalle, imagen, usuario, creado_at")
      .order("creado_at", { ascending: false })
      .limit(300);
    if (ticketId != null) q = q.eq("ticket_id", String(ticketId));
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []) as AuditoriaJugada[];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Escrituras auditadas
// ---------------------------------------------------------------------------

async function auditar(
  jugada: JugadaAdmin | null,
  ticketId: string | number,
  accion: string,
  motivo: string,
  detalle: unknown,
  imagen: string | null,
  usuario: string
): Promise<string | null> {
  if (!supabase) return "Sin conexión a Supabase.";
  try {
    const { error } = await supabase.from("jugadas_auditoria").insert({
      ticket_id: String(ticketId),
      hipodromo: jugada?.hipodromo ?? null,
      carrera: jugada?.carrera ?? null,
      accion,
      motivo: motivo.trim() || null,
      detalle: detalle ?? null,
      imagen: imagen ?? null,
      usuario: usuario || null,
    });
    return error?.message ?? null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/** Corrige los campos editables de una jugada. Deja snapshot antes/después. */
export async function editarJugada(
  id: string | number,
  cambios: EditablesJugada,
  motivo: string,
  usuario: string
): Promise<Resultado> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase." };
  try {
    exigirCapacidad("jugadas:fn_editar_jugada");
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  const antes = await leerJugada(id);
  if (!antes) return { ok: false, error: "La jugada no existe." };

  const payload: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(cambios)) {
    if (v !== undefined) payload[k] = v === "" ? null : v;
  }
  if (Object.keys(payload).length === 0) return { ok: false, error: "No hay cambios para guardar." };

  const { error } = await supabase.from("tickets_apuestas").update(payload).eq("id", id);
  if (error) return { ok: false, error: error.message };

  const fallo = await auditar(antes, id, "EDITAR", motivo, { antes, despues: payload }, null, usuario);
  return fallo ? { ok: true, error: `Cambio aplicado, pero la auditoría falló: ${fallo}` } : { ok: true };
}

export async function anularJugada(
  id: string | number,
  motivo: string,
  imagen: string | null,
  usuario: string
): Promise<Resultado> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase." };
  if (!motivo.trim()) return { ok: false, error: "Indicá el motivo de la anulación." };
  try {
    exigirCapacidad("jugadas:fn_anular_jugada");
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  const antes = await leerJugada(id);
  if (!antes) return { ok: false, error: "La jugada no existe." };
  if (antes.anulada) return { ok: false, error: "Esa jugada ya estaba anulada." };

  const { error } = await supabase
    .from("tickets_apuestas")
    .update({
      anulada: true,
      anulada_motivo: motivo.trim(),
      anulada_por: usuario || null,
      anulada_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  const fallo = await auditar(antes, id, "ANULAR", motivo, { antes }, imagen, usuario);
  return fallo ? { ok: true, error: `Anulada, pero la auditoría falló: ${fallo}` } : { ok: true };
}

export async function restaurarJugada(id: string | number, motivo: string, usuario: string): Promise<Resultado> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase." };
  try {
    exigirCapacidad("jugadas:fn_restaurar_jugada");
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  const antes = await leerJugada(id);
  if (!antes) return { ok: false, error: "La jugada no existe." };

  const { error } = await supabase
    .from("tickets_apuestas")
    .update({ anulada: false, anulada_motivo: null, anulada_por: null, anulada_at: null })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  const fallo = await auditar(antes, id, "RESTAURAR", motivo, { antes }, null, usuario);
  return fallo ? { ok: true, error: `Restaurada, pero la auditoría falló: ${fallo}` } : { ok: true };
}

export async function marcarJugadaPagada(id: string | number, usuario: string): Promise<Resultado> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase." };
  try {
    exigirCapacidad("jugadas:fn_marcar_pagada");
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  const antes = await leerJugada(id);
  if (!antes) return { ok: false, error: "La jugada no existe." };
  if (antes.pagado_en) return { ok: false, error: "Esa jugada ya figura como pagada." };

  const { error } = await supabase
    .from("tickets_apuestas")
    .update({ pagado_en: new Date().toISOString(), pagado_por: usuario || null })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  const fallo = await auditar(antes, id, "MARCAR_PAGADO", "Pago registrado desde el monitor", { antes }, null, usuario);
  return fallo ? { ok: true, error: `Pagada, pero la auditoría falló: ${fallo}` } : { ok: true };
}
