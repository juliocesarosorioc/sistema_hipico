/**
 * MODULO TAQUILLA — validacion del CABALLO al cargar una jugada (logica PURA).
 *
 * Sin Supabase, sin React, sin I/O: se corre en un test y en el modal.
 *
 * LA REGLA
 * --------
 * En la columna CABALLO no se puede escribir un numero que no corra:
 *
 *  - Si la carrera TIENE caballos registrados, solo valen esos numeros.
 *  - Si la carrera NO tiene caballos registrados, se admite hasta el 16.
 *  - Salvo que la carrera cargada muestre mas de 16 caballos: en ese caso el
 *    tope sube al numero mas alto que la carrera muestre.
 *
 * POR QUE 16 Y NO UN NUMERO FIJO MENOR
 * ------------------------------------
 * Los numeros de ejemplar en Venezuela son el dardo, y un caballo puede
 * breaking con numero alto. Poner un tope de, digamos, 10 rechazaria corridas
 * reales. El 16 es el maximo comodo del formato de nomenclatura; si la carrera
 * trae mas, manda la carrera: el numero que la carrera muestra es un hecho, y
 * un tope de 16 seria inventar que ese caballo no existe.
 *
 * POR QUE NO ES LA VALIDACION DE MARCAS
 * -------------------------------------
 * `marcas/registradas.ts` valida la CONFIGURACION de una carrera de marcas (marcas,
 * NV y debutantes) y exige que la carrera tenga ejemplares registrados: sin
 *lista no se configura. Aca es al reves: la Taquilla carga jugadas de cualquier
 * modalidad (taquilla, 2n, triples) sobre carreras que todavia no pasaron por
 * Marcas, asi que la regla tiene que tolerar la carrera vacia.
 */

/** Tope de ejemplar cuando la carrera no tiene caballos registrados. */
export const TOPE_SIN_REGISTRO = 16;

/** Lo minimo que el modulo necesita saber de un ejemplar de la carrera. */
export type ReferenciaCaballo = {
  numero?: string | number | null;
};

/** Numeros de una carrera, normalizados a texto sin espacios. */
export function numerosDeLaCarrera(caballos: ReferenciaCaballo[] | null | undefined): string[] {
  return (caballos ?? [])
    .map((c) => String(c?.numero ?? "").trim())
    .filter((n) => n !== "");
}

/** Numero mas alto que muestra la carrera (0 si no muestra ninguno). */
export function maximoDeLaCarrera(caballos: ReferenciaCaballo[] | null | undefined): number {
  let max = 0;
  for (const n of numerosDeLaCarrera(caballos)) {
    const v = Number(n);
    if (Number.isFinite(v) && v > max) max = v;
  }
  return max;
}

/**
 * Numeros que el operador puede escribir en CABALLO.
 *
 * Con caballos registrados devuelve exactamente esos numeros (el Set es lo que
 * manda, sin topes). Sin ellos devuelve el rango 1..16, o 1..<maximo visible>
 * si la carrera cargada muestra mas de 16 caballos.
 */
export function topesPermitidos(
  caballos: ReferenciaCaballo[] | null | undefined,
  maximoVisible?: number | null
): Set<string> {
  const registrados = numerosDeLaCarrera(caballos);
  const fuera = new Set<string>();
  if (registrados.length > 0) {
    for (const n of registrados) fuera.add(n);
    return fuera;
  }

  // Sin lista de participated: se admite el rango, salvo que la carrera
  // cargada muestre mas de 16 caballos, en cuyo caso manda ese maximo.
  let tope = TOPE_SIN_REGISTRO;
  const visible = Number(maximoVisible ?? 0);
  if (Number.isFinite(visible) && visible > tope) tope = visible;
  for (let i = 1; i <= tope; i++) fuera.add(String(i));
  return fuera;
}

/**
 * Numeros que aparecen en el texto de CABALLO. Acepta la notacion que la
 * columna ya admitia: "1", "1,2", "1,2x3", "1-2". Se extrae cada grupo de
 * digitos, asi que un rango partido ("1-2") se valida como dos ejemplares.
 */
export function numerosEscritos(texto: string | null | undefined): string[] {
  const t = String(texto ?? "").trim();
  if (!t) return [];
  return (t.match(/\d+/g) ?? []).map((n) => n.replace(/^0+(?=\d)/, ""));
}

export type RevisionCaballo = {
  /** La jugada se puede cargar. */
  ok: boolean;
  /** Numeros escritos que no corren en la carrera. */
  invalidos: string[];
  /** Que numeros eran legales (para el mensaje). */
  permitidos: string[];
  /** El campo estaba vacio: es una jugada sin ejemplar (taquilla, 2n, etc.). */
  vacio: boolean;
  /** Si hubo que aplicar el tope de 16 por carrera sin registrados. */
  topeSinRegistro: boolean;
  motivo?: string;
};

function listaLegible(permitidos: string[]): string {
  if (permitidos.length > 24) return `1 a ${permitidos[permitidos.length - 1]}`;
  return permitidos.join(", ");
}

/**
 * Revisa la columna CABALLO de una fila contra los caballos de la carrera.
 *
 * `maximoVisible` es el numero mas alto que muestra la carrera cargada; solo
 * importa cuando la carrera no tiene caballos registrados (ver `topesPermitidos`).
 */
export function revisarCaballo(
  texto: string | null | undefined,
  caballos: ReferenciaCaballo[] | null | undefined,
  maximoVisible?: number | null
): RevisionCaballo {
  const registrados = numerosDeLaCarrera(caballos);
  const permitidos = Array.from(topesPermitidos(caballos, maximoVisible)).sort(
    (a, b) => Number(a) - Number(b)
  );
  const conjunto = new Set(permitidos);
  const escritos = numerosEscritos(texto);
  const vacio = escritos.length === 0;
  const invalidos = [...new Set(escritos.filter((n) => !conjunto.has(n)))];

  const topeSinRegistro = registrados.length === 0 && permitidos.length > 0;
  if (vacio) {
    return { ok: true, invalidos: [], permitidos, vacio: true, topeSinRegistro };
  }
  if (invalidos.length === 0) {
    return { ok: true, invalidos: [], permitidos, vacio: false, topeSinRegistro };
  }

  const quienes = invalidos.join(", ");
  const motivo = registrados.length
    ? `el caballo ${quienes} no corre en esta carrera (participan: ${listaLegible(permitidos)})`
    : `el caballo ${quienes} no existe: la carrera no tiene registrados, se admite hasta el ${permitidos[permitidos.length - 1]}`;
  return { ok: false, invalidos, permitidos, vacio: false, topeSinRegistro, motivo };
}

/**
 * Revisa TODAS las filas de una carga (Carga Rapida incluida) de una sola vez.
 * Devuelve los numeros malos por indice de fila, para que el operador sepa que
 * linea corregir en vez de perder la carga entera.
 */
export function revisarColumnaCaballo(
  textos: (string | null | undefined)[],
  caballos: ReferenciaCaballo[] | null | undefined,
  maximoVisible?: number | null
): Map<number, RevisionCaballo> {
  const salida = new Map<number, RevisionCaballo>();
  textos.forEach((t, i) => {
    const r = revisarCaballo(t, caballos, maximoVisible);
    if (!r.ok) salida.set(i, r);
  });
  return salida;
}
