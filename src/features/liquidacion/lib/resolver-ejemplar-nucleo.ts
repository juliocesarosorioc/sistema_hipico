/**
 * ============================================================================
 * NÚCLEO PURO — SINCRONIZACIÓN NÚMERO DE EJEMPLAR ➔ NOMBRE OFICIAL
 * ============================================================================
 *
 * BUG QUE RESUELVE
 * ----------------
 * En los editores, al cambiar el NÚMERO del caballo de una jugada (ej. al #5) el
 * número se actualizaba pero el NOMBRE del ejemplar quedaba con el anterior
 * ("ETNA'S NAPPER(USA)"). El ticket terminaba mostrando el N°5 con el nombre del
 * N°7: dos verdades sobre el mismo ejemplar.
 *
 * REGLA
 * -----
 * Cada vez que cambia el número de ejemplar hay que BUSCAR el nombre real en el
 * programa/padrón oficial de esa carrera — la matriz `carreras.caballos` (JSON
 * `{numero, nombre}`) para (fecha, hipódromo, nº de carrera) — y usar ese nombre.
 *
 * Este archivo NO toca Supabase ni React: solo indexa y resuelve. La parte con
 * I/O vive en `resolver-ejemplar.ts`. Se testea en node
 * (pruebas/resolver-ejemplar.test.ts).
 */

const TXT = (v: unknown): string => (v == null ? "" : String(v).trim());

/** Ejemplar mínimo del padrón (lo que trae `carreras.caballos`). */
export type EjemplarPadron = { numero?: string | number | null; nombre?: string | null };

/**
 * Índice `número (texto, sin espacios) → nombre OFICIAL` del padrón de la
 * carrera. El número se normaliza igual que en el resto de la app
 * (`String(...).trim()`) para que "5", 5 y " 5 " apunten al mismo ejemplar. Los
 * ejemplares sin nombre utilizable se descartan (no se inventa un nombre).
 */
export function indiceNombresPorNumero(
  caballos: EjemplarPadron[] | null | undefined
): Map<string, string> {
  const mapa = new Map<string, string>();
  for (const c of caballos ?? []) {
    const n = TXT(c?.numero);
    const nombre = TXT(c?.nombre);
    if (n && nombre) mapa.set(n, nombre);
  }
  return mapa;
}

/**
 * Nombre OFICIAL del ejemplar con ese número en el padrón dado, o `null` si el
 * número no corresponde a ningún ejemplar (carrera vacía, número inexistente).
 *
 * Devuelve `null` —y NO ""— para que el llamador distinga "no hay nombre que
 * poner" de "el nombre es vacío": así no pisa un nombre válido con nada.
 */
export function nombreDeNumero(
  numero: string | number | null | undefined,
  caballos: EjemplarPadron[] | null | undefined
): string | null {
  const n = TXT(numero);
  if (!n) return null;
  return indiceNombresPorNumero(caballos).get(n) ?? null;
}

/**
 * ¿El cambio de un editor toca el número de ejemplar? Compara el número anterior
 * contra el nuevo (normalizados a texto). Es el disparador de la sincronización.
 */
export function cambioDeNumeroEjemplar(
  numeroAntes: string | number | null | undefined,
  numeroDespues: string | number | null | undefined
): boolean {
  return TXT(numeroAntes) !== TXT(numeroDespues);
}

/** Clave canónica de una carrera para buscar su padrón: fecha|hipódromo|número. */
export function clavePadronCarrera(
  fecha: string | null | undefined,
  hipodromo: string | null | undefined,
  carrera: number | string | null | undefined
): string {
  const f = TXT(fecha).slice(0, 10);
  const h = TXT(hipodromo).toUpperCase().replace(/\s+/g, "");
  const c = Number(carrera) || 0;
  return `${f}|${h}|${c}`;
}
