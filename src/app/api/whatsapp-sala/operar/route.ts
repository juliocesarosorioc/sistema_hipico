import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/core/supabase-admin";
import { autenticarPeticionSala, grupoPermitido } from "@/features/sala-juegos/lib/sala-auth";
import { obtenerSecretoInternoBot } from "@/features/whatsapp-sala/lib/bot-secret";
import { POST as procesarSala } from "../procesar/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Proxy protegido por sesión de staff para las acciones de carrera del panel de operador.
 * El navegador NUNCA envía `x-internal-bot-secret`: el servidor lo inyecta al reenviar a
 * `/api/whatsapp-sala/procesar`.
 */
const ACCIONES_PERMITIDAS = new Set([
  "abrir-carrera",
  "cerrar-carrera",
  "publicar-plano",
  "liquidar-pizarra",
  "rectificar-pizarra",
]);

function json(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (origin && !origin.includes(host || "")) {
    return json({ ok: false, error: "CSRF bloqueado" }, 403);
  }

  const auth = await autenticarPeticionSala(req);
  if (!auth.ok || !auth.identidad) {
    return json({ ok: false, error: auth.error || "No autorizado." }, auth.status || 401);
  }
  const identidad = auth.identidad;
  if (identidad.tipo !== "STAFF" || !(identidad.esAdmin || identidad.esOperador)) {
    return json({ ok: false, error: "Solo el personal puede operar la sala." }, 403);
  }

  const body = await req.json().catch(() => ({} as Record<string, any>));
  const accion = String(body?.accion || "");
  const salaId = String(body?.salaId || "").trim();
  if (!ACCIONES_PERMITIDAS.has(accion)) {
    return json({ ok: false, error: `Acción no permitida: ${accion || "(vacía)"}` }, 400);
  }
  if (!salaId) return json({ ok: false, error: "salaId es requerido." }, 400);

  const { data: sala } = await supabaseAdmin
    .from("salas_juego")
    .select("id, grupo_id")
    .eq("id", salaId)
    .maybeSingle();
  if (!sala || !grupoPermitido(identidad, String(sala.grupo_id || ""))) {
    return json({ ok: false, error: "Sala no encontrada o sin permiso." }, 404);
  }

  const reenviada = new Request(new URL("/api/whatsapp-sala/procesar", req.url), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-bot-secret": obtenerSecretoInternoBot(),
    },
    body: JSON.stringify(body),
  });
  return procesarSala(reenviada);
}
