import { supabase } from "@/lib/supabase";
import type { TablaFijaRow } from "@/lib/tablas-fijas";
import { parseNum } from "@/lib/tablas/tipos";

export const FALLBACK_HIPODROMOS = [
  "LA RINCONADA",
  "VALENCIA",
  "SANTA RITA",
  "POMONA",
  "GULFSTREAM",
  "AQUEDUCT",
  "BELMONT",
  "SARATOGA",
  "CHURCHILL DOWNS",
  "KEENELAND",
  "SANTA ANITA",
  "DEL MAR",
  "MONMOUTH",
  "LAUREL",
  "WOODBINE",
];

export type OpcionHipodromo = { value: string; label: string };

/** Lista de hipódromos operativos (Solo Activos — Supabase si responde, si no, fallback local). */
export async function listarHipodromos(): Promise<OpcionHipodromo[]> {
  try {
    if (supabase) {
      const { data } = await supabase
        .from("hipodromos")
        .select("id, nombre")
        .eq("estado", "Activo")
        .order("nombre");
      if (data && data.length) {
        return data
          .map((h) => ({ value: String(h.nombre).toUpperCase(), label: String(h.nombre) }))
          .sort((a, b) => a.label.localeCompare(b.label));
      }
    }
  } catch {
    /* sin conexión → fallback local */
  }
  return FALLBACK_HIPODROMOS.map((n) => ({ value: n, label: n }));
}

const nombrarRpc = "club_listar_tablas_fijas_publicadas";

/** Lee las Tablas Fijas publicadas (Abierta) desde la RPC del legacy. */
export async function listarTablasPublicadas(): Promise<TablaFijaRow[]> {
  if (supabase) {
    try {
      const { data, error } = await supabase.rpc(nombrarRpc);
      if (error) throw error;
      if (Array.isArray(data)) return normalizarFilas(data);
    } catch (e) {
      console.warn("RPC tablas publicadas no disponible:", e);
    }
  }
  return [];
}

/** Normaliza filas crudas (número/string) al contrato de la SPA. */
export function normalizarFilas(data: unknown[]): TablaFijaRow[] {
  return data.map((r) => {
    const raw = r as Record<string, unknown>;
    const caballos = Array.isArray(raw.caballos)
      ? raw.caballos.map((c) => {
          const cc = c as Record<string, unknown>;
          return {
            numero: String(cc.numero ?? ""),
            nombre: String(cc.nombre ?? ""),
            nacionalidad: cc.nacionalidad ? String(cc.nacionalidad) : null,
            valor_ejemplar: cc.valor_ejemplar != null ? parseNum(cc.valor_ejemplar) : null,
            retirado: Boolean(cc.retirado),
          };
        })
      : null;
    const grupos = Array.isArray(raw.tabla_grupos)
      ? raw.tabla_grupos.map((g) => g as Record<string, unknown>)
      : null;
    return {
      id: String(raw.id ?? ""),
      hipodromo: raw.hipodromo ? String(raw.hipodromo) : null,
      hipodromo_id: raw.hipodromo_id != null ? (raw.hipodromo_id as string | number) : null,
      carrera: parseNum(raw.carrera) || null,
      fecha: raw.fecha ? String(raw.fecha) : null,
      estado: raw.estado ? String(raw.estado) : null,
      premio_original: raw.premio_original != null ? parseNum(raw.premio_original) : null,
      premio_recalculado: raw.premio_recalculado != null ? parseNum(raw.premio_recalculado) : null,
      suma_base_tabla: raw.suma_base_tabla != null ? parseNum(raw.suma_base_tabla) : null,
      limite_ventas: raw.limite_ventas != null ? parseNum(raw.limite_ventas) : null,
      cantidad_vendida: raw.cantidad_vendida != null ? parseNum(raw.cantidad_vendida) : null,
      moneda: raw.moneda ? String(raw.moneda) : null,
      distancia_carrera: raw.distancia_carrera ? String(raw.distancia_carrera) : null,
      superficie: raw.superficie ? String(raw.superficie) : null,
      retirados_oficiales: raw.retirados_oficiales ? String(raw.retirados_oficiales) : null,
      caballos,
      tabla_grupos: grupos as TablaFijaRow["tabla_grupos"],
    };
  });
}

/** Payload SQL seguro para tablas_fijas (mismas columnas que js/tablas.js). */
function payloadDeTabla(t: TablaFijaRow): Record<string, unknown> {
  return {
    hipodromo: t.hipodromo,
    hipodromo_id: t.hipodromo_id ?? null,
    carrera: t.carrera,
    fecha: t.fecha,
    estado: "Abierta",
    premio: t.premio_original,
    premio_original: t.premio_original,
    premio_recalculado: t.premio_recalculado,
    suma_base_tabla: t.suma_base_tabla,
    limite_ventas: t.limite_ventas ?? 0,
    cantidad_vendida: t.cantidad_vendida ?? 0,
    moneda: t.moneda ?? "USD",
    distancia_carrera: t.distancia_carrera,
    superficie: t.superficie,
    retirados_oficiales: t.retirados_oficiales || "NO HUBO RETIROS",
    comision_grupo: t.comision_grupo ?? 0,
    grupo_venta: t.grupo_venta ?? null,
    tasa_cambio: t.tasa_cambio ?? null,
    caballos: t.caballos ?? [],
  };
}

/** Busca la fila existente por (hipodromo, carrera) para actualizar en vez de duplicar. */
async function idExistente(hipodromo?: string | null, carrera?: number | null): Promise<number | string | null> {
  if (!supabase || !hipodromo || !carrera) return null;
  const { data, error } = await supabase
    .from("tablas_fijas")
    .select("id")
    .ilike("hipodromo", hipodromo)
    .eq("carrera", carrera)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return (data as { id: number | string }).id;
}

/** Publica una tabla en Supabase (upsert por hipódromo+carrera). RLS off → anon OK. */
export async function publicarTabla(t: TablaFijaRow): Promise<{ ok: boolean; id?: string | number; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase" };
  try {
    const existente = await idExistente(t.hipodromo, t.carrera);
    if (existente != null) {
      const { error } = await supabase.from("tablas_fijas").update(payloadDeTabla(t)).eq("id", existente);
      if (error) throw error;
      return { ok: true, id: existente };
    }
    const { data, error } = await supabase.from("tablas_fijas").insert(payloadDeTabla(t)).select("id").single();
    if (error) throw error;
    return { ok: true, id: data?.id };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

const COLUMNAS_EDITABLES = [
  "premio_original",
  "premio_recalculado",
  "suma_base_tabla",
  "limite_ventas",
  "cantidad_vendida",
  "distancia_carrera",
  "superficie",
  "retirados_oficiales",
] as const;

/** Actualiza solo columnas seguras de una tabla por su id real. */
export async function actualizarTabla(
  id: string | number,
  patch: Record<string, unknown>
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase" };
  const limpio: Record<string, unknown> = {};
  for (const key of COLUMNAS_EDITABLES) {
    if (key in patch) limpio[key] = patch[key];
  }
  if (!Object.keys(limpio).length) return { ok: true };
  try {
    const { error } = await supabase.from("tablas_fijas").update(limpio).eq("id", id);
    if (error) throw error;
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Incrementa las ventas de una tabla (+ monto) para el contador del Monitor. */
export async function registrarVenta(
  id: string | number,
  monto: number
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase" };
  try {
    const { data } = await supabase
      .from("tablas_fijas")
      .select("cantidad_vendida")
      .eq("id", id)
      .maybeSingle();
    const actual = data && data.cantidad_vendida != null ? Number(data.cantidad_vendida) : 0;
    const { error } = await supabase
      .from("tablas_fijas")
      .update({ cantidad_vendida: actual + monto })
      .eq("id", id);
    if (error) throw error;
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Guarda la pizarra de resultados (RPC opcional del paquete SQL, si existe). */
export async function guardarPizarraCarrera(opts: {
  hipodromo?: string | null;
  carrera?: number | null;
  pizarra: Record<string, unknown>;
}): Promise<boolean> {
  if (!supabase) return false;
  try {
    const { error } = await supabase.rpc("club_guardar_pizarra_carrera", {
      p_hipodromo: opts.hipodromo,
      p_carrera: opts.carrera,
      p_pizarra: opts.pizarra,
    });
    return !error;
  } catch {
    return false;
  }
}