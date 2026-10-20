/**
 * ============================================================================
 * VISIBILIDAD COMPARTIDA DE LAS JUGADAS DEL GRUPO PRINCIPAL · núcleo puro
 * ============================================================================
 * Qué es: el GRUPO PRINCIPAL publica sus jugadas (Tablas Fijas, Marcas, Pollas,
 * Dupletas, Remates, Puestos) y decide QUIÉN puede verlas en vivo:
 *
 *   Toggle 1 · `visibilidad_global_principal`
 *     ON  → TODOS los usuarios/grupos de la plataforma ven las jugadas del
 *           principal. La lista de grupos autorizados queda ignorada.
 *
 *   Toggle 2 · `grupos_autorizados_ver_principal` (uuid[])
 *     Solo se usa cuando el Toggle 1 está OFF: únicamente los grupos de la lista
 *     ven las jugadas del principal.
 *
 * Regla acordada con el dueño: si el Toggle 1 está encendido, la LISTA NO
 * importa (todos ven). Por eso `puedeVerPrincipal` corta primero por global.
 *
 * Este archivo es PURO (no toca Supabase) para poder blindarlo con pruebas sin
 * navegador. La lectura/escritura real vive en `grupos.ts`
 * (`actualizarVisibilidadPrincipal`) y la parte RLS/RPC en
 * `sql/grupos_visibilidad_principal.sql`.
 * ============================================================================
 */

/** Grupo con (algunas) columnas de visibilidad del principal. Estructural. */
export type GrupoVisibilidad = {
  id: string | number;
  nombre?: string | null;
  es_principal?: boolean | null;
  /** Toggle 1: el principal queda visible para TODA la plataforma. */
  visibilidad_global_principal?: boolean | null;
  /** Toggle 2: grupos puntuales autorizados (solo si el Toggle 1 está OFF). */
  grupos_autorizados_ver_principal?: Array<string | number> | null;
};

/** Normaliza un id a texto comparable (uuid o numérico), sin romper con null. */
export function idTexto(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

/**
 * Lista de grupos autorizados, normalizada a texto y SIN duplicados ni vacíos.
 * Acepta el array crudo de PostgREST (puede llegar como string JSON o array).
 */
export function gruposAutorizadosDe(grupo: GrupoVisibilidad | null | undefined): string[] {
  if (!grupo) return [];
  let crudo: unknown = grupo.grupos_autorizados_ver_principal;
  if (typeof crudo === "string") {
    const s = crudo.trim();
    if (!s) return [];
    try {
      crudo = JSON.parse(s);
    } catch {
      // Formato `{a,b}` de Postgres como respaldo; si no, un único id suelto.
      const limpio = s.replace(/^\{|\}$/g, "");
      crudo = limpio.includes(",") ? limpio.split(",") : [limpio];
    }
  }
  if (!Array.isArray(crudo)) return [];
  const vistos = new Set<string>();
  const salida: string[] = [];
  for (const v of crudo) {
    const id = idTexto(v);
    if (id && !vistos.has(id)) {
      vistos.add(id);
      salida.push(id);
    }
  }
  return salida;
}

/**
 * Toggle 1 activo (global). Se lee solo del principal: cualquier grupo puede
 * traer la columna, pero la decisión es del principal.
 */
export function esGlobalPrincipal(grupo: GrupoVisibilidad | null | undefined): boolean {
  return grupo?.visibilidad_global_principal === true;
}

/**
 * ¿El grupo `grupoId` puede ver las jugadas del `principal`?
 *
 *   - sin principal → nadie "ve al principal" por esta vía (false);
 *   - el propio principal (o cualquiera con `es_principal`) siempre se ve;
 *   - global ON → todos ven;
 *   - global OFF → solo los ids de la lista autorizada.
 */
export function puedeVerPrincipal(
  principal: GrupoVisibilidad | null | undefined,
  grupoId: string | number | null | undefined
): boolean {
  if (!principal) return false;
  const destino = idTexto(grupoId);
  if (principal.es_principal === true) return true;
  if (destino && destino === idTexto(principal.id)) return true;
  if (esGlobalPrincipal(principal)) return true;
  if (!destino) return false;
  return gruposAutorizadosDe(principal).includes(destino);
}

/**
 * ¿El grupo `grupoId` está autorizado a ver al principal? Versión que resuelve
 * el principal dentro de una lista de grupos (el que tenga `es_principal`).
 */
export function puedeVerElPrincipal(
  grupos: ReadonlyArray<GrupoVisibilidad> | null | undefined,
  grupoId: string | number | null | undefined
): boolean {
  const principal = principalDe(grupos);
  return puedeVerPrincipal(principal, grupoId);
}

/** El grupo marcado como principal (el primero), o `null` si no hay ninguno. */
export function principalDe(
  grupos: ReadonlyArray<GrupoVisibilidad> | null | undefined
): GrupoVisibilidad | null {
  for (const g of grupos ?? []) {
    if (g.es_principal === true) return g;
  }
  return null;
}

/**
 * Descripción humana del modo de visibilidad, para el panel y las pruebas:
 *   "GLOBAL"  → todos ven;
 *   "LISTA"   → solo los grupos autorizados;
 *   "NADIE"   → nadie más que el principal (lista vacía y global OFF).
 */
export type ModoVisibilidad = "GLOBAL" | "LISTA" | "NADIE";

export function modoVisibilidad(grupo: GrupoVisibilidad | null | undefined): ModoVisibilidad {
  if (esGlobalPrincipal(grupo)) return "GLOBAL";
  return gruposAutorizadosDe(grupo).length > 0 ? "LISTA" : "NADIE";
}

/** Rótulo corto del modo, con su emoji, para el panel. */
export function etiquetaModoVisibilidad(modo: ModoVisibilidad): string {
  switch (modo) {
    case "GLOBAL":
      return "🌐 Todos los grupos";
    case "LISTA":
      return "🔒 Solo grupos autorizados";
    default:
      return "🚫 Solo el Principal";
  }
}

/**
 * Grupos que NO pueden ser autorizados: el propio principal (se autoriza solo) y
 * los inactivos. Devuelve la lista de candidatos a mostrar en el selector.
 */
export function candidatosAutorizar(
  grupos: ReadonlyArray<GrupoVisibilidad & { activo?: boolean | null }> | null | undefined,
  principalId: string | number | null | undefined
): Array<GrupoVisibilidad & { activo?: boolean | null }> {
  const pid = idTexto(principalId);
  return (grupos ?? []).filter(
    (g) => g.es_principal !== true && idTexto(g.id) !== pid && g.activo !== false
  );
}

/**
 * Alterna un id dentro de la lista autorizada SIN duplicar y manteniendo el
 * orden de la selección original (los nuevos al final). Devuelve el array nuevo
 * (no muta la entrada).
 */
export function alternarAutorizado(
  lista: ReadonlyArray<string | number> | null | undefined,
  id: string | number,
  marcar: boolean
): string[] {
  const actual = (lista ?? []).map(idTexto).filter((v) => v !== "");
  const objetivo = idTexto(id);
  const sin = actual.filter((v) => v !== objetivo);
  return marcar && objetivo ? [...sin, objetivo] : sin;
}
