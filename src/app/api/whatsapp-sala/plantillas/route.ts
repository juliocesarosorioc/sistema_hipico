import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/core/supabase-admin";
import { PLANTILLAS_GRUPO_DEFAULT } from "@/features/whatsapp/lib/plantillas-grupo";

export const dynamic = "force-dynamic";

type OrigenPlantilla = "grupo" | "global" | "default";

const TABLA = "whatsapp_plantillas_grupo";

/** `null`, `GLOBAL` y `__GLOBAL__` identifican la misma fila global (grupo_id IS NULL). */
function esGlobal(grupoId: unknown): boolean {
  if (grupoId == null) return true;
  const valor = String(grupoId).trim();
  return (
    !valor ||
    valor.toUpperCase() === "GLOBAL" ||
    valor === "__GLOBAL__" ||
    valor.toUpperCase() === "__GLOBAL__"
  );
}

type FilaPlantilla = {
  clave?: string | null;
  contenido?: string | null;
  titulo?: string | null;
  activo?: boolean | null;
};

function indicesPorClave(filas: any[] | null | undefined): Map<string, FilaPlantilla> {
  const mapa = new Map<string, FilaPlantilla>();
  for (const fila of filas || []) {
    const clave = String(fila?.clave ?? "").trim();
    if (!clave || fila?.activo === false) continue;
    mapa.set(clave, fila);
  }
  return mapa;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const grupoIdParam = searchParams.get("grupo_id") || searchParams.get("grupoId");
    const global = esGlobal(grupoIdParam);

    // Compatibilidad: si no viene grupo_id se interpreta como consulta global.
    const globales: any[] = [];
    try {
      const { data, error } = await supabaseAdmin
        .from(TABLA)
        .select("clave, contenido, activo, titulo, variables_disponibles, updated_at")
        .is("grupo_id", null);
      if (!error && Array.isArray(data)) globales.push(...data);
    } catch {
      // Tabla opcional: se continúa con los defaults.
    }
    const mapaGlobal = indicesPorClave(globales);

    const mapaGrupo = new Map<string, FilaPlantilla>();
    if (!global) {
      try {
        const { data, error } = await supabaseAdmin
          .from(TABLA)
          .select("clave, contenido, activo, titulo, variables_disponibles, updated_at")
          .eq("grupo_id", String(grupoIdParam));
        if (!error && Array.isArray(data)) {
          for (const [clave, fila] of indicesPorClave(data)) mapaGrupo.set(clave, fila);
        }
      } catch {
        // Tabla opcional: se continúa con globales/defaults.
      }
    }

    const resultado = PLANTILLAS_GRUPO_DEFAULT.map((def) => {
      const filaGlobal = mapaGlobal.get(def.clave);
      const filaGrupo = mapaGrupo.get(def.clave);

      // Precedencia: grupo > global > default.
      const elegida = filaGrupo || filaGlobal || null;
      const origen: OrigenPlantilla = filaGrupo ? "grupo" : filaGlobal ? "global" : "default";
      const contenido =
        typeof elegida?.contenido === "string" && elegida.contenido.trim()
          ? elegida.contenido
          : def.contenido;

      return {
        ...def,
        contenido,
        titulo:
          (typeof elegida?.titulo === "string" && elegida.titulo.trim()) || def.titulo,
        origen,
        // `personalizado` se mantiene por compatibilidad con el front actual.
        personalizado: origen !== "default",
      };
    });

    return NextResponse.json({
      ok: true,
      grupo_id: global ? null : String(grupoIdParam),
      es_global: global,
      plantillas: resultado,
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { grupo_id: grupoIdParam, clave, contenido } = body || {};

    const global = esGlobal(grupoIdParam);
    const claveLimpia = String(clave ?? "").trim();
    if (!claveLimpia || typeof contenido !== "string") {
      return NextResponse.json(
        { ok: false, error: "clave y contenido son requeridos" },
        { status: 400 }
      );
    }

    const def = PLANTILLAS_GRUPO_DEFAULT.find((p) => p.clave === claveLimpia);
    if (!def) {
      return NextResponse.json(
        { ok: false, error: `Clave de plantilla no válida: ${claveLimpia}` },
        { status: 400 }
      );
    }

    const payload = {
      clave: claveLimpia,
      titulo: def.titulo,
      contenido,
      variables_disponibles: def.variables,
      activo: true,
      updated_at: new Date().toISOString(),
    };

    let guardado = false;
    let detalleError = "";

    try {
      if (global) {
        // El índice parcial UNIQUE (clave) WHERE grupo_id IS NULL no se puede
        // dirigir con `on_conflict` de PostgREST: upsert manual por id.
        const { data: existente, error: errBuscar } = await supabaseAdmin
          .from(TABLA)
          .select("id")
          .is("grupo_id", null)
          .eq("clave", claveLimpia)
          .maybeSingle();
        if (errBuscar) throw errBuscar;

        const respuesta = existente?.id
          ? await supabaseAdmin
              .from(TABLA)
              .update(payload)
              .eq("id", existente.id)
              .select("id")
              .maybeSingle()
          : await supabaseAdmin
              .from(TABLA)
              .insert({ ...payload, grupo_id: null })
              .select("id")
              .maybeSingle();

        detalleError = respuesta.error?.message || "";
        guardado = Boolean(respuesta.data?.id) && !respuesta.error;
      } else {
        const respuesta = await supabaseAdmin
          .from(TABLA)
          .upsert(
            { ...payload, grupo_id: String(grupoIdParam) },
            { onConflict: "grupo_id,clave" }
          )
          .select("id")
          .maybeSingle();
        detalleError = respuesta.error?.message || "";
        guardado = Boolean(respuesta.data?.id) && !respuesta.error;
      }
    } catch (err: any) {
      detalleError = err?.message || "Error de base de datos";
      guardado = false;
    }

    if (!guardado) {
      return NextResponse.json(
        { ok: false, guardado: false, error: detalleError || "No se pudo guardar la plantilla" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      guardado: true,
      clave: claveLimpia,
      contenido,
      origen: global ? "global" : "grupo",
      grupo_id: global ? null : String(grupoIdParam),
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message }, { status: 500 });
  }
}
