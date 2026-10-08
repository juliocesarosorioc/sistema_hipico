import type { OpcionHipodromo } from "@/lib/tablas/rpc";

/**
 * Nombre PROPIO de un hipódromo (ej. "La Rinconada") a partir del catálogo de
 * hipódromos activos. Los módulos suelen manejar el valor CANÓNICO en MAYÚSCULAS
 * ("LA RINCONADA") para escribir/consultar la base; a la hora de MOSTRAR hay que
 * volver al nombre con la capitalización real, como quedó registrado en
 * `hipodromos.nombre`.
 */
export function nombrePropioHipodromo(valor: string | null | undefined, activos: OpcionHipodromo[]): string {
  const v = String(valor ?? "").trim();
  if (!v) return "";
  const clave = v.toUpperCase();
  const op = (activos ?? []).find((a) => a.value === clave);
  return op?.label ?? v;
}