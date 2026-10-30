/**
 * Analizador lexico de la nomenclatura de JUGADAS DE PUESTOS.
 *
 * Fuente unica de verdad de la gramatica. El motor (src/lib/motores/puestos.ts)
 * NO tiene expresiones regulares propias: pide aqui un `Nomenclatura` y decide.
 *
 * Las 5 modalidades, todas bajo el paraguas de Puestos:
 *
 *  1. PUESTO_PURO   "100 1p el 4"          · <=1 y si hay empate oficial en 1º
 *                                              GANA (se paga), no se anula.
 *     PELO_A_PELO   "100 PP el 4"          · 1º en solitario y con empate
 *                                              oficial en 1º se ANULA.
 *  2. MATCHUP       "100 1x2" · "1,4 x 3,5" · gana el lado que llega en mejor
 *                                              posicion; riesgo y pago 1 a 1.
 *  3. A_PREMIO      "100 10a8 el 4 y 5"     · gana si CUALQUIER ejemplar llega
 *                                              1º, y cobra la proporcion.
 *  4. MATCHUP_PROPORCION "100 10a8 la 2x3"  · el jugador va con el 2 risking 10
 *                                              y el banquero con el 3 risking 8.
 *                                              Gana el que llega mejor.
 *  5. NINI / PUESTO_PURO con varios ejemplares "100 2n el 3, 4 y 8" · gana si
 *                                              CUALQUIERa ejemplar cumple la
 *                                              condicion matematica.
 *
 * Nota de columnas: este modulo interpreta la columna JUGADA, donde `x` es un
 * ENFRENTAMIENTO. En la columna CABALLO el mismo `x` es el divisor de clientes;
 * esa gramatica vive en src/lib/taquilla/reparto.ts (parsearEjemplaresPorCliente)
 * y el motor combina ambas sin mezclarlas.
 */

/** Modalidades de Puestos. No crear motores fuera de este conjunto. */
export type ModalidadPuestos =
  | "PUESTO_PURO"
  | "PELO_A_PELO"
  | "NINI"
  | "COMBINADA"
  | "COMPUESTA"
  | "MATCHUP"
  | "A_PREMIO"
  | "MATCHUP_PROPORCION";

/**
 * Proporcion pactada. `jugador` es la unidad que arriesga el jugador y `rival`
 * la que arriesga el rival (o la casa). "10a8" -> {jugador:10, rival:8}: el
 * jugador arriesga 10 para ganar 8. La segunda cifra admite decimales
 * ("10/6.5"), la primera es entera por definicion de cuota.
 */
export type Proporcion = { jugador: number; rival: number };

export type Nomenclatura = {
  modalidad: ModalidadPuestos;
  /** Condicion posicional: 1 en 1p/PP, N en 2n/2p. null si la modalidad no usa. */
  puesto: number | null;
  /** true = nini (llega < N) · false = puesto puro (llega <= N). */
  esNini: boolean;
  proporcion: Proporcion | null;
  /** Exemplares del lado del JUGADOR (columna JUGADA). Vacio = van en CABALLO. */
  ladoA: string[];
  /** Exemplares del lado RIVAL, solo en enfrentamientos. */
  ladoB: string[];
  /** Bloques de una COMPUESTA, evaluados 50/50. */
  bloques: Nomenclatura[] | null;
  /** Par de tramos de una COMBINADA, para el bloqueo de pizarra P2==P1|P1+1. */
  tramos?: [number, number] | null;
  /** Texto de entrada ya normalizado, para la UI y los motivos. */
  fuente: string;
};

/* ---------------- Gramatica ---------------- */

/** Ejemplar: 1-2 digitos. No mas, porque un numero de 3+ digitos es un monto. */
const RE_NUM = String.raw`\d{1,2}`;
/** Lista de ejemplares: "3", "3,4,8", "3 4 y 8", "1-2". */
const RE_LISTA = RE_NUM + String.raw`(?:\s*(?:,|-|y|\s)\s*` + RE_NUM + String.raw`)*`;
/**
 * Proporcion "10a8" · "10/8" · "10 a 8" · "10/6.5". El separador `a` exige
 * digitos a ambos lados, asi que la "a" de "la"/"el" nunca se confunde.
 * Sin grupos de captura: los de RE_PROP_C son los unicos que se leen.
 */
const RE_PROPORCION =
  String.raw`\d+(?:[.,]\d+)?\s*(?:a|\/)\s*\d+(?:[.,]\d+)?`;

const RE_CABALLO = "(\\d{1,2})";
const RE_LISTA_C = "(" + RE_LISTA + ")";
/** Exactamente 2 grupos: 1 = unidad del jugador, 2 = unidad del rival.
    Sin parentesis envolventes, o serian un tercer grupo y correrian indices.
    El rival puede ser decimal con punto O coma ("10/3.5" · "10a9,75"). */
const RE_PROP_C =
  String.raw`(\d+(?:[.,]\d+)?)\s*(?:a|\/)\s*(\d+(?:[.,]\d+)?)`;

function norm(entrada: unknown): string {
  let s = String(entrada ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  // "1p de 2-3", "1p del 2 y 3" -> quitar "de/del"
  s = s.replace(/\bdel\b/g, " ").replace(/\bde\b/g, " ").replace(/\s+/g, " ").trim();
  // Expandir formas compactas de bloque pegadas sin espacios o con guion: ej. "1py1y2n" -> "1p y 1y2n", "2p-2/3n" -> "2p y 2/3n"
  s = s.replace(/^([1-8][pn])\s*(?:y|-)\s*([1-8][pn]?[y/][1-8][pn]?)$/i, "$1 y $2");
  s = s.replace(/^([1-8][pn]?[y/][1-8][pn]?)\s*(?:y|-)\s*([1-8][pn])$/i, "$1 y $2");
  return s;
}

/** Divide una entrada de exemplares. null si tiene algo que no es un ejemplar. */
export function parsearListaEjemplares(entrada: string): string[] | null {
  const t = norm(entrada);
  if (!t) return null;
  if (!new RegExp("^" + RE_LISTA + "$", "i").test(t)) return null;
  const partes = t
    .split(/[,-\s]+|y/)
    .map((x) => x.trim())
    .filter(Boolean);
  return partes.length > 0 ? partes : null;
}

/**
 * Separa "2x3" · "1,4 x 3,5" · "1-2*3-4" en sus dos lados. null si no hay
 * divisor. Solo `x` y `*`: "por" queda fuera porque en la gramatica de esta
 * columna el oppose es el unmatched, y `a`/`/` ya son separadores de proporcion.
 */
function separarEnfrentamiento(entrada: string): [string[], string[]] | null {
  const t = norm(entrada);
  if (!t) return null;
  const m = new RegExp(
    "^" + RE_LISTA_C + String.raw`\s*(?:x|\*)\s*` + RE_LISTA_C + "$",
    "i"
  ).exec(t);
  if (!m) return null;
  const a = parsearListaEjemplares(m[1]);
  const b = parsearListaEjemplares(m[2]);
  return a && b ? [a, b] : null;
}

function proporcionDe(
  jugador: unknown,
  rival: unknown
): Proporcion | null {
  // El rival puede venir decimal con punto O coma ("10/3.5" · "10a3,5"):
  // parseFloat solo entiende el punto, así que la coma se normaliza antes.
  const j = parseFloat(String(jugador).replace(",", "."));
  const r = parseFloat(String(rival).replace(",", "."));
  if (!isFinite(j) || !isFinite(r) || j <= 0 || r <= 0) return null;
  return { jugador: j, rival: r };
}

function esListaDeExemplares(t: string): boolean {
  return parsearListaEjemplares(t) !== null;
}

/**
 * Regla 4 (Escalera Estricta de Progresión para Jugadas en Bloque):
 *   1P ➔ 1Y2N ➔ 2N ➔ 2Y2N ➔ 2P ➔ 2Y3N ➔ 3N ➔ 3Y3N ➔ 3P ➔ 3Y4N ➔ 4N ➔ 4Y4N ➔ 4P ➔ 4Y5N ➔ 5N ➔ 5Y5N ➔ 5P ...
 * Un bloque debe unir exactamente una jugada Individual y su jugada Combinada adyacente en la escalera.
 * Cualquier salto de peldaño (ej. 1P Y 2/2N, 1/2N Y 2P, 2N Y 2/3N) es rechazado.
 */
function validarYAjustarBloqueEscalera(
  a: Nomenclatura,
  b: Nomenclatura
): [Nomenclatura, Nomenclatura] | null {
  const aEsHoja = (a.modalidad === "PUESTO_PURO" || a.modalidad === "NINI") && a.puesto != null && !a.bloques;
  const bEsHoja = (b.modalidad === "PUESTO_PURO" || b.modalidad === "NINI") && b.puesto != null && !b.bloques;
  const aEsComb = a.modalidad === "COMBINADA" && a.bloques?.length === 2;
  const bEsComb = b.modalidad === "COMBINADA" && b.bloques?.length === 2;

  if (!((aEsHoja && bEsComb) || (aEsComb && bEsHoja))) {
    return null;
  }

  const hoja = aEsHoja ? a : b;
  const comb = aEsComb ? a : b;
  const pHoja = hoja.puesto as number;
  const niniHoja = hoja.esNini;
  const [c1, c2] = comb.bloques as [Nomenclatura, Nomenclatura];
  const p1 = c1.puesto as number;
  const p2 = c2.puesto as number;

  // Escalón 1: XP con X/(X+1)N (ej. 1P Y 1/2N, 1P Y 1Y2N, 2P Y 2/3N, o shorthand 1P Y 1/2, 2P Y 2/3 -> 75% XP + 25% (X+1)N)
  if (!niniHoja && p1 === pHoja && p2 === pHoja + 1 && !c1.esNini) {
    if (/p$/i.test(comb.fuente)) return null;
    if (!c2.esNini) {
      const c2Ajustado: Nomenclatura = {
        ...c2,
        modalidad: "NINI",
        esNini: true,
        fuente: p2 + "n",
      };
      const combAjustado: Nomenclatura = {
        ...comb,
        bloques: [c1, c2Ajustado],
      };
      return aEsComb ? [combAjustado, b] : [a, combAjustado];
    }
    return [a, b];
  }

  // Escalón 2: X/(X+1)N con (X+1)N (ej. 1/2N Y 2N, 1Y2N Y 2N, 2/3N Y 3N, o shorthand 1/2 Y 2N -> 25% XP + 75% (X+1)N)
  if (niniHoja && pHoja >= 2 && p1 === pHoja - 1 && p2 === pHoja && !c1.esNini) {
    if (/p$/i.test(comb.fuente)) return null;
    if (!c2.esNini) {
      const c2Ajustado: Nomenclatura = {
        ...c2,
        modalidad: "NINI",
        esNini: true,
        fuente: p2 + "n",
      };
      const combAjustado: Nomenclatura = {
        ...comb,
        bloques: [c1, c2Ajustado],
      };
      return aEsComb ? [combAjustado, b] : [a, combAjustado];
    }
    return [a, b];
  }

  // Escalón 3: XN con X/XN (ej. 2N Y 2/2N, 2N Y 2Y2N)
  if (niniHoja && pHoja >= 2 && p1 === pHoja && p2 === pHoja && c1.esNini !== c2.esNini) {
    return [a, b];
  }

  // Escalón 4: X/XN con XP (ej. 2/2N Y 2P, 2Y2N Y 2P)
  if (!niniHoja && pHoja >= 2 && p1 === pHoja && p2 === pHoja && c1.esNini !== c2.esNini) {
    return [a, b];
  }

  return null;
}

function interno(texto: string): Nomenclatura | null {
  const t = norm(texto);
  if (!t) return null;

  /* --- COMBINADA: "1y2n", "1 y 2n", "1/2n", "1p y 2n", "2/2n", "2n/2p", "2n y 2p", "1/2", "1p y 2p" (50/50 por tramo) ---
     Se evalúa ANTES que COMPUESTA para que sinónimos con espacio como "1P Y 2N", "2N Y 2P", "1P Y 2P"
     se normalicen exactamente como COMBINADA de dos condiciones simples. */
  const comb = /^([1-8])\s*([pn]?)\s*[y/]\s*([1-8])\s*([pn]?)$/.exec(t);
  if (comb) {
    const p1 = parseInt(comb[1], 10);
    const p2 = parseInt(comb[3], 10);
    const raw1 = (comb[2] || "").toLowerCase();
    const raw2 = (comb[4] || "").toLowerCase();

    let s1: boolean;
    let s2: boolean;

    if (p1 === p2) {
      // Regla 1: 1N no existe -> 1/1N o 1/1 es inválida
      if (p1 === 1) return null;
      // Regla 3: X/XN = XYXN = XN/XP = XP/XN = XN Y XP = XP Y XN (o XYX como 3y3)
      if (raw1 === "n" && (raw2 === "p" || raw2 === "")) {
        s1 = true;
        s2 = false;
      } else if ((raw1 === "p" || raw1 === "") && raw2 === "n") {
        s1 = false;
        s2 = true;
      } else if (raw1 === "" && raw2 === "") {
        s1 = false;
        s2 = true;
      } else {
        // Rechaza redundantes como 2p/2p o 2n/2n
        return null;
      }
    } else if (p2 === p1 + 1) {
      // Regla 3: X/(X+1)N o X/(X+1)P -> el primer peldaño siempre es XP (no existe 1N/2N ni 2N/3P)
      if (raw1 === "n") return null;
      s1 = false;
      s2 = raw2 === "n";
    } else {
      // Saltos de peldaño prohibidos (ej. 1/3N, 1P Y 3N, 1P Y 3P)
      return null;
    }

    return {
      modalidad: "COMBINADA",
      puesto: Math.max(p1, p2),
      // La COMBINADA no tiene una condicion unica: cada tramo trae la suya en
      // `bloques`. Este flag solo describe el padre.
      esNini: false,
      proporcion: null,
      ladoA: [],
      ladoB: [],
      bloques: [
        {
          modalidad: s1 ? "NINI" : "PUESTO_PURO",
          puesto: p1,
          esNini: s1,
          proporcion: null,
          ladoA: [],
          ladoB: [],
          bloques: null,
          fuente: p1 + (s1 ? "n" : "p"),
        },
        {
          modalidad: s2 ? "NINI" : "PUESTO_PURO",
          puesto: p2,
          esNini: s2,
          proporcion: null,
          ladoA: [],
          ladoB: [],
          bloques: null,
          fuente: p2 + (s2 ? "n" : "p"),
        },
      ],
      tramos: [p1, p2],
      fuente: t,
    };
  }

  /* --- COMPUESTA / BLOQUE EN ESCALERA: "1p y 1/2n", "1/2n y 2n", "2n y 2/2n", "2/2n y 2p" --- */
  const comp = /^(\S+)\s+(?:y|&)\s+(\S+)$/.exec(t);
  if (comp && !esListaDeExemplares(comp[1]) && !esListaDeExemplares(comp[2])) {
    const a = interno(comp[1]);
    const b = interno(comp[2]);
    if (a && b) {
      const parEscalera = validarYAjustarBloqueEscalera(a, b);
      if (!parEscalera) return null;
      const [aOk, bOk] = parEscalera;
      return {
        modalidad: "COMPUESTA",
        puesto: null,
        esNini: false,
        proporcion: null,
        ladoA: [...aOk.ladoA, ...bOk.ladoA],
        ladoB: [...aOk.ladoB, ...bOk.ladoB],
        bloques: [aOk, bOk],
        fuente: t,
      };
    }
  }

  /* --- Condicion + "el/la" + lista: "2n el 3, 4 y 8" · "1p el 5" · "PP el 5" ---
     También acepta "1p 2-3", "1p 2 y 3" (sin "el/la"). */
  const conLista = new RegExp(
    String.raw`^(pp|[1-8]\s*[pn])\s+(?:el|la\s+)?(` + RE_LISTA + String.raw`)$`,
    "i"
  ).exec(t);
  if (conLista) {
    const lista = parsearListaEjemplares(conLista[2]);
    const cab = conLista[1].replace(/\s+/g, "");
    if (lista) {
      if (/^pp$/i.test(cab)) {
        return {
          modalidad: "PELO_A_PELO",
          puesto: 1,
          esNini: false,
          proporcion: null,
          ladoA: lista,
          ladoB: [],
          bloques: null,
          fuente: t,
        };
      }
      const n = parseInt(cab.charAt(0), 10);
      const esNini = cab.charAt(1).toLowerCase() === "n";
      // Regla 1: NO EXISTE 1N
      if (n === 1 && esNini) return null;
      return {
        modalidad: esNini ? "NINI" : "PUESTO_PURO",
        puesto: n,
        esNini,
        proporcion: null,
        ladoA: lista,
        ladoB: [],
        bloques: null,
        fuente: t,
      };
    }
  }

  /* --- Proporcion + "el/la" + [rival]: "10a8 el 4" · "10/6.5 el 2" · "10a8 la 2x3" --- */
  const conProp = new RegExp(
    "^" + RE_PROP_C + String.raw`\s*(?:el|la)\s*(.+)$`,
    "i"
  ).exec(t);
  if (conProp) {
    const prop = proporcionDe(conProp[1], conProp[2]);
    const cola = conProp[3];
    // "10a8 la 2x3" es un ENFRENTAMIENTO asimetrico, no un a premio simple.
    const duelo = prop ? separarEnfrentamiento(cola) : null;
    if (prop && duelo) {
      return {
        modalidad: "MATCHUP_PROPORCION",
        puesto: null,
        esNini: false,
        proporcion: prop,
        ladoA: duelo[0],
        ladoB: duelo[1],
        bloques: null,
        fuente: t,
      };
    }
    const lista = prop ? parsearListaEjemplares(cola) : null;
    if (prop && lista) {
      return {
        modalidad: "A_PREMIO",
        puesto: 1,
        esNini: false,
        proporcion: prop,
        ladoA: lista,
        ladoB: [],
        bloques: null,
        fuente: t,
      };
    }
  }

  /* --- Proporcion sola: "10/8", "10a8" (los ejemplares van en CABALLO) --- */
  const soloProp = new RegExp("^" + RE_PROP_C + "$", "i").exec(t);
  if (soloProp) {
    const prop = proporcionDe(soloProp[1], soloProp[2]);
    if (prop) {
      return {
        modalidad: "A_PREMIO",
        puesto: 1,
        esNini: false,
        proporcion: prop,
        ladoA: [],
        ladoB: [],
        bloques: null,
        fuente: t,
      };
    }
  }

  /* --- Enfrentamiento + proporcion (legacy): "2x3 10/8" --- */
  const mpProp = new RegExp(
    "^" +
      RE_LISTA_C +
      String.raw`\s*(?:x|\*)\s*` +
      RE_LISTA_C +
      String.raw`\s+` +
      RE_PROP_C +
      "$",
    "i"
  ).exec(t);
  if (mpProp) {
    const a = parsearListaEjemplares(mpProp[1]);
    const b = parsearListaEjemplares(mpProp[2]);
    const prop = proporcionDe(mpProp[3], mpProp[4]);
    if (a && b && prop) {
      return {
        modalidad: "MATCHUP_PROPORCION",
        puesto: null,
        esNini: false,
        proporcion: prop,
        ladoA: a,
        ladoB: b,
        bloques: null,
        fuente: t,
      };
    }
  }

  /* --- Enfrentamiento solo: "1x2", "1,4 x 3,5" --- */
  const soloMp = separarEnfrentamiento(t);
  if (soloMp) {
    return {
      modalidad: "MATCHUP",
      puesto: null,
      esNini: false,
      proporcion: null,
      ladoA: soloMp[0],
      ladoB: soloMp[1],
      bloques: null,
      fuente: t,
    };
  }

  /* --- NINI / PUESTO / PP sin lista (exemplares en CABALLO) --- */
  if (/^pp$/.test(t)) {
    return {
      modalidad: "PELO_A_PELO",
      puesto: 1,
      esNini: false,
      proporcion: null,
      ladoA: [],
      ladoB: [],
      bloques: null,
      fuente: t,
    };
  }
  const simple = new RegExp("^" + RE_CABALLO + String.raw`\s*([pn])$`, "i").exec(t);
  if (simple) {
    const n = parseInt(simple[1], 10);
    const suf = simple[2].toLowerCase();
    // Regla 1: NO EXISTE 1N (Primer Nini)
    if (n === 1 && suf === "n") return null;
    return {
      modalidad: suf === "n" ? "NINI" : "PUESTO_PURO",
      puesto: n,
      esNini: suf === "n",
      proporcion: null,
      ladoA: [],
      ladoB: [],
      bloques: null,
      fuente: t,
    };
  }

  return null;
}

/**
 * Parsea la columna JUGADA. Tolera un monto suelto al inicio, porque la carga
 * rapida lo antepone: "100 10a6.5 el 4 y 5", "100 2n el 3, 4 y 8".
 *
 * Devuelve null si el texto no es una nomenclatura reconocida; el motor debe
 * seguir aceptando las formas legacy via la columna CABALLO.
 */
export function parsearNomenclatura(entrada: string): Nomenclatura | null {
  const base = norm(entrada);
  if (!base) return null;
  const primera = interno(base);
  if (primera) return primera;
  // "100 <nomenclatura>": el monto inicial solo se descarta si lo que sigue
  // SI es una nomenclatura valida, para no mutilar "10 8" ni "1 2n"+"3n".
  const sinMonto = base.replace(/^\d{1,6}\s+/, "");
  if (sinMonto && sinMonto !== base) {
    const n = interno(sinMonto);
    if (n) return n;
  }
  return null;
}

/**
 * ETIQUETA UNIVERSAL de la casa (regla estricta de nomenclatura).
 *
 * TODA jugada relacionada con posiciones se denomina, se procesa y se muestra
 * ÚNICA Y EXCLUSIVAMENTE como "Jugadas de Puestos". La única excepción es la
 * jugada pactada con una RELACIÓN DE PAGO fija (10a8, 10/8 … x …), que se
 * muestra como "Jugadas a Premio": es la Modalidad A (caballo ganador) y la
 * Modalidad B (match de ejemplares) de la casa.
 *
 * Está prohibido categorizarlas en los reportes como "fijas", "fraccionadas",
 * "con nini" o "de bloques": el sistema solo lee el código, hace la matemática
 * y muestra el resultado bajo estas dos etiquetas.
 */
export type CategoriaJugada = "Jugadas de Puestos" | "Jugadas a Premio";

/**
 * Canonicaliza la forma "A Premio" a la notación de barra de la casa:
 *   "10A3" → "10/3" · "10a3.5" → "10/3,5" · "10A9,75" → "10/9,75".
 * Deja intacto cualquier código que no sea una proporción "A Premio" (PP, 2N,
 * 4X7, "1/2 Y 2N"…). Es el ÚNICO lugar donde se hace el mapeo A→/ (punto 2 del
 * requerimiento de Carga Rápida). Ojo: NO reescribe lo que se guarda como
 * `nombre_jugada` (el léxico de la casa tipea "10A9"); se usa para clasificar y
 * comparar, donde "A" y "/" son equivalentes.
 */
export function canonicalizarA_Premio(codigo: string): string {
  const t = norm(codigo);
  if (!t) return String(codigo ?? "");
  // Proporción pelada: "10a3" / "10a3,5" / "10/3.5" (solo, con punto o coma).
  const m = /^(\d+(?:[.,]\d+)?)\s*(?:a|\/)\s*(\d+(?:[.,]\d+)?)$/.exec(t);
  if (!m) return String(codigo ?? "");
  const limpia = (s: string) => s.replace(",", ".");
  const j = limpia(m[1]);
  const r = limpia(m[2]);
  // Normalizar a formato casa con coma decimal: "10/3,5"
  return `${j}/${r.replace(".", ",")}`;
}

export const canonicalizarJugada = canonicalizarA_Premio;

/**
 * Clasifica el CÓDIGO de una jugada en la etiqueta universal de la casa.
 * Es la fuente única de la clasificación para reportes y manuales.
 */
export function categoriaJugada(codigo: string): CategoriaJugada {
  // Se clasifica sobre la forma canónica: así "10A3", "10/3" y "10a3,5" caen
  // todos en "Jugadas a Premio" aunque el léxico guardado conserve la "A".
  const n = parsearNomenclatura(canonicalizarA_Premio(codigo)) ?? parsearNomenclatura(codigo);
  if (n && (n.modalidad === "A_PREMIO" || n.modalidad === "MATCHUP_PROPORCION")) {
    return "Jugadas a Premio";
  }
  return "Jugadas de Puestos";
}

/**
 * Etiqueta universal para la UI y los motivos de liquidacion. NO devuelve
 * jerga de casa ("nini", "combinada", "de bloques"…): solo las dos categorías.
 */
export function etiquetaModalidad(m: ModalidadPuestos): string {
  return m === "A_PREMIO" || m === "MATCHUP_PROPORCION"
    ? "Jugadas a Premio"
    : "Jugadas de Puestos";
}

/**
 * ÍTEM 7 — Proporción de una jugada para el rótulo de la UI. Un pareo/MATCH que
 * NO declara fracción (o un PP) es PELO A PELO = 10/10; si declara fracción
 * ("2x3 10/8") se muestra esa. Fuente única del "PP (10/10)".
 */
export function proporcionDeclarada(jugada: string): string {
  const m = /(\d+(?:[.,]\d+)?)\s*[\/aA]\s*(\d+(?:[.,]\d+)?)/.exec(String(jugada ?? ""));
  return m ? `${m[1].replace(",", ".")}/${m[2].replace(",", ".")}` : "10/10";
}

/** ¿Es un pareo/MATCH? (la jugada es "NxM"/"N*M", los ejemplares traen "x", o es un PP). */
export function esPareo(jugada: string, caballo = ""): boolean {
  const t = String(jugada ?? "");
  return /\d\s*[X*]\s*\d/i.test(t) || /[X*]/i.test(String(caballo)) || /^\s*PP/i.test(t);
}

/**
 * ÍTEM 7 — Rótulo del "match" para la UI. Desde la regla del dueño ("cuando es
 * 1x6 la jugada es PP") un match sin fracción YA se guarda con `nombre_jugada`
 * "PP", así que el rótulo solo aporta cuando:
 *   · la fila es LEGACY y quedó guardada como pareo ("4X7") → "PP (10/10)";
 *   · el match declara fracción ("2x3 10/8") → se muestra esa fracción.
 * Devuelve "" cuando la jugada no es un pareo (no hay nada que aclarar).
 */
export function rotuloPareo(jugada: string, caballo = ""): string {
  if (!esPareo(jugada, caballo)) return "";
  const t = String(jugada ?? "").trim();
  // La jugada nueva ya dice "PP": el rótulo no aportaría nada.
  if (/^\s*pp\b/i.test(t)) return "";
  const prop = proporcionDeclarada(t);
  // Match con fracción declarada ("2x3 10/8"): se muestra esa fracción. Sin
  // fracción (pelo a pelo) el rótulo queda vacío: la jugada se rotula "PP" (ver
  // `etiquetaJugada`), NUNCA "10/10".
  return prop === "10/10" ? "" : prop;
}

/**
 * Etiqueta de la JUGADA para los reportes y la UI. Regla del dueño: una jugada
 * PELO A PELO (fracción 10/10, o un MATCH/pareo SIN fracción declarada) se
 * rotula "PP" —NUNCA "10/10"—; si declara una fracción distinta ("2x3 10/8",
 * "10/6") se conserva tal cual. Cualquier otra jugada se devuelve sin cambios.
 *
 * No mira la columna CABALLO a propósito: un NINI dividido ("2Y2N" con
 * caballo "3x4") NO es un pareo.
 */
export function etiquetaJugada(jugada: string): string {
  const t = String(jugada ?? "").trim();
  if (!t) return "";
  // Fracción declarada ("10/8", "10/2.5", "10A2.5", "10a6"): si es 10/10 (pelo a pelo)
  // nunca se muestra "10/10": si hay otra jugada (ej. "2P 10/10", "PP (10/10)") se muestra
  // solo la jugada; si era solo "10/10" o un pareo "2x3 10/10", se rotula "PP".
  if (/\d+(?:[.,]\d+)?\s*[\/aA]\s*\d+(?:[.,]\d+)?/.test(t)) {
    const prop = proporcionDeclarada(t);
    if (prop === "10/10") {
      const sinDiez = t
        .replace(/\(?\b10\s*[\/aA]\s*10\b\)?/gi, "")
        .replace(/\s+/g, " ")
        .trim();
      const sinPp = sinDiez.replace(/^\bPP\b\s*|\s*\bPP\b$/gi, "").trim();
      if (sinPp && !/^\d+(?:[-,]\d+)*\s*[xX*]\s*\d+(?:[-,]\d+)*$/.test(sinPp)) {
        return sinPp;
      }
      return "PP";
    }
    return t;
  }
  if (/^\s*pp\b/i.test(t)) {
    const sinPp = t.replace(/^\s*pp\b/i, "").trim();
    if (sinPp && !/^\d+(?:[-,]\d+)*\s*[xX*]\s*\d+(?:[-,]\d+)*$/.test(sinPp)) {
      return sinPp;
    }
    return "PP"; // ya es PP
  }
  if (/\d\s*[X*]\s*\d/i.test(t)) return "PP"; // pareo/MATCH sin fracción ("4X7")
  return t;
}

/**
 * Divide los ejemplares de un pareo por su enfrentamiento: "1X8" →
 * { juega: "1", da: "8" }, "1-2X3-4" → { juega: "1-2", da: "3-4" }. Null si la
 * columna CABALLO no trae un enfrentamiento (jugada de un solo lado) o si algún
 * lado queda vacío.
 */
export function ladosDePareo(caballo: string): { juega: string; da: string } | null {
  const m = /^(.+?)\s*[Xx*]\s*(.+)$/.exec(String(caballo ?? "").trim());
  if (!m) return null;
  const juega = m[1].trim();
  const da = m[2].trim();
  return juega && da ? { juega, da } : null;
}

/** Caballo(s) de un pareo con el enfrentamiento espaciado: "1X8" → "1 X 8". */
export function caballoPareoLegible(caballo: string): string {
  const l = ladosDePareo(caballo);
  return l ? `${l.juega} X ${l.da}` : String(caballo ?? "").trim();
}


// ============================================================================
// SINTAXIS SIMPLIFICADA DEL AGENTE: ejemplares combinados y jugadas en bloque
// ============================================================================

/**
 * Preposiciones de relleno que el jugador intercala al dictar una jugada
 * (\"consigo 1p DE 2y5 CON 300\"). No aportan información: se eliminan para que
 * \"1p de 2y5 con 300\" y \"1p 2-5 300\" sean 100% equivalentes.
 */
const RE_RELLENO_JUGADA = /\b(?:de|del|al|con|por|el|la|los|las|para|ejemplar(?:es)?|caballo(?:s)?|numero|número|nro)\b/gi;

/** Quita las preposiciones opcionales y los `#` de una frase de jugada. */
export function quitarRellenoJugada(texto: string): string {
  return String(texto ?? "")
    .replace(/#/g, " ")
    .replace(RE_RELLENO_JUGADA, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type EjemplaresNormalizados =
  | { ok: true; caballos: string; lista: number[] }
  | { ok: false; motivo: string };

/**
 * Normaliza ejemplares combinados a la forma canónica `2y5`:
 *   "2y5" · "2-5" · "2,5" · "2 y 5" · "de 2y5" → "2y5"
 *   "5" → "5"
 * Un pareo (`2x5`) se conserva tal cual. Los números sueltos separados solo por
 * espacio (\"2 5\") son AMBIGUOS (¿llave o ejemplar + monto?) y se rechazan.
 */
export function normalizarEjemplaresCombinados(entrada: string): EjemplaresNormalizados {
  const limpio = quitarRellenoJugada(entrada).toLowerCase();
  if (!limpio) return { ok: false, motivo: "No hay ejemplares." };
  if (/^\d+\s*x\s*\d+$/.test(limpio)) {
    return { ok: true, caballos: limpio.replace(/\s+/g, ""), lista: [] };
  }
  // y / - / , entre dígitos son el MISMO conector.
  const unido = limpio.replace(/(\d)\s*(?:y|-|,)\s*(?=\d)/g, "$1y");
  if (!/^\d+(?:y\d+)*$/.test(unido)) {
    return { ok: false, motivo: `No se entiende «${entrada.trim()}» como ejemplares.` };
  }
  const lista: number[] = [];
  for (const n of unido.split("y").map(Number)) {
    if (!Number.isInteger(n) || n <= 0) return { ok: false, motivo: "Ejemplar inválido." };
    if (!lista.includes(n)) lista.push(n);
  }
  return { ok: true, caballos: lista.join("y"), lista };
}

/**
 * Escalera completa de tramos (cada elemento es medio paso de la tabla oficial).
 * Un BLOQUE es la unión de DOS tramos ADYACENTES:
 *
 *   pP · p/n · nN · n/n · nP · …   (n = p+1)
 *
 *   pP  + p/n  → pPYpYnN       (1p y 1/2  → 1PY1Y2N)
 *   p/n + nN   → pYnNYnN       (1/2 y 2n  → 1Y2NY2N)
 *   nN  + n/n  → nNYnYnN       (2n y 2/2  → 2NY2Y2N)
 *   n/n + nP   → nYnNYnP       (2/2 y 2p  → 2Y2NY2P)
 */
const PUESTO_MAXIMO_BLOQUE = 6;
const ESCALERA_TRAMOS: string[] = (() => {
  const t: string[] = ["1P"];
  for (let p = 1; p <= PUESTO_MAXIMO_BLOQUE; p++) {
    const n = p + 1;
    t.push(`${p}/${n}`, `${n}N`, `${n}/${n}`, `${n}P`);
  }
  return t;
})();

/** Código oficial de bloque (TABLA_JUGADAS) para cada par de tramos adyacentes. */
const BLOQUES_POR_PAR: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (let p = 1; p <= PUESTO_MAXIMO_BLOQUE; p++) {
    const n = p + 1;
    m.set(`${p}P|${p}/${n}`, `${p}PY${p}Y${n}N`);
    m.set(`${p}/${n}|${n}N`, `${p}Y${n}NY${n}N`);
    m.set(`${n}N|${n}/${n}`, `${n}NY${n}Y${n}N`);
    m.set(`${n}/${n}|${n}P`, `${n}Y${n}NY${n}P`);
  }
  return m;
})();

/** Patrón de UN tramo suelto: `1p` · `2n` · `1/2` · `2/2`. */
export const PATRON_TRAMO_PUESTO = String.raw`\d\s*[pPnN]|\d\s*\/\s*\d`;

/** Tramo en forma canónica (`1p` → `1P`, `1 / 2` → `1/2`) o null si no es un tramo. */
export function canonicalizarTramoPuesto(tramo: string): string | null {
  const t = String(tramo ?? "").replace(/\s+/g, "").toUpperCase();
  const mSlash = /^(\d)\/(\d)$/.exec(t);
  if (mSlash) {
    const a = Number(mSlash[1]);
    const b = Number(mSlash[2]);
    const canon = `${a}/${b}`;
    return ESCALERA_TRAMOS.includes(canon) ? canon : null;
  }
  return ESCALERA_TRAMOS.includes(t) ? t : null;
}

export type BloqueNormalizado =
  | { ok: true; codigo: string; tramos: [string, string] }
  | { ok: false; motivo: "NO_ES_BLOQUE" | "TRAMOS_NO_ADYACENTES"; tramos?: [string, string] };

/**
 * Convierte dos tramos de puesto unidos con `y` o `-` al código oficial de bloque:
 *   "1p y 1/2" · "1p-1/2" → 1PY1Y2N · "2/3 y 3n" → 2Y3NY3N · "6/7-7n" → 6Y7NY7N
 * El orden no importa ("1/2 y 1p" → el mismo bloque). Si los tramos no son
 * adyacentes ("1p y 3p") NO forman una clave compuesta: son dos jugadas
 * independientes y el llamador debe repartir el monto (ver `expandirDobleSplit`).
 */
export function normalizarBloquePuestos(entrada: string): BloqueNormalizado {
  const texto = String(entrada ?? "").trim();
  const m = new RegExp(`^(${PATRON_TRAMO_PUESTO})\\s*(?:y|-)\\s*(${PATRON_TRAMO_PUESTO})$`, "i").exec(texto);
  if (!m) return { ok: false, motivo: "NO_ES_BLOQUE" };
  const a = canonicalizarTramoPuesto(m[1]);
  const b = canonicalizarTramoPuesto(m[2]);
  if (!a || !b) return { ok: false, motivo: "NO_ES_BLOQUE" };
  const ia = ESCALERA_TRAMOS.indexOf(a);
  const ib = ESCALERA_TRAMOS.indexOf(b);
  const [x, y] = ia <= ib ? [a, b] : [b, a];
  const codigo = Math.abs(ia - ib) === 1 ? BLOQUES_POR_PAR.get(`${x}|${y}`) : undefined;
  if (!codigo) return { ok: false, motivo: "TRAMOS_NO_ADYACENTES", tramos: [x, y] };
  return { ok: true, codigo, tramos: [x, y] };
}
