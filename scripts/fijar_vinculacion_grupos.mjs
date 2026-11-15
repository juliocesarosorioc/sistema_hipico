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
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
  realtime: { transport: WebSocket }
});

async function vincular() {
  console.log("=== VINCULANDO SALAS A GRUPOS DE WHATSAPP ===");

  // 1. ARGENTINA NACIONALES -> Sala Principal · ESPARTANOS
  const { data: s1, error: e1 } = await supabase
    .from("salas_juego")
    .update({
      whatsapp_group_jid: "120363418508183663@g.us",
      whatsapp_group_nombre: "ARGENTINA NACIONALES",
      estado_carrera: "abierta",
      hipodromo_activo: "LA RINCONADA",
      numero_carrera_activa: 1,
      updated_at: new Date().toISOString()
    })
    .eq("id", "259cf047-cf87-413e-96c1-c7eb3239565b")
    .select();

  console.log("Sala 1 vinculada:", s1, "Error:", e1);

  // 2. ARGENTINA AMERICANAS -> VENEZUELA
  const { data: s2, error: e2 } = await supabase
    .from("salas_juego")
    .update({
      whatsapp_group_jid: "120363419028551649@g.us",
      whatsapp_group_nombre: "ARGENTINA AMERICANAS",
      estado_carrera: "abierta",
      hipodromo_activo: "GULFSTREAM PARK",
      numero_carrera_activa: 1,
      updated_at: new Date().toISOString()
    })
    .eq("id", "580c1db6-738b-4be5-8779-fe0efa0e8267")
    .select();

  console.log("Sala 2 vinculada:", s2, "Error:", e2);

  process.exit(0);
}

vincular().catch(console.error);
