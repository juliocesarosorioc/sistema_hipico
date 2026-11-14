import { NextRequest, NextResponse } from "next/server";
import { POST as procesarPOST } from "../procesar/route";

export const dynamic = "force-dynamic";

const INTERNAL_BOT_SECRET = process.env.INTERNAL_BOT_SECRET || "SH-BOT-SECRET-2026";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Inyectar el secreto interno para autorizar la acción administrativa
    const headers = new Headers(req.headers);
    headers.set("x-internal-bot-secret", INTERNAL_BOT_SECRET);
    headers.set("Content-Type", "application/json");

    const peticionInterna = new Request(req.url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    return await procesarPOST(peticionInterna);
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || "Error procesando acción administrativa" },
      { status: 500 }
    );
  }
}
