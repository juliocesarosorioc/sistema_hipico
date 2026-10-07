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
import { supabase } from "@/lib/supabase";
import { esPrincipalVigente } from "@/lib/seguridad/vigente";
import { semanaVigenteDe, type CicloSemanal } from "@/lib/liquidacion/semana";

export const MENSAJE_SIN_TABLA =
  "La columna de semana vigente no está disponible. Aplicá sql/semana_vigente.sql en Supabase.";

export type SemanaVigente = { inicio: string; fin: string; fijada: boolean };

/**
 * Semana vigente del grupo. Si la columna no existe, deduce de hoy (fallback).
 *
 * El ciclo llega YA normalizado (`cicloSemanalDe`) a propósito. Aceptar la fila
 * cruda del grupo hacía que un `dia_inicio_semana: 4` se ignorara en silencio
 * (`Number(undefined) || 1` → lunes) y la semana se anclara al lunes equivocado.
 */
export function semanaVigente(
  hoyIso: string,
  ciclo: CicloSemanal,
  fijadaInicio?: string | null
): SemanaVigente {
  return semanaVigenteDe(hoyIso, ciclo, fijadaInicio);
}

/** Formato AAAA-MM-DD y fecha que exista en el calendario (mismo criterio que `semanaVigenteDe`). */
function esFechaIso(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const [y, m, d] = iso.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const f = new Date(y, m - 1, d);
  return f.getFullYear() === y && f.getMonth() === m - 1 && f.getDate() === d;
}

/** `true` cuando el error dice "esta columna no existe" → falta correr el SQL. */
function esAusente(msg: string): boolean {
  return /does not exist|not found|PGRST202|PGRST204|schema cache/i.test(msg);
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
  if (!supabase) return { ok: false, error: "Sin credenciales Supabase (.env.local)." };
  const gid = String(grupoId ?? "").trim();
  if (!gid) return { ok: false, error: "Elegí un grupo de venta." };
  // El mismo criterio que usa `semanaVigenteDe`: formato YYYY-MM-DD y fecha que
  // exista. Aceptar "2026-13-45" acá dejaría la RPC fijando un rango que el
  // calendario nunca tuvo.
  if (inicio && !esFechaIso(inicio)) {
    return { ok: false, error: "La fecha de inicio no es una fecha válida (AAAA-MM-DD)." };
  }
  // La regla es la MISMA que aplica la RPC (`soy_principal()`), no una capacidad
  // del RBAC. Delegar en "quien puede editar la matriz de seguridad" dejaba
  // pasar al cliente a un admin que igual recibía `42501` de la base, y cerraba
  // la puerta a la inversa: el principal la tiene por ser principal, no por
  // tener esa capacidad.
  if (!esPrincipalVigente()) {
    return { ok: false, error: "Solo el usuario principal puede fijar la semana vigente." };
  }
  try {
    const { data, error } = await supabase.rpc("club_fijar_semana_vigente", {
      p_grupo_id: gid,
      p_inicio: inicio || null,
    });
    if (error) return { ok: false, error: esAusente(error.message) ? MENSAJE_SIN_TABLA : error.message };
    return { ok: true, inicio: (data as string | null) ?? null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: esAusente(msg) ? MENSAJE_SIN_TABLA : msg };
  }
}