import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const BOT_DAEMON_URL = process.env.BOT_DAEMON_URL || process.env.WHATSAPP_BOT_URL || "http://127.0.0.1:3005";
const INTERNAL_BOT_SECRET = process.env.INTERNAL_BOT_SECRET || "SH-BOT-SECRET-2026";
const FALLBACK = { ok: false, conectado: false };

/** Misma señal de sesión que acepta el middleware para el resto de la plataforma. */
function tieneSesion(req: NextRequest): boolean {
  if (req.cookies.get("hipico_acceso")?.value === "sin") return false;

  const usuario = req.cookies.get("hipico_usuario")?.value ?? "";
  const perfil = req.cookies.get("hipico_perfil")?.value;
  const permisos = req.cookies.get("hipico_permisos")?.value;
  const tokenSala = req.cookies.get("sala_staff_token")?.value ?? "";
  const tokenSupabase = req.cookies
    .getAll()
    .some((c) => c.name.startsWith("sb-") && c.name.endsWith("-auth-token") && Boolean(c.value));

  return Boolean(usuario || tokenSala || tokenSupabase || (perfil && permisos));
}

export async function GET(req: NextRequest) {
  if (!tieneSesion(req)) {
    return NextResponse.json({ ...FALLBACK, error: "No autorizado" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const sessionId = searchParams.get("session_id") || "";
    const url = new URL("/api/whatsapp/status", BOT_DAEMON_URL);
    if (sessionId) url.searchParams.set("session_id", sessionId);

    const res = await fetch(url.toString(), {
      cache: "no-store",
      headers: {
        "x-internal-bot-secret": INTERNAL_BOT_SECRET,
      },
      signal: AbortSignal.timeout(4000),
    });

    if (!res.ok) return NextResponse.json(FALLBACK, { status: 200 });

    const json = await res.json().catch(() => FALLBACK);
    return NextResponse.json(json, { status: 200 });
  } catch {
    return NextResponse.json(FALLBACK, { status: 200 });
  }
}
