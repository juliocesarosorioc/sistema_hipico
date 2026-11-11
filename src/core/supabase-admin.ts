import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

let _adminClient: SupabaseClient | null = null;

/**
 * Cliente Supabase con permisos de Service Role (Admin).
 * Solo debe ejecutarse en el entorno de Node.js / Server Routes (API).
 * Nunca exponer al navegador.
 */
export function getSupabaseAdmin(): SupabaseClient {
  if (!_adminClient) {
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      throw new Error("Faltan variables de entorno SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY");
    }
    _adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }
  return _adminClient;
}

export const supabaseAdmin = getSupabaseAdmin();
