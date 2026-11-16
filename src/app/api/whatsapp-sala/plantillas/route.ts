import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/core/supabase-admin";
import { PLANTILLAS_GRUPO_DEFAULT } from "@/features/whatsapp/lib/plantillas-grupo";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const grupoId = searchParams.get("grupo_id");

    if (!grupoId) {
      return NextResponse.json({ ok: false, error: "grupo_id es requerido" }, { status: 400 });
    }

    let plantillasPersonalizadas: any[] = [];
    try {
      const { data, error } = await supabaseAdmin
        .from("whatsapp_plantillas_grupo")
        .select("*")
        .eq("grupo_id", grupoId);

      if (!error && Array.isArray(data)) {
        plantillasPersonalizadas = data;
      }
    } catch {
      // Si la tabla aún no existe, continuará con los defaults
    }

    const mapaPers = new Map<string, any>();
    for (const p of plantillasPersonalizadas) {
      if (p.clave) mapaPers.set(p.clave, p);
    }

    const resultado = PLANTILLAS_GRUPO_DEFAULT.map((def) => {
      const pers = mapaPers.get(def.clave);
      return {
        ...def,
        contenido: pers?.contenido || def.contenido,
        personalizado: Boolean(pers),
      };
    });

    return NextResponse.json({ ok: true, plantillas: resultado });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { grupo_id, clave, contenido } = body;

    if (!grupo_id || !clave || typeof contenido !== "string") {
      return NextResponse.json(
        { ok: false, error: "grupo_id, clave y contenido son requeridos" },
        { status: 400 }
      );
    }

    const def = PLANTILLAS_GRUPO_DEFAULT.find((p) => p.clave === clave);
    const titulo = def?.titulo || clave;
    const variables = def?.variables || [];

    let guardado = false;
    try {
      const { error } = await supabaseAdmin
        .from("whatsapp_plantillas_grupo")
        .upsert(
          {
            grupo_id,
            clave,
            titulo,
            contenido,
            variables_disponibles: variables,
            activo: true,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "grupo_id,clave" }
        );

      if (!error) {
        guardado = true;
      }
    } catch {
      guardado = false;
    }

    return NextResponse.json({ ok: true, guardado, clave, contenido });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message }, { status: 500 });
  }
}
