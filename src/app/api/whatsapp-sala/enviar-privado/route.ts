import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/features/seguridad/lib/require-session";
import { enviarNotificacionesPrivadasDaemon } from "@/features/whatsapp-sala/notificador";

export const dynamic = "force-dynamic";

/** Acepta teléfono, JID privado o JID de grupo y devuelve un JID normalizado. */
function normalizarJid(valor: unknown): string {
  const limpio = String(valor ?? "")
    .trim()
    .replace(/^whatsapp:/i, "");
  if (!limpio) return "";

  if (limpio.includes("@")) {
    const partes = limpio.split("@");
    const local = partes[0].replace(/[^\d]/g, "");
    const dominio = partes.slice(1).join("@").toLowerCase();
    if (!local) return "";
    if (dominio === "s.whatsapp.net" || dominio === "g.us") return `${local}@${dominio}`;
    if (dominio === "c.us") return `${local}@s.whatsapp.net`;
    // Dominio desconocido: se trata el valor como número de teléfono.
    return `${local}@s.whatsapp.net`;
  }

  const digitos = limpio.replace(/[^\d]/g, "");
  return digitos ? `${digitos}@s.whatsapp.net` : "";
}

export async function POST(req: NextRequest) {
  const autorizacion = await requireSession(req, ["superadmin", "admin_grupo", "cliente"]);
  if (!autorizacion.ok) {
    return NextResponse.json(
      { ok: false, error: autorizacion.error },
      { status: autorizacion.status }
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    const telefonoOjid = normalizarJid(
      body?.telefonoOjid ?? body?.telefono ?? body?.jid ?? ""
    );
    const texto = String(body?.texto ?? "").trim();

    if (!telefonoOjid || !texto) {
      return NextResponse.json(
        { ok: false, error: "telefonoOjid y texto son requeridos" },
        { status: 400 }
      );
    }

    await enviarNotificacionesPrivadasDaemon([
      { telefono: telefonoOjid, mensaje: texto },
    ]);

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || "No se pudo enviar el mensaje privado" },
      { status: 500 }
    );
  }
}
