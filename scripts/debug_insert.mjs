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
  const res = await s.from("chat_mensajes").insert({
    grupo_id: "d1369236-a7db-4d49-ac26-cd36670f0613",
    sala_id: "259cf047-cf87-413e-96c1-c7eb3239565b",
    remitente_id: "899550b3-6665-4b9b-ad7b-ea388702a213",
    remitente_nombre: "Every Alfonso",
    es_operador: false,
    tipo_mensaje: "propuesta_jugada",
    contenido: "Juego 5P SPECIAL ONE 100",
    accion_proponente: "JUEGA",
    es_match: false,
    modalidad_jugada: "5P",
    ejemplar_numero: "SPECIAL ONE",
    caballos_bando_a: ["SPECIAL ONE"],
    caballos_bando_b: [],
    jugada_estandarizada: "Juego 5P SPECIAL ONE 100",
    monto_original: 100,
    monto_disponible: 100,
    estado_propuesta: "abierta",
    whatsapp_msg_id: "MSG-PRUEBA-EVERY"
  }).select();

  console.log("Error insert:", res.error);
  console.log("Data insert:", res.data);
  process.exit(0);
}
main().catch(console.error);
