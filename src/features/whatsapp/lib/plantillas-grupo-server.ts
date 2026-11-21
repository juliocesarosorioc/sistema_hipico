/**
 * Loader SERVER-ONLY de plantillas guardadas globalmente y por grupo.
 * Las plantillas globales (grupo_id IS NULL) aplican a todos los inquilinos;
 * las del grupo específico tienen precedencia. Si la tabla no existe o falla,
 * se degradan a los defaults sin romper el bot.
 */
import { supabaseAdmin } from "@/core/supabase-admin";
import {
  aplicarVariablesPlantilla,
  PLANTILLAS_GRUPO_DEFAULT,
} from "./plantillas-grupo";

export type MapaPlantillasGrupo = Map<string, string>;

function aplicarFilas(mapa: MapaPlantillasGrupo, filas: any[] | null | undefined): void {
  for (const fila of filas || []) {
    const clave = String(fila?.clave ?? "").trim();
    const contenido = typeof fila?.contenido === "string" ? fila.contenido : "";
    if (!clave || !contenido.trim()) continue;
    if (fila?.activo === false) continue;
    mapa.set(clave, contenido);
  }
}

export async function cargarPlantillasGrupo(
  grupoId?: string | number | null
): Promise<MapaPlantillasGrupo> {
  const mapa: MapaPlantillasGrupo = new Map();
  for (const def of PLANTILLAS_GRUPO_DEFAULT) {
    mapa.set(def.clave, def.contenido);
  }

  try {
    // 1) Globales: base compartida por todos los inquilinos.
    const { data: globales, error: errGlobal } = await supabaseAdmin
      .from("whatsapp_plantillas_grupo")
      .select("clave, contenido, activo")
      .is("grupo_id", null);
    if (!errGlobal) aplicarFilas(mapa, globales);

    // 2) Grupo: sobrescribe a las globales (y a los defaults).
    if (grupoId) {
      const { data: delGrupo, error: errGrupo } = await supabaseAdmin
        .from("whatsapp_plantillas_grupo")
        .select("clave, contenido, activo")
        .eq("grupo_id", String(grupoId));
      if (!errGrupo) aplicarFilas(mapa, delGrupo);
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
