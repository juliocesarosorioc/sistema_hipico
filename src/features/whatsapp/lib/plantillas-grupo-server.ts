/**
 * Loader SERVER-ONLY de plantillas guardadas por grupo.
 * Las plantillas persistidas en `whatsapp_plantillas_grupo` sustituyen a los
 * defaults en planos, resultados, apertura y cierre. Si la tabla no existe o
 * falla, se degradan a los defaults sin romper el bot.
 */
import { supabaseAdmin } from "@/core/supabase-admin";
import {
  aplicarVariablesPlantilla,
  PLANTILLAS_GRUPO_DEFAULT,
} from "./plantillas-grupo";

export type MapaPlantillasGrupo = Map<string, string>;

export async function cargarPlantillasGrupo(
  grupoId?: string | number | null
): Promise<MapaPlantillasGrupo> {
  const mapa: MapaPlantillasGrupo = new Map();
  for (const def of PLANTILLAS_GRUPO_DEFAULT) {
    mapa.set(def.clave, def.contenido);
  }

  if (!grupoId) return mapa;

  try {
    const { data, error } = await supabaseAdmin
      .from("whatsapp_plantillas_grupo")
      .select("clave, contenido, activo")
      .eq("grupo_id", String(grupoId));

    if (!error && Array.isArray(data)) {
      for (const fila of data) {
        const clave = String(fila?.clave ?? "").trim();
        const contenido = typeof fila?.contenido === "string" ? fila.contenido : "";
        if (!clave || !contenido.trim()) continue;
        if (fila?.activo === false) continue;
        mapa.set(clave, contenido);
      }
    }
  } catch {
    // Tabla opcional: los defaults siguen operativos.
  }

  return mapa;
}

/** Obtiene la plantilla efectiva ya interpolada, con fallback determinista. */
export function obtenerPlantillaGrupo(
  mapa: MapaPlantillasGrupo,
  clave: string,
  variables: Record<string, string | number | null | undefined>,
  fallback: string
): string {
  const contenido = mapa.get(clave);
  if (!contenido) return fallback;
  const aplicada = aplicarVariablesPlantilla(contenido, variables);
  return aplicada.trim() ? aplicada : fallback;
}
