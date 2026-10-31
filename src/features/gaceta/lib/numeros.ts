/**
 * Números de carrera de la gaceta (utilidades PURAS).
 *
 * La IA puede escribir el número de mil formas: 13, "13", "13ª", "XIII",
 * "decimotercera", "CARRERA 13". Todas deben caer en el MISMO entero; si no,
 * la fusión por "hipódromo|número" trata la misma carrera como dos.
 *
 * El problema grave es el inverso: cuando dos carreras DISTINTAS quedan con el
 * mismo número (una mal leída), la fusión/el deduplicado las colapsaba y la
 * Gaceta perdía una carrera EN SILENCIO (incidente real: la 13.ª publicada como
 * la 10.ª → la sección "Carreras extraídas" mostraba 12 de 13). Aquí viven las
 * funciones que normalizan el número, fusionan SIN perder carreras distintas y
 * reparan la numeración al final (renumera la mal leída al hueco de la
 * secuencia; une solo lo que de verdad es la misma carrera repartida en
 * páginas).
 */

// ---------- Tipos mínimos (compatibles con CarreraExtraida y CarreraRegistro) ----------

export type EjemplarMinimo = { numero?: number | string | null; nombre?: string | null };

export type CarreraMinima = {
  carrera: number | string | null;
  hipodromo?: string | null;
  archivoOrigen?: string | null;
  ejemplares?: EjemplarMinimo[] | null;
  caballos?: EjemplarMinimo[] | null;
};

// ---------- Normalización del número ----------

/** Ordinales escritos en español (1..20) SIN tildes ni espacios, que es como
 *  los deja `normalizarTexto`. Cubre las dos formas (undécima / decimoprimera…). */
const ORDINALES: Record<string, number> = {
  primera: 1, primero: 1, unica: 1, unico: 1,
  segunda: 2, segundo: 2,
  tercera: 3, tercero: 3,
  cuarta: 4, cuatro: 4, cuarto: 4,
  quinta: 5, quinto: 5,
  sexta: 6, sexto: 6,
  septima: 7, septimo: 7,
  octava: 8, octavo: 8,
  novena: 9, noveno: 9,
  decima: 10, decimo: 10,
  undecima: 11, undecimo: 11, decimoprimera: 11, decimoprimero: 11,
  duodecima: 12, duodecimo: 12, decimosegunda: 12, decimosegundo: 12,
  decimotercera: 13, decimotercero: 13,
  decimocuarta: 14, decimocuarto: 14,
  decimoquinta: 15, decimoquinto: 15,
  decimosexta: 16, decimosexto: 16,
  decimoseptima: 17, decimoseptimo: 17,
  decimoctava: 18, decimoctavo: 18,
  decimonovena: 19, decimonoveno: 19,
  vigesima: 20, vigesimo: 20,
};

/** Quita tildes, espacios y signos: "Decimotercera." → "decimotercera". */
function normalizarTexto(s: string): string {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/** Convierte un romano clásico (I..XL) a entero; null si no es un romano válido. */
function romanoAEntero(token: string): number | null {
  const t = String(token || "").toUpperCase().replace(/[.\s]/g, "");
  if (!t || t.length > 6 || !/^[IVXL]+$/.test(t)) return null;
  const val: Record<string, number> = { I: 1, V: 5, X: 10, L: 50 };
  let total = 0;
  for (let i = 0; i < t.length; i++) {
    const a = val[t[i]];
    const b = i + 1 < t.length ? val[t[i + 1]] : 0;
    total += a < b ? -a : a;
  }
  return total > 0 && total <= 40 ? total : null;
}

/**
 * Detecta si una cadena o valor representa explícitamente una VÁLIDA del 5 y 6 (Venezuela):
 *   "1ª VÁLIDA", "1a. VÁLIDA", "1ra valida", "PRIMERA VÁLIDA", "2ª VÁLIDA", etc.
 * Devuelve el número de válida (1..6) o null si no es una válida.
 */
export function numeroDeValida(valor: unknown): number | null {
  const s = String(valor ?? "").trim();
  if (!s) return null;
  const matchValida =
    s.match(/(?:v[aá]lida)\s*(?:n[º°.]?\s*)?#?\s*(\d+)/i) ||
    s.match(/(\d+)\s*(?:[ª°aA]|ra|da|ta|ma)?\.?\s*(?:v[aá]lida)/i);
  if (matchValida) {
    const n = parseInt(matchValida[1], 10);
    if (n >= 1 && n <= 6) return n;
  }
  const matchValidaOrd =
    s.match(/([A-Za-zÁÉÍÓÚÑáéíóúñ]+)\s+(?:v[aá]lida)/i) ||
    s.match(/(?:v[aá]lida)\s+([A-Za-zÁÉÍÓÚÑáéíóúñ]+)/i);
  if (matchValidaOrd) {
    const k = normalizarTexto(matchValidaOrd[1]);
    const n = ORDINALES[k];
    if (n && n >= 1 && n <= 6) return n;
  }
  return null;
}

/**
 * Número de carrera como ENTERO, venga como venga:
 *   13 | "13" | "13ª" | "N° 13" | "XIII" | "decimotercera" | "CARRERA 13" → 13
 * Devuelve null si no se puede leer un número positivo (entonces quien llame
 * debe conservar el valor original tal cual).
 */
export function numeroDeCarrera(valor: unknown): number | null {
  if (typeof valor === "number") {
    return Number.isFinite(valor) && valor > 0 ? Math.trunc(valor) : null;
  }
  const s = String(valor ?? "").trim();
  if (!s) return null;

  // 1) Si menciona explícitamente "carrera" o "race" con un número arábigo u ordinal:
  //    Ej: "1ª VÁLIDA (7ª CARRERA)", "7ma CARRERA", "CARRERA 7", "RACE 7", "7ª CARRERA - 1ª VÁLIDA"
  //    Prioriza el número de carrera general sobre el número de válida (7 sobre 1).
  const matchCarreraNum =
    s.match(/(?:carrera|race|car\.?)\s*(?:n[º°.]?\s*)?#?\s*(\d+)/i) ||
    s.match(/(\d+)\s*(?:[ª°aA]|ra|da|ta|ma)?\.?\s*(?:carrera|race)/i);
  if (matchCarreraNum) {
    const n = parseInt(matchCarreraNum[1], 10);
    if (n > 0) return n;
  }

  // 2) Ordinal escrito con la palabra carrera: ej "séptima carrera", "carrera séptima"
  const matchCarreraOrd =
    s.match(/([A-Za-zÁÉÍÓÚÑáéíóúñ]+)\s+(?:carrera|race)/i) ||
    s.match(/(?:carrera|race)\s+([A-Za-zÁÉÍÓÚÑáéíóúñ]+)/i);
  if (matchCarreraOrd) {
    const k = normalizarTexto(matchCarreraOrd[1]);
    const n = ORDINALES[k];
    if (n) return n;
  }

  // Si menciona explícitamente "válida" y NO menciona "carrera/race":
  // ej: "2ª VÁLIDA PARA EL 5 Y 6" o "1ª VÁLIDA". No asignar un número de carrera
  // arbitrario aquí; se delega a numeroDeValida() para resolver su correlativo.
  if (/v[aá]lida/i.test(s) && !/(?:carrera|race)/i.test(s)) {
    return null;
  }

  // 3) Un romano suelto (cubre "XIII", "XIV", "(VII)"). Se buscan palabras completas sin romper tildes.
  for (const tok of s.split(/[^A-Za-zÁÉÍÓÚÑáéíóúñ]+/)) {
    const r = romanoAEntero(tok);
    if (r) return r;
  }

  // 4) Un ordinal escrito suelto (cubre "decimotercera", "DECIMOTERCERA", "septima").
  const candidatos = [normalizarTexto(s), ...s.split(/\s+/).map(normalizarTexto)];
  for (const k of candidatos) {
    const n = ORDINALES[k];
    if (n) return n;
  }

  // 5) Cualquier dígito arábigo (cubre "13", "13ª", "N° 13", "7").
  const arabigo = s.match(/\d+/);
  if (arabigo) {
    const n = parseInt(arabigo[0], 10);
    if (n > 0) return n;
  }

  return null;
}

// ---------- Identidad de una carrera ----------

function claveHipodromo(hipodromo?: string | null): string {
  return String(hipodromo || "").trim().toUpperCase();
}

/** Clave de fusión de una carrera: hipódromo + número normalizado. */
export function claveCarreraExtraida(c: CarreraMinima | null | undefined): string {
  const n = numeroDeCarrera(c?.carrera);
  return `${claveHipodromo(c?.hipodromo)}|${n ?? String(c?.carrera ?? "")}`;
}

/** Nombres (MAYÚSCULAS) de los ejemplares de una carrera. */
function nombresDe(c: CarreraMinima | null | undefined): Set<string> {
  const arr = (c?.ejemplares && c.ejemplares.length ? c.ejemplares : c?.caballos) || [];
  const set = new Set<string>();
  for (const e of arr) {
    const n = String(e?.nombre ?? "").trim().toUpperCase();
    if (n) set.add(n);
  }
  return set;
}

/**
 * ¿Dos entradas con el MISMO hipódromo+número son LA MISMA carrera?
 * Sí cuando comparten al menos un ejemplar (misma carrera repetida entre
 * páginas) o cuando ninguna trae nombres (no se puede distinguir, se conserva
 * una sola). NO cuando ambas traen ejemplares y son disjuntos: eso es una
 * carrera DISTINTA mal numerada (p. ej. la 13.ª escrita como 10.ª).
 */
export function mismaCarreraExtraida(a: CarreraMinima | null | undefined, b: CarreraMinima | null | undefined): boolean {
  const A = nombresDe(a);
  const B = nombresDe(b);
  if (!A.size || !B.size) return true;
  for (const n of A) if (B.has(n)) return true;
  return false;
}

/** Puestos (números de programa) de los ejemplares de una carrera. */
function numerosCaballos(c: CarreraMinima | null | undefined): Set<string> {
  const arr = (c?.ejemplares && c.ejemplares.length ? c.ejemplares : c?.caballos) || [];
  const set = new Set<string>();
  for (const e of arr) {
    const n = e?.numero;
    if (n !== null && n !== undefined && String(n).trim() !== "") set.add(String(n).trim());
  }
  return set;
}

/**
 * ¿Dos carreras con el mismo número "chocan"? Sí cuando comparten algún puesto
 * de ejemplar (dos carreras distintas numeran sus caballos 1..n, así que
 * siempre chocan) o cuando no hay puestos que comparar (no se puede distinguir
 * → se prefiere no perder la carrera). NO cuando la numeración es
 * complementaria: eso es la MISMA carrera partida entre páginas.
 */
function choqueDeCaballos(a: CarreraMinima | null | undefined, b: CarreraMinima | null | undefined): boolean {
  const A = numerosCaballos(a);
  const B = numerosCaballos(b);
  if (!A.size || !B.size) return true;
  for (const x of A) if (B.has(x)) return true;
  return false;
}

/**
 * Une los ejemplares de `origen` dentro de `destino`, sin duplicar por número/nombre.
 */
function unirEjemplares<T extends CarreraMinima>(destino: T, origen: T): void {
  if (!destino.archivoOrigen && origen.archivoOrigen) destino.archivoOrigen = origen.archivoOrigen;
  const be = (destino.ejemplares = destino.ejemplares || []);
  const ids = new Set(be.map((e) => String(e?.numero ?? e?.nombre ?? "")));
  for (const e of origen.ejemplares || origen.caballos || []) {
    const id = String(e?.numero ?? e?.nombre ?? "");
    if (id && !ids.has(id)) {
      be.push(e);
      ids.add(id);
    }
  }
}

/**
 * Fusiona carreras extraídas SIN perder carreras distintas: une por
 * hipódromo+número solo cuando es la misma carrera; si el número coincide pero
 * los ejemplares son disjuntos, CONSERVA ambas (una está mal numerada) para
 * que `repararNumerosCarreras` la corrija al final.
 */
export function fusionarCarrerasSinPerder<T extends CarreraMinima>(acumulado: T[], nuevas: T[]): void {
  for (const c of Array.isArray(nuevas) ? nuevas : []) {
    if (!c || typeof c !== "object") continue;
    const key = claveCarreraExtraida(c);
    const ex = key === "|" ? undefined : acumulado.find((x) => claveCarreraExtraida(x) === key);
    if (!ex) {
      acumulado.push(c);
    } else if (mismaCarreraExtraida(ex, c)) {
      unirEjemplares(ex, c);
    } else {
      acumulado.push(c);
    }
  }
}

// ---------- Reparación de la numeración ----------

export type ReporteReparacion = {
  /** Números corregidos: la carrera mal leída `de` pasó a `a`. */
  renumeradas: Array<{ hipodromo: string; de: number; a: number }>;
  /** Carreras unidas por ser (de verdad) la misma repartida entre páginas. */
  consolidadas: number;
  /** Huecos de la secuencia que no se pudieron rellenar (carreras faltantes). */
  sinResolver: number;
};

/**
 * Repara la numeración de un lote ya fusionado. La gaceta numera 1..N sin
 * huecos: si los números presentes son EXACTAMENTE 1..M y sobran entradas
 * (repetidos), cada repetida es una carrera mal leída y se renumera con el
 * número que sigue (M+1, M+2, …). Ej.: [1..12, 10] → el 10 repetido se corrige
 * a 13 (así la Gaceta vuelve a traer las trece).
 *
 * Si la numeración tiene huecos internos NO se toca (puede ser una lote que no
 * se leyó) y se informa. Si tras renumerar quedan claves repetidas son la MISMA
 * carrera partida entre páginas: se unen sus ejemplares. Muta `carreras`.
 */
export function repararNumerosCarreras<T extends CarreraMinima>(carreras: T[]): ReporteReparacion {
  const rep: ReporteReparacion = { renumeradas: [], consolidadas: 0, sinResolver: 0 };
  if (!Array.isArray(carreras) || carreras.length < 2) return rep;

  // Agrupar por hipódromo conservando el orden de aparición.
  const grupos = new Map<string, number[]>();
  carreras.forEach((c, i) => {
    const k = claveHipodromo(c?.hipodromo);
    const arr = grupos.get(k);
    if (arr) arr.push(i);
    else grupos.set(k, [i]);
  });

  for (const [hipo, idxs] of grupos) {
    const porNumero = new Map<number, number[]>();
    for (const i of idxs) {
      const n = numeroDeCarrera(carreras[i].carrera);
      if (n == null) continue;
      const arr = porNumero.get(n);
      if (arr) arr.push(i);
      else porNumero.set(n, [i]);
    }
    if (!porNumero.size) continue;

    const presentes = [...porNumero.keys()].sort((a, b) => a - b);
    const M = presentes[presentes.length - 1];
    // "Contiguo" = los números presentes son EXACTAMENTE 1..M (M positivos
    // distintos ⇒ {1..M}). Si hay huecos internos la numeración está
    // incompleta y NO se renumera (podría ser una lote que no se leyó).
    const contiguo = presentes.length === M;

    // Apariciones repetidas (todas menos la primera de cada número).
    const extras: Array<{ i: number; de: number }> = [];
    for (const [n, lista] of porNumero) {
      for (let j = 1; j < lista.length; j++) extras.push({ i: lista[j], de: n });
    }
    // La MÁS temprana primero: recibe el número inmediatamente siguiente, de
    // modo que la última carrera del documento conserva el número más alto.
    extras.sort((a, b) => a.i - b.i);

    if (contiguo && extras.length) {
      // La secuencia 1..M está completa y sobran entradas. Cada repetida que
      // CHOCA con la original (mismos puestos de ejemplar) es otra carrera mal
      // leída (p. ej. la 13.ª escrita como 10.ª) → se le asigna el número que
      // sigue (M+1, M+2, …). Si la numeración es complementaria es la MISMA
      // carrera partida entre páginas: se deja para unir en la pasada final.
      let destino = M;
      for (const ex of extras) {
        const original = porNumero.get(ex.de)![0];
        if (!choqueDeCaballos(carreras[original], carreras[ex.i])) continue;
        destino += 1;
        carreras[ex.i].carrera = destino;
        rep.renumeradas.push({ hipodromo: hipo, de: ex.de, a: destino });
      }
    } else if (!contiguo) {
      // Huecos internos: no se puede reparar con seguridad, solo se informan.
      for (let n = 1; n <= M; n++) if (!porNumero.has(n)) rep.sinResolver += 1;
    }
  }

  // Pasada final: si quedan claves repetidas, es la misma carrera repartida
  // entre páginas → unir ejemplares (no perder ninguno).
  const vistos = new Map<string, number>();
  const out: T[] = [];
  for (const c of carreras) {
    const key = claveCarreraExtraida(c);
    const prev = key === "|" ? undefined : vistos.get(key);
    if (prev == null) {
      if (key !== "|") vistos.set(key, out.length);
      out.push(c);
      continue;
    }
    unirEjemplares(out[prev], c);
    rep.consolidadas += 1;
  }
  carreras.length = 0;
  for (const c of out) carreras.push(c);

  return rep;
}

/** Huecos de la secuencia por hipódromo: qué números faltan de 1..max. */
export function carrerasFaltantes<T extends CarreraMinima>(
  carreras: T[]
): Array<{ hipodromo: string; faltan: number[] }> {
  const grupos = new Map<string, Set<number>>();
  for (const c of carreras) {
    const n = numeroDeCarrera(c?.carrera);
    if (n == null) continue;
    const k = claveHipodromo(c?.hipodromo);
    const set = grupos.get(k) || new Set<number>();
    set.add(n);
    grupos.set(k, set);
  }
  const out: Array<{ hipodromo: string; faltan: number[] }> = [];
  for (const [hipodromo, set] of grupos) {
    let max = 0;
    for (const n of set) if (n > max) max = n;
    const faltan: number[] = [];
    for (let n = 1; n <= max; n++) if (!set.has(n)) faltan.push(n);
    if (faltan.length) out.push({ hipodromo, faltan });
  }
  return out;
}

/**
 * Parsea el número de dorsal/gualdrapa de un ejemplar para ordenamiento numérico exacto.
 * Ejemplos:
 *   1 -> { num: 1, sufijo: "" }
 *   "1A" -> { num: 1, sufijo: "A" }
 *   " 2B " -> { num: 2, sufijo: "B" }
 *   "10" -> { num: 10, sufijo: "" }
 */
export function parseNumeroCaballo(val: unknown): { num: number; sufijo: string; raw: string } {
  const raw = String(val ?? "").trim();
  if (!raw) return { num: 9999, sufijo: "", raw: "" };
  const m = raw.match(/^(\d+)(.*)$/);
  if (m) {
    const num = parseInt(m[1], 10);
    const sufijo = (m[2] || "").trim().toUpperCase();
    return { num, sufijo, raw };
  }
  return { num: 9999, sufijo: raw.toUpperCase(), raw };
}

/**
 * Función de comparación pura para ordenar ejemplares de menor a mayor dorsal:
 * 1, 1A, 2, 2A, 2B, 3, 4, ..., 10, 11, etc.
 */
export function compararEjemplares(a: EjemplarMinimo, b: EjemplarMinimo): number {
  const pa = parseNumeroCaballo(a?.numero);
  const pb = parseNumeroCaballo(b?.numero);
  if (pa.num !== pb.num) return pa.num - pb.num;
  if (pa.sufijo !== pb.sufijo) return pa.sufijo.localeCompare(pb.sufijo);
  return String(a?.nombre || "").trim().localeCompare(String(b?.nombre || "").trim());
}

/**
 * Ordena DETERMINÍSTICAMENTE una lista de carreras y todos los ejemplares dentro de cada carrera:
 * 1. Todos los ejemplares dentro de cada carrera se ordenan por su número de dorsal ascendente (1, 1A, 2, ..., 14).
 * 2. Las carreras se ordenan por hipódromo y por su número de carrera correlativo ascendente (1, 2, 3, ..., 12).
 */
export function ordenarCarrerasYEjemplares<T extends CarreraMinima>(carreras: T[]): T[] {
  if (!Array.isArray(carreras)) return [];

  for (const c of carreras) {
    if (!c) continue;
    if (Array.isArray(c.ejemplares)) {
      c.ejemplares.sort(compararEjemplares);
    }
    if (Array.isArray(c.caballos)) {
      c.caballos.sort(compararEjemplares);
    }
  }

  return carreras.sort((a, b) => {
    const hipoA = String(a?.hipodromo || "").trim().toUpperCase();
    const hipoB = String(b?.hipodromo || "").trim().toUpperCase();
    if (hipoA !== hipoB) {
      return hipoA.localeCompare(hipoB);
    }
    const numA = numeroDeCarrera(a?.carrera) ?? 9999;
    const numB = numeroDeCarrera(b?.carrera) ?? 9999;
    if (numA !== numB) return numA - numB;
    return String(a?.carrera ?? "").localeCompare(String(b?.carrera ?? ""));
  });
}
