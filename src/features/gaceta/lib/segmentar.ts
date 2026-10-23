/**
 * SEGMENTACIÓN DE UNA GACETA EN TEXTO POR CARRERA (módulo PURO).
 *
 * POR QUÉ EXISTE
 * --------------
 * La Gaceta se transcribe con un LLM. Cuando se le manda un documento
 * COMPLETO en una sola llamada, pasa una de dos cosas:
 *
 *   1. El modelo se queda sin tokens de salida a mitad del JSON → la respuesta
 *      queda truncada y las ÚLTIMAS carreras se pierden en silencio (el caso
 *      real: Belmont 1-3_OK, Charles Town 4-6_OK, Keeneland 4-6_OK: el
 *      documento entero no cabía y el modelo entregaba las primeras).
 *   2. El modelo "resume" y agrupa carreras que en el documento están
 *      separadas, con lo que las cardio pierde ejemplares.
 *
 * La solución NO es pedirle al modelo que sea más exacto: es NO darle el
 * documento entero. Aquí se parte el texto por los ENCABEZADOS de carrera
 * (`RACE 4`, `CARRERA 12`, `DECIMOTERCERA CARRERA`, `RACE VII`) y se agrupan
 * 2 o 3 carreras por llamada. Cada bloque cabe de sobra en la ventana de
 * contexto y la respuesta llega completa.
 *
 * Después, todos los bloques se consolidan en un `Map<number, Carrera>`
 * indexado por número de carrera: así, si dos bloques traen la misma carrera
 * (una carrera partida entre dos páginas del documento), se fusionan sus
 * ejemplares en vez de duplicarse, y si una carrera llega con exemplares
 * disjuntos (mal numerada), se conservan ambas para que la reparación final
 * (`repararNumerosCarreras`) la renumere.
 *
 * Todo es PURO: sin red, sin reloj, sin base. Se puede probar en node.
 */
import { numeroDeCarrera } from "@/features/gaceta/lib/numeros";

/** Segmento del documento que corresponde a UNA carrera. */
export type SegmentoCarrera = {
  /** Número de carrera leído del encabezado (null si el encabezado no se pudo leer). */
  numero: number | null;
  /** Texto del segmento: encabezado + cuerpo de la carrera. */
  texto: string;
  /** Índice del primer carácter del segmento dentro del texto original. */
  inicio: number;
};

/** Bloque de 2 o 3 carreras que se manda al LLM en UNA llamada. */
export type BloqueCarrera = {
  /** Índice del bloque, base 1 (para los mensajes de progreso). */
  indice: number;
  /** Números de carrera que el bloque DEBERÍA contener (los que se leyeron). */
  numeros: number[];
  /** Texto completo del bloque. */
  texto: string;
};

/**
 * Encabezados de carrera.
 *
 * Se aceptan las cuatro formas que aparecen en gacetas reales:
 *   - `RACE 4`, `CARRERA 12`, `CARRERA Nº 3`, `Race No. 5`
 *   - `13ª CARRERA`, `4 CARRERA`
 *   - `RACE VII` (romanos)
 *   - `DECIMOTERCERA CARRERA`, `PRIMERA CARRERA` (ordinales escritos)
 *
 * El encabezado tiene que estar al INICIO de una línea y ser CORTO: una
 * línea larga que mentione "carrera" en medio de una frase es texto de la
 * carrera, no un encabezado.
 */
const RE_ENCABEZADO =
  /^[ \t]*(?:(?:RACE|CARRERA|CARRERA|CAR\.?)[ \t]*(?:N[º°.]?[ \t]*)?#?[ \t]*([A-Za-z0-9ÁÉÍÓÚÑáéíóúñ]{1,14})\b)|(?:([A-Za-zÁÉÍÓÚÑáéíóúñ]{1,20})[ \t]+(?:CARRERA|RACE)\b)/gim;

/** Tope de caracteres de un encabezado: más de esto ya es una frase. */
const MAX_ENCABEZADO = 60;

/**
 * Parte el texto en segmentos, uno por carrera.
 *
 * Lo que va ANTES del primer encabezado (el encabezado del documento: fecha,
 * hipódromo, hora) se devuelve como un segmento con `numero: null`, para que
 * el llamador pueda usarlo de contexto (de ahí se saca el hipódromo y la
 * fecha cuando la carrera no los trae).
 *
 * Si el texto NO tiene ningún encabezado reconocible, se devuelve UN solo
 * segmento con todo el texto: es mejor mandarlo entero que no mandarlo.
 */
export function segmentarPorCarreras(texto: string): SegmentoCarrera[] {
  const t = String(texto ?? "");
  if (!t.trim()) return [];

  const cortes: Array<{ numero: number | null; inicio: number; fin: number }> = [];
  RE_ENCABEZADO.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RE_ENCABEZADO.exec(t)) !== null) {
    // El encabezado debe ser una línea propia y corta: si la línea tiene más
    // texto, es una frase que menciona "carrera", no un encabezado.
    const finLinea = t.indexOf("\n", m.index);
    const largoLinea = (finLinea === -1 ? t.length : finLinea) - m.index;
    if (largoLinea > MAX_ENCABEZADO) continue;

    const token = m[1] ?? m[2] ?? "";
    // `numeroDeCarrera` normaliza dígitos, romanos y ordinales escritos.
    const numero = numeroDeCarrera(token);
    // Un encabezado que no aporta número sirve igual como separador: sin él,
    // dos carreras quedarían pegadas en un solo segmento.
    cortes.push({ numero, inicio: m.index, fin: -1 });
  }

  if (!cortes.length) {
    return [{ numero: null, texto: t, inicio: 0 }];
  }

  // El texto previo al primer encabezado es el encabezado del documento.
  const segmentos: SegmentoCarrera[] = [];
  if (cortes[0].inicio > 0) {
    const previo = t.slice(0, cortes[0].inicio).trim();
    if (previo) segmentos.push({ numero: null, texto: previo, inicio: 0 });
  }

  for (let i = 0; i < cortes.length; i++) {
    const desde = cortes[i].inicio;
    const hasta = i + 1 < cortes.length ? cortes[i + 1].inicio : t.length;
    const cuerpo = t.slice(desde, hasta).trim();
    if (!cuerpo) continue;
    segmentos.push({ numero: cortes[i].numero, texto: cuerpo, inicio: desde });
  }

  return segmentos;
}

/**
 * Agrupa los segmentos en bloques de `carrerasPorBloque` (2 o 3).
 *
 * Un segmento demasiado largo (una carrera con muchísimos ejemplares, o un
 * bloque de texto sin encabezado) se queda SOLO en su bloque: partirlo por la
 * mitad cortaría la carrera a la mitad, que es exactamente el defecto que
 * estamos corrigiendo.
 */
export function armarBloques(
  segmentos: SegmentoCarrera[],
  carrerasPorBloque = 3
): BloqueCarrera[] {
  const porBloque = Math.min(3, Math.max(2, Number(carrerasPorBloque) || 3));
  // Los segmentos SIN número (el encabezado del documento) no son una carrera:
  // se anexan al PRIMER bloque como contexto, no cuentan para el tamaño.
  const conNumero = segmentos.filter((s) => s.numero != null);
  const sinNumero = segmentos.filter((s) => s.numero == null);

  const bloques: BloqueCarrera[] = [];
  for (let i = 0; i < conNumero.length; i += porBloque) {
    const grupo = conNumero.slice(i, i + porBloque);
    const numeros = grupo.map((s) => s.numero).filter((n): n is number => n != null);
    bloques.push({
      indice: bloques.length + 1,
      numeros,
      texto: grupo.map((s) => s.texto).join("\n\n"),
    });
  }

  // Sin ningún encabezado reconocible: el documento entero es un bloque.
  if (!bloques.length) {
    if (!segmentos.length) return [];
    return [{ indice: 1, numeros: [], texto: segmentos.map((s) => s.texto).join("\n\n") }];
  }

  // El encabezado del documento viaja con el primer bloque: el modelo lo
  // necesita para saber el hipódromo y la fecha cuando la carrera no los
  // repite.
  if (sinNumero.length && bloques.length) {
    bloques[0].texto = `${sinNumero.map((s) => s.texto).join("\n\n")}\n\n${bloques[0].texto}`;
  }

  return bloques;
}

/**
 * Consolida las carreras de todos los bloques en un `Map` indexado por número.
 *
 * Decide si dos entradas con el MISMO número son la misma carrera:
 *
 *   - Si comparten NOMBRES → es la misma carrera repetida → se unen sus
 *     ejemplares.
 *   - Si NO comparten números de gualdrapa → es la MISMA carrera partida
 *     entre dos bloques (uno trae los caballos 1-5 y el otro los 6-10) → se
 *     unen igual.
 *   - Si comparten números pero NO nombres → son DOS carreras y una está mal
 *     numerada (las dos numeran sus caballos desde 1) → se conserva la
 *     primera y la segunda sale como `colisión` para que la reparación de
 *     numeración la renumere al hueco.
 *
 * Perder la segunda es como se perdía la 13.ª: por eso va a `colisiones` y no
 * se descarta.
 */
export type Consolidacion<T> = {
  /** Carreras por número de carrera. */
  porNumero: Map<number, T>;
  /** Carreras que chocaron con otra del mismo número (mal numeradas). */
  colisiones: T[];
};

/** Nombres (MAYÚSCULAS) de los ejemplares de una carrera genérica. */
function nombresDe(c: unknown): Set<string> {
  const x = (c ?? {}) as { ejemplares?: Array<{ nombre?: string }>; caballos?: Array<{ nombre?: string }> };
  const arr = (x.ejemplares && x.ejemplares.length ? x.ejemplares : x.caballos) || [];
  const out = new Set<string>();
  for (const e of arr) {
    const n = String(e?.nombre ?? "").trim().toUpperCase();
    if (n) out.add(n);
  }
  return out;
}

/** NÚMEROS de gualdrapa de los ejemplares de una carrera genérica. */
function numerosDe(c: unknown): Set<string> {
  const x = (c ?? {}) as { ejemplares?: Array<{ numero?: unknown }>; caballos?: Array<{ numero?: unknown }> };
  const arr = (x.ejemplares && x.ejemplares.length ? x.ejemplares : x.caballos) || [];
  const out = new Set<string>();
  for (const e of arr) {
    const n = String(e?.numero ?? "").trim();
    if (n) out.add(n);
  }
  return out;
}

/** Une los ejemplares de `origen` dentro de `destino`, sin duplicar. */
function unirEjemplares<T extends { ejemplares?: unknown[]; caballos?: unknown[] }>(destino: T, origen: T): void {
  const lista = (destino.ejemplares = destino.ejemplares || []);
  const vistos = new Set(lista.map((e) => String((e as { numero?: unknown; nombre?: unknown })?.numero ?? (e as { nombre?: unknown })?.nombre ?? "")));
  for (const e of (origen.ejemplares || origen.caballos || []) as Array<{ numero?: unknown; nombre?: unknown }>) {
    const id = String(e?.numero ?? e?.nombre ?? "");
    if (!id || vistos.has(id)) continue;
    lista.push(e);
    vistos.add(id);
  }
}

export function consolidarPorNumero<T extends { ejemplares?: unknown[]; caballos?: unknown[] }>(
  entradas: T[]
): Consolidacion<T> {
  const porNumero = new Map<number, T>();
  const colisiones: T[] = [];
  for (const c of entradas) {
    if (!c || typeof c !== "object") continue;
    const n = numeroDeCarrera((c as { carrera?: unknown }).carrera);
    if (n == null) {
      colisiones.push(c);
      continue;
    }
    const previa = porNumero.get(n);
    if (!previa) {
      porNumero.set(n, c);
      continue;
    }
    const A = nombresDe(previa);
    const B = nombresDe(c);
    let compartenNombres = false;
    for (const x of B) {
      if (A.has(x)) {
        compartenNombres = true;
        break;
      }
    }
    // Numeración COMPLEMENTARIA: los dos bloques traen caballos distintos sin
    // repetir gualdrapa → es la misma carrera partida entre bloques.
    const NA = numerosDe(previa);
    const NB = numerosDe(c);
    let compartenNumeros = false;
    for (const x of NB) {
      if (NA.has(x)) {
        compartenNumeros = true;
        break;
      }
    }
    const complementaria = NA.size > 0 && NB.size > 0 && !compartenNumeros;
    if (!A.size || !B.size || compartenNombres || complementaria) {
      // La MISMA carrera: se unen sus ejemplares.
      unirEjemplares(previa, c);
    } else {
      // Ejemplares disjuntos CON los mismos números: son dos carreras y una
      // está mal numerada. Se conserva la primera y la segunda sale como
      // colisión para que `repararNumerosCarreras` la renumere al hueco.
      colisiones.push(c);
    }
  }
  return { porNumero, colisiones };
}
