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

export function procesarPuestos(t: TicketMotor): ResultadoMotor {
  const eg = t.tipo_jugada.match(/^(\d+)\/(\d+(?:\.\d+)?|PP)$/i);
  if (eg) {
    const solitario = t.puesto_final === 1 || t.puesto_final === 0;
    if (!solitario || (t.pizarra.primero === t.pizarra.segundo)) {
      return { ok: false, motivo: "EllePremio empate 1°: ANULADO (devuelve capital)", totalClienteNeto: t.monto, balanceBanca: 0, gananciaCasa: 0 };
    }
    const bruto = t.monto * (1 + 1 / parseFloat(eg[1]));
    const ganancia = bruto - t.monto;
    const comi = ganancia * COMISION.rate;
    return { ok: true, motivo: "EllePremio ganado", totalClienteNeto: bruto - comi, balanceBanca: -(ganancia - comi), gananciaCasa: comi };
  }
  return /n$/i.test(t.tipo_jugada) ? nini(t) : puesto(t);
}

registrarProcesador("puestos-puro", procesarPuestos);
registrarProcesador("nini", procesarPuestos);
registrarProcesador("a-premio", procesarPuestos);