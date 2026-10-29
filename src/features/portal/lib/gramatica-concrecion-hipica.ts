/**
 * ============================================================================
 * GRAMÁTICA DE PROPUESTAS Y CONCRECIONES DEL AGENTE (taquilla hípica venezolana)
 * ============================================================================
 *
 * Núcleo PURO (sin I/O ni React) que entiende lo que el jugador/operador dicta
 * al Agente:
 *
 *   "Consigo 1p de 2y5 con 300"      ≡  "consigo 1p 2-5 300"
 *        → { rol: "DA",    jugada: "1P",      caballos: "2y5", monto: 300 }
 *   "juego 1p y 1/2 del 5 con 300"
 *        → { rol: "JUEGA", jugada: "1PY1Y2N", caballos: "5",   monto: 300 }
 *   "juego 1p-1/2 2-5 400"
 *        → { rol: "JUEGA", jugada: "1PY1Y2N", caballos: "2y5", monto: 400 }
 *
 * REGLA DE ORO: el Agente NO inventa ni registra a ciegas. Si no se puede
 * identificar con certeza el puesto/jugada, el ejemplar o el monto —o si hay
 * confusión entre ejemplares y monto— devuelve `ok: false` con la ACLARATORIA
 * exacta del parámetro que falta.
 *
 * La tabla de bloques (1PY1Y2N, 1Y2NY2N, …) y la normalización de ejemplares
 * viven en `taquilla/lib/nomenclatura.ts`; la validación contra la tabla oficial
 * de jugadas, en `motores/lib/puestos.ts`.
 */
import {
  canonicalizarTramoPuesto,
  normalizarBloquePuestos,
  normalizarEjemplaresCombinados,
  quitarRellenoJugada,
  PATRON_TRAMO_PUESTO,
} from "@/features/taquilla/lib/nomenclatura";
import { normalizarCodigoJugada, obtenerReglaTablaJugada } from "@/features/motores/lib/puestos";
import { esJugadaCoherente } from "@/features/taquilla/lib/expandirDobleSplit";

/** JUEGA = el que pone el dinero a favor del ejemplar · DA = el que consigue (banca). */
export type RolJugada = "JUEGA" | "DA";

export type DatosJugada = {
  rol: RolJugada;
  /** Código oficial en MAYÚSCULAS ("1P", "1PY1Y2N", "10A8", "PP"). */
  jugada: string;
  /** Ejemplares en forma canónica ("5", "2y5"). */
  caballos: string;
  monto: number;
};

export type FaltanteJugada =
  | "ROL"
  | "JUGADA"
  | "EJEMPLAR"
  | "MONTO"
  | "EJEMPLAR_Y_MONTO"
  | "AMBIGUO"
  | "DOBLE_JUGADA";

/** Dos jugadas independientes dictadas en bloque ("1p y 3p del 5 con 200"). */
export type DobleJugadaPendiente = {
  rol: RolJugada;
  jugadas: [string, string];
  caballos: string;
  monto: number;
};

export type ResultadoParseo =
  | { ok: true; datos: DatosJugada }
  | {
      ok: false;
      faltante: FaltanteJugada;
      /** Pregunta lista para mostrar al usuario. */
      aclaratoria: string;
      parcial: Partial<DatosJugada>;
      doble?: DobleJugadaPendiente;
    };

/** Quita tildes y pasa a minúsculas para comparar palabras clave. */
export function sinTildes(texto: string): string {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

const PALABRAS_DA = ["consigo", "consigue", "consigues", "doy", "da", "das", "dale", "banco", "tengo"];
const PALABRAS_JUEGA = ["juego", "juega", "jugo", "apuesto", "voy", "quiero", "pongo"];

/** Máximo número de ejemplar creíble: por encima, el dato es casi seguro un monto. */
const EJEMPLAR_MAXIMO_CREIBLE = 20;

function detectarRol(t: string): { rol: RolJugada | null; resto: string } {
  const re = new RegExp(`\\b(${[...PALABRAS_DA, ...PALABRAS_JUEGA].join("|")})\\b`);
  const m = re.exec(t);
  if (!m) return { rol: null, resto: t };
  const rol: RolJugada = PALABRAS_DA.includes(m[1]) ? "DA" : "JUEGA";
  const resto = (t.slice(0, m.index) + " " + t.slice(m.index + m[0].length)).replace(/\s+/g, " ").trim();
  return { rol, resto };
}

const fmt = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, ""));

/**
 * Ejemplares + monto del resto de la frase. Devuelve los datos o la aclaratoria.
 * Regla: el ÚLTIMO número es el monto; lo anterior (unido con y / - / ,) son los
 * ejemplares. Números sueltos separados por espacio son ambiguos.
 */
function leerEjemplaresYMonto(
  resto: string
):
  | { ok: true; caballos: string; monto: number }
  | { ok: false; faltante: FaltanteJugada; aclaratoria: string } {
  const compacto = quitarRellenoJugada(resto)
    .replace(/\$|\bbs\b|\busd\b|\bdolares\b/g, " ")
    .replace(/(\d)\s*(?:y|-|,)\s*(?=\d)/g, "$1y")
    .replace(/\s+/g, " ")
    .trim();
  const numericos = compacto.split(" ").filter((tok) => /^\d+(?:[.]\d+)?(?:y\d+)*$|^\d+x\d+$/.test(tok));

  if (numericos.length === 0) {
    return {
      ok: false,
      faltante: "EJEMPLAR_Y_MONTO",
      aclaratoria: "Me faltan el ejemplar y el monto. ¿Qué ejemplar(es) y por cuánto?",
    };
  }
  if (numericos.length === 1) {
    return {
      ok: false,
      faltante: "AMBIGUO",
      aclaratoria: `Solo veo el número ${numericos[0]}: ¿es el ejemplar o el monto? Dime el que falta.`,
    };
  }
  if (numericos.length > 2) {
    return {
      ok: false,
      faltante: "AMBIGUO",
      aclaratoria:
        "Veo varios números sueltos y no sé cuáles son ejemplares. Une los ejemplares con «y» o «-» (ej. 2y5) y deja el monto al final.",
    };
  }

  const [tokCaballo, tokMonto] = numericos;
  if (/y|x/.test(tokMonto)) {
    return {
      ok: false,
      faltante: "AMBIGUO",
      aclaratoria: `«${tokMonto}» no parece un monto. ¿Cuánto es el monto y cuáles los ejemplares?`,
    };
  }
  const monto = Number(tokMonto);
  if (!Number.isFinite(monto) || monto <= 0) {
    return { ok: false, faltante: "MONTO", aclaratoria: "El monto debe ser mayor que 0. ¿Por cuánto es?" };
  }

  if (/^\d+x\d+$/.test(tokCaballo)) return { ok: true, caballos: tokCaballo, monto };

  const ej = normalizarEjemplaresCombinados(tokCaballo);
  if (!ej.ok) {
    return { ok: false, faltante: "EJEMPLAR", aclaratoria: "No entendí el ejemplar. ¿Cuál es el número del ejemplar?" };
  }
  const sospechoso = ej.lista.find((n) => n > EJEMPLAR_MAXIMO_CREIBLE);
  if (sospechoso !== undefined) {
    return {
      ok: false,
      faltante: "AMBIGUO",
      aclaratoria: `El ${sospechoso} parece un monto y no un ejemplar. ¿Cuál es el ejemplar y cuál el monto?`,
    };
  }
  return { ok: true, caballos: ej.caballos, monto };
}

/** Jugada simple al inicio de la frase: pp · 10a8 · 10/8 · 2p · 3n · 1/2. */
const RE_JUGADA_SIMPLE = /^(pp|10\s*[a/]\s*\d+(?:[.,]\d+)?|\d\s*[pn]|\d\s*\/\s*\d)(?=\s|$)/;
/** Dos tramos de puesto unidos por y / - al inicio (candidato a bloque). */
const RE_DOS_TRAMOS = new RegExp(`^(${PATRON_TRAMO_PUESTO})\\s*(?:y|-)\\s*(${PATRON_TRAMO_PUESTO})(?=\\s|$)`);

const aclaratoriaJugada =
  "No identifiqué el puesto/jugada. Dime la jugada (ej. 1p, 2n, 1/2, 1p y 1/2, pp, 10a8).";

/**
 * Interpreta una frase de PROPUESTA ("consigo …" / "juego …").
 * Nunca lanza ni inventa: o devuelve los datos completos o la aclaratoria.
 */
export function parsearMensajeJugada(texto: string): ResultadoParseo {
  const t = sinTildes(texto).replace(/[!¡?¿;:]/g, " ").replace(/\s+/g, " ").trim();
  const { rol, resto: sinRol } = detectarRol(t);
  const resto = quitarRellenoJugada(sinRol);
  const parcial: Partial<DatosJugada> = rol ? { rol } : {};

  // 1) ¿Bloque (o dos tramos independientes)?
  const mDos = RE_DOS_TRAMOS.exec(resto);
  if (mDos) {
    const bloque = normalizarBloquePuestos(`${mDos[1]} y ${mDos[2]}`);
    const despues = resto.slice(mDos[0].length).trim();
    const ejm = leerEjemplaresYMonto(despues);

    if (bloque.ok) {
      if (!ejm.ok) return { ok: false, faltante: ejm.faltante, aclaratoria: ejm.aclaratoria, parcial: { ...parcial, jugada: bloque.codigo } };
      if (!rol) return pedirRol({ ...parcial, jugada: bloque.codigo, caballos: ejm.caballos, monto: ejm.monto });
      return { ok: true, datos: { rol, jugada: bloque.codigo, caballos: ejm.caballos, monto: ejm.monto } };
    }

    // Tramos no adyacentes (1p y 3p): dos jugadas independientes → preguntar el reparto.
    const a = canonicalizarTramoPuesto(mDos[1]);
    const b = canonicalizarTramoPuesto(mDos[2]);
    if (!a || !b || !esJugadaCoherente(a.toLowerCase()) || !esJugadaCoherente(b.toLowerCase())) {
      return { ok: false, faltante: "JUGADA", aclaratoria: aclaratoriaJugada, parcial };
    }
    if (!ejm.ok) return { ok: false, faltante: ejm.faltante, aclaratoria: ejm.aclaratoria, parcial };
    if (!rol) return pedirRol({ ...parcial, caballos: ejm.caballos, monto: ejm.monto });
    const ja = normalizarCodigoJugada(a);
    const jb = normalizarCodigoJugada(b);
    return {
      ok: false,
      faltante: "DOBLE_JUGADA",
      aclaratoria: `Son dos jugadas distintas (${ja} y ${jb}). ¿Los ${fmt(ejm.monto)} son en total (${fmt(ejm.monto / 2)} y ${fmt(ejm.monto / 2)}) o ${fmt(ejm.monto)} cada una?`,
      parcial: { ...parcial, caballos: ejm.caballos, monto: ejm.monto },
      doble: { rol, jugadas: [ja, jb], caballos: ejm.caballos, monto: ejm.monto },
    };
  }

  // 2) Jugada simple.
  const mSimple = RE_JUGADA_SIMPLE.exec(resto);
  if (!mSimple) return { ok: false, faltante: "JUGADA", aclaratoria: aclaratoriaJugada, parcial };
  const jugada = normalizarCodigoJugada(mSimple[1].replace(/\s+/g, ""));
  if (!obtenerReglaTablaJugada(jugada)) {
    return { ok: false, faltante: "JUGADA", aclaratoria: `«${mSimple[1]}» no es una jugada oficial. ${aclaratoriaJugada}`, parcial };
  }
  const ejm = leerEjemplaresYMonto(resto.slice(mSimple[0].length));
  if (!ejm.ok) return { ok: false, faltante: ejm.faltante, aclaratoria: ejm.aclaratoria, parcial: { ...parcial, jugada } };
  if (!rol) return pedirRol({ ...parcial, jugada, caballos: ejm.caballos, monto: ejm.monto });
  return { ok: true, datos: { rol, jugada, caballos: ejm.caballos, monto: ejm.monto } };
}

function pedirRol(parcial: Partial<DatosJugada>): ResultadoParseo {
  return {
    ok: false,
    faltante: "ROL",
    aclaratoria: "¿Juegas o consigues (das) esa jugada?",
    parcial,
  };
}

/** Reparte una doble jugada pendiente: total (mitad y mitad) o el monto completo en cada una. */
export function resolverDobleJugada(doble: DobleJugadaPendiente, modo: "TOTAL" | "CADA_UNA"): DatosJugada[] {
  const monto = modo === "TOTAL" ? Math.round((doble.monto / 2) * 100) / 100 : doble.monto;
  return doble.jugadas.map((jugada) => ({ rol: doble.rol, jugada, caballos: doble.caballos, monto }));
}

export type ResultadoConcrecion = { ok: true; monto?: number } | { ok: false };

/**
 * ¿El mensaje CONCRETA una propuesta abierta? "J" · "Ponte" · "Jugué" · "Jugaste"
 * (con monto opcional: "ponte 400", "j 300").
 */
export function parsearConcrecion(texto: string): ResultadoConcrecion {
  const t = sinTildes(texto).replace(/[!¡.,;:]/g, " ").replace(/\s+/g, " ").trim();
  const m = /^(?:j|jugue|jugado|jugaste|ponte|tomado|hecho)(?:\s+(\d+(?:[.]\d+)?))?$/.exec(t);
  if (!m) return { ok: false };
  if (m[1] === undefined) return { ok: true };
  const monto = Number(m[1]);
  return Number.isFinite(monto) && monto > 0 ? { ok: true, monto } : { ok: false };
}
