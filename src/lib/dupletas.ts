import { supabase } from "@/lib/supabase";

export type CaballoDupleta = {
  numero: string;
  nombre: string;
  nacionalidad?: string | null;
  retirado?: boolean;
};

export type CeldaDupleta = {
  vendida: boolean;
  cliente_id?: string | number | null;
  cliente_nombre?: string;
  precio?: number | null;
};

export type DupletaEstado = {
  hipodromo: string;
  fecha: string;
  carrera1: number | string;
  carrera2: number | string;
  premio: number;
  precio: number;
  caballos1: CaballoDupleta[];
  caballos2: CaballoDupleta[];
  celdas: Record<string, CeldaDupleta>;
  updatedAt?: string;
};

export function claveDupleta(e: {
  hipodromo: string;
  fecha: string;
  carrera1: number | string;
  carrera2: number | string;
}): string {
  return `${String(e.hipodromo).trim().toUpperCase()}|${e.fecha ?? ""}|${e.carrera1}|${e.carrera2}`;
}

export function claveCelda(n1: string | number, n2: string | number): string {
  return `${n1}|${n2}`;
}

export async function guardarDupleta(estado: DupletaEstado): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin credenciales Supabase (.env.local)." };
  const payload = {
    clave: claveDupleta(estado),
    hipodromo: String(estado.hipodromo).trim().toUpperCase(),
    fecha: estado.fecha || new Date().toISOString().slice(0, 10),
    carrera1: Number(estado.carrera1) || String(estado.carrera1),
    carrera2: Number(estado.carrera2) || String(estado.carrera2),
    premio: estado.premio ?? 0,
    precio: estado.precio ?? 0,
    estado: JSON.stringify(estado),
    updated_at: new Date().toISOString(),
  };
  try {
    const r = await supabase.from("dupletas").upsert(payload, { onConflict: "clave" }).select("id").single();
    if (r.error) return { ok: false, error: r.error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function listarDupletasGuardadas(): Promise<DupletaEstado[]> {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from("dupletas")
      .select("clave, hipodromo, fecha, carrera1, carrera2, estado, updated_at")
      .order("updated_at", { ascending: false });
    if (error || !data) return [];
    const out: DupletaEstado[] = [];
    for (const r of data as Array<Record<string, unknown>>) {
      try {
        const e = JSON.parse(String(r.estado)) as DupletaEstado;
        if (e && Array.isArray(e.caballos1)) out.push(e);
      } catch {
        /* fila inválida */
      }
    }
    return out;
  } catch {
    return [];
  }
}