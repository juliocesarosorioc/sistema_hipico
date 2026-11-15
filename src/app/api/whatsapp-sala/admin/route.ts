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

export async function GET() {
  try {
    const res = await fetch(`${BOT_DAEMON_URL}/status`, {
      method: "GET",
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json(
        {
          ok: false,
          conectado: false,
          grupos: [],
          motivo: "Bot Baileys en puerto 3005 apagado o reiniciando",
        },
        { status: 200 }
      );
    }
    const data = await res.json();
    return NextResponse.json(data, { status: 200 });
  } catch {
    return NextResponse.json(
      {
        ok: false,
        conectado: false,
        grupos: [],
        motivo: "Bot Baileys en puerto 3005 apagado o reiniciando",
      },
      { status: 200 }
    );
  }
}

export async function POST(req: NextRequest) {
  const _origin = req.headers.get("origin");
  const _host = req.headers.get("host");
  if (_origin && !_origin.includes(_host || "")) {
    return NextResponse.json({ error: "CSRF bloqueado" }, { status: 403 });
  }
  try {
    const body = await req.json().catch(() => ({}));
    const accion = String(body.accion || body.action || "");

    // 1. Vincular grupo a sala
    if (accion === "vincular_grupo_sala" || accion === "vincular-grupo-sala") {
      const { grupoId, salaId, groupJid } = body;
      try {
        const resBot = await fetch(`${BOT_DAEMON_URL}/verificar-y-vincular`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-internal-bot-secret": INTERNAL_BOT_SECRET,
          },
          body: JSON.stringify({ grupoId, salaId, groupJid }),
        });
        const json = await resBot.json().catch(() => null);
        return NextResponse.json(
          json || { ok: false, motivo: "Respuesta inválida del demonio Baileys" },
          { status: 200 }
        );
      } catch {
        return NextResponse.json(
          {
            ok: false,
            conectado: false,
            grupos: [],
            motivo: "Bot Baileys en puerto 3005 apagado o reiniciando",
          },
          { status: 200 }
        );
      }
    }

    // 2. Desvincular grupo de sala
    if (accion === "desvincular_grupo_sala" || accion === "desvincular-grupo-sala") {
      const { salaId, groupJid } = body;
      try {
        const resBot = await fetch(`${BOT_DAEMON_URL}/desvincular-grupo`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-internal-bot-secret": INTERNAL_BOT_SECRET,
          },
          body: JSON.stringify({ salaId, groupJid }),
        });
        const json = await resBot.json().catch(() => null);
        return NextResponse.json(
          json || { ok: false, motivo: "Respuesta inválida del demonio Baileys" },
          { status: 200 }
        );
      } catch {
        return NextResponse.json(
          {
            ok: false,
            conectado: false,
            grupos: [],
            motivo: "Bot Baileys en puerto 3005 apagado o reiniciando",
          },
          { status: 200 }
        );
      }
    }

    // 3. Crear sala (máximo 2 salas por grupo_id)
    if (accion === "crear_sala" || accion === "crear-sala") {
      const { grupoId, nombreSala, hipodromoActivo } = body;
      if (!grupoId) {
        return NextResponse.json({ ok: false, motivo: "grupoId es requerido" }, { status: 200 });
      }

      const { data: existentes } = await supabaseAdmin
        .from("salas_juego")
        .select("id, orden_sala")
        .eq("grupo_id", grupoId)
        .eq("activa", true)
        .order("orden_sala", { ascending: true });

      if ((existentes?.length || 0) >= 2) {
        return NextResponse.json(
          { ok: false, motivo: "Máximo 2 salas permitidas por grupo" },
          { status: 200 }
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
          hipodromo_activo:
            hipodromoActivo || (siguienteOrden === 1 ? "LA RINCONADA" : "GULFSTREAM PARK"),
          numero_carrera_activa: 1,
        })
        .select()
        .single();

      if (errCrear) {
        return NextResponse.json({ ok: false, motivo: errCrear.message }, { status: 200 });
      }
      return NextResponse.json(
        { ok: true, sala: creada, motivo: `Sala "${nombreFinal}" creada exitosamente` },
        { status: 200 }
      );
    }

    // 4. Eliminar sala
    if (accion === "eliminar_sala" || accion === "eliminar-sala") {
      const { salaId } = body;
      if (!salaId) {
        return NextResponse.json({ ok: false, motivo: "salaId es requerido" }, { status: 200 });
      }

      await supabaseAdmin.from("salas_whatsapp_grupos").delete().eq("sala_id", salaId);
      const { error: errDel } = await supabaseAdmin
        .from("salas_juego")
        .update({ activa: false, whatsapp_group_jid: null, updated_at: new Date().toISOString() })
        .eq("id", salaId);

      if (errDel) {
        return NextResponse.json({ ok: false, motivo: errDel.message }, { status: 200 });
      }
      return NextResponse.json(
        { ok: true, motivo: "Sala eliminada correctamente" },
        { status: 200 }
      );
    }

    // 4.1 Actualizar configuración de sala (apuesta mínima, vencimiento, topes de marcas)
    if (accion === "actualizar_config_sala" || accion === "actualizar-config-sala") {
      const {
        salaId,
        apuestaMinima,
        tiempoVencimientoPropuestaMin,
        topeCaballosMarcasNacional,
        topeCaballosMarcasInternacional,
        nombreSala,
        hipodromoActivo,
      } = body;
      if (!salaId) {
        return NextResponse.json({ ok: false, motivo: "salaId es requerido" }, { status: 200 });
      }

      const payload: Record<string, any> = {
        updated_at: new Date().toISOString(),
      };
      if (apuestaMinima !== undefined) {
        const n = parseFloat(String(apuestaMinima));
        if (Number.isFinite(n) && n > 0) payload.apuesta_minima = n;
      }
      if (tiempoVencimientoPropuestaMin !== undefined) {
        const n = parseInt(String(tiempoVencimientoPropuestaMin), 10);
        if (Number.isFinite(n) && n > 0) {
          payload.tiempo_vencimiento_propuesta_min = n;
          payload.tiempo_vencimiento_min = n;
        }
      }
      if (topeCaballosMarcasNacional !== undefined) {
        const n = parseInt(String(topeCaballosMarcasNacional), 10);
        if (Number.isFinite(n) && n > 0) {
          payload.tope_caballos_marcas_nacional = n;
          payload.tope_marcas_nacional = n;
        }
      }
      if (topeCaballosMarcasInternacional !== undefined) {
        const n = parseInt(String(topeCaballosMarcasInternacional), 10);
        if (Number.isFinite(n) && n > 0) {
          payload.tope_caballos_marcas_internacional = n;
          payload.tope_marcas_americano = n;
        }
      }
      if (nombreSala) payload.nombre_sala = String(nombreSala).trim();
      if (hipodromoActivo) payload.hipodromo_activo = String(hipodromoActivo).trim().toUpperCase();

      const { data: updated, error: errUpd } = await supabaseAdmin
        .from("salas_juego")
        .update(payload)
        .eq("id", salaId)
        .select()
        .single();

      if (errUpd) {
        return NextResponse.json({ ok: false, motivo: errUpd.message }, { status: 200 });
      }

      return NextResponse.json({ ok: true, sala: updated }, { status: 200 });
    }

    // 5. Proxy fallback seguro a http://127.0.0.1:3005
    try {
      const endpoint = body.endpoint ? String(body.endpoint) : "/status";
      const method = body.method ? String(body.method) : "POST";
      const resBot = await fetch(
        `${BOT_DAEMON_URL}${endpoint.startsWith("/") ? endpoint : "/" + endpoint}`,
        {
          method,
          headers: {
            "Content-Type": "application/json",
            "x-internal-bot-secret": INTERNAL_BOT_SECRET,
          },
          body: method !== "GET" ? JSON.stringify(body) : undefined,
        }
      );
      const json = await resBot.json().catch(() => null);
      return NextResponse.json(
        json || { ok: false, motivo: "Respuesta sin contenido" },
        { status: 200 }
      );
    } catch {
      return NextResponse.json(
        {
          ok: false,
          conectado: false,
          grupos: [],
          motivo: "Bot Baileys en puerto 3005 apagado o reiniciando",
        },
        { status: 200 }
      );
    }
  } catch {
    return NextResponse.json(
      {
        ok: false,
        conectado: false,
        grupos: [],
        motivo: "Bot Baileys en puerto 3005 apagado o reiniciando",
      },
      { status: 200 }
    );
  }
}
