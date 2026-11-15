import fs from "fs";
import path from "path";
import WebSocket from "ws";
import { createClient } from "@supabase/supabase-js";
globalThis.WebSocket = WebSocket;

function leerEnv() {
  const envFiles = [".env.local", ".env"];
  const vars = {};
  for (const f of envFiles) {
    const full = path.resolve(process.cwd(), f);
    if (fs.existsSync(full)) {
      for (const l of fs.readFileSync(full, "utf8").split("\n")) {
        const t = l.trim();
        if (!t || t.startsWith("#")) continue;
        const idx = t.indexOf("=");
        if (idx > 0) {
          const k = t.slice(0, idx).trim();
          const v = t.slice(idx + 1).trim().replace(/^['"]|['"]$/g, "");
          if (!vars[k]) vars[k] = v;
        }
      }
    }
  }
  return vars;
}
const env = leerEnv();
const s = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
  realtime: { transport: WebSocket }
});

async function main() {
  const quotedMsgId = "MSG-PRUEBA-EVERY";
  const { data: propMsg, error } = await s
    .from("chat_mensajes")
    .select("*")
    .eq("whatsapp_msg_id", quotedMsgId)
    .maybeSingle();

  console.log("Error:", error);
  console.log("Mensaje encontrado:", propMsg ? { id: propMsg.id, tipo: propMsg.tipo_mensaje, sala_id: propMsg.sala_id, disp: propMsg.monto_disponible, estado: propMsg.estado_propuesta } : null);
  process.exit(0);
}
main().catch(console.error);
