import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const BOT_DAEMON_URL = process.env.BOT_DAEMON_URL || "http://127.0.0.1:3005";
const INTERNAL_BOT_SECRET = process.env.INTERNAL_BOT_SECRET || "SH-BOT-SECRET-2026";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false },
});

export async function POST(req: NextRequest) {
  const _origin = req.headers.get("origin");
  const _host = req.headers.get("host");
  if (_origin && !_origin.includes(_host || "")) {
    return NextResponse.json({ error: "CSRF bloqueado" }, { status: 403 });
  }
  try {
    const body = await req.json().catch(() => ({}));
    const { salaId, grupoId: grupoIdParam, texto, quotedMsgId } = body;

    const textoLimpio = String(texto || "").trim();
    if (!salaId || !textoLimpio) {
      return NextResponse.json(
        { ok: false, motivo: "salaId y texto son requeridos" },
        { status: 400 }
      );
    }

    let grupoId = grupoIdParam;
    if (!grupoId) {
      const { data: sRow } = await supabaseAdmin
        .from("salas_juego")
        .select("grupo_id")
        .eq("id", salaId)
        .maybeSingle();
      if (sRow?.grupo_id) grupoId = sRow.grupo_id;
    }

    // 1. Insertar el mensaje en public.chat_mensajes
    const { data: msgInsert, error: errInsert } = await supabaseAdmin
      .from("chat_mensajes")
      .insert({
        sala_id: salaId,
        grupo_id: grupoId,
        contenido: textoLimpio,
        remitente_nombre: "Oficial de Sala",
        es_bot: true,
        es_operador: true,
        tipo_mensaje: "OPERADOR_AVISO",
        solo_borrable_operador: true,
      })
      .select()
      .single();

    if (errInsert) {
      console.error("[Enviar] Error insertando chat_mensajes:", errInsert.message);
    }

    // 2. Llamar a http://127.0.0.1:3005/publicar-grupo para despacho inmediato en WhatsApp
    let resBotOk = false;
    let resBotMotivo = "";
    try {
      const resBot = await fetch(`${BOT_DAEMON_URL}/publicar-grupo`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-bot-secret": INTERNAL_BOT_SECRET,
        },
        body: JSON.stringify({
          salaId,
          texto: textoLimpio,
          quotedMsgId: quotedMsgId || null,
        }),
      });
      const dataBot = await resBot.json().catch(() => null);
      resBotOk = Boolean(dataBot?.ok);
      resBotMotivo = dataBot?.error || dataBot?.motivo || "";
    } catch (errBot: any) {
      console.warn("[Enviar] Baileys 3005 inaccesible o apagado:", errBot?.message);
    }

    return NextResponse.json({
      ok: true,
      mensaje: msgInsert || null,
      publicadoWhatsApp: resBotOk,
      motivoBot: resBotMotivo || null,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, motivo: err?.message || "Error al enviar mensaje" },
      { status: 500 }
    );
  }
}
