import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import {
  procesarMensajeEntranteWhatsApp,
  type MensajeEntranteWhatsApp,
} from "@/features/whatsapp-sala/lib/puente-baileys-sala";

export const dynamic = "force-dynamic";

const MAX_MENSAJES_LOTE = 50;

function esMensajeValido(msg: unknown): msg is MensajeEntranteWhatsApp {
  if (!msg || typeof msg !== "object") return false;
  const m = msg as Record<string, unknown>;
  return (
    typeof m.groupJid === "string" &&
    m.groupJid.trim().length > 0 &&
    typeof m.senderJid === "string" &&
    m.senderJid.trim().length > 0 &&
    typeof m.texto === "string" &&
    m.texto.trim().length > 0 &&
    (m.senderNombre === undefined || typeof m.senderNombre === "string") &&
    (m.quotedMsgId === undefined || m.quotedMsgId === null || typeof m.quotedMsgId === "string") &&
    (m.whatsappMsgId === undefined || m.whatsappMsgId === null || typeof m.whatsappMsgId === "string")
  );
}

/**
 * Health check para verificación de conectividad del Webhook de WhatsApp
 */
export async function GET() {
  return NextResponse.json({
    ok: true,
    servicio: "puente-baileys-sala-webhook",
    estado: "activo",
    timestamp: new Date().toISOString(),
  });
}

/**
 * Endpoint de procesamiento de mensajes entrantes de WhatsApp en tiempo real (< 50ms)
 * Recibe el paquete de Baileys / Bot y retorna las acciones inmediatas a ejecutar.
 */
export async function POST(req: Request) {
  const inicioMs = Date.now();

  try {
    const envSecret = process.env.WHATSAPP_WEBHOOK_SECRET;
    if (!envSecret) {
      console.error("[WHATSAPP_WEBHOOK_ERR] Falta WHATSAPP_WEBHOOK_SECRET");
      return NextResponse.json(
        { ok: false, error: "Error interno del webhook" },
        { status: 500 }
      );
    }

    const authHeader = req.headers.get("authorization");
    const secretHeader = req.headers.get("x-webhook-secret");
    const token = authHeader ? authHeader.replace(/^Bearer\s+/i, "") : secretHeader;
    const esperado = Buffer.from(envSecret, "utf8");
    const recibido = Buffer.from(token ?? "", "utf8");

    if (recibido.length !== esperado.length || !timingSafeEqual(recibido, esperado)) {
      return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
    }

    const body = await req.json().catch(() => null);

    // Soporte para payload individual o en lote
    const crudos: unknown[] | null = Array.isArray(body)
      ? body
      : Array.isArray((body as any)?.mensajes)
      ? (body as any).mensajes
      : body != null
      ? [body]
      : null;

    if (!crudos || crudos.length === 0 || !crudos.every(esMensajeValido)) {
      return NextResponse.json({ ok: false, error: "Payload inválido" }, { status: 400 });
    }
    if (crudos.length > MAX_MENSAJES_LOTE) {
      return NextResponse.json(
        { ok: false, error: `Máximo ${MAX_MENSAJES_LOTE} mensajes por lote` },
        { status: 413 }
      );
    }

    const mensajes = crudos as MensajeEntranteWhatsApp[];
    const resultados = [];

    for (const msg of mensajes) {
      const res = await procesarMensajeEntranteWhatsApp(msg);
      resultados.push(res);
    }

    const duracionMs = Date.now() - inicioMs;

    return NextResponse.json({
      ok: true,
      procesados: resultados.length,
      resultados: resultados.length === 1 ? resultados[0] : resultados,
      duracionMs,
    });
  } catch (err) {
    console.error("[WHATSAPP_WEBHOOK_ERR]", err);
    return NextResponse.json(
      {
        ok: false,
        error: "Error procesando webhook de WhatsApp",
        duracionMs: Date.now() - inicioMs,
      },
      { status: 500 }
    );
  }
}
