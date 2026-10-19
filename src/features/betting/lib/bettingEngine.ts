/**
 * Núcleo matemático de la plataforma — patrón Estrategia/Router.
 * procesarTicket(ticket) lee ticket.tipo_jugada y deriva al submódulo correcto.
 * CERO espagueti: cada modalidad vive en su propio submódulo.
 */
import { BetSlipEntry } from "@/shared/store/bet-slip";
import { PizarraCarrera, ResultadoPago, esPagoInmediato } from "@/features/liquidacion/lib/liquidacion";
// Detección de JUGADAS DE PUESTOS (las únicas que pueden cruzar): el mismo
// parser que usa liquidarOficial para despachar al motor de puestos.
import { parsearNomenclatura } from "@/features/taquilla/lib/nomenclatura";

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

/** Canoniza la nomenclatura de un NINI (ej. "2n" → "2N", "1y 2N" → "1Y2N").
 *  El separador se escribe en MAYÚSCULA porque así lo usa la casa ("2Y2N") en
 *  los planos y relaciones de WhatsApp. */
export function normalizarNini(tipoJugada: string): string {
  const info = parsearNini(tipoJugada);
  return info ? info.modalidad.replace(/y/g, "Y") : String(tipoJugada ?? "").trim();
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
  /**
   * Comisión (%) DEL GRUPO de este ticket — `comision_porcentaje` congelado al
   * vender. Cuando viene, manda sobre la tasa general: cada grupo cobra la suya.
   * Si ningún ticket del grupo la trae, se usa `tasaComisionPorcentaje`.
   */
  tasa?: number | null;
};

export type NeteoCruceGrupo = {
  /** Resultado neto del cliente (ganado − perdido) en la carrera. */
  neto: number;
  /**
   * BRUTO ganado en la carrera (suma de `bruto − monto` de los tickets
   * ganadores) — la "Ganancia Bruta" de la regla de negocio de la casa.
   */
  ganadoBruto: number;
  /**
   * Base sobre la que se cobra la comisión:
   *   CON cruces → el neto positivo (ganado − perdido, mínimo 0).
   *   SIN cruces → el BRUTO ganado (cada jugada ganadora paga comisión por el
   *                total, sin compensarse con las perdedoras de la carrera).
   */
  baseComision: number;
  /** Comisión SOBRE `baseComision` (0 si la base no es positiva). */
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
 * ¿Este ticket es una JUGADA DE PUESTOS (la única que puede cruzar)?
 *
 * El cruce financiero es EXCLUSIVO de Puestos: el cliente arriesga contra la
 * casa (o contra otro apostador) sobre la LLEGADA de un ejemplar, así que sus
 * ganancias y sus pérdidas dentro de la misma carrera se compensan.
 *
 * Todas las demás modalidades (Tablas Fijas, Marcas, Dupletas, Remates, WPS,
 * Pollas…) NO se cruzan: se cobran y se pagan completas, cada una con su
 * comisión sobre su propia ganancia.
 *
 * La detección es por SINTAXIS (parsearNomenclatura), que es la misma que usa
 * `liquidarOficial` para despachar al motor de puestos. Cualquier jugada que
 * ese parser no entiende NO es de puestos.
 */
export function esJugadaDePuestos(tipoJugada: string | null | undefined): boolean {
  return parsearNomenclatura(String(tipoJugada ?? "")) != null;
}

/**
 * Agrupa los tickets por (cliente, caballo, carrera) — o por (cliente, carrera)
 * cuando `agruparPorCliente` está activo, como pide la regla de PUESTOS — y
 * calcula la comisión neta de cada grupo (cruces financieros).
 *
 * REGLA DE NEGOCIO (ver docs y pruebas/cruces-puestos.test.ts):
 *   · CON cruces  → base de comisión = el NETO positivo (ganado − perdido).
 *   · SIN cruces  → base de comisión = el BRUTO GANADO (cada jugada ganadora
 *                   paga comisión sobre lo que ganó, sin compensarse).
 *   · En AMBOS casos el cliente recibe `neto − comisión`; lo único que cambia
 *     es la base gravable de la casa.
 *
 * Los tickets sin cliente (o sin caballo, si no se agrupa por cliente) no
 * participan del neteo: se mantienen con comisión por ticket.
 */
export function netearComisionCruce(
  items: NeteoCruceItem[],
  carrera: string | number,
  tasaComisionPorcentaje?: number | null,
  opts?: {
    /**
     * true ⇒ todas las jugadas de PUESTOS del cliente en la carrera se cruzan
     * en UN solo grupo (clave = cliente::carrera). false ⇒ el neteo histórico
     * por (cliente, caballo).
     */
    agruparPorCliente?: boolean;
    /**
     * false ⇒ SIN cruces: la comisión se cobra sobre el BRUTO ganado, no sobre
     * el neto. Default true (con cruces), que era el comportamiento previo.
     */
    permiteCruces?: boolean;
  }
): Map<string, NeteoCruceGrupo> {
  const tasa =
    Number.isFinite(Number(tasaComisionPorcentaje)) && Number(tasaComisionPorcentaje) >= 0
      ? Number(tasaComisionPorcentaje)
      : COMISION_CASA.rate * 100;
  const permiteCruces = opts?.permiteCruces !== false;
  const porCliente = opts?.agruparPorCliente === true;
  const porGrupo = new Map<
    string,
    { neto: number; ganadoBruto: number; conteo: number; tasa: number | null }
  >();
  for (const it of items) {
    const cliente = String(it.cliente ?? "").trim();
    const caballo = String(it.caballo ?? "").trim();
    // Sin cliente no hay a quién netear; sin caballo solo se puede agrupar por
    // cliente (el cruce de PUESTOS no necesita el ejemplar).
    if (!cliente || (!caballo && !porCliente)) continue;
    const k = porCliente
      ? [String(carrera ?? "").trim().toUpperCase(), cliente].join("::")
      : claveCruceFinanciero(carrera, cliente, caballo);
    const g = porGrupo.get(k) ?? { neto: 0, ganadoBruto: 0, conteo: 0, tasa: null };
    // Bruto = capital de vuelta + ganancia; bruto − monto = GANANCIA BRUTA.
    // Perdedor: −monto (la pérdida bruta).
    g.neto += it.ok ? it.bruto - it.monto : -it.monto;
    if (it.ok && it.bruto - it.monto > 0) g.ganadoBruto += it.bruto - it.monto;
    g.conteo += 1;
    // La tasa del GRUPO manda: se toma la primera del grupo que venga definida
    // (numerica y >= 0). Si no hay, cae a la general en el loop de salida.
    if (g.tasa == null && it.tasa != null) {
      const t = Number(it.tasa);
      if (Number.isFinite(t) && t >= 0) g.tasa = t;
    }
    porGrupo.set(k, g);
  }
  const out = new Map<string, NeteoCruceGrupo>();
  for (const [k, g] of porGrupo) {
    const tasaGrupo = g.tasa != null ? g.tasa : tasa;
    // CON cruces → base = neto positivo · SIN cruces → base = bruto ganado.
    const base = permiteCruces ? (g.neto > 0 ? g.neto : 0) : g.ganadoBruto;
    out.set(k, {
      neto: round2(g.neto),
      ganadoBruto: round2(g.ganadoBruto),
      baseComision: round2(base),
      comisionNeta: base > 0 ? round2(base * (tasaGrupo / 100)) : 0,
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

/** Veredicto de UN bloque de una COMBINADA/COMPUESTA (hoja o anidada). */
export type EstadoBloque = "GANA" | "PIERDE" | "EMPATA" | "ANULADA";

/**
 * Detalle de un bloque de jugada, para que la UI estime CADA bloque y su
 * resultado por separado ("1P Y 1Y2N" = bloque 1: 1P · bloque 2: 1Y2N, y ese
 * segundo bloque son dos jugadas: 1P y 2N).
 *
 * · HOJA (1p, 2n, PP…):                    bruto = 2×monto (GANA) | monto (ANULADA/EMPATA) | 0 (PIERDE)
 * · NODO (COMBINADA/COMPUESTA anidada):    reparte su monto 50/50 entre `bloques` y suma.
 */
export type BloqueDetalleResultado = {
  /** Etiqueta del bloque, p. ej. "1p", "1y2n". */
  fuente: string;
  /** Monto repartido a este bloque (mitad del bloque padre). */
  monto: number;
  /** Bruto devuelto por este bloque. */
  bruto: number;
  estado: EstadoBloque;
  motivo: string;
  /** Sub-bloques de una COMBINADA/COMPUESTA anidada (hojas sin `bloques`). */
  bloques?: BloqueDetalleResultado[];
};

export type ResultadoMotor = {
  ok: boolean;
  motivo?: string;
  /**
   * La jugada NO se puede decidir todavía: el resultado dice que el ejemplar
   * PODIA ganar pero falta el dato que cuantifica el premio (p. ej. la
   * matriz de dividendos de Win/Place/Show sin cargar).
   *
   * Existe porque `ok: false` significa "PERDEDOR" para todos los consumidores
   * (`saldos.ts` escribe estado Perdedor y premio 0). Confundir "no sabemos
   * cuánto paga" con "perdió" cobra $0 a una jugada ganadora, y como el estado
   * queda escrito en la base ya no se corrige solo. Quien llama debe dejar el
   * ticket PENDIENTE y avisar, nunca marcarlo perdido.
   */
  indeterminado?: boolean;
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
  /**
   * Estimación POR BLOQUE de una COMBINADA/COMPUESTA ("1P Y 1Y2N" → bloque 1:
   * 1P, bloque 2: 1Y2N = 1P y 2N). Ausente en jugadas de un solo bloque.
   */
  bloquesDetalle?: BloqueDetalleResultado[];
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
  // La casa escribe el pareo con "X" ("4X8") o con "*" ("1*6"): ambos separan
  // los dos bandos. Sin divisor no hay pareo que resolver.
  const cabPareo = String(t.caballo ?? "").toUpperCase();
  if (!cabPareo || (!cabPareo.includes("X") && !cabPareo.includes("*"))) {
    return {
      ok: false,
      motivo: "Pareo (PP) requiere sintaxis 'A X B' (ej. 4X8 o 4-5X2-3)",
      totalClienteNeto: 0,
      balanceBanca: t.monto,
      gananciaCasa: 0,
    };
  }

  // 1. Separar los bandos por la "X" (o el "*" de la casa)
  const [strA, strB] = cabPareo.split(/\s*[X*]\s*/);
  
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