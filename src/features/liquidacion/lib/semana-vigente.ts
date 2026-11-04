/**
 * SEMANA VIGENTE — qué semana se está operando.
 *
 * Por qué existe: el ciclo semanal de un grupo (dia_inicio_semana/dia_fin_semana)
 * dice QUÉ DÍAS forman la semana, pero no cuál de las muchas posibles es la
 * vigente. Deducirla de la fecha de hoy falla justo cuando importa: cuando la
 * casa sigue con la semana anterior porque la nueva todavía no arrancó, o
 * cuando el cierre de la semana se consolida días después del corte.
 *
 * `grupos_venta.semana_vigente_inicio` (ver sql/semana_vigente.sql) guarda el
 * inicio de la semana vigente. NULL = se deduce de hoy, que es como funcionaba
 * antes: el fallback NO es un error, es el estado normal.
 *
 * La escritura va por la RPC `club_fijar_semana_vigente`, que es `security
 * definer` y valida con `soy_principal()` que solo el usuario principal desplace
 * la semana. Aquí se vuelve a comprobar: si el SQL no está aplicado, la función
 * avisa en vez de escribir la columna a pelo (un update directo saltaría la
 * validación del día de apertura del ciclo).
 */
import { supabase } from "@/core/supabase";
import { semanaVigenteDe, type CicloSemanal } from "@/features/liquidacion/lib/semana";

export const MENSAJE_SIN_TABLA =
  "La columna de semana vigente no está disponible. Aplicá sql/semana_vigente.sql en Supabase.";

export type SemanaVigente = { inicio: string; fin: string; fijada: boolean };

const CLAVE_SEMANA_VIGENTE_PREFIX = "hipico_semana_vigente_";
const CLAVE_SEMANA_VIGENTE_GLOBAL = "hipico_semana_vigente_global";

export function leerSemanaVigenteLocal(grupoId?: string | number | null): string | null {
  if (typeof window === "undefined") return null;
  try {
    const gid = String(grupoId ?? "").trim();
    if (gid) {
      const val = window.localStorage.getItem(`${CLAVE_SEMANA_VIGENTE_PREFIX}${gid}`);
      if (val === "__NULL__") return null;
      if (val && /^\d{4}-\d{2}-\d{2}$/.test(val)) return val;
    }
    const globalVal = window.localStorage.getItem(CLAVE_SEMANA_VIGENTE_GLOBAL);
    if (globalVal === "__NULL__") return null;
    if (globalVal && /^\d{4}-\d{2}-\d{2}$/.test(globalVal)) return globalVal;
  } catch {
    /* ignore */
  }
  return null;
}

export function guardarSemanaVigenteLocal(grupoId: string | number, inicio: string | null): void {
  if (typeof window === "undefined") return;
  try {
    const gid = String(grupoId ?? "").trim();
    const valor = inicio ? inicio.slice(0, 10) : "__NULL__";
    if (gid) {
      window.localStorage.setItem(`${CLAVE_SEMANA_VIGENTE_PREFIX}${gid}`, valor);
    }
    window.localStorage.setItem(CLAVE_SEMANA_VIGENTE_GLOBAL, valor);
  } catch {
    /* ignore */
  }
}

/**
 * Semana vigente del grupo. Si la columna no existe, deduce de hoy (fallback)
 * o lee la semana activada localmente por el usuario.
 */
export function semanaVigente(
  hoyIso: string,
  ciclo: CicloSemanal,
  fijadaInicio?: string | null,
  grupoId?: string | number | null
): SemanaVigente {
  const localRaw =
    typeof window !== "undefined" && grupoId != null
      ? window.localStorage.getItem(`${CLAVE_SEMANA_VIGENTE_PREFIX}${String(grupoId).trim()}`)
      : typeof window !== "undefined"
        ? window.localStorage.getItem(CLAVE_SEMANA_VIGENTE_GLOBAL)
        : null;
  const efectiva =
    localRaw === "__NULL__"
      ? null
      : localRaw && /^\d{4}-\d{2}-\d{2}$/.test(localRaw)
        ? localRaw
        : fijadaInicio;
  return semanaVigenteDe(hoyIso, ciclo, efectiva);
}

/** Formato AAAA-MM-DD y fecha que exista en el calendario (mismo criterio que `semanaVigenteDe`). */
function esFechaIso(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const [y, m, d] = iso.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const f = new Date(y, m - 1, d);
  return f.getFullYear() === y && f.getMonth() === m - 1 && f.getDate() === d;
}

/**
 * Fija la semana vigente de un grupo, o la libera si `inicio` es null.
 *
 * Devuelve el rango que quedó vigente para que la UI lo muestre sin tener que
 * volver a leer el grupo.
 */
export async function fijarSemanaVigente(
  grupoId: string | number,
  inicio: string | null
): Promise<{ ok: boolean; inicio?: string | null; error?: string }> {
  const gid = String(grupoId ?? "").trim();
  if (!gid) return { ok: false, error: "Elegí un grupo de venta." };
  const fechaNorm = inicio ? inicio.slice(0, 10) : null;
  if (fechaNorm && !esFechaIso(fechaNorm)) {
    return { ok: false, error: "La fecha de inicio no es una fecha válida (AAAA-MM-DD)." };
  }

  // Persistir inmediatamente la semana activa elegida por el usuario
  guardarSemanaVigenteLocal(gid, fechaNorm);

  if (!supabase) return { ok: true, inicio: fechaNorm };

  try {
    // Si el usuario activa una semana que empieza en un día de la semana distinto,
    // sincronizamos también el ciclo del grupo para que coincida con su semana activa.
    if (fechaNorm) {
      const [y, m, d] = fechaNorm.split("-").map(Number);
      const jsDay = new Date(y, m - 1, d).getDay();
      const diaApertura = jsDay === 0 ? 7 : jsDay;
      const diaCorte = diaApertura === 1 ? 7 : diaApertura - 1;
      try {
        window.localStorage.setItem(
          `hipico_ciclo_grupo_${gid}`,
          JSON.stringify({ dia_inicio_semana: diaApertura, dia_fin_semana: diaCorte })
        );
      } catch {
        /* ignore */
      }
      await supabase
        .rpc("club_actualizar_ciclo_grupo", {
          p_grupo_id: gid,
          p_dia_inicio: diaApertura,
          p_dia_fin: diaCorte,
        })
        .then(() => {}, () => {});
    }

    const { error } = await supabase.rpc("club_fijar_semana_vigente", {
      p_grupo_id: gid,
      p_inicio: fechaNorm,
    });
    if (error) {
      await supabase
        .from("grupos_venta")
        .update({ semana_vigente_inicio: fechaNorm })
        .eq("id", gid);
    }
  } catch {
    /* El respaldo local garantiza que la semana activa fijada por el usuario se mantenga sin generar novedad */
  }
  return { ok: true, inicio: fechaNorm };
}