// ============================================================================
// EDGE FUNCTION: whatsapp-webhook
// ============================================================================
import { createClient } from "jsr:@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VERIFY = Deno.env.get("WHATSAPP_VERIFY_TOKEN") ?? "";
const WHATSAPP_TOKEN = Deno.env.get("WHATSAPP_ACCESS_TOKEN") ?? "";
const PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "";

const MAX_BODY = 512 * 1024;

function json(d: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(d), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

type Fila = Record<string, unknown>;
const texto = (v: unknown, max = 400): string => String(v ?? "").trim().slice(0, max);

async function enviarWhatsApp(destino: string, mensaje: string, phoneNumberId?: string): Promise<void> {
  const pid = phoneNumberId || PHONE_NUMBER_ID;
  if (!WHATSAPP_TOKEN || !pid || !destino) return;
  try {
    await fetch(`https://graph.facebook.com/v19.0/${pid}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: destino,
        type: "text",
        text: { body: mensaje },
      }),
    });
  } catch {
    // no bloquear webhook
  }
}

async function registrarGrupo(db: ReturnType<typeof createClient>, group_id: unknown, phone_number_id: unknown, ahora: string): Promise<void> {
  const gid = texto(group_id, 400);
  if (!gid) return;
  try {
    await db.from("whatsapp_grupos").upsert(
      { group_id: gid, phone_number_id: texto(phone_number_id, 120) || null, ultimo_evento: ahora },
      { onConflict: "group_id" }
    );
  } catch { /* ignore */ }
}

function parsearApertura(t: string): { hipodromo: string; carrera: number } | null {
  const m = /^abierta\s+(.+?)\s+(\d+)$/i.exec(t);
  if (m) {
    const hip = m[1].trim().toUpperCase();
    const car = Number(m[2]);
    if (hip && Number.isFinite(car) && car > 0) return { hipodromo: hip, carrera: car };
  }
  const m2 = /^abierta\s+c(\d+)$/i.exec(t);
  if (m2) return { hipodromo: "GENERAL", carrera: Number(m2[1]) };
  return null;
}

function esCierre(t: string): boolean {
  const n = t.trim().toLowerCase();
  return n === "cerrada" || n === "no va más" || n === "no va mas" || n === "cierre" || n === "no va mas";
}

function parsearPizarra(t: string): number[] | null {
  const m = /^(pizarra|llegada|cambio de pizarra)\s*:\s*(.+)$/i.exec(t);
  if (!m) return null;
  const nums = m[2].split(/[-,\s]+/).map((x) => Number(x.trim())).filter((n) => Number.isFinite(n) && n > 0);
  return nums.length ? nums : null;
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
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
  try { evento = JSON.parse(cuerpo); } catch { return json({ ok: true }); }

  const db = createClient(URL, SERVICE, { auth: { persistSession: false } });
  const ahora = new Date().toISOString();
  const hoy = ahora.slice(0, 10);

  const entries = Array.isArray(evento.entry) ? (evento.entry as Fila[]) : [];
  for (const entry of entries) {
    const changes = Array.isArray(entry.changes) ? (entry.changes as Fila[]) : [];
    for (const change of changes) {
      const value = (change.value ?? {}) as Fila;
      const metadata = (value.metadata ?? {}) as Fila;
      const phone_number_id = metadata.phone_number_id;

      if (Array.isArray(value.messages)) {
        for (const msg of value.messages as Fila[]) {
          const from = texto(msg.from, 40);
          const msgText = texto((msg.text as Fila)?.body ?? msg.body, 500);
          const groupId = msg.group_id ? texto(msg.group_id, 400) : "";

          if (groupId) {
            await registrarGrupo(db, groupId, phone_number_id, ahora);

            // Apertura de carrera
            const ap = parsearApertura(msgText);
            if (ap) {
              await db.from("whatsapp_control_carrera_grupo").upsert(
                { fecha: hoy, hipodromo: ap.hipodromo, carrera: ap.carrera, estado_carrera: "ABIERTA", grupo_id: groupId },
                { onConflict: "fecha,hipodromo,carrera" }
              );
              await enviarWhatsApp(groupId, `🟢 ABIERTA ${ap.hipodromo} - CARRERA ${ap.carrera}. Hagan sus jugadas.`, String(phone_number_id ?? ""));
              continue;
            }

            // Cierre de carrera
            if (esCierre(msgText)) {
              await db.from("whatsapp_control_carrera_grupo")
                .update({ estado_carrera: "CERRADA", updated_at: ahora })
                .eq("grupo_id", groupId)
                .eq("fecha", hoy);
              await enviarWhatsApp(groupId, "⛔ Carrera cerrada, no se registran más jugadas.", String(phone_number_id ?? ""));
              continue;
            }

            // Pizarra
            const pz = parsearPizarra(msgText);
            if (pz) {
              await enviarWhatsApp(groupId, `🏁 Pizarra oficial: ${pz.join("-")}. Procesando liquidación...`, String(phone_number_id ?? ""));
              continue;
            }

            // Carrera cerrada → rechazar jugadas
            const { data: carreraActiva } = await db
              .from("whatsapp_control_carrera_grupo")
              .select("estado_carrera")
              .eq("grupo_id", groupId)
              .eq("fecha", hoy)
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();
            if ((carreraActiva as Fila)?.estado_carrera === "CERRADA") {
              await enviarWhatsApp(groupId, "⛔ Carrera cerrada, no se registran más jugadas.", String(phone_number_id ?? ""));
            }
          } else {
            // DM: consultas, abonos y autorización de admin
            const low = msgText.toLowerCase();
            const mAuth = low.match(/autorizar\s+#?([a-z0-9]+)/i);
            if (mAuth) {
              const codigo = `#${mAuth[1].toUpperCase()}`;
              const { data: sol } = await db.from("whatsapp_solicitudes_abono").select("*").eq("codigo_corto", codigo).maybeSingle();
              const s = sol as Fila | null;
              if (s && s.estado === "PENDIENTE") {
                const monto = Number(s.monto ?? 0);
                // incrementar saldo del cliente
                if (s.cliente_id) {
                  const { data: cli } = await db.from("clientes").select("saldo_actual").eq("id", s.cliente_id).maybeSingle();
                  const actual = Number((cli as Fila)?.saldo_actual ?? 0);
                  await db.from("clientes").update({ saldo_actual: actual + monto }).eq("id", s.cliente_id);
                }
                await db.from("whatsapp_solicitudes_abono").update({ estado: "APROBADO", updated_at: ahora }).eq("codigo_corto", codigo);
                await enviarWhatsApp(from, `✅ Abono ${codigo} aprobado por ${monto}.`, String(phone_number_id ?? ""));
                if (s.cliente_nombre) await enviarWhatsApp(String(s.cliente_nombre), `Tu abono ${codigo} fue aprobado. Nuevo saldo disponible.`, String(phone_number_id ?? ""));
              } else {
                await enviarWhatsApp(from, `No se encontró la solicitud ${codigo} o ya fue procesada.`, String(phone_number_id ?? ""));
              }
              continue;
            }
            if (low.includes("saldo")) {
              const { data: cli } = await db.from("clientes").select("nombre,saldo_actual,disponible").eq("telefono", from).maybeSingle();
              const c = cli as Fila | null;
              const resp = c
                ? `💰 Saldo contable: ${c.saldo_actual ?? 0}\n✨ Disponible: ${c.disponible ?? c.saldo_actual ?? 0}\n¡Éxitos!`
                : "No encontré tu cuenta. Contacta al administrador.";
              await enviarWhatsApp(from, resp, String(phone_number_id ?? ""));
            } else if (low.includes("abonar") || low.includes("recargar")) {
              // crear solicitud de abono (monto por defecto 0; el admin completa)
              const codigo = `#${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
              await db.from("whatsapp_solicitudes_abono").insert({
                codigo_corto: codigo,
                cliente_nombre: from,
                monto: 0,
                metodo_pago: "WhatsApp",
                estado: "PENDIENTE",
              });
              await enviarWhatsApp(from, `Solicitud de abono creada ${codigo}. El administrador la revisará.`, String(phone_number_id ?? ""));
            }
          }
        }
      }
    }
  }

  return json({ ok: true });
});