import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const BOT_DAEMON_URL = process.env.BOT_DAEMON_URL || process.env.WHATSAPP_BOT_URL || "http://127.0.0.1:3005";
const INTERNAL_BOT_SECRET = process.env.INTERNAL_BOT_SECRET || "SH-BOT-SECRET-2026";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const res = await fetch(`${BOT_DAEMON_URL}/disconnect`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-bot-secret": INTERNAL_BOT_SECRET,
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    const json = await res.json().catch(() => ({}));
    return NextResponse.json(
      {
        ok: Boolean(res.ok && json?.ok !== false),
        status: "disconnected",
        motivo: json?.motivo || json?.error || "Sesión de WhatsApp cerrada",
      },
      { status: res.ok ? 200 : 500 }
    );
  } catch (err: any) {
    return NextResponse.json(
      {
        ok: false,
        status: "disconnected",
        motivo: err?.message || "Motor Baileys en puerto 3005 no responde",
      },
      { status: 500 }
    );
  }
}
