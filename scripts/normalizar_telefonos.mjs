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

function normalizar(raw) {
  if (!raw) return "";
  return String(raw).replace(/@.*$/, "").replace(/:.*$/, "").replace(/[^0-9]/g, "");
}

async function main() {
  console.log("=== NORMALIZANDO TELÉFONOS EN PUBLIC.CLIENTES ===");
  const { data: clientes, error } = await supabase
    .from("clientes")
    .select("id, nombre, telefono, telefono_normalizado, whatsapp_jid");

  if (error) {
    console.error("Error al leer clientes:", error);
    process.exit(1);
  }

  let actualizados = 0;
  for (const c of clientes || []) {
    const limpio = normalizar(c.telefono);
    if (limpio && limpio !== c.telefono_normalizado) {
      await supabase
        .from("clientes")
        .update({ telefono_normalizado: limpio })
        .eq("id", c.id);
      actualizados++;
      console.log(`[OK] Cliente "${c.nombre}": "${c.telefono}" -> "${limpio}"`);
    }
  }

  console.log(`\n✅ Proceso completado. Clientes actualizados: ${actualizados} de ${clientes?.length || 0}`);
  process.exit(0);
}

main().catch(console.error);
