import { liquidarPuestos } from "@/lib/motores/puestos";
import type { TicketMotor, ResultadoMotor } from "@/lib/bettingEngine";

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
 */
export function validarComando(texto: string, tasaComision?: number | null): ValidacionComando {
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

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}