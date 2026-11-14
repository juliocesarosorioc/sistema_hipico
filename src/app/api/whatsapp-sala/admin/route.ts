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

    const resp = await procesarPOST(peticionInterna);
    if (resp.status >= 500) {
      const errData = await resp.json().catch(() => ({}));
      return NextResponse.json(
        {
          ok: false,
          conectado: false,
          grupos: [],
          motivo:
            errData?.motivo ||
            errData?.error ||
            "Servicio Baileys (puerto 3005) apagado o iniciando",
        },
        { status: 200 }
      );
    }
    return resp;
  } catch (err: any) {
    const msg = String(err?.message || err?.cause?.code || "");
    const esOffline =
      msg.includes("ECONNREFUSED") ||
      msg.includes("fetch failed") ||
      msg.includes("3005");
    return NextResponse.json(
      {
        ok: false,
        conectado: false,
        grupos: [],
        motivo: esOffline
          ? "Servicio Baileys (puerto 3005) apagado o iniciando"
          : msg || "Servicio Baileys (puerto 3005) apagado o iniciando",
      },
      { status: 200 }
    );
  }
}
