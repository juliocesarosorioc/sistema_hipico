/**
 * CUADERNO DE JUGADAS — acceso a datos (libro manual, entre varios grupos).
 *
 * El admin anota a mano las jugadas de un cliente repartidas entre VARIOS
 * grupos, incluidos grupos que NO están en el sistema. La agregación (totales
 * por grupo y por semana) vive en `cuadernoResumen.ts`; acá solo entra y sale
 * de `public.cuaderno_jugadas` (sql/cuaderno_jugadas.sql).
 *
 * NO mueve saldos ni crea tickets. Es un libro de control, no una venta.
 */
import { supabase } from "@/core/supabase";
import { exigirCapacidad } from "@/features/seguridad/lib/vigente";
import {
  num,
  type CuadernoEstado,
  type CuadernoFila,
} from "@/features/clientes/lib/cuadernoResumen";

export type { CuadernoFila, CuadernoEstado } from "@/features/clientes/lib/cuadernoResumen";

const TABLA = "cuaderno_jugadas";
const COLS =
  "id,cliente_id,grupo_id,grupo_nombre,fecha,hipodromo,carrera,tipo,caballo,monto,premio,estado,nota,creado_por,created_at";

/** Falla cuando la tabla no existe: mensaje con el archivo SQL a aplicar. */
function mensajeSinTabla(msg: string): string {
  return /cuaderno_jugadas/.test(msg) || /does not exist|no existe|relation/i.test(msg)
    ? `No existe la tabla del Cuaderno. Ejecute sql/cuaderno_jugadas.sql en el SQL Editor. (${msg})`
    : msg;
}

/** Apunte a guardar: alta (sin `id`) o edición (con `id`). */
export type CuadernoPatch = {
  id?: string | number;
  cliente_id: string | number;
  grupo_id?: string | number | null;
  grupo_nombre: string;
  fecha: string;
  hipodromo?: string | null;
  carrera?: number | string | null;
  tipo?: string | null;
  caballo?: string | null;
  monto: number | string;
  premio?: number | string | null;
  estado: CuadernoEstado;
  nota?: string | null;
};

/** Apuntes de un cliente, del más nuevo al más viejo. */
export async function listarCuaderno(clienteId: string | number): Promise<CuadernoFila[]> {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from(TABLA)
      .select(COLS)
      .eq("cliente_id", clienteId)
      .order("fecha", { ascending: false })
      .order("id", { ascending: false })
      .limit(1000);
    if (error) throw error;
    return (data ?? []) as CuadernoFila[];
  } catch {
    return [];
  }
}

/** Normaliza el apunte a columnas reales de la tabla (evita 400 por basura). */
function filaSegura(p: CuadernoPatch, usuario?: string | null): Record<string, unknown> {
  const carrera = num(p.carrera);
  return {
    cliente_id: p.cliente_id,
    grupo_id: p.grupo_id ?? null,
    grupo_nombre: (String(p.grupo_nombre ?? "").trim() || "SIN GRUPO").toUpperCase(),
    fecha: String(p.fecha ?? "").slice(0, 10),
    hipodromo: p.hipodromo ? String(p.hipodromo).trim().toUpperCase() : null,
    carrera: carrera > 0 ? Math.trunc(carrera) : null,
    tipo: p.tipo ? String(p.tipo).trim().toUpperCase() : "JUGADA",
    caballo: p.caballo ? String(p.caballo).trim() : null,
    monto: num(p.monto),
    premio: num(p.premio),
    estado: p.estado,
    nota: p.nota ? String(p.nota).trim() : null,
    ...(usuario ? { creado_por: usuario } : {}),
  };
}

/**
 * Alta o edición de un apunte. Sin `id` inserta; con `id` actualiza.
 *
 * La escritura se gatea con la MISMA capacidad que el resto de la gestión de
 * clientes (`clientes:fn_guardar_cliente`): el Cuaderno es una herramienta de
 * cartera, no un módulo nuevo, y no se inventa una capacidad que la base no
 * siembra (ver la nota en `capacidades.ts`).
 */
export async function guardarCuaderno(
  p: CuadernoPatch,
  usuario?: string | null
): Promise<{ ok: boolean; error?: string; id?: string | number }> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase" };
  try {
    exigirCapacidad("clientes:fn_guardar_cliente");
    if (!p.cliente_id) return { ok: false, error: "Falta el cliente del apunte." };
    if (!String(p.fecha ?? "").trim()) return { ok: false, error: "Falta la fecha del apunte." };
    const payload = filaSegura(p, usuario);
    if (p.id != null) {
      const { data, error } = await supabase.from(TABLA).update(payload).eq("id", p.id).select("id");
      if (error) return { ok: false, error: mensajeSinTabla(error.message) };
      if (!data || data.length === 0) return { ok: false, error: "No se actualizó el apunte (permisos o RLS)." };
      return { ok: true, id: p.id };
    }
    const { data, error } = await supabase.from(TABLA).insert([payload]).select("id").maybeSingle();
    if (error) return { ok: false, error: mensajeSinTabla(error.message) };
    return { ok: true, id: (data as { id?: string | number } | null)?.id };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Borra un apunte del cuaderno. */
export async function eliminarCuaderno(id: string | number): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase" };
  try {
    exigirCapacidad("clientes:fn_guardar_cliente");
    const { data, error } = await supabase.from(TABLA).delete().eq("id", id).select("id");
    if (error) return { ok: false, error: mensajeSinTabla(error.message) };
    if (!data || data.length === 0) return { ok: false, error: "No se borró el apunte (permisos o RLS)." };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
