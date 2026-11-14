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

async function run() {
  const { data: todos, error } = await s.from("clientes").select("id, nombre, seudonimo, telefono, telefono_normalizado, whatsapp_jid, saldo_actual, saldo_disponible, libre, aval");
  if (error) {
    console.error("Error clientes:", error);
    process.exit(1);
  }
  console.log("Total clientes registrados:", todos.length);
  const encontrados = todos.filter(c => 
    (c.nombre && /partner|every|alfonso/i.test(c.nombre)) ||
    (c.seudonimo && /partner|every|alfonso/i.test(c.seudonimo))
  );
  console.log("Coincidencias PARTNER / Every Alfonso:", encontrados);
  
  console.log("\nTodos los clientes con sus teléfonos:");
  todos.forEach(c => {
    console.log(`- ${c.nombre} (Alias: ${c.seudonimo || 'N/A'}) | Tel: "${c.telefono}" | Norm: "${c.telefono_normalizado}" | JID: "${c.whatsapp_jid}" | Disp: ${c.saldo_disponible}`);
  });

  process.exit(0);
}
run();
