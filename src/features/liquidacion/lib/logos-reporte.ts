/**
 * ============================================================================
 * LOGOS DE LA CABECERA DEL REPORTE DE CARRERA — resolución SIEMPRE FRESCA
 * ============================================================================
 *
 * El Reporte de Liquidación pinta en su cabecera azul el logo del HIPÓDROMO y
 * el del GRUPO HÍPICO. Antes esos logos se resolvían desde catálogos que cada
 * pantalla cargaba UNA sola vez (al montar el componente). Consecuencia: si el
 * operador incorporaba el logo DESPUÉS de que la pantalla ya había cargado su
 * lista, el reporte seguía mostrando el logo viejo (o ninguno) hasta recargar
 * la página entera.
 *
 * Este módulo centraliza la resolución para que el logo se lea FRESCO en el
 * momento de armar el reporte, sin importar cuándo se cargó:
 *
 *   · `logoDeHipodromo` / `logoDeGrupo` son funciones PURAS (testeables en
 *     node) que resuelven el Data URL desde una lista ya cargada.
 *   · `logosFrescosDeCarrera` lee la base en el momento: `listarHipodromos()`
 *     siempre relee; `listarGruposAdmin(true)` fuerza el salto del caché de
 *     grupos, que es el que quedaba viejo tras editar el logo del grupo.
 *
 * El resultado se pasa a `armarReporteCarrera(..., { logoHipodromo, logoGrupo })`.
 */

import { listarHipodromos } from "@/features/hipodromos/lib/servicio";
import { listarGruposAdmin, type GrupoRow } from "@/features/grupos/lib/grupos";

/** Logo por nombre de hipódromo (comparación normalizada, sin acentos). */
export type HipodromoConLogo = { nombre: string; logo_url?: string | null };

/** Normaliza un nombre para comparar (mayúsculas, sin espacios sobrantes). */
function claveNombre(nombre: unknown): string {
  return String(nombre ?? "").trim().toUpperCase();
}

/**
 * Logo del hipódromo a partir de una lista ya cargada. Devuelve `null` si no
 * hay coincidencia o si el hipódromo no tiene logo.
 */
export function logoDeHipodromo(
  hipodromos: HipodromoConLogo[] | null | undefined,
  nombre: string
): string | null {
  const buscado = claveNombre(nombre);
  if (!buscado) return null;
  const h = (hipodromos ?? []).find((x) => claveNombre(x.nombre) === buscado);
  return h?.logo_url ? String(h.logo_url) : null;
}

/**
 * Logo del grupo a partir de una lista ya cargada. Si `grupoId` viene vacío,
 * cae al grupo PRINCIPAL (o al primero disponible): así el reporte del grupo
 * dueño nunca queda sin logo.
 */
export function logoDeGrupo(
  grupos: GrupoRow[] | null | undefined,
  grupoId?: string | number | null
): string | null {
  const lista = grupos ?? [];
  if (!lista.length) return null;
  const id = grupoId != null && String(grupoId).trim() !== "" ? String(grupoId) : "";
  const elegido = id
    ? lista.find((g) => String(g.id) === id)
    : lista.find((g) => g.es_principal) ?? lista[0];
  return elegido?.logo_url ? String(elegido.logo_url) : null;
}

/**
 * Lee la base EN EL MOMENTO y devuelve los logos frescos de la cabecera. Se
 * llama justo antes de `armarReporteCarrera`, de modo que un logo incorporado
 * hace un segundo ya sale en el reporte, sin recargar la página.
 *
 * Nunca lanza: si algo falla, devuelve `null` en el logo afectado y el reporte
 * se pinta igual (solo sin ese logo).
 */
export async function logosFrescosDeCarrera(opts: {
  hipodromo: string;
  /** id del grupo hípico; si se omite, se usa el grupo principal. */
  grupoId?: string | number | null;
  /**
   * Lista de grupos YA cargada (opcional). Cuando la pantalla necesita además el
   * NOMBRE del grupo, puede leer `listarGruposAdmin(true)` una sola vez y
   * pasarla acá para no repetir la consulta. Si se omite, se lee acá.
   */
  gruposYaLeidos?: GrupoRow[] | null;
}): Promise<{ logoHipodromo: string | null; logoGrupo: string | null }> {
  const [hipodromos, grupos] = await Promise.all([
    listarHipodromos().then((r) => r.data).catch(() => [] as HipodromoConLogo[]),
    // `true` = fuerza el salto del caché de grupos (el que quedaba viejo tras
    // editar el logo del grupo en GruposModule).
    opts.gruposYaLeidos
      ? Promise.resolve(opts.gruposYaLeidos)
      : listarGruposAdmin(true).catch(() => [] as GrupoRow[]),
  ]);

  return {
    logoHipodromo: logoDeHipodromo(hipodromos, opts.hipodromo),
    logoGrupo: logoDeGrupo(grupos, opts.grupoId),
  };
}
