import type { OpcionHipodromo } from "@/lib/tablas/rpc";
import { formatearNombre } from "@/lib/hipodromos/tipos";

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
export function nombrePropioHipodromo(valor: string | null | undefined, activos: OpcionHipodromo[]): string {
  const v = String(valor ?? "").trim();
  if (!v) return "";
  const clave = v.toUpperCase();
  const op = (activos ?? []).find((a) => a.value === clave);
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