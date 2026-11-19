import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/core/supabase-admin";
import { mensajeConCodigoSala } from "@/features/grupos/lib/codigo-sala";
import { codigoSalaEnRespuesta } from "./resolverSala";
import type { PayloadNotificacion } from "./types";

export const BOT_DAEMON_URL = process.env.WHATSAPP_BOT_URL || "http://127.0.0.1:3005";
export const INTERNAL_BOT_SECRET = process.env.INTERNAL_BOT_SECRET || "SH-BOT-SECRET-2026";

/**
 * Emite eventos realtime a los canales Supabase de la sala.
 */
export async function emitirBroadcastSala(salaId: string, evento: string, payload: any): Promise<void> {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return;
    await fetch(`${url}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        messages: [
          { topic: `realtime:sala:${salaId}`, event: evento, payload },
          { topic: `realtime:sala-${salaId}`, event: evento, payload },
        ],
      }),
    }).catch(() => {});
  } catch {
    // No bloqueante
  }
}

/**
 * Inserta un registro en `chat_mensajes` y emite el broadcast de nuevo mensaje en la sala.
 */
export async function registrarMensajeChat(params: {
  salaId: string;
  grupoId?: string | null;
  tipo?: string;
  tipoMensaje?: string;
  remitenteNombre: string;
  remitenteJid?: string | null;
  esOperador?: boolean;
  mensajeTexto: string;
  whatsappMsgId?: string | null;
  whatsappGroupJid?: string | null;
  whatsappGroupNombre?: string | null;
  metadata?: Record<string, any>;
}): Promise<any> {
  const {
    salaId,
    grupoId,
    tipo = "BOT",
    tipoMensaje = "texto",
    remitenteNombre,
    remitenteJid = null,
    esOperador = false,
    mensajeTexto,
    whatsappMsgId = null,
    whatsappGroupJid = null,
    whatsappGroupNombre = null,
    metadata = {},
  } = params;

  try {
    const { data, error } = await supabaseAdmin
      .from("chat_mensajes")
      .insert({
        sala_id: salaId,
        grupo_id: grupoId || undefined,
        tipo,
        tipo_mensaje: tipoMensaje,
        remitente_nombre: remitenteNombre,
        remitente_jid: remitenteJid,
        es_operador: esOperador,
        contenido: mensajeTexto,
        mensaje: mensajeTexto,
        whatsapp_msg_id: whatsappMsgId,
        whatsapp_group_jid: whatsappGroupJid,
        whatsapp_group_nombre: whatsappGroupNombre,
        origen_canal: "WHATSAPP",
        metadata: { ...metadata, grupoId: grupoId || undefined },
      })
      .select()
      .maybeSingle();

    if (error) {
      console.warn("[NOTIFICADOR] Advertencia insertando en chat_mensajes:", error.message);
    }

    await emitirBroadcastSala(salaId, "nuevo_mensaje", { salaId });
    return data;
  } catch (err: any) {
    console.error("[NOTIFICADOR_REGISTRAR_CHAT_ERR]", err?.message || err);
    return null;
  }
}

/**
 * Despacha notificaciones privadas directamente al bot daemon Baileys.
 */
export async function enviarNotificacionesPrivadasDaemon(notificaciones: any[]): Promise<void> {
  if (!Array.isArray(notificaciones) || notificaciones.length === 0) return;

  for (const notif of notificaciones) {
    const msgPriv = notif?.mensaje || notif?.msg || notif?.texto;
    if (!msgPriv) continue;
    let destinoJid = notif?.whatsapp_jid || notif?.jid || notif?.telefono || null;
    if (!destinoJid && (notif?.cliente_id || notif?.jugador_id)) {
      try {
        const { data: clDest } = await supabaseAdmin
          .from("clientes")
          .select("whatsapp_jid, telefono, telefono_normalizado")
          .eq("id", notif.cliente_id || notif.jugador_id)
          .maybeSingle();
        destinoJid =
          clDest?.whatsapp_jid ||
          (clDest?.telefono_normalizado ? `${clDest.telefono_normalizado}@s.whatsapp.net` : null) ||
          clDest?.telefono ||
          null;
      } catch {}
    }
    if (destinoJid) {
      try {
        await fetch(`${BOT_DAEMON_URL}/enviar-privado`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-internal-bot-secret": INTERNAL_BOT_SECRET,
          },
          body: JSON.stringify({ telefonoOjid: destinoJid, texto: msgPriv }),
        });
      } catch {
        // No bloqueante si el bot daemon está offline
      }
    }
  }
}

/**
 * Toda respuesta del endpoint pasa por acá: los mensajes privados que el
 * demonio Baileys entrega por DM siempre incluyen el Código de Sala del tenant.
 */
export function respuestaSala(body: any, init?: ResponseInit): NextResponse {
  const codigo = codigoSalaEnRespuesta(body);
  if (codigo && body && typeof body === "object") {
    const camposPrivados = [
      "mensajePrivadoAutor",
      "msg_privado_bot",
      "msg_privado_proponente",
      "msg_privado_aceptante",
      "msgPrivado",
      "alertaPrivada",
    ];
    for (const campo of camposPrivados) {
      if (typeof body[campo] === "string" && body[campo].trim()) {
        body[campo] = mensajeConCodigoSala(body[campo], codigo);
      }
    }
    if (Array.isArray(body.notificaciones_privadas)) {
      for (const notif of body.notificaciones_privadas) {
        if (!notif || typeof notif !== "object") continue;
        for (const clave of ["mensaje", "texto"]) {
          if (typeof notif[clave] === "string" && notif[clave].trim()) {
            notif[clave] = mensajeConCodigoSala(notif[clave], codigo);
          }
        }
      }
    }
  }
  return NextResponse.json(body, init);
}

/**
 * Helper para armar un payload de notificación privada tipado.
 */
export function armarNotificacionPrivada(
  destino: string | { whatsapp_jid?: string | null; telefono?: string | null; cliente_id?: string | null },
  mensaje: string,
  tipo: string = "privado"
): PayloadNotificacion {
  if (typeof destino === "string") {
    return {
      whatsapp_jid: destino.includes("@") ? destino : null,
      telefono: destino.includes("@") ? null : destino,
      mensaje,
      tipo,
    };
  }
  return {
    whatsapp_jid: destino.whatsapp_jid || null,
    telefono: destino.telefono || null,
    cliente_id: destino.cliente_id || null,
    mensaje,
    tipo,
  };
}
