import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

/**
 * Cliente Supabase para el lado cliente (SPA).
 * Usa las mismas credenciales que el sistema legacy (configuradas en .env.local):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY
 *
 * Sin env → `supabase` es null y los componentes entran en "modo local/respaldo"
 * (mismo comportamiento fallback que el sistema actual con tabla carrerasDeHoy).
 */
export const supabase: SupabaseClient | null =
  URL && KEY ? createClient(URL, KEY) : null;

/** Reintento en runtime: útil para recargar credenciales sin rebuild. */
export function crearSupabaseRuntime(
  url?: string,
  key?: string
): SupabaseClient | null {
  const u = url ?? URL;
  const k = key ?? KEY;
  return u && k ? createClient(u, k) : null;
}

export type Carrera = {
  carrera: number | string;
  numero?: number | string;
  estado?: string;
  status?: string;
  hora?: string;
  hora_carrera?: string;
};

export type ProgramaCarreras = {
  carreras?: Carrera[];
};
