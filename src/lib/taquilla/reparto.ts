/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  REPARTO DE RIESGO Y AUTORIZACION POR SALDO  (Taquilla / Gestión de Jugadas)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  Este módulo NO liquida: solo decide CUÁNTO puede arriesgar cada cliente y
 *  con qué estructura. La liquidación por posición sigue en lib/motores/puestos.ts.
 *
 *  ── 1. NOTACIÓN DE EJEMPLARES POR CLIENTE ──────────────────────────────────
 *  La columna "Caballo" admite un divisor que separa al cliente 1 del cliente 2:
 *
 *      x   ·   *   ·   por
 *
 *  y dentro de cada lado los ejemplares se separan con espacios, comas o guiones.
 *  Todas estas formas son EQUIVALENTES (convención de la casa):
 *
 *      1-2x3-4      1,2 x 3,4      1 2 x 3 4
 *      12 13 x 14 15      12-13x14-15      1,2 por 3-4      1-2*3-4
 *
 *      "1"          → solo cliente 1 juega (cliente 2 queda como dador)
 *      "12 13 x 14 15" → cada cliente juega sus propios ejemplares (PP)
 *
 *  OJO: el guion es SEPARADOR, no rango. "1-2" son los ejemplares 1 y 2.
 *
 *  ── 2. ESTRUCTURA SEGÚN QUIÉN JUEGA ───────────────────────────────────────
 *    DADOR    Solo cliente 1 juega; cliente 2 da (cubre) y no pone caballos.
 *    PP       Ambos juegan sus propios ejemplares (1+ contra 1+).
 *    A_PREMIO Ambos arriesgan en proporción fija (10a8, 10/8, PP).
 *
 *  ── 3. EL MONTO ES TOTAL Y SE REPARTE ENTRE LOS EJEMPLARES ─────────────────
 *  "1p" con 2 caballos y monto 100 → 50 por caballo. Si gana CUALQUIERA de los
 *  dos, se paga la jugada completa como ganador (semántica de conjunto).
 *
 *  ── 4. TOPE POR SALDO DISPONIBLE ───────────────────────────────────────────
 *  Se autoriza SIEMPRE hasta el monto que puede arriesgar el cliente con MENOR
 *  saldo disponible, y ambos lados se escalan a ese mínimo.
 *
 *  El "disponible" es `saldo_actual + aval`: el aval es crédito propio del
 *  cliente que amplía su poder de compra, así que un cliente con saldo NEGATIVO
 *  igual puede jugar, hasta donde se lo da el aval. Comprado $100 de saldo y
 *  con $300 de aval → disponible $400; al jugarlos los $400 queda en -$300, que
 *  es exactamente su aval, y ahí vuelve a topar.
 *
 *  El aval NO se descuenta al jugar: se topa contra `saldo + aval`, y es el
 *  saldo el que baja. Por eso no hace falta rebajar `aval` en cada ticket.
 *
 *  Excepción: modo de juego "libre" → el cliente puede jugar por encima de su
 *  saldo y no actúa como tope.
 */

import { parsearNomenclatura } from "./nomenclatura";

/** Datos de cliente mínimos para calcular riesgo (compatible con ClienteVenta). */
export type ClienteRiesgo = {
  nombre?: string | null;
  saldo_actual?: number | null;
  aval?: number | null;
  modo_juego?: string | null;
};

export type EstructuraJugada = "DADOR" | "PP" | "A_PREMIO";

export type LadoRiesgo = {
  /** Ejemplares que juega este lado (vacío = es el dador, no juega caballos). */
  caballos: string[];
  /** Riesgo total del lado. */
  riesgo: number;
  /** Riesgo por ejemplar (el monto es total y se reparte). */
  porCaballo: number;
  /** Saldo disponible con el que se topó este lado. */
  disponible: number;
  /** true si el modo de juego es "libre" (sin tope de saldo). */
  sinTope: boolean;
  /** true si se autoriza a jugar por encima de su saldo. */
  excedido: boolean;
};

export type Reparto = {
  estructura: EstructuraJugada;
  /** Monto realmente autorizado (base del cliente 1). */
  montoAutorizado: number;
  /** true si el monto autorizado quedó por DEBAJO de lo pedido. */
  recortado: boolean;
  lado1: LadoRiesgo;
  lado2: LadoRiesgo;
  /** Proporción aplicada (P:Q) si la jugada es A Premio. */
  proporcion: { p: number; q: number } | null;
  /** Avisos legibles para el operador. */
  avisos: string[];
};

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Saldo disponible para jugar: el saldo EN MANO más el aval que el banco le
 * garantizó. Un cliente con saldo negativo no está en mora mientras su aval
 * cubra lo que debe: puede seguir jugando hasta agotarlo.
 *
 * `saldo_actual` y `aval` son columnas independientes. Al "Otorgar Aval" solo
 * sube `aval` (ver sql/contabilidad.sql): si además se sumara al saldo, el aval
 * contaría dos veces y el cliente compraría el doble de lo que se le garantizó.
 *
 * Un cliente inexistente o sin saldo informado devuelve 0.
 */
export function disponibleParaJugar(c: ClienteRiesgo | null | undefined): number {
  const saldo = c && c.saldo_actual != null ? Number(c.saldo_actual) : 0;
  const aval = c && c.aval != null ? Number(c.aval) : 0;
  const total = (Number.isFinite(saldo) ? saldo : 0) + (Number.isFinite(aval) ? aval : 0);
  return total;
}

/** Porción del disponible que sale del AVAL (0 si no tiene aval). */
export function respaldoAval(c: ClienteRiesgo | null | undefined): number {
  const aval = c && c.aval != null ? Number(c.aval) : 0;
  const n = Number.isFinite(aval) ? aval : 0;
  return n > 0 ? n : 0;
}

/**
 * Como explicarle al operador de dónde sale el dinero. Cuando el cliente tiene
 * saldo NEGATIVO y aun así alcanza, tiene que quedar claro que se está jugando
 * con el aval: si solo se muestra el total, el caja cree que hay efectivo y se
 * lleva la sorpresa cuando el cliente no aparece a recoger.
 */
export function explicarDisponible(c: ClienteRiesgo | null | undefined): string {
  if (esSinTope(c)) return "disponible libre (sin tope)";
  const disponible = disponibleParaJugar(c);
  const saldo = c && c.saldo_actual != null ? Number(c.saldo_actual) : 0;
  const aval = respaldoAval(c);
  const base = `${round2(disponible)}`;
  if (aval <= 0) return `${base} de saldo`;
  if (saldo < 0) return `${base} (saldo ${round2(saldo)} + aval ${round2(aval)})`;
  return `${base} (saldo ${round2(saldo)} + aval ${round2(aval)})`;
}


/** Modo "libre": el cliente puede jugar por encima de su saldo. */
export function esSinTope(c: ClienteRiesgo | null | undefined): boolean {
  return String(c?.modo_juego ?? "").trim().toLowerCase() === "libre";
}

/* ───────────────────────── 1. PARSER DE EJEMPLARES ───────────────────────── */

/** Divisor entre cliente 1 y cliente 2: x · * · por (como palabra suelta). */
const DIVISOR_LADOS = /\s*(?:x|\*|\bpor\b)\s*/i;
/** Separadores DENTRO de un mismo lado. El guion es separador, no rango. */
const SEPARADORES_INTRA = /[\s,\-]+/;

/* Expresión de ejemplares dividida, para la Carga Rápida.

   NO se usa \b porque el divisor "x" es un carácter de palabra: entre el
   dígito y la "x" no hay límite de palabra, así que \b nunca casaría y
   "1x2" no se detectaría. En su lugar se usa (?!\d), que impide que un monto
   de 3 dígitos se coma su inicio ("100" no puede matchear "10").

   Cada ejemplar se limita a 1-19, igual que el heurístico de CABALLO de la
   carga rápida, así que un monto de 2 o 3 dígitos nunca se interpreta como
   ejemplar aunque quede pegado ("pp 1-2*3-4 75 Ana" -> "1-2*3-4"). */
const RE_NUM_CABALLO = String.raw`(?:[1-9]|1[0-9])(?!\d)`;
const RE_SEP_CABALLO = String.raw`(?:\s*[,,-]\s*|\s+)`;
const RE_LADO_EJEMPLARES = RE_NUM_CABALLO + `(?:` + RE_SEP_CABALLO + RE_NUM_CABALLO + `)*`;
const RE_EJEMPLARES_DIVIDIDOS = new RegExp(
  `(${RE_LADO_EJEMPLARES})\\s*(?:x|\\*|por)\\s*(${RE_LADO_EJEMPLARES})`,
  "i"
);

export type LadosEjemplares = {
  izquierda: string[];
  derecha: string[];
  /** true si la notación trae divisor explícito (o sea, ambos lados [&gt;0]). */
  hayDivisor: boolean;
};

function limpiarLado(bruto: string): string[] {
  return bruto
    .split(SEPARADORES_INTRA)
    .map((t) => t.trim())
    .filter((t) => /^\d{1,2}$/.test(t));
}

/**
 * Divide la columna "Caballo" en los ejemplares de cada cliente.
 * Devuelve null si no hay nada reconocible.
 *
 *   "1"              → { izquierda:["1"], derecha:[], hayDivisor:false }
 *   "1-2x3-4"        → { izquierda:["1","2"], derecha:["3","4"], hayDivisor:true }
 *   "12 13 x 14 15"  → { izquierda:["12","13"], derecha:["14","15"] }
 *   "1,2 por 3-4"    → { izquierda:["1","2"], derecha:["3","4"] }
 */
export function parsearEjemplaresPorCliente(texto: string): LadosEjemplares | null {
  const t = String(texto ?? "").trim();
  if (!t) return null;

  // Más de un divisor no es una notación válida de dos lados.
  const partes = t.split(DIVISOR_LADOS).filter((p) => p.trim() !== "");
  if (partes.length > 2) return null;

  if (partes.length === 1) {
    const izquierda = limpiarLado(partes[0]);
    if (izquierda.length === 0) return null;
    return { izquierda, derecha: [], hayDivisor: false };
  }

  const izquierda = limpiarLado(partes[0]);
  const derecha = limpiarLado(partes[1]);
  if (izquierda.length === 0 && derecha.length === 0) return null;
  return { izquierda, derecha, hayDivisor: true };
}

/**
 * Extrae la expresión de ejemplares DIVIDIDA entre los dos clientes, tal como
 * la acepta `parsearEjemplaresPorCliente`. Se usa en la Carga Rápida para
 * apartar la expresión ANTES de tokenizar la línea: si no, "12 13 x 14 15" se
 * desarmaría en números sueltos y el "15" se tomaría como monto.
 *
 * Devuelve el texto de la expresión con su posición en la línea, o null.
 */
export function buscarExpresionEjemplares(
  linea: string
): { texto: string; inicio: number; largo: number } | null {
  const t = String(linea ?? "");
  const m = RE_EJEMPLARES_DIVIDIDOS.exec(t);
  if (!m) return null;

  /* Si justo después de la expresión hay una letra, el último número se pegó
     a una jugada — "1,2 x 3,4 1p 100" captura "1,2 x 3,4 1" y el "1" es de
     "1p", no un ejemplar. Se recorta por el final. No se puede resolver con un
     lookahead en el regex porque el propio divisor "x" también es una letra. */
  let largo = m[0].length;
  while (largo > 0) {
    const siguiente = t[m.index + largo];
    if (!siguiente || !/[a-z]/i.test(siguiente) || !/\d$/.test(m[0].slice(0, largo))) break;
    largo -= 1;
    while (largo > 0 && /[\s,-]/.test(m[0][largo - 1])) largo -= 1;
  }
  const texto = m[0].slice(0, largo).trim();
  if (!texto) return null;
  return { texto, inicio: m.index, largo };
}

/* ─────────────────── 2. PROPORCIÓN "A PREMIO" (10a8 / 10/8) ───────────────── */
/**
 * Extrae la proporción P:Q de la nomenclatura de la jugada.
 * Acepta "10a8", "10A8", "10/8" y "PP" (que es 10:10, a la par).
 *
 * Devuelve `{ p, q, base }` donde `base` es la nomenclatura de puestos que
 * queda al quitar la proporción (ej. "10a8 1p" → base "1p"). Si la jugada no
 * trae proporción, devuelve null.
 */
export function extraerProporcion(jugada: string): { p: number; q: number; base: string } | null {
  const t = String(jugada ?? "").trim();
  if (!t) return null;

  // "PP" es la paridad: 10:10, y no deja nomenclatura de puestos detrás.
  if (/^pp$/i.test(t)) return { p: 10, q: 10, base: "" };

  // "10a8 1p" / "10/8 1p": proporción adelante y nomenclatura de puestos después.
  const mix = /^(\d+(?:\.\d+)?)\s*(?:a|\/)\s*(\d+(?:\.\d+)?)\s+(.+)$/i.exec(t);
  if (mix) {
    const p = parseFloat(mix[1]);
    const q = parseFloat(mix[2]);
    const base = mix[3].trim();
    if (p > 0 && q > 0 && base) return { p, q, base };
    return null;
  }

  /* Proporción sola ("10a8", "10/8", "10/6.5"). Se delega en la nomenclatura
     para que la gramática de proporciones exista en un solo lugar: el motor de
     puestos y la autorización de riesgo tienen que leer EXACTAMENTE lo mismo. */
  const nom = parsearNomenclatura(t);
  if (nom && nom.proporcion) {
    return { p: nom.proporcion.jugador, q: nom.proporcion.rival, base: "" };
  }

  return null;
}

/* ─────────────────────── 3. CÁLCULO DEL REPARTO ──────────────────────────── */

function armarLado(
  caballos: string[],
  riesgo: number,
  cliente: ClienteRiesgo | null | undefined
): LadoRiesgo {
  const disponible = disponibleParaJugar(cliente);
  const sinTope = esSinTope(cliente);
  const n = caballos.length;
  return {
    caballos,
    riesgo: round2(riesgo),
    porCaballo: n > 0 ? round2(riesgo / n) : 0,
    disponible: round2(disponible),
    sinTope,
    excedido: !sinTope && riesgo > disponible + 0.005,
  };
}

export type OpcionesReparto = {
  /** Nomenclatura de la jugada (puede traer proporción: "10a8", "10a8 1p"). */
  jugada: string;
  /** Notación de ejemplares por cliente ("1-2x3-4"). */
  ejemplares: string;
  /** Monto total pedido por el operador. */
  monto: number;
  cliente1: ClienteRiesgo | null | undefined;
  cliente2: ClienteRiesgo | null | undefined;
};

/**
 * Calcula el reparto de riesgo aplicando el tope por saldo disponible.
 *
 * Sin proporción (DADOR o PP): ambos lados arriesgan lo mismo y se escalan al
 * mínimo entre el monto pedido y los dos saldos disponibles.
 *
 * Con proporción (A_PREMIO P:Q): el cliente 1 arriesga el monto y el cliente 2
 * arriesga `monto × Q/P`. Si a uno le falta saldo, se escala al de menos
 * manteniendo la razón — "solo se autoriza hasta la proporción del que tiene
 * menos".
 */
export function calcularReparto(o: OpcionesReparto): Reparto {
  const avisos: string[] = [];
  const lados = parsearEjemplaresPorCliente(o.ejemplares);
  const cab1 = lados?.izquierda ?? [];
  const cab2 = lados?.derecha ?? [];
  const montoPedido = Number.isFinite(o.monto) && o.monto > 0 ? o.monto : 0;

  const prop = extraerProporcion(o.jugada);
  const sinCliente2 = !o.cliente2 || !String(o.cliente2.nombre ?? "").trim();

  // La notación "PP" (puesto por puesto) NO es una proporción: significa que
  // cada cliente juega sus propios ejemplares. Se liquida a la par.
  const notacionPP = /^pp$/i.test(String(o.jugada ?? "").trim());

  // Base de puestos (sin la proporción) para decidir la estructura.
  const base = (prop?.base ?? String(o.jugada ?? "")).trim();

  /* DADOR: solo cuando la base es "1p" y cada lado juega un único ejemplar
     (o el cliente 2 no juega ninguno y por lo tanto únicamente da).
     En 1p los dos caballos compiten por el 1º lugar: si gana el del cliente 1
     el cliente 2 pierde, y si no gana ninguno el cliente 1 pierde — es suma
     cero. En "2n"/"1y2n" 1v1 NO es dador: si ambos llegan 3º o peor los dos
     pierden, así que cada uno juega contra la pizarra (PP). */
  const esUnoP = /^1p$/i.test(base);
  const esDador =
    !notacionPP &&
    esUnoP &&
    (cab2.length === 0 || (cab1.length <= 1 && cab2.length <= 1));

  /* ── Sin cliente 2: jugada de un solo cliente, solo tope de su saldo ── */
  if (sinCliente2 && !prop) {
    const c1 = o.cliente1;
    const sinTope = esSinTope(c1);
    const disp = disponibleParaJugar(c1);
    let autorizado = montoPedido;
    if (!sinTope && montoPedido > disp) {
      autorizado = Math.max(0, disp);
      avisos.push(
        `Solo hay ${c1?.nombre ?? "cliente 1"}: se autoriza ${round2(autorizado)} de ${round2(montoPedido)} pedido.`
      );
    }
    return {
      estructura: esDador ? "DADOR" : "PP",
      montoAutorizado: round2(autorizado),
      recortado: round2(autorizado) < round2(montoPedido),
      lado1: armarLado(cab1, autorizado, c1),
      lado2: armarLado([], 0, o.cliente2),
      proporcion: null,
      avisos,
    };
  }

  /* ── A PREMIO: riesgos en razón P:Q (notación 10a8 / 10a7 / 10/8) ── */
  if (prop && !notacionPP) {
    const { p, q } = prop;
    const d1 = disponibleParaJugar(o.cliente1);
    const d2 = disponibleParaJugar(o.cliente2);
    const l1 = esSinTope(o.cliente1);
    const l2 = esSinTope(o.cliente2);

    // Riesgo pedido: cliente 1 = monto · cliente 2 = monto × Q/P
    let riesgo1 = montoPedido;
    let riesgo2 = montoPedido * (q / p);

    if (!l1 && d1 < riesgo1 - 0.005) {
      // Cliente 1 no cubre: se escala su parte y la del 2 en la misma razón.
      riesgo1 = Math.max(0, d1);
      riesgo2 = riesgo1 * (q / p);
      avisos.push(
        `${o.cliente1?.nombre ?? "Cliente 1"} tiene ${explicarDisponible(o.cliente1)}: se autoriza ${round2(riesgo1)} en razón ${p}:${q}.`
      );
    } else if (!l2 && d2 < riesgo2 - 0.005) {
      // Cliente 2 no cubre: se baja hasta que su parte quepa en su disponible.
      riesgo2 = Math.max(0, d2);
      riesgo1 = riesgo2 * (p / q);
      avisos.push(
        `${o.cliente2?.nombre ?? "Cliente 2"} tiene ${explicarDisponible(o.cliente2)}: se autoriza ${round2(riesgo1)} en razón ${p}:${q}.`
      );
    }

    return {
      estructura: "A_PREMIO",
      montoAutorizado: round2(riesgo1),
      recortado: round2(riesgo1) < round2(montoPedido),
      lado1: armarLado(cab1, riesgo1, o.cliente1),
      lado2: armarLado(cab2, riesgo2, o.cliente2),
      proporcion: { p, q },
      avisos,
    };
  }

  /* ── DADOR o PP: ambos arriesgan lo mismo, tope = mínimo disponible ── */  const d1 = disponibleParaJugar(o.cliente1);
  const d2 = disponibleParaJugar(o.cliente2);
  const l1 = esSinTope(o.cliente1);
  const l2 = esSinTope(o.cliente2);

  let autorizado = montoPedido;
  if (!l1 && !l2) {
    autorizado = Math.max(0, Math.min(montoPedido, d1, d2));
  } else if (!l1) {
    autorizado = Math.max(0, Math.min(montoPedido, d1));
  } else if (!l2) {
    autorizado = Math.max(0, Math.min(montoPedido, d2));
  }

  if (round2(autorizado) < round2(montoPedido)) {
    const corto = !l1 && !l2
      ? `el menor disponible (${round2(Math.min(d1, d2))})`
      : `el disponible del cliente con tope`;
    const quien = !l1 && !l2
      ? ""
      : l1
        ? ` de ${o.cliente2?.nombre ?? "Cliente 2"}`
        : ` de ${o.cliente1?.nombre ?? "Cliente 1"}`;
    avisos.push(`Se autoriza ${round2(autorizado)} de ${round2(montoPedido)} pedido: ${corto}${quien}.`);
  }


  return {
    estructura: esDador ? "DADOR" : "PP",
    montoAutorizado: round2(autorizado),
    recortado: round2(autorizado) < round2(montoPedido),
    lado1: armarLado(cab1, autorizado, o.cliente1),
    lado2: armarLado(cab2, autorizado, o.cliente2),
    proporcion: null,
    avisos,
  };
}
