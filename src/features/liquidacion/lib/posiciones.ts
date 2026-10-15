/**
 * Posiciones de llegada de una pizarra, en orden y sin huecos.
 *
 * `PizarraCarrera` es un objeto con campos por nombre (primero..octavo) porque
 * es cómodo de editar en un form, pero la fuente de verdad (`resultados_carreras.
 * ganadores`) guarda una lista ordenada. Convertir de una a otra aparecía
 * copiado en los tres puntos donde se centraliza un resultado, y una de esas
 * copias solo mandaba el ganador: se perdían del 2º al 8º y las jugadas de
 * puestos quedaban sin datos en Carreras del Día.
 */

/** Campos de `PizarraCarrera` que son una posición de llegada, en orden. */
export const CAMPOS_POSICION = [
  "primero",
  "segundo",
  "tercero",
  "cuarto",
  "quinto",
  "sexto",
  "septimo",
  "octavo",
] as const;

export type CampoPosicion = (typeof CAMPOS_POSICION)[number];

/** Subconjunto de `PizarraCarrera` que este módulo necesita (sin `empates`). */
export type PizarraConPosiciones = Partial<Record<CampoPosicion, string | number | undefined | null>>;

/**
 * Devuelve los números de llegada en orden, sin entradas vacías y recortados.
 * Un `"0"` o un `"-"` no cuentan como llegada: `0` es un valor no-nulo, así
 * que hace falta tratar el `0` numérico aparte del "".
 */
export function posicionesDePizarra(pizarra: PizarraConPosiciones | null | undefined): string[] {
  if (!pizarra) return [];
  const out: string[] = [];
  for (const campo of CAMPOS_POSICION) {
    const crudo = pizarra[campo];
    if (crudo === null || crudo === undefined) continue;
    const n = String(crudo).trim();
    if (!n) continue;
    if (/^0+$/.test(n)) continue;
    out.push(n);
  }
  return out;
}

/**
 * Orden de llegada oficial `[{numero,puesto}]` derivado de la pizarra.
 *
 * Es la forma ESTRUCTURADA que guarda `resultados_carreras.orden_llegada` (la
 * que prefiere `leerPizarra()` en reportes). Antes vivía dentro de
 * `PagarCarreraModal`, así que la liquidación de Taquilla la guardaba y la de
 * Gestión de Jugadas no: la carrera quedaba con `orden_llegada = null` y solo
 * se podía reconstruir por el fallback `ganadores`.
 */
export function ordenLlegadaDePizarra(
  pizarra: PizarraConPosiciones | null | undefined
): Array<{ numero: string; puesto: number }> {
  if (!pizarra) return [];
  const out: Array<{ numero: string; puesto: number }> = [];
  CAMPOS_POSICION.forEach((campo, i) => {
    const v = pizarra[campo];
    if (typeof v === "string" && v.trim() !== "") out.push({ numero: v.trim(), puesto: i + 1 });
    else if (typeof v === "number" && Number.isFinite(v)) out.push({ numero: String(v), puesto: i + 1 });
  });
  return out;
}

/**
 * Une los dividendos por CABALLO con la matriz de las AMERICANAS W/P/S en el
 * único objeto que leen el motor y `resultados_carreras.dividendos`.
 *
 * Viven separados porque miden cosas distintas (la matriz depende del tipo
 * apostado, los pools solo del puesto alcanzado), pero el motor los resuelve en
 * la misma clave plana: `wps_WW`, `wps_WP`, ... conviviendo con `win:7`.
 * Prefijadas, no se pisan entre sí ni con el Pareo ("PP").
 */
export function dividendosDePizarra(r: {
  dividendos?: Record<string, number> | null;
  matrizWps?: Record<string, number> | null;
} | null | undefined): Record<string, number> | null {
  const porCaballo = r?.dividendos ?? {};
  const matriz = r?.matrizWps ?? {};
  if (!Object.keys(porCaballo).length && !Object.keys(matriz).length) return null;
  return { ...porCaballo, ...matriz };
}
