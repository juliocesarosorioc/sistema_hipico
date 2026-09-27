/**
 * Núcleo matemático de la plataforma — patrón Estrategia/Router.
 * procesarTicket(ticket) lee ticket.tipo_jugada y deriva al submódulo correcto.
 * CERO espagueti: cada modalidad vive en su propio submódulo.
 */
import { BetSlipEntry } from "@/store/bet-slip";
import { PizarraCarrera, ResultadoPago, esPagoInmediato } from "./liquidacion";

// ============================================================
// Dominio NINI (sintaxis con "N": 2N · 1N · 1y2N)
// ============================================================

export type NiniInfo = {
  /** Modalidad canonizada para reportes (ej. "2N", "1y2N"). */
  modalidad: string;
  /** Puestos 1..N cubiertos por el nini (oficial: hasta 8). */
  N: number;
};

const CLAVES_PIZARRA = [
  "primero",
  "segundo",
  "tercero",
  "cuarto",
  "quinto",
  "sexto",
  "septimo",
  "octavo",
] as const;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Parser de la modalidad NINI desde la columna JUGADA.
 * Reconoce expresiones compactas terminadas en "N": "2N", "1N", "1y2N",
 * "1Y2N". DEVUELVE null para formes espaciadas ("1 y 2n"), con "/" (compuestas
 * "1/2n y 2n") o sin sufijo N. Devuelve N = máximo puesto cubierto.
 */
export function parsearNini(tipoJugada: string): NiniInfo | null {
  const t = String(tipoJugada ?? "").trim().replace(/\s+/g, " ");
  if (!t || t.includes("/")) return null;
  const m = /^(\d+(?:[Yy]\d+)*)\s*N$/i.exec(t);
  if (!m) return null;
  const nums = m[1]
    .split(/[Yy]/)
    .map((x) => parseInt(x, 10))
    .filter((n) => Number.isFinite(n) && n >= 1 && n <= 8);
  if (nums.length === 0) return null;
  return {
    modalidad: `${nums.join("y")}N`,
    N: Math.max(...nums),
  };
}

export function esNini(tipoJugada: string): boolean {
  return parsearNini(tipoJugada) !== null;
}

/** Canoniza la nomenclatura de un NINI (ej. "2n" → "2N", "1y 2N" → "1y2N"). */
export function normalizarNini(tipoJugada: string): string {
  const info = parsearNini(tipoJugada);
  return info ? info.modalidad : String(tipoJugada ?? "").trim();
}

/**
 * Lista ordenada (1º→8º) de números de la pizarra oficial. Cada valor es el
 * NÚMERO del ejemplar que ocupó ese puesto (p. ej. primero = "6").
 */
export function numerosPizarra(p: PizarraCarrera): string[] {
  const out: string[] = [];
  for (const k of CLAVES_PIZARRA) {
    const raw = (p as Record<string, unknown>)[k];
    const v = raw == null ? "" : String(raw).trim();
    if (v) out.push(v);
  }
  return out;
}

/**
 * AVISO — se eliminaron de este archivo `figuraEnPizarra` y el motor de
 * liquidacion del NINI que lo usaba.
 *
 * Aquella version pagaba cuando el caballo NO figuraba entre los N primeros
 * puestos, al reves de la regla de la casa (nini = llegar < N, o sea que
 * Figurar en el top N es lo que GANA). Los dos caminos de liquidacion del repo
 * se contradecian: este pagaba al reves y el de src/lib/motores/puestos.ts
 * hacia lo correcto.
 *
 * Toda la liquidacion por posicion de llegada vive ahora en el PuestosEngine
 * (src/lib/motores/puestos.ts), que cubre 1p, PP, A Premio, enfrentamientos,
 * ninis y puestos multi-ejemplar con una sola gramatica. No reintroducir aqui
 * reglas de llegada.
 */

/**
 * AVISO — se elimino tambien `liquidarNini`. Quien necesite liquidar una jugada
 * de puestos debe importar `liquidarPuestos` de src/lib/motores/puestos.
 */

export type ComisionConfig = {
  /** Solo se descuenta sobre la GANANCIA NETA del jugador, nunca sobre el capital. */
  rate: number;
};

export const COMISION_CASA: ComisionConfig = { rate: 0.05 };

// ============================================================
// CRUCE FINANCIERO — comisión sobre la GANANCIA NETA
// ============================================================
// Condición de mitigación de riesgo donde un cliente apuesta a favor y en
// contra del mismo ejemplar (ej. juega 2n y da 1y2n). La comisión del 5% y
// las devoluciones se calculan ÚNICAMENTE sobre la ganancia neta resultante.
// (Ej: Gana 15 y pierde 10 -> Comisión sobre 5. Gana 15 y pierde 15 ->
// Comisión cero. Si hay pérdida neta, comisión cero).
//
// Agrupación: (cliente, caballo, carrera). Dentro del grupo se suman los
// resultados netos (bruto − monto de cada ganador y − monto de cada
// perdedor); la comisión resultante sobre el saldo NETO POSITIVO reemplaza
// la suma de comisiones por ticket de ese grupo.
//
// TODO(PLANIFICACIÓN): "INQUIETUDES CON RESPECTO A CRUCES" — la jerarquía de
// permisos Carrera → Cliente → Grupo decide si el cruce recibe este descuento
// de comisión neta (permiso en NO = comisión por ticket, sin neteo). Pendiente
// definir si además se BLOQUEA la operación.

export type NeteoCruceItem = {
  /** Identidad del cliente apostador (cliente_juega_id / cliente1). */
  cliente: string;
  caballo: string;
  monto: number;
  /** Bruto de la jugada ANTES de comisión (0 si el ticket perdió). */
  bruto: number;
  /** true = ticket ganador (bruto > 0). */
  ok: boolean;
};

export type NeteoCruceGrupo = {
  /** Resultado neto del cliente sobre ese ejemplar en la carrera. */
  neto: number;
  /** Comisión SOLO sobre el neto positivo (0 si pérdida neta). */
  comisionNeta: number;
  /** Cantidad de tickets que integran el grupo. */
  conteo: number;
};

export function claveCruceFinanciero(carrera: string | number, cliente: string, caballo: string): string {
  return [
    String(carrera ?? "").trim().toUpperCase(),
    String(cliente ?? "").trim().toUpperCase(),
    String(caballo ?? "").trim().toUpperCase(),
  ].join("::");
}

/**
 * Agrupa los tickets por (cliente, caballo, carrera) y calcula la comisión
 * neta de cada grupo (cruces financieros). Los tickets sin cliente o sin
 * caballo no participan del neteo (se mantienen con comisión por ticket).
 */
export function netearComisionCruce(
  items: NeteoCruceItem[],
  carrera: string | number,
  tasaComisionPorcentaje?: number | null
): Map<string, NeteoCruceGrupo> {
  const tasa =
    Number.isFinite(Number(tasaComisionPorcentaje)) && Number(tasaComisionPorcentaje) >= 0
      ? Number(tasaComisionPorcentaje)
      : COMISION_CASA.rate * 100;
  const porGrupo = new Map<string, { neto: number; conteo: number }>();
  for (const it of items) {
    const cliente = String(it.cliente ?? "").trim();
    const caballo = String(it.caballo ?? "").trim();
    if (!cliente || !caballo) continue;
    const k = claveCruceFinanciero(carrera, cliente, caballo);
    const g = porGrupo.get(k) ?? { neto: 0, conteo: 0 };
    g.neto += it.ok ? it.bruto - it.monto : -it.monto;
    g.conteo += 1;
    porGrupo.set(k, g);
  }
  const out = new Map<string, NeteoCruceGrupo>();
  for (const [k, g] of porGrupo) {
    out.set(k, {
      neto: round2(g.neto),
      comisionNeta: g.neto > 0 ? round2(g.neto * (tasa / 100)) : 0,
      conteo: g.conteo,
    });
  }
  return out;
}

export type TicketMotor = BetSlipEntry & {
  /** Posición exhaustada del ejemplar según la Pagar (orden de llegada). */
  puesto_final: number | "SOC" | "EMP1";
  pizarra: PizarraCarrera;
  dividendos: Record<string, number> | null;
  /** Premio por tabla fija (Tablas): bruto = monto × premio_por_tabla. */
  premio_por_tabla?: number | null;
  /** Proporción de un Pareo (PP), ej. "10/8". Sin proporción = PARIDAD. */
  proporcion?: string | null;
};

export type ResultadoMotor = {
  ok: boolean;
  motivo?: string;
  /** Lo que recibe el jugador en mano (capital + ganancia neta − comisión). */
  totalClienteNeto: number;
  /** +/- del balance de la casa (jugada a favor = negativo, uno de sus rubros). */
  balanceBanca: number;
  /** Comisión efectiva cobrada por la casa. */
  gananciaCasa: number;
  /**
   * Lo que recibe el RIVAL (el segundo cliente o el banquero) en las modalidades
   * de enfrentamiento, donde el dinero se mueve entre dos clientes y no contra
   * la casa. 0 en las modalidades jugadas contra la pizarra.
   */
  totalRival?: number;
};

export type ProcesarTicket = (t: TicketMotor) => ResultadoMotor;

const PROCESADORES = new Map<string, ProcesarTicket>();

export function registrarProcesador(tipo: string, fn: ProcesarTicket): void {
  PROCESADORES.set(tipo, fn);
}

export function procesarTicket(t: TicketMotor): ResultadoMotor {
  const fn = PROCESADORES.get(t.tipo_jugada);
  if (!fn) {
    return {
      ok: false,
      motivo: "modalidad sin motor registrado: " + t.tipo_jugada,
      totalClienteNeto: 0,
      balanceBanca: 0,
      gananciaCasa: 0,
    };
  }
  return fn(t);
}
// ============================================================
// Dominio PAREOS (PP) — Multicaballos (Ej: "4X8" o "4-5X2-3")
// ============================================================
/**
 * Motor de LIQUIDACIÓN de Pareos.
 * REGLA: Gana el BANDO que logre colocar un caballo en la mejor posición de la pizarra.
 */
export function liquidarPareo(
  t: TicketMotor,
  tasaComision?: number | null
): ResultadoMotor {
  if (!t.caballo || !t.caballo.toUpperCase().includes("X")) {
    return {
      ok: false,
      motivo: "Pareo (PP) requiere sintaxis 'A X B' (ej. 4X8 o 4-5X2-3)",
      totalClienteNeto: 0,
      balanceBanca: t.monto,
      gananciaCasa: 0,
    };
  }

  // 1. Separar los bandos por la "X"
  const [strA, strB] = t.caballo.toUpperCase().split("X");
  
  // 2. Extraer los caballos de cada bando (Soporta separadores: guion, coma o slash)
  // Ej: "4-5" -> ["4", "5"]
  const bandoA = strA.split(/-|,|\//).map((s) => s.trim()).filter(Boolean);
  const bandoB = strB.split(/-|,|\//).map((s) => s.trim()).filter(Boolean);

  const fila = numerosPizarra(t.pizarra);

  // 3. Función interna: Buscar la mejor posición (la menor) de un bando entero
  const obtenerMejorPosicion = (bando: string[]) => {
    let mejorPos = 999;
    for (const cab of bando) {
      const pos = fila.indexOf(cab);
      if (pos !== -1 && pos < mejorPos) {
        mejorPos = pos;
      }
    }
    return mejorPos;
  };

  const posA = obtenerMejorPosicion(bandoA);
  const posB = obtenerMejorPosicion(bandoB);

  // 4. Determinar qué bando ganó
  let ganoA = false;
  if (posA < posB) ganoA = true;
  else if (posB < posA) ganoA = false;
  else {
    // Si ninguno entró en pizarra (ambos 999) o hubo empate técnico
    return {
      ok: true,
      motivo: `Empate técnico o sin figuración en ambos bandos. Devolución.`,
      totalClienteNeto: t.monto,
      balanceBanca: 0,
      gananciaCasa: 0,
    };
  }

  // 5. CÁLCULO DE PROPORCIÓN (Ej. 10/8)
  let multiplicador = 1; 
  // Si el cliente indicó UNA PROPORCIÓN (ej. "10/8") se ESTIMA el premio
  // multiplicando el monto por num2/num1. Sin proporción = PARIDAD (paga 2:1):
  if (t.proporcion && t.proporcion.includes("/")) {
    const [num1, num2] = t.proporcion.split("/").map(Number);
    // Asumimos que num2/num1 calcula el multiplicador de premio (ej. 8/10 = 0.8)
    multiplicador = num2 / num1; 
  }

  const tasa = Number.isFinite(Number(tasaComision)) && Number(tasaComision) >= 0
    ? Number(tasaComision)
    : COMISION_CASA.rate * 100;

  // 6. Liquidación final (Simplificado: Asume que el cliente apostó al Bando A)
  const acerto = ganoA; 

  if (acerto) {
    const bruto = t.monto + (t.monto * multiplicador); 
    const comision = (bruto - t.monto) > 0 ? round2((bruto - t.monto) * (tasa / 100)) : 0;
    
    return {
      ok: true,
      motivo: `Pareo ganado. Bando [${bandoA.join("-")}] venció a [${bandoB.join("-")}].` + 
              (comision > 0 ? ` (Comisión $${comision})` : ""),
      totalClienteNeto: round2(bruto - comision),
      balanceBanca: round2(t.monto - bruto + comision),
      gananciaCasa: comision,
    };
  } else {
    return {
      ok: false,
      motivo: `Pareo perdido. Bando [${bandoB.join("-")}] venció a [${bandoA.join("-")}].`,
      totalClienteNeto: 0,
      balanceBanca: t.monto,
      gananciaCasa: 0,
    };
  }
}