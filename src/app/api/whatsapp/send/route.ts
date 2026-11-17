import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/whatsapp/send
 *
 * Contrato público del frontend:
 *   { session_id, to_jid, message_text, media_url }
 *
 * Reenvía el despacho al demonio Baileys que corre en Contabo
 * (`BOT_DAEMON_URL`, puerto 3005). Si `media_url` viene poblada, la imagen se
 * descarga y se entrega como `imageMessage` (Baileys recibe un Buffer y emite
 * `image` con caption). Si no, se publica un mensaje de texto normal.
 */
const BOT_DAEMON_URL = process.env.BOT_DAEMON_URL || "http://127.0.0.1:3005";
const INTERNAL_BOT_SECRET = process.env.INTERNAL_BOT_SECRET || "SH-BOT-SECRET-2026";

const MIME_POR_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  heic: "image/heic",
};

function mimetypeDe(url: string, header: string | null): string {
  const delHeader = String(header || "").split(";")[0].trim().toLowerCase();
  if (delHeader.startsWith("image/")) return delHeader;
  const extension = String(url.split("?")[0].split("#")[0].split(".").pop() || "").toLowerCase();
  return MIME_POR_EXTENSION[extension] || "image/jpeg";
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (origin && !origin.includes(host || "")) {
    return NextResponse.json({ error: "CSRF bloqueado" }, { status: 403 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const sessionId = String(body.session_id || body.sessionId || "default").trim() || "default";
    const toJid = String(body.to_jid || body.toJid || body.groupJid || body.whatsapp_group_jid || "").trim();
    const messageText = String(body.message_text || body.messageText || body.texto || body.text || "").trim();
    const mediaUrl = String(body.media_url || body.mediaUrl || "").trim();

    if (!toJid) {
      return NextResponse.json(
        { ok: false, error: "to_jid es requerido" },
        { status: 400 }
      );
    }
    if (!messageText && !mediaUrl) {
      return NextResponse.json(
        { ok: false, error: "message_text o media_url son requeridos" },
        { status: 400 }
      );
    }

    if (mediaUrl) {
      let mediaBase64 = "";
      let mimetype = "image/jpeg";
      try {
        const resMedia = await fetch(mediaUrl, { cache: "no-store" });
        if (!resMedia.ok) throw new Error(`HTTP ${resMedia.status} descargando media_url`);
        const buffer = Buffer.from(await resMedia.arrayBuffer());
        mediaBase64 = buffer.toString("base64");
        mimetype = mimetypeDe(mediaUrl, resMedia.headers.get("content-type"));
      } catch (err: any) {
        return NextResponse.json(
          { ok: false, error: `No se pudo descargar la imagen: ${err?.message || "desconocido"}` },
          { status: 502 }
        );
      }

      const resBot = await fetch(`${BOT_DAEMON_URL}/difundir-grupos`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-bot-secret": INTERNAL_BOT_SECRET,
        },
        body: JSON.stringify({
          groupJids: [toJid],
          tipo: "IMAGEN",
          texto: messageText || undefined,
          mediaBase64,
          mimetype,
          sessionId,
        }),
      });
      const dataBot = await resBot.json().catch(() => null);
      return NextResponse.json({
        ok: Boolean(dataBot?.ok),
        session_id: sessionId,
        to_jid: toJid,
        message_text: messageText,
        media_url: mediaUrl,
        tipo: "imageMessage",
        mimetype,
        bot: dataBot,
      });
    }

    const resBot = await fetch(`${BOT_DAEMON_URL}/publicar-grupo`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-bot-secret": INTERNAL_BOT_SECRET,
      },
      body: JSON.stringify({
        groupJid: toJid,
        texto: messageText,
        sessionId,
      }),
    });
    const dataBot = await resBot.json().catch(() => null);
    return NextResponse.json({
      ok: Boolean(dataBot?.ok),
      session_id: sessionId,
      to_jid: toJid,
      message_text: messageText,
      media_url: null,
      tipo: "textMessage",
      bot: dataBot,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || "Error enviando a Baileys" },
      { status: 500 }
    );
  }
}
