import type { OpcionHipodromo } from "@/features/tablas/lib/rpc";
import { formatearNombre } from "@/features/hipodromos/lib/tipos";

/**
 * Nombre PROPIO de un hipódromo (ej. "La Rinconada") a partir del catálogo de
 * hipódromos activos. Los módulos suelen manejar el valor CANÓNICO en MAYÚSCULAS
 * ("LA RINCONADA") para escribir/consultar la base; a la hora de MOSTRAR hay que
 * volver al nombre con la capitalización real.
 *
 * El label del catálogo puede venir en mayúsculas (depende del seed que se haya
 * corrido), así que se normaliza a título también; y si el valor no matchea
 * ningún hipódromo del catálogo, se formatea igual el valor crudo (que suele
 * ser la clave normalizada "LARINCONADA" o un tipeo libre).
 */
import { claveHipodromo } from "@/features/carreras/lib/claves";

export function nombrePropioHipodromo(valor: string | null | undefined, activos?: OpcionHipodromo[]): string {
  const v = String(valor ?? "").trim();
  if (!v) return "";
  const k = claveHipodromo(v);
  const op = (activos ?? []).find((a) => claveHipodromo(a.value) === k || claveHipodromo(a.label) === k);
  return formatearNombre(op?.label ?? v);
}

/**
 * Despliegue directo de un nombre de hipódromo en formato propio, SIN depender
 * del catálogo: convierte cualquier valor ("LA RINCONADA", "LARINCONADA",
 * "la rinconada", "Gulfstream Park") en "La Rinconada" / "Gulfstream Park".
 *
 * Es la forma recomendada para UI: el nombre en pantalla siempre sale con la
 * capitalización correcta, independiente de cómo esté guardado en la base.
 */
export function nombreHipodromoParaMostrar(valor: string | null | undefined): string {
  return formatearNombre(String(valor ?? ""));
}

/**
 * Convierte el catálogo REAL de hipódromos (`Hipodromo[]`, con `pais` y
 * `logo_url`) en las opciones del `SearchableSelect`, cada una con la bandera
 * del país y el logo. Es la fuente única para TODOS los modales que eligen un
 * hipódromo: el operador ve la bandera y el escudo antes de leer el nombre, y no
 * hay una lista de países/íconos distinta en cada pantalla.
 *
 * El `value` queda en mayúsculas (canónico, como se escribe y consulta la base);
 * el `label` con la capitalización real ("La Rinconada").
 */
export function opcionesHipodromo(
  hipodromos: Array<{ nombre: string; pais?: string | null; logo_url?: string | null }> | null | undefined
): Array<{ value: string; label: string; pais?: string | null; logo?: string | null }> {
  const vistos = new Set<string>();
  const opciones: Array<{ value: string; label: string; pais?: string | null; logo?: string | null }> = [];
  for (const h of hipodromos ?? []) {
    const value = String(h?.nombre ?? "").trim().toUpperCase();
    if (!value || vistos.has(value)) continue;
    vistos.add(value);
    opciones.push({
      value,
      label: formatearNombre(h?.nombre ?? ""),
      pais: h?.pais ?? null,
      logo: h?.logo_url ?? null,
    });
  }
  return opciones.sort((a, b) => a.label.localeCompare(b.label, "es"));
}