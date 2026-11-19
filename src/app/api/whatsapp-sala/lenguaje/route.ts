import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/core/supabase-admin";
import { LENGUAJE_HUMANIZADO_SEED } from "@/features/whatsapp-sala/lib/lenguaje-bot";

export const dynamic = "force-dynamic";

function csrfOk(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  return !origin || !host || origin.includes(host);
}

function texto(row: any, keys: string[], fallback = ""): string {
  for (const key of keys) {
    const value = row?.[key];
    if (value != null && String(value).trim()) return String(value).trim();
  }
  return fallback;
}

function normalizarRevision(row: any) {
  return {
    id: row?.id ? String(row.id) : "",
    grupo_id: row?.grupo_id ? String(row.grupo_id) : null,
    sala_id: row?.sala_id ? String(row.sala_id) : null,
    usuario_id: row?.usuario_id ? String(row.usuario_id) : null,
    usuario_nombre: texto(row, ["usuario_nombre"], "Jugador"),
    mensaje_usuario_original: texto(row, [
      "mensaje_usuario_original",
      "termino_original",
      "texto_original",
    ]),
    jugada_corregida_sugerida: texto(row, [
      "jugada_corregida_sugerida",
      "jugada_corregida",
      "correccion_sugerida",
    ]),
    motivo_rechazo: texto(row, ["motivo_rechazo", "motivo"], "LENGUAJE_NO_COMPRENDIDO"),
    intencion_detectada: texto(row, ["intencion_detectada", "intencion"]),
    respuesta_ia_enviada: texto(row, ["respuesta_ia_enviada"]),
    nivel_confianza: Number(row?.nivel_confianza ?? 0),
    estado: texto(row, ["estado_ticket_soporte", "estado"], "PENDIENTE"),
    created_at: row?.created_at || null,
  };
}

function normalizarAprendido(row: any) {
  return {
    id: row?.id ? String(row.id) : "",
    termino_original: texto(row, ["termino_original", "mensaje_usuario_original"]),
    jugada_corregida: texto(row, ["jugada_corregida", "jugada_corregida_sugerida"]),
    intencion_detectada: texto(row, ["intencion_detectada", "intencion"]),
    motivo_rechazo: texto(row, ["motivo_rechazo", "motivo"]),
    nivel_confianza: Number(row?.nivel_confianza ?? 0),
    created_at: row?.created_at || null,
  };
}

export async function GET(req: NextRequest) {
  try {
    const grupoId = req.nextUrl.searchParams.get("grupo_id");
    let revisiones: any[] = [];
    let aprendido: any[] = [];

    try {
      let q = supabaseAdmin
        .from("registro_revision_llm")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (grupoId) q = q.eq("grupo_id", grupoId);
      const { data, error } = await q;
      if (!error && Array.isArray(data)) revisiones = data.map(normalizarRevision);
    } catch {
      revisiones = [];
    }

    try {
      let q = supabaseAdmin
        .from("diccionario_aprendizaje_bot")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (grupoId) q = q.eq("grupo_id", grupoId);
      const { data, error } = await q;
      if (!error && Array.isArray(data)) aprendido = data.map(normalizarAprendido);
    } catch {
      aprendido = [];
    }

    return NextResponse.json({
      ok: true,
      revisiones,
      aprendido,
      semilla: LENGUAJE_HUMANIZADO_SEED,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || "No se pudo cargar el lenguaje del bot" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  if (!csrfOk(req)) {
    return NextResponse.json({ ok: false, error: "CSRF bloqueado" }, { status: 403 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const accion = String(body?.accion || "ensenar").toLowerCase();
    const grupoId = body?.grupo_id ? String(body.grupo_id) : null;
    const salaId = body?.sala_id ? String(body.sala_id) : null;

    if (accion === "sembrar") {
      let insertados = 0;
      try {
        const filas = LENGUAJE_HUMANIZADO_SEED.map((s) => ({
          ...s,
          grupo_id: grupoId,
          sala_id: salaId,
          activo: true,
          origen: "SEMILLA_HUMANIZADA",
        }));
        const { error } = await supabaseAdmin
          .from("diccionario_aprendizaje_bot")
          .insert(filas);
        if (!error) insertados = filas.length;
      } catch {
        insertados = 0;
      }
      return NextResponse.json({ ok: true, insertados });
    }

    if (accion === "descartar") {
      const id = body?.id ? String(body.id) : "";
      if (!id) {
        return NextResponse.json({ ok: false, error: "id es requerido" }, { status: 400 });
      }
      let actualizado = false;
      try {
        const { error } = await supabaseAdmin
          .from("registro_revision_llm")
          .update({ estado_ticket_soporte: "DESCARTADO" })
          .eq("id", id);
        actualizado = !error;
      } catch {
        actualizado = false;
      }
      return NextResponse.json({ ok: true, actualizado });
    }

    if (accion !== "ensenar") {
      return NextResponse.json({ ok: false, error: "Acción no soportada" }, { status: 400 });
    }

    const terminoOriginal = String(body?.termino_original || "").trim();
    const jugadaCorregida = String(
      body?.jugada_corregida || body?.jugada_corregida_sugerida || ""
    ).trim();
    if (!terminoOriginal || !jugadaCorregida) {
      return NextResponse.json(
        { ok: false, error: "termino_original y jugada_corregida son requeridos" },
        { status: 400 }
      );
    }

    let guardado = false;
    try {
      const { error } = await supabaseAdmin.from("diccionario_aprendizaje_bot").insert({
        grupo_id: grupoId,
        sala_id: salaId,
        usuario_id: body?.usuario_id ? String(body.usuario_id) : null,
        usuario_nombre: body?.usuario_nombre ? String(body.usuario_nombre) : null,
        termino_original: terminoOriginal,
        mensaje_usuario_original: terminoOriginal,
        jugada_corregida: jugadaCorregida,
        jugada_corregida_sugerida: jugadaCorregida,
        intencion_detectada:
          String(body?.intencion_detectada || "LENGUAJE_ENSENADO").trim() || "LENGUAJE_ENSENADO",
        motivo_rechazo:
          String(body?.motivo_rechazo || "LENGUAJE_NO_COMPRENDIDO").trim() ||
          "LENGUAJE_NO_COMPRENDIDO",
        nivel_confianza: Number(body?.nivel_confianza ?? 0.9),
        activo: true,
        origen: "APRENDIZAJE_ADMIN",
      });
      guardado = !error;
    } catch {
      guardado = false;
    }

    if (body?.id) {
      try {
        await supabaseAdmin
          .from("registro_revision_llm")
          .update({ estado_ticket_soporte: "APRENDIDO" })
          .eq("id", String(body.id));
      } catch {
        // La auditoría es best-effort; el diccionario ya quedó registrado.
      }
    }

    return NextResponse.json({ ok: true, guardado });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || "No se pudo registrar el aprendizaje" },
      { status: 500 }
    );
  }
}
