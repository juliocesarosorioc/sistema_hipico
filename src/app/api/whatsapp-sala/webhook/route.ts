import { NextResponse } from "next/server";
import {
  procesarMensajeEntranteWhatsApp,
  type MensajeEntranteWhatsApp,
} from "@/features/whatsapp-sala/lib/puente-baileys-sala";

export const dynamic = "force-dynamic";

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
    // Verificación opcional de secreto de webhook
    const authHeader = req.headers.get("authorization");
    const secretHeader = req.headers.get("x-webhook-secret");
    const envSecret = process.env.WHATSAPP_WEBHOOK_SECRET;

    if (envSecret) {
      const token = authHeader ? authHeader.replace(/^Bearer\s+/i, "") : secretHeader;
      if (token !== envSecret) {
        return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
      }
    }

    const body = await req.json();

    // Soporte para payload individual o en lote
    const mensajes: MensajeEntranteWhatsApp[] = Array.isArray(body)
      ? body
      : Array.isArray(body?.mensajes)
      ? body.mensajes
      : [body];

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
  } catch (err: any) {
    return NextResponse.json(
      {
        ok: false,
        error: err?.message || "Error procesando webhook de WhatsApp",
        duracionMs: Date.now() - inicioMs,
      },
      { status: 500 }
    );
  }
}
