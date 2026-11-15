import { createClient } from "@supabase/supabase-js";
import fs from "fs";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://dbkvnqzchtcabhiaqdyi.supabase.co";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRia3ZucXpjaHRjYWJoaWFxZHlpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczMDM4OTkwOCwiZXhwIjoyMDQ1OTY1OTA4fQ.aA_j5-L_v_R-VqYy5T2yE5lKj1bC3yP9D_uM7E4h2jM";

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

async function main() {
  // Verificar si la tabla ya responde
  const { data, error } = await supabase.from("reglas_respuestas_automaticas").select("id").limit(1);
  console.log("Check reglas_respuestas_automaticas:", data ? "OK" : error?.message);
}

main().catch(console.error);
