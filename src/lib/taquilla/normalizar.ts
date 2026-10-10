/**
 * NORMALIZADOR DIFUSO de la Carga Rápida (módulo PURO, sin I/O ni React).
 *
 * Se para ANTES del parser (validar.ts) y usa los catálogos que la plataforma
 * ya tiene en pantalla:
 *
 *   normalizarLineaRapida(linea, { clientes, caballos })
 *
 * Resuelve exactamente lo que un texto dictado por voz rompe en el parser
 * legacy:
 *
 *  1. Números hablados → dígitos        ("cincuenta y cinco" → 55)
 *  2. Nomenclatura hablada → canónica   ("a la par" → pp · "dos p" → 2p ·
 *                                        "tres y tres" → 3y3 · "diez a ocho" →
 *                                        10/8)
 *  3. Nombres de clientes con errores   ("perito molina" → "Perrito Molinas",
 *                                        matcheado contra el catálogo REAL con
 *                                        Jaro-Winkler, sin partir nombres
 *                                        compuestos)
 *  4. El caballo por nombre de ejemplar ("juega … con relámpago …" → N°7)
 *
 * Devuelve la línea ya estructurada con una CONFIANZA por campo ("exacto" |
 * "aproximado" | "sin") y una lista de correcciones legibles para la vista
 * previa del modal. Las líneas que no se reconocen NO se descartan: vuelven
 * como { ok:false } para que el caller las pinte en rojo y las corrija.
 *
 * El módulo es determinista y gratis: es la Capa 1 del plan; la IA (Edge
 * Function) es solo un refuerzo opcional cuando una línea quede "sin".
 */

import { clasificarLineaRapida } from "@/lib/taquilla/validar";

export type ConfianzaCampo = "exacto" | "aproximado" | "sin";

/** Lo mínimo que necesita el matcheador: el nombre canónico del cliente. */
export type ClienteRef = { nombre: string };

/** Un ejemplar de la carrera: el padrón con número + nombre. */
export type CaballoRef = { numero: string | number; nombre?: string | null };

export type ContextoNormalizacion = {
  clientes: ClienteRef[];
  caballos?: CaballoRef[];
};

export type ResultadoNormalizado =
  | {
      ok: true;
      jugada: string;
      caballo: string;
      monto: string;
      cliente1: string;
      cliente2: string;
      confianza: Record<"jugada" | "caballo" | "monto" | "cliente1" | "cliente2", ConfianzaCampo>;
      /** Ajustes legibles: «perito molina» → Perrito Molinas · N°7, etc. */
      correcciones: string[];
    }
  | { ok: false; motivo: string };

/** Umbral de Jaro-Winkler para dar por bueno un nombre (0..1). */
export const UMBRAL_MATCH = 0.88;
/** Sobre UMBRAL_MATCH se considera coincidencia EXACTA (sin tilde/espacio). */
const UMBRAL_EXACTO = 0.97;

/** Conectores que separan material entre clientes ("y" suele sobrevivir). */
const CONECTORES = new Set(["y", "e", "con"]);

/* ─────────────────────────── 1. NÚMEROS HABLADOS ─────────────────────────── */

const NUM_UNIDADES: Record<string, number> = {
  cero: 0, un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5,
  seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, trece: 13,
  catorce: 14, quince: 15, dieciseis: 16, dieciséis: 16, diecisiete: 17,
  dieciocho: 18, diecinueve: 19,
};
const NUM_VEINTI: Record<string, number> = {
  veintiun: 21, veintiún: 21, veintiuno: 21, veintidos: 22, veintidós: 22,
  veintitres: 23, veintitrés: 23, veinticuatro: 24, veinticinco: 25,
  veintiseis: 26, veintiséis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29,
};
const NUM_DECENAS: Record<string, number> = {
  veinte: 20, treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60,
  setenta: 70, ochenta: 80, noventa: 90,
};
const NUM_CENTENAS: Record<string, number> = {
  cien: 100, ciento: 100, doscientos: 200, doscientas: 200, trescientos: 300,
  trescientas: 300, cuatrocientos: 400, cuatrocientas: 400, quinientos: 500,
  quinientas: 500, seiscientos: 600, seiscientas: 600, setecientos: 700,
  setecientas: 700, ochocientos: 800, ochocientas: 800, novecientos: 900,
  novecientas: 900,
};

/**
 * Lee una frase numérica empezando en `pos`. Cubre el habla real de la casa:
 * "mil doscientos" → 1200 · "dos mil trescientos cuarenta y cinco" → 2345 ·
 * "cincuenta y cinco" → 55 · "quinientos" → 500. Los dígitos crudos se
 * devuelven tal cual (consumidos 1, desdePalabras false).
 *
 * Regla clave de la gramática del español: una UNIDAD (1-9) sin "mil" NO
 * continúa en decena/centena — "cinco doscientos" son DOS números ("el cinco,
 * doscientos a la par"), jamás 205. En cambio la centena sí sigue en decena
 * ("doscientos cincuenta y cinco") y la decena en unidad vía "y".
 */
function leerNumeroHablado(
  palabras: string[],
  pos: number
): { valor: number; consumidos: number; desdePalabras: boolean } | null {
  const n = palabras.length;
  if (pos >= n) return null;
  let i = pos;

  // Dígitos crudos ("100", "1.200,50"): pasan sin tocar.
  if (/^\d+(?:[.,]\d+)*$/.test(palabras[i])) {
    return { valor: parseFloat(palabras[i].replace(",", ".")), consumidos: 1, desdePalabras: false };
  }

  let total = 0;
  let desdePalabras = false;
  let inicio: "centena" | "decena" | "veinti" | "unidad" | "mil" | null = null;

  // ── palabra inicial ──
  const cen = NUM_CENTENAS[palabras[i]];
  const dec = NUM_DECENAS[palabras[i]];
  const vei = NUM_VEINTI[palabras[i]];
  const uni = NUM_UNIDADES[palabras[i]];
  if (cen !== undefined) {
    total = cen;
    inicio = "centena";
  } else if (dec !== undefined) {
    total = dec;
    inicio = "decena";
  } else if (vei !== undefined) {
    return { valor: vei, consumidos: 1, desdePalabras: true };
  } else if (uni !== undefined) {
    total = uni;
    inicio = "unidad";
  } else if (palabras[i] === "mil") {
    total = 1000;
    inicio = "mil";
  } else {
    return null;
  }
  i++;
  desdePalabras = true;
  let huboMil = inicio === "mil";

  // ── factor de miles: "dos mil" · "quinientos mil" ──
  if (i < n && palabras[i] === "mil") {
    total *= 1000;
    i++;
    huboMil = true;
  }

  // ── continuaciones ──
  if (inicio === "decena") {
    // Solo "y"/"con" + unidad: "cincuenta y cinco" → 55.
    if (i + 1 < n && (palabras[i] === "y" || palabras[i] === "con") && NUM_UNIDADES[palabras[i + 1]] !== undefined) {
      total += NUM_UNIDADES[palabras[i + 1]];
      i += 2;
    }
  } else if (inicio === "unidad" && !huboMil) {
    // "cinco doscientos" no es un número: se corta acá (quedó 5).
  } else if (inicio === "centena" || huboMil) {
    // Centena o miles: total; puede seguir decena/centena/unidad/veinti.
    while (i < n) {
      const w = palabras[i];
      if (w === "y" || w === "con") {
        i++;
        continue;
      }
      const c = NUM_CENTENAS[w];
      const d = NUM_DECENAS[w];
      const v = NUM_VEINTI[w];
      const u = NUM_UNIDADES[w];
      if (c !== undefined) {
        total += c;
        i++;
        continue;
      }
      if (d !== undefined) {
        total += d;
        i++;
        if (i + 1 < n && (palabras[i] === "y" || palabras[i] === "con") && NUM_UNIDADES[palabras[i + 1]] !== undefined) {
          total += NUM_UNIDADES[palabras[i + 1]];
          i += 2;
        }
        break;
      }
      if (v !== undefined) {
        total += v;
        i++;
        break;
      }
      if (u !== undefined) {
        total += u;
        i++;
        break;
      }
      break;
    }
  }

  if (i === pos) return null;
  return { valor: total, consumidos: i - pos, desdePalabras };
}

/* ──────────────────── 2. NOMENCLATURA HABLADA → CANÓNICA ─────────────────── */

export type LineaExpandida = {
  texto: string;
  huboNumeroPalabra: boolean;
  huboNomenclatura: boolean;
};

/**
 * Pre-procesa la línea del transcriptor: números en palabras → dígitos y
 * nomenclatura hablada → canónica (el orden importa: primero los números para
 * que "dos p" → "2 p" → "2p").
 */
export function expandirLineaHablada(linea: string): LineaExpandida {
  const t = String(linea ?? "").trim();
  const palabras = t.split(/\s+/);
  const nuevos: string[] = [];
  let huboNumeroPalabra = false;

  for (let i = 0; i < palabras.length; ) {
    const leido = leerNumeroHablado(palabras, i);
    if (leido && (leido.desdePalabras || leido.consumidos > 1)) {
      nuevos.push(String(leido.valor));
      if (leido.desdePalabras) huboNumeroPalabra = true;
      i += leido.consumidos;
    } else if (leido && leido.consumidos === 1) {
      nuevos.push(palabras[i]);
      i++;
    } else {
      nuevos.push(palabras[i]);
      i++;
    }
  }
  let texto = nuevos.join(" ");
  let huboNomenclatura = false;
  const marca = () => {
    huboNomenclatura = true;
  };

  // "1 y 2 n" → "1y2n" (combinada hablada). Va primero: es la más específica.
  texto = texto.replace(/\b(\d{1,2})\s+y\s+(\d{1,2})\s+(p|n)\b/gi, (_m, a, b, s) => {
    marca();
    return `${a}y${b}${s.toLowerCase()}`;
  });
  // "3 y 3" → "3y3" (solo rangos de puestos/caballos 1..16; un "200 y 300"
  // son dos montos y NO se pegan).
  texto = texto.replace(/\b(\d{1,2})\s+y\s+(\d{1,2})\b/gi, (_m, a, b) => {
    const na = parseInt(a, 10);
    const nb = parseInt(b, 10);
    if (na >= 1 && na <= 16 && nb >= 1 && nb <= 16) {
      marca();
      return `${a}y${b}`;
    }
    return `${a} y ${b}`;
  });
  // "2 p" / "1 pe" / "3 n" / "2 ene" → "2p" · "1p" · "3n".
  texto = texto.replace(/\b(\d{1,2})\s+(p|n|pe|ene)\b/gi, (_m, a, s) => {
    marca();
    const suf = s === "pe" || s === "ene" ? s.charAt(0) : s;
    return `${a}${suf.toLowerCase()}`;
  });
  // Pelo a pelo hablado → "pp".
  texto = texto.replace(/\ba\s+la\s+par\b/gi, () => {
    marca();
    return "pp";
  });
  texto = texto.replace(/\bpu?es?to\s+(?:por|a)\s+pu?es?to\b/gi, () => {
    marca();
    return "pp";
  });
  texto = texto.replace(/\bpar\b/gi, () => {
    marca();
    return "pp";
  });
  // A Premio hablado: "diez a ocho" → "10/8" (canon de barra que el parser ya
  // reconoce como jugada; "10a8" sigue existiendo como forma tipeada).
  texto = texto.replace(/\b(\d+(?:[.,]\d+)?)\s+a\s+(\d+(?:[.,]\d+)?)\b/gi, (_m, p, q) => {
    marca();
    return `${p}/${q}`;
  });

  return { texto, huboNumeroPalabra, huboNomenclatura };
}

/* ──────────────────── 3. SIMILITUD DIFUSA (JARO-WINKLER) ─────────────────── */

const ACENTOS: Record<string, string> = {
  á: "a", é: "e", í: "i", ó: "o", ú: "u", ü: "u", ñ: "n",
  Á: "a", É: "e", Í: "i", Ó: "o", Ú: "u", Ü: "u", Ñ: "n",
};

/** Quita tildes/dieresis y convierte ñ→n (para matchear el dictado sin tildes). */
export function quitarAcentos(s: string): string {
  return String(s ?? "").replace(/[áéíóúüñÁÉÍÓÚÜÑ]/g, (c) => ACENTOS[c] ?? c);
}

/** Nombre normalizado para comparar: minúsculas, sin tildes, sin puntuación. */
export function normalizarNombre(s: string): string {
  return quitarAcentos(String(s ?? ""))
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Jaro-Winkler: 1 = idénticos, 0 = totalmente distintos. Booster por prefijo
 * común (máx 4 caracteres, p = 0.1): ideal para nombres propios con typos.
 */
export function jaroWinkler(a: string, b: string): number {
  const sa = String(a ?? "");
  const sb = String(b ?? "");
  if (sa === sb) return 1;
  const lenA = sa.length;
  const lenB = sb.length;
  if (lenA === 0 || lenB === 0) return 0;

  const ventana = Math.max(0, Math.floor(Math.max(lenA, lenB) / 2) - 1);
  const matchA = new Array<boolean>(lenA).fill(false);
  const matchB = new Array<boolean>(lenB).fill(false);
  let matches = 0;
  for (let i = 0; i < lenA; i++) {
    const inicio = Math.max(0, i - ventana);
    const fin = Math.min(i + ventana + 1, lenB);
    for (let j = inicio; j < fin; j++) {
      if (!matchB[j] && sa[i] === sb[j]) {
        matchA[i] = true;
        matchB[j] = true;
        matches++;
        break;
      }
    }
  }
  if (matches === 0) return 0;

  let transposiciones = 0;
  let k = 0;
  for (let i = 0; i < lenA; i++) {
    if (!matchA[i]) continue;
    while (!matchB[k]) k++;
    if (sa[i] !== sb[k]) transposiciones++;
    k++;
  }

  const m = matches;
  const jaro = (m / lenA + m / lenB + (m - transposiciones / 2) / m) / 3;
  let prefijo = 0;
  for (let i = 0; i < Math.min(4, lenA, lenB); i++) {
    if (sa[i] === sb[i]) prefijo++;
    else break;
  }
  return jaro + prefijo * 0.1 * (1 - jaro);
}

/**
 * Penaliza la diferencia de palabras: matchear "perrito" contra el catálogo
 * completo "perrito molinas" debe perder contra el match del nombre completo.
 */
function afinidadTokens(a: string, b: string): number {
  const na = a.split(" ").filter(Boolean).length;
  const nb = b.split(" ").filter(Boolean).length;
  if (na === nb) return 1;
  return Math.max(0.4, 1 - Math.abs(na - nb) * 0.22);
}

/* ──────────────────── 4. RESOLUCIÓN DE CLIENTES ─────────────────── */

type CatalogoCliente = { nombre: string; norm: string };

type MatchCliente = { nombre: string; norm: string; score: number };

function mejorMatchCliente(segmento: string, catalogo: CatalogoCliente[]): MatchCliente | null {
  const seg = normalizarNombre(segmento);
  if (!seg) return null;
  let mejor: MatchCliente | null = null;
  for (const c of catalogo) {
    if (!c.norm) continue;
    const score = jaroWinkler(seg, c.norm) * afinidadTokens(seg, c.norm);
    if (score >= UMBRAL_MATCH && (!mejor || score > mejor.score)) {
      mejor = { nombre: c.nombre, norm: c.norm, score };
    }
  }
  return mejor;
}

export type ResolucionClientes = {
  cliente1: string;
  cliente1Score: number;
  cliente1Norm: string | null;
  cliente2: string;
  cliente2Score: number;
  cliente2Norm: string | null;
  correcciones: string[];
};

/**
 * Segmenta el "sobrante" en CLIENTE 1 / CLIENTE 2 matcheando el catálogo real
 * (jamás parte un nombre compuesto: "perrito molinas" se queda entero si el
 * cliente se llama "Perrito Molinas"). Sin catálogo → comportamiento legacy
 * (1° → CL1, resto → CL2) para no romper el flujo actual.
 */
export function resolverClientes(restantes: string[], clientes: ClienteRef[]): ResolucionClientes {
  const vacio: ResolucionClientes = {
    cliente1: "",
    cliente1Score: 0,
    cliente1Norm: null,
    cliente2: "",
    cliente2Score: 0,
    cliente2Norm: null,
    correcciones: [],
  };
  const tokens = restantes.filter((t) => {
    const n = normalizarNombre(t);
    return n && !CONECTORES.has(n);
  });
  if (tokens.length === 0) return vacio;

  const catalogo: CatalogoCliente[] = clientes
    .map((c) => ({ nombre: String(c.nombre ?? "").trim(), norm: normalizarNombre(c.nombre) }))
    .filter((c) => c.norm && c.nombre);

  // Sin catálogo (lista no cargada o vacía): idéntico al parser legacy.
  if (catalogo.length === 0) {
    return {
      cliente1: tokens[0],
      cliente1Score: 0,
      cliente1Norm: null,
      cliente2: tokens.slice(1).join(" "),
      cliente2Score: 0,
      cliente2Norm: null,
      correcciones: [],
    };
  }

  const n = tokens.length;
  type Particion = {
    score: number;
    seg1: string[];
    seg2: string[];
    m1: MatchCliente;
    m2: MatchCliente | null;
    sobras: number;
  };
  let mejor: Particion | null = null;

  // Cortes contiguos: cliente1 = [0..c1), cliente2 = [c1..c2), sobras = [c2..n).
  for (let corte1 = 1; corte1 <= n && corte1 <= 4; corte1++) {
    const seg1 = tokens.slice(0, corte1);
    const m1 = mejorMatchCliente(seg1.join(" "), catalogo);
    if (!m1) continue;
    for (let corte2 = corte1; corte2 <= n; corte2++) {
      const seg2 = tokens.slice(corte1, corte2);
      const m2 = seg2.length ? mejorMatchCliente(seg2.join(" "), catalogo) : null;
      if (seg2.length && !m2) continue;
      const sobras = n - corte2;
      const score = m1.score + (m2 ? m2.score * 1.02 : 0) - sobras * 0.45;
      if (!mejor || score > mejor.score) {
        mejor = { score, seg1, seg2, m1, m2, sobras };
      }
    }
  }

  if (!mejor) {
    // Ninguna partición alcanzó el umbral: se deja el material entero en CL1
    // para que la fila quede marcada "revisar", nunca se parte al azar.
    return {
      cliente1: tokens.join(" "),
      cliente1Score: 0,
      cliente1Norm: null,
      cliente2: "",
      cliente2Score: 0,
      cliente2Norm: null,
      correcciones: [],
    };
  }

  const texto1 = mejor.seg1.join(" ");
  const texto2 = mejor.seg2.join(" ");
  const correcciones: string[] = [];
  if (normalizarNombre(texto1) !== mejor.m1.norm) {
    correcciones.push(`«${texto1}» → ${mejor.m1.nombre}`);
  }
  if (mejor.m2 && normalizarNombre(texto2) !== mejor.m2.norm) {
    correcciones.push(`«${texto2}» → ${mejor.m2.nombre}`);
  }

  return {
    cliente1: mejor.m1.nombre,
    cliente1Score: mejor.m1.score,
    cliente1Norm: mejor.m1.norm,
    cliente2: mejor.m2?.nombre ?? "",
    cliente2Score: mejor.m2?.score ?? 0,
    cliente2Norm: mejor.m2?.norm ?? null,
    correcciones,
  };
}

/* ──────────────────── 5. CABALLO POR NOMBRE ─────────────────── */

export type ResolucionCaballo = {
  caballo: string;
  confianza: ConfianzaCampo;
  /** Sobrantes ya sin los tokens que eran el nombre del ejemplar. */
  restantes: string[];
  correcciones: string[];
};

/**
 * Si el parser no encontró un número de caballo, busca el NOMBRE del ejemplar
 * en el sobrante contra el padrón de la carrera ("juega … con relámpago …" →
 * N°7). Los tokens que eran el nombre se quitan del sobrante para que no
 * estorben en la asignación de clientes.
 */
export function resolverCaballoPorNombre(
  caballo: string,
  restantes: string[],
  caballos: CaballoRef[]
): ResolucionCaballo {
  const yaViene: ResolucionCaballo = { caballo, confianza: "exacto", restantes, correcciones: [] };
  if (String(caballo ?? "").trim()) return yaViene;

  const catalogo = caballos
    .map((c) => ({ numero: String(c.numero), norm: normalizarNombre(String(c.nombre ?? "")) }))
    .filter((c) => c.norm && /[a-z]/.test(c.norm));
  if (!catalogo.length) {
    return { caballo: "", confianza: "sin", restantes, correcciones: [] };
  }

  const n = restantes.length;
  let mejor: { numero: string; score: number; desde: number; hasta: number } | null = null;
  for (let i = 0; i < n; i++) {
    for (let j = i; j < Math.min(n, i + 4); j++) {
      const seg = restantes.slice(i, j + 1).join(" ");
      const segNorm = normalizarNombre(seg);
      if (!segNorm) continue;
      for (const c of catalogo) {
        const score = jaroWinkler(segNorm, c.norm) * afinidadTokens(segNorm, c.norm);
        if (score >= UMBRAL_MATCH && (!mejor || score > mejor.score)) {
          mejor = { numero: c.numero, score, desde: i, hasta: j };
        }
      }
    }
  }

  if (!mejor) return { caballo: "", confianza: "sin", restantes, correcciones: [] };
  const consumidos = restantes.slice(mejor.desde, mejor.hasta + 1);
  const nuevosRestantes = [...restantes.slice(0, mejor.desde), ...restantes.slice(mejor.hasta + 1)];
  return {
    caballo: mejor.numero,
    confianza: "aproximado",
    restantes: nuevosRestantes,
    correcciones: [`«${consumidos.join(" ")}» → N°${mejor.numero}`],
  };
}

/* ──────────────────── 6. ORQUESTA PRINCIPAL ─────────────────── */

function confianzaDeScore(score: number): ConfianzaCampo {
  if (score >= UMBRAL_EXACTO) return "exacto";
  if (score >= UMBRAL_MATCH) return "aproximado";
  return "sin";
}

/**
 * Estructura una línea de Carga Rápida en las 5 columnas de la taquilla,
 * ordenando el texto hablado aunque el transcriptor se equivoque. Devuelve
 * null para líneas en blanco / comentarios, { ok:false } para irreconocibles.
 */
export function normalizarLineaRapida(
  linea: string,
  contexto: ContextoNormalizacion
): ResultadoNormalizado | null {
  const t = String(linea ?? "").trim();
  if (!t || t.startsWith("#")) return null;

  const exp = expandirLineaHablada(t);
  const clas = clasificarLineaRapida(exp.texto);
  if (!clas) return null;
  if (!clas.ok) return { ok: false, motivo: clas.motivo };

  // Primero el caballo por nombre (consume los tokens del ejemplar del
  // sobrante), después los clientes contra el catálogo.
  const caballoResuelto = resolverCaballoPorNombre(clas.caballo, clas.restantes, contexto.caballos ?? []);
  const clientes = resolverClientes(caballoResuelto.restantes, contexto.clientes);

  const correcciones: string[] = [
    ...caballoResuelto.correcciones,
    ...clientes.correcciones,
  ];
  if (exp.huboNomenclatura) correcciones.push("hablado → canónico");

  return {
    ok: true,
    jugada: clas.jugada,
    caballo: caballoResuelto.caballo,
    monto: clas.monto,
    cliente1: clientes.cliente1,
    cliente2: clientes.cliente2,
    confianza: {
      jugada: !clas.jugada ? "sin" : exp.huboNomenclatura ? "aproximado" : "exacto",
      caballo: caballoResuelto.confianza,
      monto: !clas.monto ? "sin" : exp.huboNumeroPalabra ? "aproximado" : "exacto",
      cliente1: clientes.cliente1Norm ? confianzaDeScore(clientes.cliente1Score) : "sin",
      cliente2: clientes.cliente2Norm ? confianzaDeScore(clientes.cliente2Score) : "sin",
    },
    correcciones,
  };
}