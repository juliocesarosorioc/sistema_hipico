// ============================================================================
// EDGE FUNCTION: whatsapp-webhook
//
// Es el oído de la integración: WhatsApp Business (Cloud API) avisa acá cada
// evento del número de negocio. Lo que nos importa es DETECTAR el grupo:
// cuando el número del negocio está en un grupo y alguien escribe, Meta manda
// un webhook `messages` cuyo mensaje trae `group_id`. Ese id es lo único que
// la API acepta como destino para mandar mensajes al grupo, así que se guarda
// en `public.whatsapp_grupos` y después el Centro WhatsApp lo ofrece para
// vincular.
//
// ---------------------------------------------------------------------------
// INSTALAR (requiere el CLI de Supabase, no está en el repo)
// ---------------------------------------------------------------------------
//   1. Definir el secreto del token de verificación ANTES de conectar Meta:
//        npx supabase secrets set WHATSAPP_VERIFY_TOKEN="un-secreto-largo"
//   2. Desplegar:
//        npx supabase functions deploy whatsapp-webhook
//   3. En WhatsApp Manager → API Setup → Webhook:
//        Callback URL  = https://<REF>.supabase.co/functions/v1/whatsapp-webhook
//        Verify token  = el secreto del paso 1
//        Field         = messages   (y los group_* si la cuenta llega a tener OBA)
//
// El GET de verificación lo pide Meta una sola vez al guardar el webhook; el
// POST es el flujo normal de eventos. La función responde 200 rápido siempre:
// si Meta no recibe 200 reintenta el evento, y un webhook que no contesta es
// un webhook caído.
//
// Seguridad: este endpoint es PÚBLICO por diseño (Meta lo llama sin sesión).
// La verificación del GET usa el secreto; el POST es solo escritura de un
// group_id detectado y un sello de tiempo — no expone datos de negocio.
// ============================================================================

import { createClient } from "jsr:@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VERIFY = Deno.env.get("WHATSAPP_VERIFY_TOKEN") ?? "";

const MAX_BODY = 512 * 1024;

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

/** Texto acotado, igual contrato que portal-auth. */
const texto = (v: unknown, max = 200): string => String(v ?? "").trim().slice(0, max);

/**
 * Registra un group_id detectado. No toca `vinculado`: si el grupo ya estaba
 * marcado como el destino de los envíos, un nuevo mensaje no lo desmarca.
 */
async function registrarGrupo(
  db: ReturnType<typeof createClient>,
  group_id: unknown,
  phone_number_id: unknown,
  ahora: string
): Promise<void> {
  const gid = texto(group_id, 400);
  if (!gid) return;
  try {
    await db.from("whatsapp_grupos").upsert(
      {
        group_id: gid,
        phone_number_id: texto(phone_number_id, 120) || null,
        ultimo_evento: ahora,
      },
      { onConflict: "group_id" }
    );
  } catch {
    // Sin comentario: el webhook no puede dejar de contestar 200 por un
    // problema de escritura; si la base no está lista, Meta reintenta solo.
  }
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);

  // --- verificación inicial (GET) ------------------------------------------
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && token && VERIFY && token === VERIFY) {
      return new Response(challenge ?? "", { status: 200 });
    }
    return json({ ok: false, error: "Verificación del webhook fallida." }, 403);
  }

  if (req.method !== "POST") return json({ ok: false, error: "Método no permitido." }, 405);

  const cuerpo = await req.text();
  if (cuerpo.length > MAX_BODY) return json({ ok: false, error: "Solicitud demasiado grande." }, 413);

  let evento: Fila;
  try {
    evento = JSON.parse(cuerpo);
  } catch {
    // Un payload que no es JSON no es un evento nuestro: 200 para que Meta
    // no lo reintente (no tiene sentido).
    return json({ ok: true });
  }

  const db = createClient(URL, SERVICE, { auth: { persistSession: false } });
  const ahora = new Date().toISOString();

  const entries = Array.isArray(evento.entry) ? (evento.entry as Fila[]) : [];
  for (const entry of entries) {
    const changes = Array.isArray(entry.changes) ? (entry.changes as Fila[]) : [];
    for (const change of changes) {
      const value = (change.value ?? {}) as Fila;
      const metadata = (value.metadata ?? {}) as Fila;
      const phone_number_id = metadata.phone_number_id;

      // Un mensaje que le mandan al número del negocio. Si viene de un grupo,
      // trae `group_id`: es la detección que buscamos. Los mensajes directos
      // (sin group_id) no interesan acá.
      if (Array.isArray(value.messages)) {
        for (const msg of value.messages as Fila[]) {
          if (msg.group_id) await registrarGrupo(db, msg.group_id, phone_number_id, ahora);
        }
      }

      // `statuses` = estado de envíos SALIENTES (delivered/read/failed): no
      // aporta a la detección. Los group_* (lifecycle/participants/settings)
      // se pueden procesar más adelante si se quiere el nombre del grupo por
      // webhook; hoy el nombre lo pone el usuario en la plataforma.
    }
  }

  return json({ ok: true });
});