/**
 * PuestosEngine — submódulo ESTRATEGIA (Paso 3).
 * Registrado en procesarTicket() vía registrarProcesador("puestos", ...).
 * Reglas ESTRICTAS de la casa:
 *  - NINI ("100 2n"): llega <N = GANA · ==N = EMPATA (devuelve capital) · >N = PIERDE
 *  - Puesto puro ("100 2p"): llega <=N = GANA · >N = PIERDE
 *  - A PREMIO ("100 10/2.5 o PP"): SOLO 1° EN SOLITARIO · empate 1° = ANULA (devuelve capital, NO fracciona)
 *  - COMBINADA CONSECUTIVA ("100 1 y 2n"): 50/50 por tramo · Bloqueo de Pizarra si P2 != P1 y P2 != P1+1
 *  - COMPUESTA / ANIDADA ("100 1/2n y 2n"): split 50/50 entre bloques · delegación modular
 *  - COMISIÓN (Iteración Final): tasa dinámica `tasaComision` (porcentaje). Si no se provee,
 *    usa TASA_DEFECTO (= COMISION_CASA.rate * 100). Aplica SOLO sobre la ganancia bruta
 *    (clienteBruto - monto). El balanceBanca es el INVERSO MATEMÁTICO del resultado bruto del
 *    cliente ANTES de comisiones, más la comisión retenida (Juego de Suma Cero).
 */
import { registrarProcesador, TicketMotor, ResultadoMotor, COMISION_CASA } from "../bettingEngine";
import { parsearNini, liquidarNini } from "../bettingEngine";

/** Tasa porcentual por defecto de la casa (COMISION_CASA.rate = 0.05 -> 5%). */
const TASA_DEFECTO = COMISION_CASA.rate * 100;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function posicion(t: TicketMotor): number {
  const p = t.puesto_final;
  return typeof p === "number" ? p : p === "EMP1" ? 1 : Infinity;
}

/* ---------- Envoltorio ÚNICO de Comisión y Suma Cero ---------- */
/** Exportado para el Motor Universal (oficiales.ts): aplica comisión 5% SOLO
    sobre la ganancia bruta y calcula balanceBanca = monto − bruto + comisión. */
export function finalizar(ok: boolean, motivo: string, clienteBruto: number, monto: number, tasa: number): ResultadoMotor {
  const gananciaBruta = clienteBruto - monto;
  const comision = gananciaBruta > 0 ? gananciaBruta * (tasa / 100) : 0;
  return {
    ok,
    motivo: motivo + (comision > 0 ? " · comisión casa $" + round2(comision) : ""),
    totalClienteNeto: round2(clienteBruto - comision),
    // Inverso bruto del jugador + comisión retenida: monto - clienteBruto + comision
    balanceBanca: round2(monto - clienteBruto + comision),
    gananciaCasa: round2(comision)
  };
}

/* ------- NINI único (ej. 2n) ------- */
function nini(t: TicketMotor, tasa: number): ResultadoMotor {
  const m = /^(\d+)n$/.exec(t.tipo_jugada);
  if (!m) return { ok: false, motivo: "NINI malformado: " + t.tipo_jugada, totalClienteNeto: 0, balanceBanca: t.monto, gananciaCasa: 0 };
  const N = parseInt(m[1], 10);
  const pos = posicion(t);
  if (pos < N) return finalizar(true, "NINI gana (<" + N + ")", t.monto * 2, t.monto, tasa);
  if (pos === N) return finalizar(false, "NINI empata (==" + N + "): devuelve capital", t.monto, t.monto, tasa);
  return finalizar(false, "NINI pierde (>" + N + ")", 0, t.monto, tasa);
}

/* ------- PUESTO puro (ej. 2p) ------- */
function puesto(t: TicketMotor, tasa: number): ResultadoMotor {
  const m = /^(\d+)p$/.exec(t.tipo_jugada);
  if (!m) return { ok: false, motivo: "PUESTO malformado: " + t.tipo_jugada, totalClienteNeto: 0, balanceBanca: t.monto, gananciaCasa: 0 };
  const N = parseInt(m[1], 10);
  if (posicion(t) <= N) return finalizar(true, "PUESTO gana (<=" + N + ")", t.monto * 2, t.monto, tasa);
  return finalizar(false, "PUESTO pierde", 0, t.monto, tasa);
}

/* ------- A PREMIO (PP o 10/X) ------- */
/* Gana SOLO 1° EN SOLITARIO · empate 1° = ANULA (devuelve capital, NO fracciona) ·
   llega >1° = PIERDE · pago proporcional (ej. 10/2.5 -> fracción X:10) */
function aPremio(t: TicketMotor, tasa: number): ResultadoMotor | null {
  const soloPP = /^pp$/i.test(t.tipo_jugada) || /^\d+\/pp$/i.test(t.tipo_jugada);
  const egA = /^(\d+)\/(\d+(?:\.\d+)?|PP)$/i.exec(t.tipo_jugada);
  if (!egA && !soloPP) return null;
  const proporcion = soloPP ? 10 : (egA![2].toUpperCase() === "PP" ? 10 : parseFloat(egA![2]));

  const pos = posicion(t);
  const empate1 =
    typeof t.pizarra.segundo === "number" && t.pizarra.primero === t.pizarra.segundo
      ? true
      : (t.pizarra.empates ?? []).includes(1);

  if ((pos === 1 || pos === 0) && !empate1) {
    const bruto = t.monto * (1 + proporcion / 10);
    return finalizar(true, "A PREMIO gana 1° en solitario (proporción " + proporcion + ":10)", bruto, t.monto, tasa);
  }
  if (empate1) {
    return finalizar(false, "A PREMIO empate 1°: ANULADA (devuelve capital)", t.monto, t.monto, tasa);
  }
  return finalizar(false, "A PREMIO pierde (no llegó 1° en solitario)", 0, t.monto, tasa);
}

/* ------- PAREO (ej. 2x3 10/8) — caballo contra caballo ------- */
/* Apuesta doble a dos caballos con proporciones por cliente (NUNCA un
   "cruce financiero": un cliente apuesta contra su propia jugada):
   - Gana caballo A (cliente 1): bruto = monto × (Q/P)
   - Gana caballo B (cliente 2): bruto = monto × (P/P) = monto (a la par)
   - Cualquier otro ganador: pierde
   La comisión se aplica (como en toda la casa) SOLO sobre la ganancia bruta. */
function pareo(t: TicketMotor, tasa: number): ResultadoMotor | null {
  const m = /^(\d+)\s*X\s*(\d+)(?:\s+(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?))?$/i.exec(String(t.tipo_jugada).trim());
  if (!m) return null;
  const A = parseInt(m[1], 10);
  const B = parseInt(m[2], 10);
  const P = m[3] ? parseFloat(m[3]) : 10;
  const Q = m[4] ? parseFloat(m[4]) : 10;
  if (!isFinite(P) || P <= 0 || !isFinite(Q) || Q <= 0) {
    return { ok: false, motivo: "PAREO malformado (proporción inválida): " + t.tipo_jugada, totalClienteNeto: 0, balanceBanca: t.monto, gananciaCasa: 0 };
  }
  const pos = posicion(t);
  if (pos === A) {
    const bruto = t.monto * (Q / P);
    return finalizar(true, `PAREO gana caballo ${A} (cliente 1): paga ${Q}/${P} = ${round2(bruto)}`, bruto, t.monto, tasa);
  }
  if (pos === B) {
    const bruto = t.monto * (P / P);
    return finalizar(true, `PAREO gana caballo ${B} (cliente 2): paga ${P}/${P} a la par = ${round2(bruto)}`, bruto, t.monto, tasa);
  }
  return finalizar(false, `PAREO pierde (ganó el ${pos})`, 0, t.monto, tasa);
}

/* ------- COMBINADA CONSECUTIVA (ej. 1 y 2n) ------- */
/* Monto 50/50 entre partes · Bloqueo de Pizarra si P2 != P1 y P2 != P1+1 ·
   cada parte se liquida con su lógica (n/puro) y se suman los balances netos */
function evaluarTramo(n: number, suf: string, mitad: number, t: TicketMotor): { bruto: number; bal: number } {
  const pos = posicion(t);
  if (suf === "n") {
    if (pos < n) return { bruto: mitad * 2, bal: -mitad };
    if (pos === n) return { bruto: mitad, bal: 0 };
    return { bruto: 0, bal: mitad };
  }
  return pos <= n ? { bruto: mitad * 2, bal: -mitad } : { bruto: 0, bal: mitad };
}

function combinada(t: TicketMotor, tasa: number): ResultadoMotor | null {
  const m = /^([1-8])([pn]?)\s*(?:y|\/)\s*([1-8])([pn]?)$/i.exec(t.tipo_jugada);
  if (!m) return null;
  const p1 = parseInt(m[1], 10);
  const p2 = parseInt(m[3], 10);
  const s1 = (m[2] || "p").toLowerCase();
  const s2 = (m[4] || "p").toLowerCase();

  if (p2 !== p1 && p2 !== p1 + 1) {
    return { ok: false, motivo: "BLOQUEO DE PIZARRA: la parte 2 (" + p2 + ") debe ser igual a la parte 1 (" + p1 + ") o su inmediato superior (P1+1). La jugada no se registra.", totalClienteNeto: 0, balanceBanca: 0, gananciaCasa: 0 };
  }

  const mitad = t.monto / 2;
  const a1 = evaluarTramo(p1, s1, mitad, t);
  const a2 = evaluarTramo(p2, s2, mitad, t);
  const brutoTotal = a1.bruto + a2.bruto;
  const estado = brutoTotal > t.monto ? "GANADORA" : brutoTotal === t.monto ? "EMPATA" : "PERDIDA";
  return finalizar(brutoTotal > 0, "COMBINADA (" + p1 + s1 + " y " + p2 + s2 + ") " + estado, brutoTotal, t.monto, tasa);
}

/* ------- COMPUESTA / ANIDADA (ej. 1/2n y 2n, o 2n y 2/2n) ------- */
/* Split 50/50 entre dos bloques separados por " y " o " & " · cada bloque se
   liquida por delegación (combinada con su bloqueo de pizarra, o nini/puesto
   simple) · se consolidan totalClienteNeto y balanceBanca */
function resolve(t: TicketMotor, tipo: string, monto: number, tasa: number): ResultadoMotor | null {
  const sub: TicketMotor = { ...t, tipo_jugada: tipo, monto };
  const ap = aPremio(sub, tasa);
  if (ap) return ap;
  const cb = combinada(sub, tasa);
  if (cb) return cb;
  if (/n$/i.test(tipo)) return nini(sub, tasa);
  if (/p$/i.test(tipo)) return puesto(sub, tasa);
  return null;
}

function compuesta(t: TicketMotor, tasa: number): ResultadoMotor | null {
  const m = String(t.tipo_jugada).trim().match(/^(.+?)\s+(?:y|&)\s+(.+)$/i);
  if (!m) return null;
  const a = m[1].trim();
  const b = m[2].trim();
  const mitad = t.monto / 2;

  const rA = resolve(t, a, mitad, tasa);
  if (!rA) return { ok: false, motivo: "COMPUESTA: bloque A inválido (" + a + ")", totalClienteNeto: 0, balanceBanca: 0, gananciaCasa: 0 };
  const rB = resolve(t, b, mitad, tasa);
  if (!rB) return { ok: false, motivo: "COMPUESTA: bloque B inválido (" + b + ")", totalClienteNeto: 0, balanceBanca: 0, gananciaCasa: 0 };

  return {
    ok: rA.ok && rB.ok,
    motivo: "COMPUESTA (" + a + ") 50/50 (" + b + "): " + rA.motivo + " | " + rB.motivo,
    totalClienteNeto: round2(rA.totalClienteNeto + rB.totalClienteNeto),
    balanceBanca: round2(rA.balanceBanca + rB.balanceBanca),
    gananciaCasa: round2(rA.gananciaCasa + rB.gananciaCasa)
  };
}

/* ---------- API pública ---------- */
/** Ejecuta el PuestosEngine. `tasaComision` es porcentual (0-100); si no se
    provee usa TASA_DEFECTO. Permite inyectar comisiones jerárquicas personalizadas. */
export function liquidarPuestos(t: TicketMotor, tasaComision?: number | null): ResultadoMotor {
  const tasa = (typeof tasaComision === "number" && isFinite(tasaComision) && tasaComision >= 0)
    ? tasaComision : TASA_DEFECTO;
  // NINI puro/cantón (2N · 1N · 1y2N) → Motor Nini (cruce del caballo contra la Pizarra).
  if (parsearNini(t.tipo_jugada)) return liquidarNini(t, tasa);
  const ap = aPremio(t, tasa);
  if (ap) return ap;
  const cn = pareo(t, tasa);
  if (cn) return cn;
  const cb = combinada(t, tasa);
  if (cb) return cb;
  const cp = compuesta(t, tasa);
  if (cp) return cp;
  return /n$/i.test(t.tipo_jugada) ? nini(t, tasa) : puesto(t, tasa);
}

export function procesarPuestos(t: TicketMotor): ResultadoMotor {
  return liquidarPuestos(t);
}

registrarProcesador("puestos-puro", procesarPuestos);
registrarProcesador("nini", procesarPuestos);
registrarProcesador("a-premio", procesarPuestos);
registrarProcesador("pareo", procesarPuestos);
registrarProcesador("cruce", procesarPuestos);
registrarProcesador("combinada", procesarPuestos);
registrarProcesador("compuesta", procesarPuestos);