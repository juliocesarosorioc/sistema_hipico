/**
 * PuestosEngine — el UNICO motor de las Jugadas de Puestos.
 *
 * Todas las modalidades de esta casa son variantes de una misma pregunta
 * ("llegada de los ejemplares"), asi que se resuelven aqui y en ningun otro
 * lado. No crear motores huerfanos: si una jugada nueva depende de la posicion
 * de llegada, se agrega como modalidad de este archivo, no como motor aparte.
 *
 * Las 5 modalidades (gramatica en src/lib/taquilla/nomenclatura.ts):
 *
 *  1. PUESTO_PURO "1p" · PELO_A_PELO "PP" al 1er lugar
 *       1p  GANA si llega 1º. Con empate oficial en 1º GANA y se PAGA.
 *       PP  GANA si llega 1º en solitario. Con empate oficial en 1º se ANULA
 *           y se devuelve el capital a los dos lados.
 *  2. MATCHUP "1x2" · "1,4 x 3,5"
 *       Gana el lado cuyo ejemplar llega en MEJOR posicion. Riesgo y pago 1 a 1.
 *  3. A_PREMIO "10a8 el 4" · "10/6.5 el 2"
 *       Gana si CUALQUIER ejemplar llega 1º, y cobra la proporcion pactada.
 *  4. MATCHUP_PROPORCION "10a8 la 2x3"
 *       El jugador va con el 2 risking 10, el banquero con el 3 risking 8.
 *       Gana el que llega mejor; el que gana se lleva la posta del otro.
 *  5. NINI "2n" y PUESTO_PURO "3p" con VARIOS ejemplares "2n el 3, 4 y 8"
 *       Gana si CUALQUIERa ejemplar cumple la condicion matematica.
 *
 * MODELO FINANCIERO (bote). Todo se reduce a dos puestas en un bote:
 *
 *      puestaJugador = monto
 *      puestaRival   = monto * (rival / jugador)   si hay proporcion, si no = monto
 *      bote          = puestaJugador + puestaRival
 *
 *  - Gana el jugador  -> recibe el bote completo.  Neto = puestaRival.
 *    En "10a8" (100) gana 8 por cada 10 que arriesgo: recibe 180, neto +80. Es
 *    exactamente lo que dice la casa: "el jugador GANA 8".
 *  - Gana el rival    -> el jugador recibe 0. Neto = -100. "el banquero gana 10".
 *  - Se anula         -> cada lado recupera su puesta. Neto 0 para ambos.
 *
 * La comision de la casa se aplica SOLO sobre la ganancia bruta, y el
 * balanceBanca es el inverso matematico del bruto del cliente (juego de suma
 * cero). El tanto del rival se reporta aparte en `totalRival` porque en las
 * modalidades 2 y 4 el dinero se mueve entre dos clientes, no contra la casa.
 */
import { registrarProcesador, TicketMotor, ResultadoMotor, COMISION_CASA } from "../bettingEngine";
import type { PizarraCarrera } from "../liquidacion";
import {
  parsearNomenclatura,
  etiquetaModalidad,
  type Nomenclatura,
  type ModalidadPuestos,
  type Proporcion,
} from "../taquilla/nomenclatura";
import { parsearEjemplaresPorCliente } from "../taquilla/reparto";

/** Tasa porcentual por defecto de la casa (COMISION_CASA.rate = 0.05 -> 5%). */
const TASA_DEFECTO = COMISION_CASA.rate * 100;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/* ============ Pizarra: ejemplo -> posicion ============ */

const CAMPOS_PIZARRA: (keyof PizarraCarrera)[] = [
  "primero", "segundo", "tercero", "cuarto",
  "quinto", "sexto", "septimo", "octavo",
];

/**
 * Mapa ejemplo -> puesto. PizarraCarrera trae los 8 primeros lugares, que es
 * todo lo que estas modalidades necesitan para decidir.
 */
export function posicionesDePizarra(pizarra: PizarraCarrera | null | undefined): Map<string, number> {
  const mapa = new Map<string, number>();
  if (!pizarra) return mapa;
  CAMPOS_PIZARRA.forEach((campo, i) => {
    const bruto = (pizarra as Record<string, unknown>)[campo];
    if (bruto === null || bruto === undefined || bruto === "") return;
    // Puede venir como numero o como string.
    mapa.set(String(bruto).trim(), i + 1);
  });
  return mapa;
}

/** Hay empate oficial en la posicion pedida? */
function hayEmpateEn(pizarra: PizarraCarrera | null | undefined, puesto: number): boolean {
  if (!pizarra) return false;
  const empates = pizarra.empates ?? [];
  return empates.some((e) => Number(e) === puesto);
}

/**
 * Mejor posicion de un conjunto de ejemplares y quien la Logs. Infinity = el
 * ejemplar no figura en la pizarra, es decir llego peor que el 8º.
 */
function mejorPosicion(ejemplares: string[], mapa: Map<string, number>): { pos: number; de: string | null } {
  let pos = Infinity;
  let de: string | null = null;
  for (const ej of ejemplares) {
    const clave = String(ej).trim();
    if (!clave) continue;
    const p = mapa.has(clave) ? (mapa.get(clave) as number) : Infinity;
    if (p < pos) {
      pos = p;
      de = clave;
    }
  }
  return { pos, de };
}

/* ============ Bote ============ */

type Bote = { jugador: number; rival: number; total: number };

/**
 * El bote de la jugada. Sin proporcion el rival arriesga lo mismo (a la par);
 * con proporcion arriesga la fraccion pactada: "10a8" con 100 pone 100 y
 * enfrenta 80, "6.5a10" con 100 pone 100 y enfrenta 153.85.
 */
function boteDe(monto: number, prop: Proporcion | null): Bote {
  const jugador = monto;
  const rival = prop ? (monto * prop.rival) / prop.jugador : monto;
  return { jugador, rival, total: jugador + rival };
}

/* ============ Resolucion de la jugada ============ */

type Decision = {
  ganador: "jugador" | "rival";
  /** Se devuelve la puesta a cada lado: nadie gana ni pierde. */
  anulada: boolean;
  motivo: string;
};

/** Une la gramatica de la columna JUGADA con la de la columna CABALLO. */
type Resuelta = {
  modalidad: ModalidadPuestos;
  puesto: number | null;
  esNini: boolean;
  proporcion: Proporcion | null;
  ladoA: string[];
  ladoB: string[];
  bloques: Nomenclatura[] | null;
  tramos: [number, number] | null;
};

function resolverJugada(nom: Nomenclatura, caballo: string): Resuelta {
  const col = parsearEjemplaresPorCliente(caballo) ?? {
    izquierda: [] as string[],
    derecha: [] as string[],
    hayDivisor: false,
  };
  const ladoA = nom.ladoA.length > 0 ? nom.ladoA : col.izquierda;
  const ladoB = nom.ladoB.length > 0 ? nom.ladoB : col.derecha;

  let modalidad = nom.modalidad;

  // Un `x` en la columna CABALLO son dos clientes enfrentados, asi que es un
  // enfrentamiento aunque la columna JUGADA solo traiga la proporcion
  // (forma legacy "2x3 10/8", o "10/8" con caballo "3x5").
  if (col.hayDivisor && modalidad !== "MATCHUP" && modalidad !== "MATCHUP_PROPORCION") {
    modalidad = nom.proporcion ? "MATCHUP_PROPORCION" : "MATCHUP";
  }

  return {
    modalidad,
    puesto: nom.puesto,
    esNini: nom.esNini,
    proporcion: nom.proporcion,
    ladoA,
    ladoB,
    bloques: nom.bloques,
    tramos: nom.tramos ?? null,
  };
}

/* ---- Modalidades 1, 3 y 5: condicion posicional sobre ejemplares ---- */

/**
 * Gana si CUALQUIERa ejemplar cumple la condicion. Para los ninis se conserva
 * la regla legacy: terminar JUSTO en N devuelve el capital.
 */
function winningAny(
  puestos: number[],
  n: number,
  esNini: boolean,
  etiqueta: string
): Decision {
  if (puestos.length === 0) {
    return { ganador: "rival", anulada: false, motivo: etiqueta + ": sin ejemplares en la pizarra" };
  }
  const mejor = Math.min(...puestos);
  const cumple = esNini ? mejor < n : mejor <= n;
  if (cumple) {
    const signo = esNini ? "<" : "<=";
    return {
      ganador: "jugador",
      anulada: false,
      motivo: etiqueta + " GANA: mejor posicion " + mejor + " cumple " + signo + n,
    };
  }
  if (esNini && mejor === n) {
    return {
      ganador: "rival",
      anulada: true,
      motivo: etiqueta + " EMPATA (==" + n + "): se devuelve el capital",
    };
  }
  return {
    ganador: "rival",
    anulada: false,
    motivo: etiqueta + " PIERDE: mejor posicion " + mejor + " no cumple " + (esNini ? "<" : "<=") + n,
  };
}

/** 1p: gana si llega 1º. Si hay empate oficial en 1º GANA y se paga. */
function puestoPuro(puestos: number[], n: number, esNini: boolean, empate1: boolean): Decision {
  if (n === 1 && !esNini) {
    if (puestos.length > 0 && puestos.includes(1)) {
      return {
        ganador: "jugador",
        anulada: false,
        motivo: empate1
          ? "PUESTO 1p GANA con empate oficial en 1º (se paga, no se anula)"
          : "PUESTO 1p GANA: 1er lugar",
      };
    }
    return { ganador: "rival", anulada: false, motivo: "PUESTO 1p PIERDE: no llegó 1º" };
  }
  return winningAny(puestos, n, esNini, esNini ? "NINI" : "PUESTO");
}

/** PP: gana si llega 1º EN SOLITARIO. Empate oficial en 1º = se anula. */
function peloAPelo(puestos: number[], empate1: boolean): Decision {
  const hay1 = puestos.includes(1);
  if (empate1) {
    return {
      ganador: "rival",
      anulada: true,
      motivo: hay1
        ? "PP 1º con empate oficial: se ANULA y se devuelve el capital"
        : "PP sin 1º propio y con empate oficial: se ANULA",
    };
  }
  if (hay1) return { ganador: "jugador", anulada: false, motivo: "PP GANA: 1er lugar en solitario" };
  return { ganador: "rival", anulada: false, motivo: "PP PIERDE: no llegó 1º" };
}

/** A Premio: gana si CUALQUIERa ejemplar cruza la meta de primero. */
function aPremio(puestos: number[], empate1: boolean, prop: Proporcion | null): Decision {
  const et = "A PREMIO" + (prop ? " (" + prop.jugador + "a" + prop.rival + ")" : "");
  if (empate1) {
    return { ganador: "rival", anulada: true, motivo: et + " empate oficial en 1º: se ANULA" };
  }
  if (puestos.includes(1)) {
    return { ganador: "jugador", anulada: false, motivo: et + " GANA: un ejemplar llegó 1º" };
  }
  return { ganador: "rival", anulada: false, motivo: et + " PIERDE: ningun ejemplar llegó 1º" };
}

/* ---- Modalidades 2 y 4: enfrentamiento por mejor posicion ---- */

/**
 * Gana el lado que llega mejor posicionado.
 *
 * Empate de posiciones: la casa no lo define. Se ANULA y se devuelven ambas
 * puestas, que es la unica salida que no favorece a ningun lado. Si los dos
 * lados estan fuera de la pizarra la pizarra no alcanza para desempatar, y
 * tambien se anula. PENDIENTE de regla de casa.
 */
function enfrentamiento(
  ladoA: string[],
  ladoB: string[],
  mapa: Map<string, number>,
  etiqueta: string
): Decision {
  // Ojo: un ejemplar FUERA de la pizarra (llego peor que el 8º) no es lo mismo
  // que un lado sin ejemplares. Solo un lado realmente vacio pierde por falta
  // de apuesta; si ambos estan fuera, la pizarra no alcanza y se anula.
  if (ladoA.length === 0) {
    return { ganador: "rival", anulada: false, motivo: etiqueta + " PIERDE: el jugador no tiene ejemplares" };
  }
  if (ladoB.length === 0) {
    return { ganador: "jugador", anulada: false, motivo: etiqueta + " GANA: el rival no tiene ejemplares" };
  }
  const a = mejorPosicion(ladoA, mapa);
  const b = mejorPosicion(ladoB, mapa);
  const lugar = (p: number) => (p === Infinity ? "fuera de pizarra" : String(p));

  if (a.pos < b.pos) {
    return {
      ganador: "jugador",
      anulada: false,
      motivo:
        etiqueta + " GANA: el " + a.de + " (" + lugar(a.pos) + ") llegó mejor que el " + b.de + " (" + lugar(b.pos) + ")",
    };
  }
  if (a.pos > b.pos) {
    return {
      ganador: "rival",
      anulada: false,
      motivo:
        etiqueta + " PIERDE: el " + b.de + " (" + lugar(b.pos) + ") llegó mejor que el " + a.de + " (" + lugar(a.pos) + ")",
    };
  }
  return {
    ganador: "rival",
    anulada: true,
    motivo:
      etiqueta + " EMPATE (" + a.de + " y " + b.de + " en la misma posicion: " + lugar(a.pos) + "): se ANULA y se devuelven ambas puestas",
  };
}

/* ============ Envoltorio de Comision y Suma Cero ============ */

/** Exportado para el Motor Universal (oficiales.ts). `totalRival` es 0 en las
 *  modalidades contra la casa y el tanto del banquero en 2 y 4. */
export function finalizar(
  ok: boolean,
  motivo: string,
  clienteBruto: number,
  monto: number,
  tasa: number,
  totalRival?: number
): ResultadoMotor {
  const gananciaBruta = clienteBruto - monto;
  const comision = gananciaBruta > 0 ? gananciaBruta * (tasa / 100) : 0;
  return {
    ok,
    motivo: motivo + (comision > 0 ? " · comisión casa $" + round2(comision) : ""),
    totalClienteNeto: round2(clienteBruto - comision),
    // Inverso bruto del jugador + comision retenida: monto - clienteBruto + comision
    balanceBanca: round2(monto - clienteBruto + comision),
    gananciaCasa: round2(comision),
    totalRival: round2(totalRival ?? 0),
  };
}

/**
 * Convierte una decision + bote en el resultado del jugador y del rival.
 *
 * `totalRival` solo se informa en las modalidades de ENFRENTAMIENTO, donde
 * hay un segundo cliente de verdad. En las jugadas contra la pizarra el rival
 * es la casa y su apuesta no es el pago de ningun cliente, asi que se reporta 0.
 */
function aplicar(
  decision: Decision,
  bote: Bote,
  monto: number,
  tasa: number,
  esEnfrentamiento: boolean
): ResultadoMotor {
  const brutoJugador = decision.anulada ? bote.jugador : decision.ganador === "jugador" ? bote.total : 0;
  const brutoRival = !esEnfrentamiento
    ? 0
    : decision.anulada
    ? bote.rival
    : decision.ganador === "rival"
    ? bote.total
    : 0;
  // Una jugada anulada devuelve el capital pero NO es ganadora: se mantiene el
  // ok:false del legacy para que los reportes no la cuenten como premio.
  const gano = !decision.anulada && decision.ganador === "jugador";
  return finalizar(gano, decision.motivo, brutoJugador, monto, tasa, brutoRival);
}

/* ============ COMBINADA / COMPUESTA: 50/50 por bloques ============ */

function porBloques(
  r: Resuelta,
  mapa: Map<string, number>,
  empate1: boolean,
  monto: number,
  tasa: number
): ResultadoMotor | null {
  if (!r.bloques || r.bloques.length === 0) return null;

  // Bloqueo de pizarra de las COMBINADAS: el segundo tramo debe ser el mismo
  // puesto que el primero o su inmediato superior.
  if (r.tramos) {
    const [p1, p2] = r.tramos;
    if (p2 !== p1 && p2 !== p1 + 1) {
      return {
        ok: false,
        motivo:
          "BLOQUEO DE PIZARRA: la parte 2 (" + p2 + ") debe ser igual a la parte 1 (" + p1 +
          ") o su inmediato superior (P1+1). La jugada no se registra.",
        totalClienteNeto: 0,
        balanceBanca: 0,
        gananciaCasa: 0,
        totalRival: 0,
      };
    }
  }

  const mitad = monto / 2;
  const puestos = r.ladoA.map((c) => (mapa.has(c) ? (mapa.get(c) as number) : Infinity));
  let brutoTotal = 0;
  const motivos: string[] = [];

  for (const bloque of r.bloques) {
    // Cada tramo hereda los ejemplares del lado del jugador: "1y2n el 3 y 5"
    // apuesta a 1º y a 2º sobre los mismos dos caballos.
    const d = bloque.esNini
      ? winningAny(puestos, bloque.puesto as number, true, "NINI " + bloque.fuente)
      : puestoPuro(puestos, bloque.puesto as number, false, empate1);
    const bruto = d.anulada ? mitad : d.ganador === "jugador" ? mitad * 2 : 0;
    brutoTotal += bruto;
    motivos.push(d.motivo);
  }

  const estado = brutoTotal > monto ? "GANADORA" : brutoTotal === monto ? "EMPATA" : "PERDIDA";
  // Solo es ganadora si el jugador sale por encima de lo que puso. Recuperar
  // capital en un tramo y perder el otro NO es ganar: el legacy contaba
  // cualquier bruto > 0 y eso inflaba los premios de los reportes.
  return finalizar(
    brutoTotal > monto,
    (r.modalidad === "COMBINADA" ? "COMBINADA" : "COMPUESTA") + " (" + r.bloques.map((b) => b.fuente).join(" y ") + ") " + estado + ": " + motivos.join(" | "),
    brutoTotal,
    monto,
    tasa,
    0
  );
}

/* ============ PuestosEngine ============ */

/**
 * Liquida cualquier jugada de Puestos. Punto de entrada UNICO: la columna
 * JUGADA se parsea con la nomenclatura y la columna CABALLO aporta los
 * ejemplares que la jugada no trae.
 */
export function liquidarPuestos(t: TicketMotor, tasaComision?: number | null): ResultadoMotor {
  const tasa =
    typeof tasaComision === "number" && isFinite(tasaComision) && tasaComision >= 0
      ? tasaComision
      : TASA_DEFECTO;

  const nom = parsearNomenclatura(t.tipo_jugada);
  if (!nom) {
    return {
      ok: false,
      motivo: "Nomenclatura no reconocida: " + t.tipo_jugada,
      totalClienteNeto: 0,
      balanceBanca: t.monto,
      gananciaCasa: 0,
      totalRival: 0,
    };
  }

  const r = resolverJugada(nom, String(t.caballo ?? ""));
  const mapa = posicionesDePizarra(t.pizarra);
  const empate1 = hayEmpateEn(t.pizarra, 1);
  const bote = boteDe(t.monto, r.proporcion);

  /* Si la pizarra todavia no esta cargada pero el ticket trae la posicion
     exhaustada del unico ejemplar, se usa como respaldo (apuestas de un solo
     caballo cargadas a mano). Con varios ejemplares no alcanza y se pierde. */
  if (mapa.size === 0 && r.ladoA.length === 1 && typeof t.puesto_final === "number") {
    mapa.set(r.ladoA[0], t.puesto_final);
  }

  if (r.bloques) {
    const porBloq = porBloques(r, mapa, empate1, t.monto, tasa);
    if (porBloq) return porBloq;
  }

  const puestosA = r.ladoA.map((c) => (mapa.has(c) ? (mapa.get(c) as number) : Infinity));

  switch (r.modalidad) {
    case "PELO_A_PELO":
      return aplicar(peloAPelo(puestosA, empate1), bote, t.monto, tasa, false);

    case "A_PREMIO":
      return aplicar(aPremio(puestosA, empate1, r.proporcion), bote, t.monto, tasa, false);

    case "MATCHUP":
      return aplicar(enfrentamiento(r.ladoA, r.ladoB, mapa, "ENFRENTAMIENTO"), bote, t.monto, tasa, true);

    case "MATCHUP_PROPORCION":
      return aplicar(
        enfrentamiento(r.ladoA, r.ladoB, mapa, "ENFRENTAMIENTO C/PROPORCION"),
        bote,
        t.monto,
        tasa,
        true
      );

    case "NINI":
      return aplicar(winningAny(puestosA, r.puesto as number, true, "NINI"), bote, t.monto, tasa, false);

    case "PUESTO_PURO":
      return aplicar(puestoPuro(puestosA, r.puesto as number, r.esNini, empate1), bote, t.monto, tasa, false);

    default:
      return {
        ok: false,
        motivo: "Modalidad sin liquidar: " + (r.modalidad as string) + " (" + etiquetaModalidad(r.modalidad) + ")",
        totalClienteNeto: 0,
        balanceBanca: t.monto,
        gananciaCasa: 0,
        totalRival: 0,
      };
  }
}

export function procesarPuestos(t: TicketMotor): ResultadoMotor {
  return liquidarPuestos(t);
}

/* El nombre canonico es "puestos". Los alias se conservan para que cualquier
  _llamada por nombre_ legado siga llegando a este mismo motor, y no a otro. */
registrarProcesador("puestos", procesarPuestos);
registrarProcesador("puestos-puro", procesarPuestos);
registrarProcesador("nini", procesarPuestos);
registrarProcesador("a-premio", procesarPuestos);
registrarProcesador("pareo", procesarPuestos);
registrarProcesador("cruce", procesarPuestos);
registrarProcesador("combinada", procesarPuestos);
registrarProcesador("compuesta", procesarPuestos);
