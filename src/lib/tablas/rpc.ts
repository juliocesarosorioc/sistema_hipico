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

/** Lista de hipódromos operativos (Supabase si responde, si no, fallback local). */
export async function listarHipodromos(): Promise<OpcionHipodromo[]> {
  try {
    if (supabase) {
      const { data } = await supabase.from("hipodromos").select("id, nombre").order("nombre");
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