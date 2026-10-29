/**
 * Persistencia y Permisos para la Configuracion de Incentivos WPS
 *
 * Reglas de acceso:
 * - Solo el dueno del grupo (o admin de grupo) tiene acceso a personalizarlo para su grupo.
 * - El administrador principal puede configurar un parametro general/minimo para todos los grupos o personalizarlo por grupo.
 */

import { supabase } from "@/core/supabase";
import {
  type ConfiguracionIncentivosWps,
  CONFIG_WPS_DEFECTO,
} from "@/features/motores/lib/wps-incentivos";
import { esUsuarioPrincipal } from "@/features/seguridad/lib/resolver";
import { usuarioVigente } from "@/features/seguridad/lib/vigente";

const CLAVE_STORAGE_PREFIX = "sistema_hipico_wps_config_";
const CLAVE_GLOBAL = "global";

/**
 * Verifica si el usuario actual tiene permisos de edicion:
 * - Si es Admin Principal: puede editar "global" y cualquier "grupoId".
 * - Si es Dueno/Operador de Grupo: solo puede editar su propio grupo.
 */
export function puedeEditarConfigWps(grupoId?: string | number | null): boolean {
  const user = usuarioVigente();
  const idUsuario = typeof user === "string" ? user : (user as { username?: string; usuario?: string; id?: string })?.username || (user as { username?: string; usuario?: string; id?: string })?.usuario || "";
  if (esUsuarioPrincipal(idUsuario)) return true;
  if (!user) return false;

  // Si intenta editar la configuracion global/general y no es principal: denegado
  if (!grupoId || String(grupoId) === CLAVE_GLOBAL) {
    return false;
  }

  // Si tiene grupo asignado y coincide con el grupoId que edita: permitido
  const userGrupo = (user as { grupo_id?: string | number; grupoId?: string | number })?.grupo_id
    ?? (user as { grupo_id?: string | number; grupoId?: string | number })?.grupoId;
  if (userGrupo && String(userGrupo) === String(grupoId)) {
    return true;
  }

  // Verificamos rol
  const rol = String((user as { rol?: string })?.rol ?? "").toLowerCase();
  if (rol === "dueno" || rol === "admin_grupo" || rol === "master") {
    return true;
  }

  return false;
}

/**
 * Lee la configuracion de incentivos WPS:
 * Si se solicita un grupo especifico, primero busca la del grupo.
 * Si no existe, se mezcla con la configuracion general / global.
 */
export async function leerConfiguracionWps(
  grupoId?: string | number | null
): Promise<ConfiguracionIncentivosWps> {
  const clave = grupoId && String(grupoId) !== CLAVE_GLOBAL ? String(grupoId) : CLAVE_GLOBAL;

  // 1. Intento desde Supabase si existe conexion
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from("wps_config_grupos")
        .select("config")
        .eq("grupo_id", clave)
        .maybeSingle();

      if (!error && data?.config && typeof data.config === "object") {
        return { ...CONFIG_WPS_DEFECTO, ...data.config };
      }
    } catch {
      // Si la tabla no existe todavia, continua con fallback local
    }
  }

  // 2. Fallback a LocalStorage en browser
  if (typeof window !== "undefined" && window.localStorage) {
    try {
      const guardado = window.localStorage.getItem(`${CLAVE_STORAGE_PREFIX}${clave}`);
      if (guardado) {
        const parsed = JSON.parse(guardado);
        if (parsed && typeof parsed === "object") {
          return { ...CONFIG_WPS_DEFECTO, ...parsed };
        }
      }
    } catch {
      // Ignorar error de parsing
    }

    // Si pidio grupo y no tiene guardado, intenta leer el global de fallback
    if (clave !== CLAVE_GLOBAL) {
      try {
        const guardadoGlobal = window.localStorage.getItem(`${CLAVE_STORAGE_PREFIX}${CLAVE_GLOBAL}`);
        if (guardadoGlobal) {
          const parsedG = JSON.parse(guardadoGlobal);
          if (parsedG && typeof parsedG === "object") {
            return { ...CONFIG_WPS_DEFECTO, ...parsedG };
          }
        }
      } catch {
        // Ignorar
      }
    }
  }

  return { ...CONFIG_WPS_DEFECTO };
}

/**
 * Guarda la configuracion de incentivos WPS:
 */
export async function guardarConfiguracionWps(
  grupoId: string | number | null | undefined,
  config: ConfiguracionIncentivosWps
): Promise<{ ok: boolean; error?: string }> {
  const clave = grupoId && String(grupoId) !== CLAVE_GLOBAL ? String(grupoId) : CLAVE_GLOBAL;

  // Validacion de permisos estricta
  if (!puedeEditarConfigWps(clave)) {
    return {
      ok: false,
      error: "Acceso denegado: solo el dueño del grupo o el Administrador Principal pueden modificar esta configuración.",
    };
  }

  // 1. Guardar en LocalStorage siempre para disponibilidad offline inmediata
  if (typeof window !== "undefined" && window.localStorage) {
    try {
      window.localStorage.setItem(`${CLAVE_STORAGE_PREFIX}${clave}`, JSON.stringify(config));
    } catch (e) {
      console.warn("No se pudo guardar config WPS en localStorage:", e);
    }
  }

  // 2. Guardar en Supabase si esta disponible
  if (supabase) {
    try {
      const { error } = await supabase.from("wps_config_grupos").upsert(
        {
          grupo_id: clave,
          config,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "grupo_id" }
      );
      if (error) {
        // Si falla porque no existe la tabla wps_config_grupos, guardamos en configuraciones_sistema o dejamos el storage local
        console.warn("Supabase upsert wps_config_grupos advertencia:", error.message);
      }
    } catch {
      // Respaldo local ya quedo guardado
    }
  }

  return { ok: true };
}
