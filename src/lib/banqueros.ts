/**
 * Banquero por grupo de venta y modalidad.
 *
 * Un banquero es un CLIENTE del grupo que toma el lado contrario de las jugadas.
 * Al liquidar cada ticket su saldo se mueve en espejo (pierde el jugador gana el
 * banquero y viceversa) y ademas se le cobra una comision sobre el monto decidido
 * que recibe el grupo. El convenio vive en `banquero_convenio`, se configura por
 * (grupo, modalidad) y queda congelado en el ticket al vender.
 */
import { supabase } from "@/lib/supabase";
import { exigirCapacidad } from "@/lib/seguridad/vigente";

export const MODALIDADES_BANQUERO = ["TABLAS", "MARCAS", "DUPLETA", "REMATES", "WPS", "POLLAS"] as const;

export type ModalidadBanquero = (typeof MODALIDADES_BANQUERO)[number];

export type BanqueroBase = "MONTO_DECIDIDO" | "MONTO_JUGADO" | "GANANCIA";

export type BanqueroConvenio = {
  id?: string;
  grupo_id: string;
  modalidad: ModalidadBanquero;
  banquero_cliente_id: string | null;
  banquero_nombre?: string | null;
  cobra_comision: boolean;
  comision_porcentaje: number;
  comision_base: BanqueroBase;
  activo: boolean;
};

export const ETIQUETA_MODALIDAD: Record<ModalidadBanquero, string> = {
  TABLAS: "Tablas Fijas",
  MARCAS: "Marcas",
  DUPLETA: "Dupleta",
  REMATES: "Remates",
  WPS: "W.P.S.",
  POLLAS: "Pollas",
};

export const ETIQUETA_BASE: Record<BanqueroBase, string> = {
  MONTO_DECIDIDO: "Sobre el monto decidido (premio)",
  MONTO_JUGADO: "Sobre el monto jugado",
  GANANCIA: "Sobre la ganancia",
};

/** Convenios de banquero de un grupo, indexados por modalidad. */
export async function listarBanquerosGrupo(grupoId: string | number): Promise<BanqueroConvenio[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("banquero_convenio")
    .select("*")
    .eq("grupo_id", grupoId);
  if (error || !data) return [];
  return data as BanqueroConvenio[];
}

/** Todos los convenios de banquero (para reportes o carga masiva). */
export async function listarBanqueros(): Promise<BanqueroConvenio[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from("banquero_convenio").select("*");
  if (error || !data) return [];
  return data as BanqueroConvenio[];
}

/** Crea o reemplaza el banquero de un (grupo, modalidad). */
export async function guardarBanquero(input: {
  grupo_id: string;
  modalidad: ModalidadBanquero;
  banquero_cliente_id: string;
  banquero_nombre?: string | null;
  cobra_comision: boolean;
  comision_porcentaje: number;
  comision_base: BanqueroBase;
  activo?: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin credenciales Supabase (.env.local)." };
  try {
    exigirCapacidad("grupos:fn_guardar_grupo");
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  const fila = {
    grupo_id: input.grupo_id,
    modalidad: input.modalidad,
    banquero_cliente_id: input.banquero_cliente_id,
    banquero_nombre: input.banquero_nombre ?? null,
    cobra_comision: input.cobra_comision,
    comision_porcentaje: input.comision_porcentaje,
    comision_base: input.comision_base,
    activo: input.activo ?? true,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase
    .from("banquero_convenio")
    .upsert(fila, { onConflict: "grupo_id,modalidad" });
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Quita el banquero de un (grupo, modalidad). */
export async function eliminarBanquero(
  grupoId: string,
  modalidad: ModalidadBanquero
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin credenciales Supabase (.env.local)." };
  try {
    exigirCapacidad("grupos:fn_guardar_grupo");
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  const { error } = await supabase
    .from("banquero_convenio")
    .delete()
    .eq("grupo_id", grupoId)
    .eq("modalidad", modalidad);
  return error ? { ok: false, error: error.message } : { ok: true };
}
