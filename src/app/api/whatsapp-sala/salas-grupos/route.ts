import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/core/supabase-admin";

export const dynamic = "force-dynamic";

const BOT_DAEMON_URL = process.env.WHATSAPP_BOT_URL || "http://127.0.0.1:3005";
const INTERNAL_BOT_SECRET = process.env.INTERNAL_BOT_SECRET || "SH-BOT-SECRET-2026";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const grupoId = searchParams.get("grupoId") || searchParams.get("grupo_id") || "";
    const salaId = searchParams.get("salaId") || searchParams.get("sala_id") || "";

    const { data: gruposSistema } = await supabaseAdmin
      .from("grupos_venta")
      .select("id, nombre, moneda, activo")
      .eq("activo", true)
      .order("created_at", { ascending: true });

    let qSalas = supabaseAdmin
      .from("salas_juego")
      .select("*")
      .eq("activa", true)
      .order("orden_sala", { ascending: true });

    if (grupoId) {
      qSalas = qSalas.eq("grupo_id", grupoId).limit(2);
    }
    if (salaId) {
      qSalas = qSalas.eq("id", salaId);
    }

    const { data: salasRaw, error: errSalas } = await qSalas;
    if (errSalas) {
      return NextResponse.json({ ok: false, motivo: errSalas.message }, { status: 500 });
    }

    const salaIds = (salasRaw || []).map((s: any) => s.id);
    let vinculosPorSala: Record<string, any[]> = {};

    if (salaIds.length > 0) {
      const { data: vinculos } = await supabaseAdmin
        .from("salas_whatsapp_grupos")
        .select("*")
        .in("sala_id", salaIds)
        .eq("activo", true)
        .order("created_at", { ascending: true });

      for (const v of vinculos || []) {
        if (!vinculosPorSala[v.sala_id]) vinculosPorSala[v.sala_id] = [];
        vinculosPorSala[v.sala_id].push(v);
      }
    }

    const grupoNombrePorId = new Map<string, string>();
    for (const g of gruposSistema || []) {
      if (g?.id) grupoNombrePorId.set(String(g.id), String(g.nombre || ""));
    }

    const salas = (salasRaw || []).map((s: any) => ({
      ...s,
      grupo_nombre: grupoNombrePorId.get(String(s.grupo_id)) || null,
      grupos_whatsapp: vinculosPorSala[s.id] || [],
    }));

    return NextResponse.json({
      ok: true,
      salas,
      gruposSistema: gruposSistema || [],
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, motivo: err?.message || "Error consultando salas y grupos" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const accion = String(body.accion || "");

    if (accion === "crear-sala") {
      const { grupoId, nombreSala, hipodromoActivo } = body;
      if (!grupoId) {
        return NextResponse.json({ ok: false, motivo: "grupoId es requerido" }, { status: 400 });
      }

      const { data: existentes } = await supabaseAdmin
        .from("salas_juego")
        .select("id, orden_sala")
        .eq("grupo_id", grupoId)
        .eq("activa", true)
        .order("orden_sala", { ascending: true });

      if ((existentes?.length || 0) >= 2) {
        return NextResponse.json(
          { ok: false, motivo: "Máximo 2 salas activas permitidas por grupo" },
          { status: 400 }
        );
      }

      const siguienteOrden = (existentes?.length || 0) + 1;
      const nombreFinal =
        String(nombreSala || "").trim() ||
        (siguienteOrden === 1 ? "Sala 1 - Nacionales" : "Sala 2 - Americanas");

      const { data: creada, error: errCrear } = await supabaseAdmin
        .from("salas_juego")
        .insert({
          grupo_id: grupoId,
          nombre_sala: nombreFinal,
          orden_sala: siguienteOrden,
          activa: true,
          estado_carrera: "abierta",
          hipodromo_activo: hipodromoActivo || (siguienteOrden === 1 ? "LA RINCONADA" : "GULFSTREAM PARK"),
          numero_carrera_activa: 1,
        })
        .select()
        .single();

      if (errCrear) {
        return NextResponse.json({ ok: false, motivo: errCrear.message }, { status: 500 });
      }
      return NextResponse.json({ ok: true, sala: creada, motivo: `Sala "${nombreFinal}" creada` });
    }

    if (accion === "eliminar-sala") {
      const { salaId } = body;
      if (!salaId) {
        return NextResponse.json({ ok: false, motivo: "salaId es requerido" }, { status: 400 });
      }

      await supabaseAdmin.from("salas_whatsapp_grupos").delete().eq("sala_id", salaId);
      const { error: errDel } = await supabaseAdmin
        .from("salas_juego")
        .update({ activa: false, whatsapp_group_jid: null, updated_at: new Date().toISOString() })
        .eq("id", salaId);

      if (errDel) {
        return NextResponse.json({ ok: false, motivo: errDel.message }, { status: 500 });
      }
      return NextResponse.json({ ok: true, motivo: "Sala eliminada correctamente" });
    }

    if (accion === "verificar-y-vincular") {
      const { grupoId, salaId, groupJid } = body;
      if (!salaId || !groupJid) {
        return NextResponse.json(
          { ok: false, motivo: "salaId y groupJid son requeridos" },
          { status: 400 }
        );
      }

      try {
        const resBot = await fetch(`${BOT_DAEMON_URL}/verificar-y-vincular`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-internal-bot-secret": INTERNAL_BOT_SECRET,
          },
          body: JSON.stringify({ grupoId, salaId, groupJid }),
          cache: "no-store",
        });
        const json = await resBot.json().catch(() => ({}));
        return NextResponse.json({
          ok: Boolean(json?.ok),
          motivo: json?.motivo || json?.error || "Sin respuesta del motor Baileys",
          nombreGrupo: json?.nombreGrupo || null,
        });
      } catch {
        return NextResponse.json({
          ok: false,
          motivo: "Motor Baileys desconectado o inaccesible en 127.0.0.1:3005",
        });
      }
    }

    if (accion === "desvincular-grupo") {
      const { id, salaId, groupJid } = body;
      try {
        const resBot = await fetch(`${BOT_DAEMON_URL}/desvincular-grupo`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-internal-bot-secret": INTERNAL_BOT_SECRET,
          },
          body: JSON.stringify({ id, salaId, groupJid }),
          cache: "no-store",
        });
        const json = await resBot.json().catch(() => ({}));
        if (resBot.ok && json?.ok) {
          return NextResponse.json({ ok: true, motivo: json?.motivo || "Desvinculado" });
        }
      } catch {
        // Fallback directo a Supabase si el daemon está offline
      }

      let qDel = supabaseAdmin.from("salas_whatsapp_grupos").delete();
      if (id) {
        qDel = qDel.eq("id", id);
      } else if (salaId && groupJid) {
        qDel = qDel.eq("sala_id", salaId).eq("whatsapp_group_jid", groupJid);
      } else {
        return NextResponse.json({ ok: false, motivo: "id o salaId/groupJid requeridos" }, { status: 400 });
      }
      const { error } = await qDel;
      if (error) {
        return NextResponse.json({ ok: false, motivo: error.message }, { status: 500 });
      }
      return NextResponse.json({ ok: true, motivo: "Grupo desvinculado correctamente" });
    }

    return NextResponse.json({ ok: false, motivo: `Acción no soportada: ${accion}` }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, motivo: err?.message || "Error procesando solicitud" },
      { status: 500 }
    );
  }
}
