import { liquidarPuestos } from "@/lib/motores/puestos";
import type { TicketMotor, ResultadoMotor } from "@/lib/bettingEngine";
import { parsearNini, liquidarNini } from "@/lib/bettingEngine";

export type Proyeccion = {
  monto: number;
  mejorBruto: number;
  totalClienteNeto: number;
  gananciaProyectada: number;
  comision: number;
  balanceBanca: number;
  escenario: string;
};

export type ValidacionComando =
  | { ok: true; tipo: string; monto: number; simulada: ResultadoMotor; proyeccion: Proyeccion }
  | { ok: false; motivo: string };

const REGLA_VIOLADA = /BLOQUEO DE PIZARRA|malformado|inválido|sin motor registrado|modalidad sin motor/i;

const POSICIONES = [1, 2, 3, 4, 5, 6, 7, 8];

export type ModalidadAuto = "NINIS" | "EMPAREJAMIENTOS" | "CRUCES" | "COMPUESTAS" | "PUESTOS";

/**
 * Auto-detección de modalidad por la sintaxis de la jugada (sin motor):
 *  - "y"/"n" (2n, 1y2n, 1 y 2n, 1y2n y 2n) → Ninis / Emparejamientos
 *  - "/"     (10/7, 10/PP, PP)              → Cruces
 *  - "/" + y (1/2n y 2n, 2n y 2/2n)         → Compuestas
 *  - "p"     (1p, 2p)                       → Puestos
 * Acepta "100 2n" (monto + jugada) o solo la nomenclatura "2n".
 */
export function detectarModalidad(texto: string): ModalidadAuto | null {
  const bruto = String(texto ?? "").trim().replace(/\s+/g, " ");
  if (!bruto) return null;
  const m = /^\d+(?:\.\d+)?\s+(.+)$/.exec(bruto);
  const jugada = (m ? m[1] : bruto)
    .toUpperCase()
    .replace(/(\d)Y(\d)/g, "$1 y $2")
    .replace(/\s+/g, " ")
    .trim();
  if (!jugada) return null;

  if (/^PP$/i.test(jugada) || /^\d+\/(?:\d+(?:\.\d+)?|PP)$/i.test(jugada)) return "CRUCES";
  if (/^\d+\s*X\s*\d+(?:\s+\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?)?$/i.test(jugada)) return "CRUCES";

  const bloques = jugada.split(/ Y | & /).filter(Boolean);
  if (bloques.length > 1) {
    return bloques.some((b) => b.includes("/")) ? "COMPUESTAS" : "EMPAREJAMIENTOS";
  }
  if (/\d+N$/.test(jugada)) return "NINIS";
  if (/\d+P$/.test(jugada)) return "PUESTOS";
  return null;
}

/**
 * Conecta el input del Bet Slip con el motor matemático (puestos.ts).
 * "En tiempo real": se simula la jugada en todas las posiciones de llegada
 * (1..8). Si el motor reporta BLOQUEO/malformado/inválido → regla rota.
 * La proyección usa el mejor escenario de posiciones (pago monto*2 o la
 * proporción A Premio), restando la comisión de la casa del resultado neto.
 * Para NINIS (2N · 1y2N) se resuelve con el Motor Nini: se proyectan los dos
 * escenarios posibles (caballo NO figura → gana 2×; caballo figura → pierde)
 * y se reporta el ganador (mejor escenario).
 */
export function validarComando(
  texto: string,
  tasaComision?: number | null,
  caballo?: string
): ValidacionComando {
  const t = String(texto ?? "").trim();
  const m = /^(\d+(?:\.\d+)?)\s+(.+?)\s*$/i.exec(t);
  if (!m) {
    return { ok: false, motivo: "Formato esperado: <monto> <jugada>. Ej: 100 1 y 2n" };
  }
  const monto = parseFloat(m[1]);
  if (!isFinite(monto) || monto <= 0) {
    return { ok: false, motivo: "El monto debe ser un número mayor a $0." };
  }
  const tipo = m[2].trim().toUpperCase();

  const infoNini = parsearNini(tipo);
  if (infoNini) {
    const caballoTicket = String(caballo ?? "1").trim().replace(/[^0-9]/g, "") || "1";
    const base: TicketMotor = {
      hipodromo: "",
      carrera: "",
      caballo: caballoTicket,
      fechas: [],
      id: "preview-nini",
      cruces: 1,
      cuota: null,
      total: monto,
      addedAt: 0,
      tipo_jugada: infoNini.modalidad,
      monto,
      puesto_final: 1 as TicketMotor["puesto_final"],
      pizarra: { primero: "1" },
      dividendos: null,
    };
    const rGana = liquidarNini({ ...base, pizarra: { primero: "" } }, tasaComision);
    const rPierde = liquidarNini({ ...base, pizarra: { primero: caballoTicket } }, tasaComision);
    const brutoGana = rGana.totalClienteNeto + rGana.gananciaCasa;
    const brutoPierde = rPierde.totalClienteNeto + rPierde.gananciaCasa;
    const mejor = brutoGana >= brutoPierde ? rGana : rPierde;

    const proyeccion: Proyeccion = {
      monto,
      mejorBruto: Math.max(brutoGana, brutoPierde),
      totalClienteNeto: mejor.totalClienteNeto,
      gananciaProyectada: round2(mejor.totalClienteNeto - monto),
      comision: mejor.gananciaCasa,
      balanceBanca: mejor.balanceBanca,
      escenario: mejor.motivo ?? "",
    };
    return { ok: true, tipo: infoNini.modalidad, monto, simulada: mejor, proyeccion };
  }

  let mejor: ResultadoMotor | null = null;
  let brutoMejor = -Infinity;

  for (const pos of POSICIONES) {
    const ticket: TicketMotor = {
      hipodromo: "",
      carrera: "",
      caballo: "",
      fechas: [],
      id: "preview-" + pos,
      cruces: 1,
      cuota: null,
      total: monto,
      addedAt: 0,
      tipo_jugada: tipo,
      monto,
      puesto_final: pos as TicketMotor["puesto_final"],
      pizarra: { primero: String(pos) },
      dividendos: null,
    };
    const r = liquidarPuestos(ticket, tasaComision);

    if (REGLA_VIOLADA.test(r.motivo ?? "")) {
      return { ok: false, motivo: r.motivo ?? "Jugada inválida." };
    }

    const bruto = r.totalClienteNeto + r.gananciaCasa;
    if (!mejor || bruto > brutoMejor) {
      mejor = r;
      brutoMejor = bruto;
    }
  }

  if (!mejor) {
    return { ok: false, motivo: "No se pudo simular la jugada." };
  }

  const proyeccion: Proyeccion = {
    monto,
    mejorBruto: brutoMejor,
    totalClienteNeto: mejor.totalClienteNeto,
    gananciaProyectada: round2(mejor.totalClienteNeto - monto),
    comision: mejor.gananciaCasa,
    balanceBanca: mejor.balanceBanca,
    escenario: mejor.motivo ?? "",
  };

  return { ok: true, tipo, monto, simulada: mejor, proyeccion };
}

export type CobroCliente = {
  caballo: string;
  cobroBruto: number;
  comision: number;
  cobroNeto: number;
};

export type FilaProyeccion =
  | {
      ok: true;
      tipo: string;
      modalidad: ModalidadAuto | null;
      monto: number;
      cliente1: CobroCliente | null;
      cliente2: CobroCliente | null;
      cobroTotal: number;
    }
  | { ok: false; motivo: string };

const CRUCE_RE = /^(\d+)\s*X\s*(\d+)(?:\s+(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?))?$/i;

/**
 * Proyección por fila de la Carga Individual (Taquilla): la JUGADA recibe solo
 * nomenclatura pura (ej. "2x3 10/8") y el MONTO es una columna numérica aparte.
 * Para CRUCES se calcula la matemática proporcional ESTRICTA de la casa:
 *   - gana caballo A (cliente 1): bruto = MONTO × (Q/P)
 *   - gana caballo B (cliente 2): bruto = MONTO × (P/P) = MONTO (a la par)
 *   - comisión de la casa SOLO sobre la ganancia bruta (clienteBruto − monto)
 * Para el resto de modalidades delega en el motor (validarComando) y reporta el
 * mejor escenario en "cliente1".
 */
export function proyectarFila(opts: {
  jugada: string;
  caballo?: string;
  monto: string;
  tasaComision?: number | null;
}): FilaProyeccion {
  const jugada = String(opts.jugada ?? "").trim().toUpperCase();
  const monto = parseFloat(String(opts.monto ?? "").replace(",", "."));
  if (!jugada) return { ok: false, motivo: "Ingresá la nomenclatura de la jugada (ej. 2x3 10/8, 2n, 1p)." };
  if (!isFinite(monto) || monto <= 0) return { ok: false, motivo: "Ingresá el monto numérico de la jugada." };

  const modalidad = detectarModalidad(jugada);
  const cruce = CRUCE_RE.exec(jugada);

  if (cruce) {
    const A = cruce[1];
    const B = cruce[2];
    const P = cruce[3] ? parseFloat(cruce[3]) : 10;
    const Q = cruce[4] ? parseFloat(cruce[4]) : 10;
    if (!isFinite(P) || P <= 0 || !isFinite(Q) || Q <= 0) {
      return { ok: false, motivo: `Proporción del cruce inválida ("${jugada}", ej. 2x3 10/8).` };
    }
    const tasa = tasaComisionValida(opts.tasaComision);
    const bruto1 = monto * (Q / P);
    const com1 = comisionDe(bruto1, monto, tasa);
    const bruto2 = monto * (P / P);
    const com2 = comisionDe(bruto2, monto, tasa);
    const c1: CobroCliente = { caballo: A, cobroBruto: round2(bruto1), comision: com1, cobroNeto: round2(bruto1 - com1) };
    const c2: CobroCliente = { caballo: B, cobroBruto: round2(bruto2), comision: com2, cobroNeto: round2(bruto2 - com2) };
    return {
      ok: true,
      tipo: jugada,
      modalidad,
      monto,
      cliente1: c1,
      cliente2: c2,
      cobroTotal: round2(c1.cobroNeto + c2.cobroNeto),
    };
  }

  const v = validarComando(`${monto} ${jugada}`, opts.tasaComision, opts.caballo);
  if (!v.ok) return { ok: false, motivo: v.motivo };
  const bruto = v.simulada.totalClienteNeto + v.simulada.gananciaCasa;
  const caballo =
    (opts.caballo ?? "").trim().replace(/[^0-9]/g, "") ||
    v.tipo.replace(/[a-z]+/gi, "").split(/\s+|\//)[0] ||
    "?";
  const c1: CobroCliente = {
    caballo,
    cobroBruto: round2(bruto),
    comision: v.simulada.gananciaCasa,
    cobroNeto: v.simulada.totalClienteNeto,
  };
  return {
    ok: true,
    tipo: v.tipo,
    modalidad,
    monto,
    cliente1: c1,
    cliente2: null,
    cobroTotal: v.proyeccion.totalClienteNeto,
  };
}

function tasaComisionValida(tasa?: number | null): number {
  const n = typeof tasa === "number" && isFinite(tasa) && tasa >= 0 ? tasa : 5;
  return n;
}

function comisionDe(bruto: number, monto: number, tasa: number): number {
  const g = bruto - monto;
  return g > 0 ? round2(g * (tasa / 100)) : 0;
}

export type LineaRapida =
  | { ok: true; jugada: string; caballo: string; monto: string; cliente1: string; cliente2: string }
  | { ok: false; motivo: string };

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  MOTOR HEURÍSTICO POR TOKENS  (parser universal de Carga Rápida)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  Abandona los Regex rígidos: cualquier orden de campos es válido.
 *  El operador puede pegar desde "2p 1 100 Perrito molinas" hasta
 *  "Juega Lolo 2p (1) con 300 da Mar" — todos desembocan en la misma
 *  estructura de 5 columnas { jugada, caballo, monto, cliente1, cliente2 }.
 *
 *  Pipeline:
 *   1. ↓ minúsculas + split(' ')              → tokens crudos
 *   2. limpieza de puntuación                 → se conservan .,/x- (decimales y
 *      sintaxis de jugadas) y se descarta ( ) ' " ; ¿ ? ...
 *   3. filtro de stop-words                   → juega/con/da/por/en/$/bs/el/la
 *   4. clasificación por eliminación:
 *        JUGADA   → token con clave de apuesta (p, n, y, pp, /, x) + número
 *                   o cruce "NX M/P"; agrupa tramos contiguos (1/2 y 2n).
 *        CABALLO  → número pequeño (< 20), pareo NxM, o el que iba entre
 *                   paréntesis "(6)".
 *        MONTO    → número "grande" (>= 20) o con separadores (.,); fallback
 *                   al último número restante (monto = último del legacy).
 *        CLIENTES → lo que sobra: 1° → CLIENTE 1, resto → CLIENTE 2.
 *   5. tolerancia a fallos                    → si falta JUGADA o MONTO se
 *      devuelve { ok:false } (el caller pinta la fila en rojo ⚠️, no rompe).
 *
 *  Acepta "#" al inicio como comentario (se ignora → null).
 */
const STOP_WORDS = new Set(["juega", "con", "da", "por", "en", "$", "bs", "el", "la"]);

const RE_PURGADO = /[^\p{L}\p{N}.,/x-]/gu;

/** Token puramente numérico (admite separadores de miles/decimales . y ,). */
const RE_NUMERICO = /^\d+(?:[.,]\d+)*$/;
/** Pareo de caballos: "6x7". */
const RE_PAREO = /^\d+[x]\d+$/;
/** Cruce con proporción: "2x3" seguido de "10/8" (formato legacy). */
const RE_CRUCE_A = /^\d+[x]\d+$/;
const RE_CRUCE_B = /^\d+\/\d+(?:[.,]\d+)?$/;
/** Jugada con letra de apuesta + dígito: 2p, 2n, 1y2n, 3y3, pp (nunca un número pelado). */
const RE_JUGADA_LETRA = /^(?:\d+[y]\d*[pn]?|\d+[pn]|pp)$/;
const RE_JUGADA_BARRA = /^\d+\/\d+(?![\d.])/;

function limpiarToken(tok: string): string {
  return tok.replace(RE_PURGADO, "");
}

function tokenNumerico(tok: string): number | null {
  const t = String(tok ?? "").trim();
  if (!RE_NUMERICO.test(t)) return null;
  let n: number;
  if (/^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(t)) {
    // Miles con punto y decimal con coma: 1.200,50
    n = parseFloat(t.replace(/\./g, "").replace(",", "."));
  } else {
    n = parseFloat(t.replace(",", "."));
  }
  return Number.isFinite(n) ? n : null;
}

type TokenAnalizado = {
  raw: string;
  limpio: string;
  enParentesis: boolean;
};

function esJugadaLetra(tok: string): boolean {
  return RE_JUGADA_LETRA.test(tok);
}

/**
 * Clasifica la línea en las 5 columnas de la taquilla. Devuelve null para
 * líneas en blanco / comentarios, { ok:false } para ilegibles.
 */
export function parsearLineaRapida(linea: string): LineaRapida | null {
  const t = String(linea ?? "").trim();
  if (!t || t.startsWith("#")) return null;

  const crudos = t.split(/[ \t]+/);
  if (crudos.length === 0) return null;

  // 1) Limpieza + 2) stop-words. Se conserva el flag de "(n)" para el caballo.
  const tokens: TokenAnalizado[] = [];
  for (const c of crudos) {
    const enParentesis = /^\((\d+)\)$/.test(c);
    const limpio = limpiarToken(c).toLowerCase();
    if (!limpio) continue;
    if (STOP_WORDS.has(limpio)) continue;
    tokens.push({ raw: c, limpio, enParentesis });
  }
  if (tokens.length === 0) return null;

  const usados = new Set<number>();
  let jugada = "";
  let caballo = "";
  let monto = "";

  const marcarJugada = (rango: [number, number]) => {
    jugada = tokens.slice(rango[0], rango[1] + 1).map((k) => k.limpio).join(" ");
    for (let i = rango[0]; i <= rango[1]; i++) usados.add(i);
  };

  // 3) JUGADA — cruce legacy "2x3 10/8" primero (par de tokens contiguos).
  for (let i = 0; i < tokens.length - 1; i++) {
    if (RE_CRUCE_A.test(tokens[i].limpio) && RE_CRUCE_B.test(tokens[i + 1].limpio)) {
      marcarJugada([i, i + 1]);
      break;
    }
  }

  if (!jugada) {
    // JUGADA con letra de apuesta o "/" → tramo contiguo (preservando
    // conectores "y"/"&"): un solo token = simple, varios = compuesta.
    // Un pareo NxM suelto (ej. "6x7") NO se pega a otra jugada: pasa a CABALLO.
    const yesIdx = tokens
      .map((k, i) => (esJugadaLetra(k.limpio) || RE_JUGADA_BARRA.test(k.limpio) ? i : -1))
      .filter((i) => i !== -1);
    if (yesIdx.length > 0) {
      marcarJugada([yesIdx[0], yesIdx[yesIdx.length - 1]]);
    } else {
      // Pareo NxM como jugada única ("6x7 100 Juan").
      const idx = tokens.findIndex((k) => RE_PAREO.test(k.limpio));
      if (idx !== -1) marcarJugada([idx, idx]);
    }
  }

  if (!jugada) {
    return { ok: false, motivo: `No se detectó una JUGADA válida (ej. 2p, 2n, 3y3, 1/2, 2x3) en "${t}".` };
  }

  // 4) MONTO — número grande (>= 20) o con separadores; fallback al último.
  const numericos = tokens
    .map((k, i) => ({ i, k, n: tokenNumerico(k.limpio) ?? NaN }))
    .filter((x) => Number.isFinite(x.n) && !usados.has(x.i));
  const numericosGrandes = numericos.filter((x) => x.n >= 20 || /[.,]/.test(x.k.limpio));
  const montoSel = numericosGrandes.length > 0 ? numericosGrandes[numericosGrandes.length - 1] : numericos[numericos.length - 1];
  if (!montoSel) {
    return { ok: false, motivo: `No se detectó el MONTO numérico en "${t}".` };
  }
  monto = /^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(montoSel.k.raw) ? String(montoSel.n).replace(".", ",") : montoSel.k.raw;
  usados.add(montoSel.i);

  // 5) CABALLO — el que iba entre paréntesis, un número pequeño restante,
  //    o un pareo NxM restante.
  const paren = tokens.findIndex((k, i) => k.enParentesis && !usados.has(i) && RE_NUMERICO.test(k.limpio));
  let cabIdx = -1;
  if (paren !== -1) cabIdx = paren;
  else {
    cabIdx = (numericos.find((x) => !usados.has(x.i) && /^\d+$/.test(x.k.limpio) && x.n < 20) ?? numericos.find((x) => !usados.has(x.i)))?.i ?? -1;
  }
  if (cabIdx === -1) {
    cabIdx = tokens.findIndex((k, i) => !usados.has(i) && RE_PAREO.test(k.limpio));
  }
  if (cabIdx !== -1) {
    caballo = tokens[cabIdx].limpio;
    usados.add(cabIdx);
  }

  // 6) CLIENTES — lo sobrante: 1° → CLIENTE 1, el resto → CLIENTE 2.
  const restantes = tokens
    .filter((_, i) => !usados.has(i))
    .map((k) => k.raw.trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""));
  const cliente1 = restantes[0] ?? "";
  const cliente2 = restantes.slice(1).join(" ");

  return {
    ok: true,
    jugada: jugada.toUpperCase(),
    caballo: caballo.toUpperCase(),
    monto,
    cliente1,
    cliente2,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}