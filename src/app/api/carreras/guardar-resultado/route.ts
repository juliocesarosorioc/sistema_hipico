import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { fecha, hipodromo, carrera, fila } = body;

    const hip = String(hipodromo ?? "").trim().toUpperCase();
    const num = Number(carrera);
    const f = String(fecha ?? "").trim().slice(0, 10);

    if (!hip || !num || !f) {
      return NextResponse.json({ ok: false, error: "Datos incompletos (fecha, hipodromo, carrera requeridos)" }, { status: 400 });
    }

    const supabase = getAdminClient();
    if (!supabase) {
      return NextResponse.json({ ok: false, error: "Base de datos no configurada" }, { status: 500 });
    }

    // Buscar fila existente en resultados_carreras
    const { data: existente } = await supabase
      .from("resultados_carreras")
      .select("*")
      .eq("fecha", f)
      .ilike("hipodromo", `%${hip}%`)
      .eq("carrera", num)
      .maybeSingle();

    const payload: Record<string, unknown> = {
      fecha: f,
      hipodromo: hip,
      carrera: num,
      ...(existente ?? {}),
      ...(fila ?? {}),
      updated_at: new Date().toISOString(),
    };

    if (fila?.ganadores && Array.isArray(fila.ganadores)) {
      payload.ganadores = fila.ganadores;
    }
    if (fila?.orden_llegada) {
      payload.orden_llegada = fila.orden_llegada;
    }
    if (fila?.dividendos) {
      payload.dividendos = fila.dividendos;
    }
    if (fila?.retirados !== undefined) {
      payload.retirados = fila.retirados;
    }
    if (fila?.aplicado_a_tablas !== undefined) {
      payload.aplicado_a_tablas = Boolean(fila.aplicado_a_tablas);
    }
    if (fila?.cargado_por) {
      payload.cargado_por = fila.cargado_por;
    }
    if (fila?.detalle) {
      payload.detalle = fila.detalle;
    }

    let err: string | null = null;
    if (existente?.id) {
      const { error: upErr } = await supabase
        .from("resultados_carreras")
        .update(payload)
        .eq("id", existente.id);
      if (upErr) err = upErr.message;
    } else {
      const { error: insErr } = await supabase
        .from("resultados_carreras")
        .insert([payload]);
      if (insErr) err = insErr.message;
    }

    if (err) {
      return NextResponse.json({ ok: false, error: err }, { status: 500 });
    }

    return NextResponse.json({ ok: true, data: payload });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
