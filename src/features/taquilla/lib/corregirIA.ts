/**
 * ============================================================================
 * CARGA RÁPIDA — Capa 2 (IA), cliente de la Edge Function `normalizar-jugadas`
 * ============================================================================
 *
 * La Capa 1 (normalizador difuso local, `normalizar.ts`) resuelve el 100% del
 * caso normal. Esta capa es un REFUERZO OPCIONAL: manda el bloque dictado a la
 * Edge Function y devuelve las mismas líneas reescritas, dejando que el resto
 * del pipeline (vista previa + poblar) trabaje igual.
 *
 * Reglas:
 *  - Nunca es requisito para vender: si la IA no está configurada, no hay red,
 *    el usuario no tiene la capacidad o la función falla, se devuelve `ok:false`
 *    y el módulo se queda con el resultado local.
 *  - La escritura/exigencia pasa por `exigirCapacidad`, y la Edge Function la
 *    vuelve a comprobar server-side antes de gastar tokens.
 */
import { supabase } from "@/core/supabase";
import { exigirCapacidad } from "@/features/seguridad/lib/vigente";

const URL_FN = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1`
  : "";

export type ResCorreccionIA = { ok: boolean; lineas?: string[]; error?: string };

/** ¿Hay URL de funciones configurada? Sin esto no se puede llamar a la IA. */
export function iaDisponible(): boolean {
  return Boolean(supabase && URL_FN);
}

/**
 * Manda las líneas a la IA y devuelve la versión corregida (misma cantidad, en
 * orden). El llamador reemplaza el texto de la Carga Rápida con el resultado y
 * deja que el normalizador local rehaga la vista previa.
 */
export async function corregirLineasConIA(
  lineas: string[],
  contexto: { clientes: string[]; caballos: Array<{ numero: string; nombre: string }> }
): Promise<ResCorreccionIA> {
  try {
    exigirCapacidad("gestion_jugadas:fn_corregir_ia");
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Sin permiso para usar la IA." };
  }

  if (!supabase || !URL_FN) return { ok: false, error: "La IA no está configurada." };

  const limpias = lineas.map((l) => l.trim()).filter(Boolean);
  if (limpias.length === 0) return { ok: false, error: "No hay líneas para corregir." };

  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token ?? "";
    let resp: Response;
    try {
      resp = await fetch(`${URL_FN}/normalizar-jugadas`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          lineas: limpias,
          clientes: contexto.clientes,
          caballos: contexto.caballos,
        }),
      });
    } catch {
      return { ok: false, error: "No se pudo contactar la IA." };
    }

    const txt = await resp.text();
    let datos: { ok?: boolean; lineas?: unknown; error?: string };
    try {
      datos = JSON.parse(txt);
    } catch {
      return { ok: false, error: `Respuesta inesperada de la IA (${resp.status}).` };
    }
    if (!datos.ok || !Array.isArray(datos.lineas)) {
      return { ok: false, error: datos.error ?? "La IA no pudo corregir el bloque." };
    }
    const corregidas = datos.lineas.map((l) => String(l).trim()).filter(Boolean);
    if (corregidas.length === 0) return { ok: false, error: "La IA devolvió un bloque vacío." };
    return { ok: true, lineas: corregidas };
  } catch {
    return { ok: false, error: "No se pudo usar la IA." };
  }
}
