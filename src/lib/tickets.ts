/**
 * Tickets / Reclamos (Tickets por solucionar) — módulo del flujo de disputas.
 *
 *  - Consola de la casa: CREADO → EN_REVISION → SOLUCIONADO (responder con
 *    acción y monto ajustado).
 *  - Portal del cliente: "Mis tickets" + encuesta de satisfacción 1-5.
 *  - Tabla: `tickets_jugadas` (runbook_estabilizacion.sql la crea si no existe).
 */
import { supabase } from "@/lib/supabase";

export type EstadoTicket = "CREADO" | "EN_REVISION" | "SOLUCIONADO";
export type AccionTicket = "ABONO" | "REEMBOLSO" | "AJUSTE" | "RECHAZO";

export type TicketDisputa = {
  id: string | number;
  numero_ticket?: number | null;
  cliente_id?: string | number | null;
  cliente_nombre?: string | null;
  jugada_origen?: string | null;
  jugada_id?: string | null;
  tipo_jugada?: string | null;
  fecha_jugada?: string | null;
  hipodromo?: string | null;
  carrera?: number | null;
  monto?: number | null;
  premio_recalculado?: number | null;
  motivo?: string | null;
  imagen_soporte?: string | null;
  estado?: EstadoTicket | null;
  respuesta_casa?: string | null;
  accion_aplicada?: AccionTicket | null;
  monto_resuelto?: number | null;
  respondido_por?: string | null;
  respondido_at?: string | null;
  encuesta_satisfaccion?: number | null;
  encuesta_comentario?: string | null;
  encuesta_at?: string | null;
  creado_por?: string | null;
  creado_at?: string | null;
  updated_at?: string | null;
};

const SEL =
  "id, numero_ticket, cliente_id, cliente_nombre, jugada_origen, jugada_id, tipo_jugada, fecha_jugada, hipodromo, carrera, monto, premio_recalculado, motivo, imagen_soporte, estado, respuesta_casa, accion_aplicada, monto_resuelto, respondido_por, respondido_at, encuesta_satisfaccion, encuesta_comentario, encuesta_at, creado_por, creado_at, updated_at";

/** Todos los tickets para la consola de la casa (más recientes primero). */
export async function listarTicketsAdmin(): Promise<TicketDisputa[]> {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from("tickets_jugadas")
      .select(SEL)
      .order("creado_at", { ascending: false })
      .limit(300);
    if (error) throw error;
    return (data ?? []) as TicketDisputa[];
  } catch {
    return [];
  }
}

/** "Mis tickets" — reclamos/disputas de un cliente (Portal). */
export async function listarMisTickets(clienteId: string | number): Promise<TicketDisputa[]> {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from("tickets_jugadas")
      .select(SEL)
      .eq("cliente_id", clienteId)
      .order("creado_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    return (data ?? []) as TicketDisputa[];
  } catch {
    return [];
  }
}

/** Casa: pasa un ticket de CREADO a EN_REVISION. */
export async function pasarARevision(id: string | number): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase" };
  try {
    const { error } = await supabase.from("tickets_jugadas").update({ estado: "EN_REVISION", updated_at: new Date().toISOString() }).eq("id", id);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export type ResolverTicket = {
  respuesta: string;
  accion: AccionTicket;
  monto: number | null;
  por: string;
};

/** Casa: resuelve el ticket (SOLUCIONADO) con acción + monto ajustado. */
export async function resolverTicket(id: string | number, d: ResolverTicket): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase" };
  try {
    const { error } = await supabase
      .from("tickets_jugadas")
      .update({
        estado: "SOLUCIONADO",
        respuesta_casa: d.respuesta.trim().toUpperCase(),
        accion_aplicada: d.accion,
        monto_resuelto: d.monto ?? null,
        respondido_por: d.por || "ADMIN",
        respondido_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Portal: encuesta de satisfacción 1-5 sobre el ticket resuelto. */
export async function encuestarTicket(id: string | number, puntuacion: number, comentario: string): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase" };
  try {
    const { error } = await supabase
      .from("tickets_jugadas")
      .update({
        encuesta_satisfaccion: puntuacion,
        encuesta_comentario: comentario.trim().toUpperCase() || null,
        encuesta_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}