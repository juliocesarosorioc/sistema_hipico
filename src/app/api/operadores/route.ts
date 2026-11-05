import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function GET(req: NextRequest) {
  const supabase = getAdminClient();
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Base de datos no configurada" }, { status: 500 });
  }

  const { searchParams } = new URL(req.url);
  const grupoId = searchParams.get("grupoId");

  try {
    let query = supabase
      .from("usuario_sistema")
      .select("id, nombre, activo, grupo_id, creado_en, clave_acceso, telefono, codigo_pais, tipo_usuario_id, tipo_usuario(nombre)")
      .order("creado_en", { ascending: false });

    if (grupoId && grupoId.trim() !== "") {
      query = query.eq("grupo_id", grupoId.trim());
    }

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      operadores: (data || []).map((u) => ({
        id: String(u.id ?? ""),
        nombre: String(u.nombre ?? u.id ?? ""),
        grupoId: String(u.grupo_id ?? ""),
        clave: u.clave_acceso ? String(u.clave_acceso) : "",
        telefono: u.telefono ? String(u.telefono) : undefined,
        codigoPais: u.codigo_pais ? String(u.codigo_pais) : undefined,
        activo: u.activo !== false,
        creadoEn: u.creado_en ? String(u.creado_en) : undefined,
      })),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const supabase = getAdminClient();
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Base de datos no configurada" }, { status: 500 });
  }

  try {
    const body = await req.json();
    const { usuario, nombre, clave, grupoId, telefono, codigoPais, activo } = body;

    if (!usuario || typeof usuario !== "string") {
      return NextResponse.json({ ok: false, error: "Usuario requerido" }, { status: 400 });
    }

    const idLimpio = usuario.trim().toLowerCase();
    const grupoIdLimpio = String(grupoId || "").trim();

    // Intentar vía RPC
    try {
      const { data: rpcRes, error: rpcErr } = await supabase.rpc("club_guardar_operador", {
        p_usuario: idLimpio,
        p_nombre: (nombre || idLimpio).trim(),
        p_clave: (clave || "").trim(),
        p_grupo_id: grupoIdLimpio,
        p_telefono: telefono ? String(telefono).trim() : null,
        p_codigo_pais: codigoPais ? String(codigoPais).trim() : "+58",
        p_activo: activo !== false,
      });

      if (!rpcErr && rpcRes && (rpcRes as Record<string, unknown>).ok) {
        return NextResponse.json({ ok: true, data: rpcRes });
      }
    } catch {
      /* fallback directo */
    }

    // Direct upsert with service role
    const { error: upsertErr } = await supabase.from("usuario_sistema").upsert(
      {
        id: idLimpio,
        nombre: (nombre || idLimpio).trim(),
        tipo_usuario_id: 2,
        grupo_id: grupoIdLimpio || null,
        clave_acceso: (clave || "").trim() || null,
        telefono: telefono ? String(telefono).trim() : null,
        codigo_pais: codigoPais ? String(codigoPais).trim() : "+58",
        activo: activo !== false,
        es_principal: false,
      },
      { onConflict: "id" }
    );

    if (upsertErr) {
      return NextResponse.json({ ok: false, error: upsertErr.message }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      operador: {
        id: idLimpio,
        nombre: (nombre || idLimpio).trim(),
        grupoId: grupoIdLimpio,
        clave: (clave || "").trim(),
        telefono,
        codigoPais,
        activo: activo !== false,
      },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const supabase = getAdminClient();
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Base de datos no configurada" }, { status: 500 });
  }

  const { searchParams } = new URL(req.url);
  const usuario = searchParams.get("usuario");
  if (!usuario) {
    return NextResponse.json({ ok: false, error: "Usuario requerido" }, { status: 400 });
  }

  const idLimpio = usuario.trim().toLowerCase();

  try {
    try {
      await supabase.rpc("club_eliminar_operador", { p_usuario: idLimpio });
    } catch {
      /* fallback */
    }

    const { error: delErr } = await supabase.from("usuario_sistema").delete().eq("id", idLimpio);
    if (delErr) {
      // Si falla por FK, desvincular del grupo
      await supabase.from("usuario_sistema").update({ grupo_id: null, activo: false }).eq("id", idLimpio);
    }

    return NextResponse.json({ ok: true, usuario: idLimpio });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const supabase = getAdminClient();
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Base de datos no configurada" }, { status: 500 });
  }

  try {
    const { usuario, activo } = await req.json();
    if (!usuario) {
      return NextResponse.json({ ok: false, error: "Usuario requerido" }, { status: 400 });
    }

    const idLimpio = String(usuario).trim().toLowerCase();
    const { error } = await supabase
      .from("usuario_sistema")
      .update({ activo: Boolean(activo) })
      .eq("id", idLimpio);

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true, usuario: idLimpio, activo: Boolean(activo) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
