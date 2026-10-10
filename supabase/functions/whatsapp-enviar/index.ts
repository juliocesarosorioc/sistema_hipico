// ============================================================================
// EDGE FUNCTION: whatsapp-enviar
//
// Envía un mensaje de texto por la Cloud API de WhatsApp Business:
//   - destino "grupo" (por defecto): al grupo VINCULADO en whatsapp_grupos.
//     El mensaje entra a la API como recipient_type "group" con el group_id.
//   - destino "telefono": a un número suelto (mismo formato individual).
//
// ---------------------------------------------------------------------------
// INSTALAR
// ---------------------------------------------------------------------------
//   npx supabase secrets set WHATSAPP_ACCESS_TOKEN="..." \
//                         WHATSAPP_PHONE_NUMBER_ID="..."
//   npx supabase functions deploy whatsapp-enviar
//
// Cómo se registra:
//   - public.whatsapp_envios  → bitácora técnica (id del mensaje, aceptado o no)
//   - public.notificaciones   → el historial que ya muestra el Centro WhatsApp
//
// LÍMITE CONOCIDO (ventana de servicio): la Cloud API solo acepta texto libre
// mientras haya una ventana abierta (24 h desde el último mensaje entrante del
// grupo). Si la ventana está cerrada, Meta rechaza con un error que pide una
// plantilla aprobada; ese error se devuelve tal cual para que la UI lo muestre.
// ============================================================================

import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TOKEN = Deno.env.get("WHATSAPP_ACCESS_TOKEN") ?? "";
const PHONE = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "";

const GRAPH = "https://graph.facebook.com/v21.0";
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

const mensajeOk = (v: unknown): string => {
  const s = String(v ?? "").trim();
  return s.length > 0 && s.length <= 4096 ? s : "";
};

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
    return { ok: false, error: "No tenés permiso para enviar por WhatsApp." };
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

  if (texto(e.accion, 40) !== "enviar") return json({ ok: false, error: "Acción desconocida." }, 400);

  const mensaje = mensajeOk(e.mensaje);
  if (!mensaje) return json({ ok: false, error: "El mensaje está vacío o es demasiado largo (máx. 4096)." }, 400);

  if (!TOKEN || !PHONE) {
    return json(
      { ok: false, error: "La integración no está configurada: faltan WHATSAPP_ACCESS_TOKEN o WHATSAPP_PHONE_NUMBER_ID." },
      503
    );
  }

  const db = createClient(URL, SERVICE, { auth: { persistSession: false } });
  const staff = await esStaffConCapacidad(db, req, ["whatsapp:enviar_grupo"]);
  if (!staff.ok) return json({ ok: false, error: staff.error ?? "Sin permiso." }, 403);

  const destino = texto(e.destino, 20) === "telefono" ? "telefono" : "grupo";
  const modulo = texto(e.modulo, 60) || "whatsapp";

  // --- resolver a quién va -------------------------------------------------
  let destinoId = "";
  let destinoNombre = "";
  if (destino === "telefono") {
    destinoId = texto(e.telefono, 40).replace(/[^\d]/g, "");
    if (!destinoId) return json({ ok: false, error: "Falta el teléfono de destino." }, 400);
  } else {
    const { data: grupo } = await db
      .from("whatsapp_grupos")
      .select("group_id, nombre")
      .eq("vinculado", true)
      .maybeSingle();
    if (!grupo) {
      return json(
        { ok: false, error: "No hay grupo vinculado. Vinculá uno desde el Centro de WhatsApp." },
        409
      );
    }
    destinoId = String(grupo.group_id);
    destinoNombre = typeof grupo.nombre === "string" ? grupo.nombre : "";
  }

  // --- llamada a la API ----------------------------------------------------
  const payload = {
    messaging_product: "whatsapp",
    recipient_type: destino === "grupo" ? "group" : "individual",
    to: destinoId,
    type: "text",
    text: { preview_url: false, body: mensaje },
  };

  let apiStatus = 0;
  let apiBody = "";
  try {
    const resp = await fetch(`${GRAPH}/${PHONE}/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${TOKEN}`,
      },
      body: JSON.stringify(payload),
    });
    apiStatus = resp.status;
    apiBody = await resp.text();
  } catch (err) {
    const detalle = err instanceof Error ? err.message : String(err);
    await db.from("whatsapp_envios").insert([{
      destino_tipo: destino === "grupo" ? "group" : "individual",
      destino: destinoId,
      destino_nombre: destinoNombre || null,
      modulo,
      mensaje,
      ok: false,
      api_error: `Sin respuesta de Meta: ${detalle}`.slice(0, 2000),
      creado_por: staff.id ?? null,
    }]);
    return json({ ok: false, error: "No se pudo contactar la API de WhatsApp." }, 502);
  }

  let resp: Fila = {};
  try {
    resp = apiBody ? JSON.parse(apiBody) : {};
  } catch {
    /* respuesta vacía o no-JSON */
  }

  if (apiStatus < 200 || apiStatus >= 300) {
    const detalle = (resp as { error?: { message?: string } }).error?.message ?? apiBody.slice(0, 2000);
    await db.from("whatsapp_envios").insert([{
      destino_tipo: destino === "grupo" ? "group" : "individual",
      destino: destinoId,
      destino_nombre: destinoNombre || null,
      modulo,
      mensaje,
      ok: false,
      api_error: String(detalle).slice(0, 2000),
      creado_por: staff.id ?? null,
    }]);
    return json({ ok: false, error: String(detalle || "La API rechazó el mensaje.").slice(0, 500) }, 502);
  }

  const mensajes = Array.isArray(resp.messages) ? (resp.messages as Fila[]) : [];
  const mensajeId = typeof mensajes[0]?.id === "string" ? (mensajes[0].id as string) : null;

  await db.from("whatsapp_envios").insert([{
    destino_tipo: destino === "grupo" ? "group" : "individual",
    destino: destinoId,
    destino_nombre: destinoNombre || null,
    modulo,
    mensaje,
    ok: true,
    api_mensaje_id: mensajeId,
    creado_por: staff.id ?? null,
  }]);

  // El historial que ya muestra el Centro WhatsApp vive en notificaciones:
  // se replica el mismo contrato de registrarEnvioWsp para que aparezca ahí.
  await db.from("notificaciones").insert([{
    tipo: "whatsapp",
    titulo: `WhatsApp · ${destino === "grupo" ? "Grupo" : "Envío directo"}`,
    mensaje,
    cliente_id: null,
    cliente_nombre: destinoNombre || (destino === "grupo" ? "GRUPO" : "DIRECTO"),
    datos: { telefono: destinoId, tipo: modulo },
    estado: "Enviado",
  }]);

  return json({ ok: true, mensaje_id: mensajeId, destino, destino_id: destinoId, grupo: destinoNombre || null });
});