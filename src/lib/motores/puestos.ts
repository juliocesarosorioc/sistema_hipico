/**
 * PuestosEngine — submódulo ESTRATEGIA (Paso 3).
 * Registrado en procesarTicket() vía registrarProcesador("puestos", ...).
 * Reglas ESTRICTAS de la casa (contracto Paso 3):
 *  - NINI ("100 2n"): llega <N = GANA · ==N = EMPATA (devuelve capital) · >N = PIERDE
 *  - Puesto puro ("100 2p"): llega <=N = GANA · >N = PIERDE
 *  - PP / documentado ("100 10/2.5 o PP"): SOLO 1° EN SOLITARIO · empate 1° = ANULA (devuelve capital, NO fracciona)
 *  - comisión 5% SOLO sobre ganancia neta (capital intacto)
 */
import { registrarProcesador, TicketMotor, ResultadoMotor } from "../bettingEngine";
import { esPagoInmediato } from "../liquidacion";
import { PizarraCarrera } from "../liquidacion";

const COMISION = { rate: 0.05 };

function nini(t: TicketMotor): ResultadoMotor {
  const m = /^(\d+)n$/.exec(t.tipo_jugada);
  if (!m) return { ok: false, motivo: "NINI malformado: " + t.tipo_jugada, totalClienteNeto: 0, balanceBanca: t.monto, gananciaCasa: 0 };
  const N = parseInt(m[1], 10);
  const p = t.puesto_final;
  const pos = typeof p === "number" ? p : p === "EMP1" ? 1 : Infinity;
  if (pos < N) return { ok: true, motivo: "NINI gana (<" + N + ")", totalClienteNeto: t.monto * 2, balanceBanca: -t.monto, gananciaCasa: 0 };
  if (pos === N) return { ok: false, motivo: "NINI empata (==" + N + "): devuelve capital", totalClienteNeto: t.monto, balanceBanca: 0, gananciaCasa: 0 };
  return { ok: false, motivo: "NINI pierde (>" + N + ")", totalClienteNeto: 0, balanceBanca: t.monto, gananciaCasa: 0 };
}

function puesto(t: TicketMotor): ResultadoMotor {
  const m = /^(\d+)p$/.exec(t.tipo_jugada);
  if (!m) return { ok: false, motivo: "PUESTO malformado: " + t.tipo_jugada, totalClienteNeto: 0, balanceBanca: t.monto, gananciaCasa: 0 };
  const N = parseInt(m[1], 10);
  const p = t.puesto_final;
  const pos = typeof p === "number" ? p : p === "EMP1" ? 1 : Infinity;
  if (pos <= N) return { ok: true, motivo: "PUESTO gana (<=" + N + ")", totalClienteNeto: t.monto * 2, balanceBanca: -t.monto, gananciaCasa: 0 };
  return { ok: false, motivo: "PUESTO pierde", totalClienteNeto: 0, balanceBanca: t.monto, gananciaCasa: 0 };
}

/* ------- A PREMIO (PP o 10/X) ------- */
/* Gana SOLO 1° EN SOLITARIO · empate 1° = ANULA (devuelve capital, NO fracciona) ·
   llega >1° = PIERDE · pago proporcional (ej. 10/2.5 -> dobla según fracción) */
function aPremio(t: TicketMotor): ResultadoMotor | null {
  const soloPP = /^pp$/i.test(t.tipo_jugada) || /^\d+\/pp$/i.test(t.tipo_jugada);
  const egA = /^(\d+)\/(\d+(?:\.\d+)?|PP)$/i.exec(t.tipo_jugada);
  if (!egA && !soloPP) return null;
  const proporcion = soloPP ? 10 : (egA![2].toUpperCase() === "PP" ? 10 : parseFloat(egA![2]));

  const pos = typeof t.puesto_final === "number" ? t.puesto_final : t.puesto_final === "EMP1" ? 1 : Infinity;
  const empate1 = typeof t.pizarra.segundo === "number" && t.pizarra.primero === t.pizarra.segundo;

  if ((pos === 1 || pos === 0) && !empate1) {
    const bruto = t.monto * (1 + proporcion / 10);
    const ganancia = bruto - t.monto;
    const comi = ganancia * COMISION.rate;
    return { ok: true, motivo: "A PREMIO gana 1° en solitario (proporción " + proporcion + ":10)", totalClienteNeto: bruto - comi, balanceBanca: -(ganancia - comi), gananciaCasa: comi };
  }
  if (empate1) {
    return { ok: false, motivo: "A PREMIO empate 1°: ANULADA (devuelve capital)", totalClienteNeto: t.monto, balanceBanca: 0, gananciaCasa: 0 };
  }
  return { ok: false, motivo: "A PREMIO pierde (no llegó 1° en solitario)", totalClienteNeto: 0, balanceBanca: t.monto, gananciaCasa: 0 };
}

/* ------- COMBINADA CONSECUTIVA (ej. 1 y 2n) ------- */
/* Monto 50/50 entre partes · Bloqueo de Pizarra si P2 != P1 y P2 != P1+1 ·
   cada parte se liquida con su lógica (n/puro) y se suman los balances netos */
function evaluarTramo(n: number, suf: string, mitad: number, t: TicketMotor): { bruto: number; bal: number } {
  const pos = typeof t.puesto_final === "number" ? t.puesto_final : t.puesto_final === "EMP1" ? 1 : Infinity;
  if (suf === "n") {
    if (pos < n) return { bruto: mitad * 2, bal: -mitad };
    if (pos === n) return { bruto: mitad, bal: 0 };
    return { bruto: 0, bal: mitad };
  }
  return pos <= n ? { bruto: mitad * 2, bal: -mitad } : { bruto: 0, bal: mitad };
}

function combinada(t: TicketMotor): ResultadoMotor | null {
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
  const balTotal = a1.bal + a2.bal;
  const ganancia = brutoTotal - t.monto;
  const estado = brutoTotal > t.monto ? "GANADORA" : brutoTotal === t.monto ? "EMPATA" : "PERDIDA";

  if (ganancia <= 0) {
    return { ok: brutoTotal > 0, motivo: "COMBINADA " + estado + " · balance neto " + balTotal, totalClienteNeto: brutoTotal, balanceBanca: balTotal, gananciaCasa: 0 };
  }
  const comi = ganancia * COMISION.rate;
  return { ok: true, motivo: "COMBINADA GANADORA (" + p1 + s1 + " y " + p2 + s2 + ") · balance neto " + balTotal, totalClienteNeto: brutoTotal - comi, balanceBanca: balTotal - comi, gananciaCasa: comi };
}

/* ------- COMPUESTA / ANIDADA (ej. 1/2n y 2n, o 2n y 2/2n) ------- */
/* Split 50/50 entre dos bloques separados por " y " o " & " · cada bloque se
   liquida por delegación (combinada con su bloqueo de pizarra, o nini/puesto
   simple) · se consolidan totalClienteNeto y balanceBanca */
function resolve(t: TicketMotor, tipo: string, monto: number): ResultadoMotor | null {
  const sub: TicketMotor = { ...t, tipo_jugada: tipo, monto };
  const ap = aPremio(sub);
  if (ap) return ap;
  const cb = combinada(sub);
  if (cb) return cb;
  if (/n$/i.test(tipo)) return nini(sub);
  if (/p$/i.test(tipo)) return puesto(sub);
  return null;
}

function compuesta(t: TicketMotor): ResultadoMotor | null {
  const m = String(t.tipo_jugada).trim().match(/^(.+?)\s+(?:y|&)\s+(.+)$/i);
  if (!m) return null;
  const a = m[1].trim();
  const b = m[2].trim();
  const mitad = t.monto / 2;

  const rA = resolve(t, a, mitad);
  if (!rA) return { ok: false, motivo: "COMPUESTA: bloque A inválido (" + a + ")", totalClienteNeto: 0, balanceBanca: 0, gananciaCasa: 0 };
  const rB = resolve(t, b, mitad);
  if (!rB) return { ok: false, motivo: "COMPUESTA: bloque B inválido (" + b + ")", totalClienteNeto: 0, balanceBanca: 0, gananciaCasa: 0 };

  return {
    ok: rA.ok && rB.ok,
    motivo: "COMPUESTA (" + a + ") 50/50 (" + b + "): " + rA.motivo + " | " + rB.motivo,
    totalClienteNeto: rA.totalClienteNeto + rB.totalClienteNeto,
    balanceBanca: rA.balanceBanca + rB.balanceBanca,
    gananciaCasa: rA.gananciaCasa + rB.gananciaCasa
  };
}

export function procesarPuestos(t: TicketMotor): ResultadoMotor {
  const ap = aPremio(t);
  if (ap) return ap;
  const cb = combinada(t);
  if (cb) return cb;
  const cp = compuesta(t);
  if (cp) return cp;
  return /n$/i.test(t.tipo_jugada) ? nini(t) : puesto(t);
}

registrarProcesador("puestos-puro", procesarPuestos);
registrarProcesador("nini", procesarPuestos);
registrarProcesador("a-premio", procesarPuestos);
registrarProcesador("combinada", procesarPuestos);
registrarProcesador("compuesta", procesarPuestos);