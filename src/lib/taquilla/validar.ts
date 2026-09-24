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

  const v = validarComando(`${monto} ${jugada}`, opts.tasaComision);
  if (!v.ok) return { ok: false, motivo: v.motivo };
  const bruto = v.simulada.totalClienteNeto + v.simulada.gananciaCasa;
  const caballo = v.tipo.replace(/[a-z]+/gi, "").split(/\s+|\//)[0] || "?";
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
 * Parser línea a línea del Modal de Carga Rápida (paridad con el legacy):
 *   JUGADA CABALLO MONTO CLIENTE1 [CLIENTE2]
 *   ej: "2n 7 25 Eddie Manuel" · "1/2 4 60 Camacho rucio" · "1/2 y 2n 7 100 Eddie Manuel"
 *   ej cruce nuevo: "2x3 10/8 2 100 Juan Pedro"
 * El monto es el ÚLTIMO número de la línea; el token anterior es el caballo; los
 * tokens restantes (1 o 2) son los clientes. Acepta "#" como comentario.
 */
export function parsearLineaRapida(linea: string): LineaRapida | null {
  const t = String(linea ?? "").trim().replace(/\s+/g, " ");
  if (!t || t.startsWith("#")) return null;

  const tokens = t.split(" ");
  let montoIdx = -1;
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (/^\d+(?:[.,]\d+)?$/.test(tokens[i])) {
      montoIdx = i;
      break;
    }
  }
  if (montoIdx < 1) {
    return { ok: false, motivo: `Falta el monto numérico: esperado "JUGADA CABALLO MONTO CLIENTE1 [CLIENTE2]".` };
  }
  const monto = tokens[montoIdx].replace(",", ".");
  if (!(parseFloat(monto) > 0)) {
    return { ok: false, motivo: `Monto inválido "${tokens[montoIdx]}".` };
  }
  const caballo = tokens[montoIdx - 1];
  const jugada = tokens.slice(0, montoIdx - 1).join(" ");
  const clientes = tokens.slice(montoIdx + 1).filter(Boolean);
  return {
    ok: true,
    jugada,
    caballo,
    monto,
    cliente1: clientes[0] ?? "",
    cliente2: clientes.slice(1).join(" "),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}