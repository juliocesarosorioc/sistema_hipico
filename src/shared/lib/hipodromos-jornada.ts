/**
 * ORDEN DE LOS HIPÓDROMOS EN LOS BUSCADORES DE JORNADA.
 *
 * Gestión de Jugadas abrió el camino: el primer día del operador empieza por
 * el hipódromo que TIENE CARRERAS cargadas, no por el que cae primero en el
 * alfabeto. El resto de los módulos (Pollas, Inteligencia, …) tiene que
 * ofrecer la misma lectura, así que la regla vive acá y no repetida en cada
 * pantalla.
 *
 * La comparación es por CLAVE canónica (`claveHipodromo`: mayúsculas sin
 * espacios), porque el catálogo puede traer "LA RINCONADA" y el registro
 * central "LARINCONADA" — con un `.toUpperCase()` a secas el hipódromo con
 * carreras no entraba en la lista y el operador creía que no había jornada.
 *
 * El catálogo NUNCA se recorta: los que no corren hoy quedan después, para
 * que el operador pueda consultar un hipódromo sin carreras sin quedar preso
 * de una lista vacía.
 */
import { claveHipodromo } from "@/features/carreras/lib/claves";

/** Cualquier opción de selector con valor y etiqueta. */
export type OpcionJornada = { value: string; label: string };

/**
 * Devuelve el catálogo ordenado: primero los hipódromos con carreras en la
 * jornada (ordenados por etiqueta) y después el resto (también por etiqueta).
 *
 * @param opciones    Catálogo completo del selector.
 * @param clavesDelDia Claves (nombre canónico) de los hipódromos que tienen
 *                     carreras cargadas ese día.
 * @param nombreDe    Cómo obtener el nombre real de una opción cuando el
 *                     `value` es un id (Pollas filtra por `hipodromo_id`).
 *                    Por defecto se usa el `label`.
 */
export function ordenarHipodromosDeLaJornada<T extends OpcionJornada>(
  opciones: T[],
  clavesDelDia: string[],
  nombreDe: (opcion: T) => string = (o) => o.label
): T[] {
  const opcionesVacias = (opciones ?? []).filter((o) => !o.value);
  const catalogo = (opciones ?? []).filter((o) => Boolean(o.value));
  const claves = new Set(
    (clavesDelDia ?? []).map((c) => claveHipodromo(c)).filter(Boolean)
  );
  if (!claves.size) return [...opcionesVacias, ...catalogo];

  const dentro: T[] = [];
  const fuera: T[] = [];
  for (const o of catalogo) {
    if (claves.has(claveHipodromo(nombreDe(o)))) dentro.push(o);
    else fuera.push(o);
  }

  const porEtiqueta = (a: T, b: T) =>
    nombreDe(a).localeCompare(nombreDe(b), "es", { sensitivity: "base" });

  dentro.sort(porEtiqueta);
  fuera.sort(porEtiqueta);
  return [...opcionesVacias, ...dentro, ...fuera];
}
