// ============================================================================
// EDGE FUNCTION: whatsapp-grupos
//
// Puerta de control de la conexión al grupo:
//   estado           → ¿están cargados el token y el Phone Number ID de Meta?
//   listar           → los grupos detectados por el webhook (+ cuál está vinculado)
//   vincular         → marca UN grupo como destino de los envíos
//   desvincular      → saca la marca
//   renombrar        → pone un nombre humano al grupo detectado
//   automatizaciones → lista los toggles de envío automático por módulo
//   automatizacion   → activa/desactiva el envío automático de un módulo
//
// ---------------------------------------------------------------------------
// INSTALAR
// ---------------------------------------------------------------------------
//   npx supabase secrets set WHATSAPP_ACCESS_TOKEN="..." \
//                         WHATSAPP_PHONE_NUMBER_ID="..."
//   npx supabase functions deploy whatsapp-grupos
//
// La base que se toca es public.whatsapp_grupos y public.whatsapp_automatizaciones
// (sql/whatsapp_integracion.sql). El service role escribe sin RLS; la
// verificación de quién llama la hace ESTA función con `auth.getUser` + la RPC
// `tiene_capacidad`, que ya contempla al usuario principal (josorioc → todo).
// ============================================================================

import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const MAX_BODY = 64 * 1024;

function json(d: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(d), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

type Fila = Record<string, unknown>;

const texto = (v: unknown, max = 200): string => String(v ?? "").trim().slice(0, max);

/** Contar que el número de mensaje sea razonable, no pasa de 4096. */
const mensajeOk = (v: unknown): string => {
  const s = String(v ?? "").trim();
  return s.length > 0 && s.length <= 4096 ? s : "";
};

/**
 * ¿Quién llama es staff con alguna de las capacidades de WhatsApp (o el
 * principal)? Mismo patrón que portal-auth: primero se valida el JWT contra
 * Supabase Auth, y después se pregunta por la RPC del maestro para no
 * reimplementar la precedencia acá.
 */
async function esStaffConCapacidad(
  db: SupabaseClient,
  req: Request,
  claves: string[]
): Promise<{ ok: boolean; error?: string; id?: string }> {
  const h = req.headers.get("authorization") ?? "";
  const jwt = h.replace(/^Bearer\s+/i, "").trim();
  if (!jwt || jwt.split(".").length !== 3) return { ok: false, error: "Sin sesión válida." };
  try {
    const { data, error } = await db.auth.getUser(jwt);
    const user = data?.user;
    if (error || !user) return { ok: false, error: "Sesión no válida." };
    for (const clave of claves) {
      const { data: puede, error: eRbac } = await db.rpc("tiene_capacidad", { u: user.id, clave });
      if (!eRbac && puede === true) return { ok: true, id: user.id };
    }
    return { ok: false, error: "No tenés permiso para operar WhatsApp." };
  } catch {
    return { ok: false, error: "No se pudo validar la sesión." };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ ok: false, error: "Método no permitido." }, 405);

  const cuerpo = await req.text();
  if (cuerpo.length > MAX_BODY) return json({ ok: false, error: "Solicitud demasiado grande." }, 413);

  let e: Fila;
  try {
    e = JSON.parse(cuerpo);
  } catch {
    return json({ ok: false, error: "Datos inválidos." }, 400);
  }

  const accion = texto(e.accion, 40);
  if (!accion) return json({ ok: false, error: "Falta la acción." }, 400);

  const db = createClient(URL, SERVICE, { auth: { persistSession: false } });

  // `estado` no exige permiso: es una sonda de configuración inofensiva y la
  // UI la usa para saber si mostrar la guía o el panel de vinculación. Todo lo
  // demás sí exige membrete del staff.
  if (accion === "estado") {
    return json({
      ok: true,
      configurado: Boolean(Deno.env.get("WHATSAPP_ACCESS_TOKEN") && Deno.env.get("WHATSAPP_PHONE_NUMBER_ID")),
      webhook: Boolean(Deno.env.get("WHATSAPP_VERIFY_TOKEN")),
    });
  }

  const staff = await esStaffConCapacidad(db, req, ["whatsapp:vincular_grupo", "whatsapp:enviar_grupo"]);
  if (!staff.ok) return json({ ok: false, error: staff.error ?? "Sin permiso." }, 403);

  // --- listar grupos detectados --------------------------------------------
  if (accion === "listar") {
    const { data, error } = await db
      .from("whatsapp_grupos")
      .select("*")
      .order("primera_deteccion", { ascending: false });
    if (error) return json({ ok: false, error: "No se pudieron leer los grupos." }, 502);
    return json({ ok: true, grupos: data ?? [] });
  }

  // --- vincular uno (desmarca los demás) -----------------------------------
  if (accion === "vincular") {
    const gid = texto(e.group_id, 400);
    if (!gid) return json({ ok: false, error: "Falta el group_id." }, 400);
    const { data: existe } = await db.from("whatsapp_grupos").select("group_id").eq("group_id", gid).maybeSingle();
    if (!existe) return json({ ok: false, error: "Ese grupo no está en la lista de detectados." }, 404);

    // Primero se desmarca el actual: el índice único sobre `(true) where
    // vinculado` rechaza el UPDATE si ya hay otra fila marcada.
    const { error: eSel } = await db.from("whatsapp_grupos").update({ vinculado: false }).eq("vinculado", true);
    if (eSel) return json({ ok: false, error: "No se pudo actualizar el grupo vinculado." }, 502);

    const patch: Fila = { vinculado: true };
    const nombre = texto(e.nombre, 120);
    if (nombre) patch.nombre = nombre;

    const { data, error } = await db.from("whatsapp_grupos").update(patch).eq("group_id", gid).select("*").single();
    if (error || !data) return json({ ok: false, error: "No se pudo vincular el grupo." }, 502);
    return json({ ok: true, grupo: data });
  }

  // --- desvincular ----------------------------------------------------------
  if (accion === "desvincular") {
    const { error } = await db.from("whatsapp_grupos").update({ vinculado: false }).eq("vinculado", true);
    if (error) return json({ ok: false, error: "No se pudo desvincular." }, 502);
    return json({ ok: true });
  }

  // --- renombrar un grupo detectado ----------------------------------------
  if (accion === "renombrar") {
    const gid = texto(e.group_id, 400);
    const nombre = texto(e.nombre, 120);
    if (!gid || !nombre) return json({ ok: false, error: "Faltan group_id y nombre." }, 400);
    const { error } = await db.from("whatsapp_grupos").update({ nombre }).eq("group_id", gid);
    if (error) return json({ ok: false, error: "No se pudo guardar el nombre." }, 502);
    return json({ ok: true });
  }

  // --- toggles de envío automático -----------------------------------------
  if (accion === "automatizaciones") {
    const { data, error } = await db.from("whatsapp_automatizaciones").select("*").order("modulo");
    if (error) return json({ ok: false, error: "No se pudieron leer las automatizaciones." }, 502);
    return json({ ok: true, automatizaciones: data ?? [] });
  }

  if (accion === "automatizacion") {
    const modulo = texto(e.modulo, 60);
    const activo = e.activo === true || e.activo === "true";
    if (!modulo) return json({ ok: false, error: "Falta el módulo." }, 400);
    const { error } = await db.from("whatsapp_automatizaciones").upsert(
      { modulo, activo, updated_at: new Date().toISOString() },
      { onConflict: "modulo" }
    );
    if (error) return json({ ok: false, error: "No se pudo guardar la automatización." }, 502);
    return json({ ok: true, modulo, activo });
  }

  return json({ ok: false, error: "Acción desconocida." }, 400);
});