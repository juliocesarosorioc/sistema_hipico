import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const BOT_DAEMON_URL = process.env.BOT_DAEMON_URL || process.env.WHATSAPP_BOT_URL || "http://127.0.0.1:3005";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const sessionId = searchParams.get("session_id") || "";
    const qs = sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : "";

    const res = await fetch(`${BOT_DAEMON_URL}/api/whatsapp/groups${qs}`, {
      cache: "no-store",
    });

    const json = await res.json().catch(() => ({}));
    return NextResponse.json(json, { status: res.status });
  } catch (err: any) {
    return NextResponse.json(
      {
        ok: false,
        conectado: false,
        grupos: [],
        total: 0,
        error: err?.message || "Motor Baileys en puerto 3005 no responde",
      },
      { status: 200 }
    );
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}
