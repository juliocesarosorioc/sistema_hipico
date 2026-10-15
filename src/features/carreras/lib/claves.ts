/**
 * CLAVES DE CRUCE de hipódromo y número de carrera.
 *
 * Existían cuatro normalizaciones distintas del mismo dato:
 *   - `agruparHipodromos.ts` → `(hipo ?? "").trim().toUpperCase()`
 *   - `useRegistroCentral.ts` → mayúsculas sin espacios
 *   - `DupletaModule.tsx` → un `norm()` local
 *   - `PanelMarcas.tsx` → `String(...).trim().toUpperCase()`
 *
 * Basta con que uno conserve un espacio o una tilde y la carrera "desaparece" de
 * un módulo y sigue visible en otro: es exactamente el síntoma que se venía
 * reportando ("esta carrera sale en unos módulos y en otros no"). Aquí hay UNA
 * sola clave para todos, sin React ni Supabase, para que sea testeable en
 * aislamiento y se pueda importar desde cualquier lado.
 */

/** Clave de comparación de hipódromo: mayúsculas, sin espacios redundantes. */
export function claveHipodromo(v: unknown): string {
  return String(v ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

/** Número de carrera usable. `0` cuando no lo es (PP, "", null, NaN). */
export function numeroCarrera(v: unknown): number {
  const n = Number(String(v ?? "").trim());
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

/** `hipodromo|carrera` — la clave con que se cruzan marcas, tablas y resultados. */
export function claveCarrera(hipodromo: unknown, carrera: unknown, fecha?: string): string {
  const dia = fecha ? String(fecha).trim().slice(0, 10) : "";
  return `${claveHipodromo(hipodromo)}|${numeroCarrera(carrera)}${dia ? `|${dia}` : ""}`;
}

/**
 * Agrupa carreras por hipódromo y las ordena por número. Descarta las que no
 * tienen hipódromo o un número de carrera válido.
 *
 * Devuelve un Map para que quien llama no tenga que volver a agrupar: el registro
 * central lo usa para `carrerasDe`/`numerosDe` y Dupletas para intersectar con
 * el catálogo.
 */
export function agruparCarreras<T extends { hipodromo?: string | null; carrera?: number | string | null }>(
  carreras: T[]
): Map<string, T[]> {
  const porHipodromo = new Map<string, T[]>();
  for (const c of carreras) {
    const hipo = claveHipodromo(c.hipodromo);
    const n = numeroCarrera(c.carrera);
    if (!hipo || !n) continue;
    const lista = porHipodromo.get(hipo);
    if (lista) lista.push(c);
    else porHipodromo.set(hipo, [c]);
  }
  for (const lista of porHipodromo.values()) {
    lista.sort((a, b) => numeroCarrera(a.carrera) - numeroCarrera(b.carrera));
  }
  return porHipodromo;
}

/**
 * Números de carrera de UN hipódromo, sin repetir y ordenados.
 *
 * Filtra por la clave normalizada de verdad: sin ese filtro un llamador creería
 * que una carrera existe en un hipódromo donde nunca se registró, que es
 * justamente como una tabla "aparece" en un módulo y en otro no.
 */
export function numerosDeCarrera<T extends { hipodromo?: string | null; carrera?: number | string | null }>(
  carreras: T[],
  hipodromo: string | null | undefined
): number[] {
  const hipo = claveHipodromo(hipodromo);
  if (!hipo) return [];
  const lista = carreras.filter((c) => claveHipodromo(c.hipodromo) === hipo);
  return [...new Set(lista.map((c) => numeroCarrera(c.carrera)).filter((n) => n > 0))].sort((a, b) => a - b);
}
