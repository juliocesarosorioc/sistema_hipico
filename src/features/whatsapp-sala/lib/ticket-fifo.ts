import crypto from "crypto";
import { supabaseAdmin } from "@/core/supabase-admin";
import {
  construirPayloadTicketFifo,
  type DatosTicketFifo,
} from "./payload-ticket-fifo";

export { construirPayloadTicketFifo, type DatosTicketFifo } from "./payload-ticket-fifo";

function texto(valor: unknown, fallback: string): string {
  const s = String(valor ?? "").trim();
  return s || fallback;
}

function numero(valor: unknown): number {
  const n = Number(valor ?? 0);
  return Number.isFinite(n) ? Number(n.toFixed(2)) : 0;
}

export async function siguienteOrdenFifo(salaId?: string | null, propuestaMsgId?: string | null): Promise<number> {
  try {
    let q = supabaseAdmin.from("chat_tickets_fifo").select("orden_fifo");
    if (salaId) q = q.eq("sala_id", salaId);
    else if (propuestaMsgId) q = q.eq("propuesta_msg_id", propuestaMsgId);
    const { data } = await q.order("orden_fifo", { ascending: false }).limit(1).maybeSingle();
    const max = Number((data as any)?.orden_fifo ?? 0);
    return Number.isFinite(max) && max > 0 ? Math.trunc(max) + 1 : 1;
  } catch {
    return 1;
  }
}

export async function insertarTicketFifo(
  datos: DatosTicketFifo
): Promise<{ ok: boolean; ticketId?: string; codigoTicket?: string; error?: any; payload?: Record<string, unknown> }> {
  const ordenFifo =
    datos.ordenFifo != null && Number.isFinite(Number(datos.ordenFifo))
      ? Math.trunc(Number(datos.ordenFifo))
      : await siguienteOrdenFifo(datos.salaId, datos.propuestaMsgId);

  const id = crypto.randomUUID();
  const codigoTicket = texto(datos.codigoTicket, `TK-${id.slice(0, 8).toUpperCase()}`);
  const firmaSha256 =
    datos.firmaSha256 ||
    crypto
      .createHash("sha256")
      .update(`${codigoTicket}:${datos.propuestaMsgId}:${datos.aceptanteId || ""}:${numero(datos.montoConcretado)}:${id}`)
      .digest("hex");

  const payload = construirPayloadTicketFifo(datos, ordenFifo);
  const { data, error } = await supabaseAdmin
    .from("chat_tickets_fifo")
    .insert({
      id,
      codigo_ticket: codigoTicket,
      firma_sha256: firmaSha256,
      ...payload,
    })
    .select("id, codigo_ticket")
    .maybeSingle();

  if (error) {
    console.error("[INSERT_TICKET_FIFO_ERROR]", { code: error.code, message: error.message, detalles: payload });
    return { ok: false, error, payload };
  }
  return {
    ok: true,
    ticketId: String((data as any)?.id || id),
    codigoTicket: String((data as any)?.codigo_ticket || codigoTicket),
    payload,
  };
}
