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
    if (!gid) return null;
    const val = window.localStorage.getItem(`${CLAVE_SEMANA_VIGENTE_PREFIX}${gid}`);
    if (val === "__NULL__") return null;
    if (val && /^\d{4}-\d{2}-\d{2}$/.test(val)) return val;
  } catch {
    /* ignore */
  }
  return null;
}

export function guardarSemanaVigenteLocal(grupoId: string | number, inicio: string | null): void {
  if (typeof window === "undefined") return;
  try {
    const gid = String(grupoId ?? "").trim();
    if (!gid) return;
    const valor = inicio ? inicio.slice(0, 10) : "__NULL__";
    window.localStorage.setItem(`${CLAVE_SEMANA_VIGENTE_PREFIX}${gid}`, valor);
  } catch {
    /* ignore */
  }
}

/**
 * Semana vigente del grupo. Si la columna no existe, deduce de hoy (fallback)
 * o lee la semana activada localmente por el grupo.
 */
export function semanaVigente(
  hoyIso: string,
  ciclo: CicloSemanal,
  fijadaInicio?: string | null,
  grupoId?: string | number | null
): SemanaVigente {
  const gid = String(grupoId ?? "").trim();
  const localRaw =
    typeof window !== "undefined" && gid
      ? window.localStorage.getItem(`${CLAVE_SEMANA_VIGENTE_PREFIX}${gid}`)
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

  if (fechaNorm && typeof window !== "undefined") {
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
  }

  return { ok: true, inicio: fechaNorm };
}