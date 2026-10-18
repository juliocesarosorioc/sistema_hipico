import { supabase } from "@/core/supabase";

export type ComisionHistorico = {
  id: number;
  grupo_id: string;
  comision_default: number;
  fecha_vigencia: string;
  creado_por?: string | null;
  nota?: string | null;
  created_at: string;
};

export async function listarHistoricoComisiones(grupoId: string): Promise<ComisionHistorico[]> {
  if (!supabase) return [];
  const { data } = await supabase
    .from("grupos_comisiones_historico")
    .select("*")
    .eq("grupo_id", grupoId)
    .order("fecha_vigencia", { ascending: false });
  return (data ?? []) as ComisionHistorico[];
}

export async function guardarComisionVigente(opts: {
  grupoId: string;
  comision: number;
  fechaVigencia: string;
  creadoPor?: string;
  nota?: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase" };
  try {
    const { error } = await supabase
      .from("grupos_comisiones_historico")
      .upsert(
        {
          grupo_id: opts.grupoId,
          comision_default: opts.comision,
          fecha_vigencia: opts.fechaVigencia,
          creado_por: opts.creadoPor ?? null,
          nota: opts.nota ?? null,
        },
        { onConflict: "grupo_id,fecha_vigencia" }
      );
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function comisionVigenteEnFecha(grupoId: string, fecha: string): Promise<number | null> {
  if (!supabase) return null;
  const { data } = await supabase.rpc("comision_vigente_grupo", {
    p_grupo_id: grupoId,
    p_fecha: fecha,
  });
  const n = Number(data);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
