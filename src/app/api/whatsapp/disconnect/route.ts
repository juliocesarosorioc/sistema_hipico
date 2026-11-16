import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const BOT_DAEMON_URL = process.env.BOT_DAEMON_URL || process.env.WHATSAPP_BOT_URL || "http://127.0.0.1:3005";
const INTERNAL_BOT_SECRET = process.env.INTERNAL_BOT_SECRET || "SH-BOT-SECRET-2026";

export async function POST(req: NextRequest) {
  const _origin = req.headers.get("origin");
  const _host = req.headers.get("host");
  if (_origin && !_origin.includes(_host || "")) {
    return NextResponse.json({ error: "CSRF bloqueado" }, { status: 403 });
  }

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
        motivo: json?.motivo || json?.error || "Sesión de WhatsApp desconectada",
      },
      { status: res.ok ? 200 : 500 }
    );
  } catch (err: any) {
    return NextResponse.json(
      {
        ok: false,
        motivo: err?.message || "Motor Baileys en puerto 3005 no responde",
      },
      { status: 500 }
    );
  }
}
