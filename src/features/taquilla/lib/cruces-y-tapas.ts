/**
 * ============================================================================
 * MOTOR UNIFICADO DE CRUCES, TAPAS Y CLUSTERS (`cruces-y-tapas.ts`)
 * ============================================================================
 *
 * Implementación exacta y determinista de `Gestión de Planos_2.html`:
 *  1. `TABLA_JUGADAS`: Tabla oficial de jugadas (`1P`..`6Y7NY7N`, `PP`, `10A1`..`10A9.5`).
 *  2. `_rolEfectivo`: Canonicalización de pares simétricos (`PP`) preservando asimetría en `10Ax`.
 *  3. `_comprometidoSimuladoCli`: Cobertura de riesgo en vivo por clusters de caballos
 *     simulando posiciones de llegada (`1..10` y `99` fuera de pizarra) y liberando tapas.
 *  4. `calcularReembolsosCruce`: Reembolso de comisión en modalidad `CON CRUCES` al liquidar
 *     o previsualizar resultados:
 *       reembolsoCruce = redondearCentavos((comisionPct / 100) * min(brutoGanado, brutoPerdido))
 */

import {
  aCentavos,
  deCentavos,
  redondearCentavos,
  sumarDinero,
  restarDinero,
  calcularComisionExacta,
  calcularProporcionExacta,
} from "@/shared/lib/dinero";
import {
  normalizarJugadaPremio,
  getMejorPos,
  extraerEjemplaresMultiples,
  calcularRiesgoCliente2,
  TABLA_JUGADAS,
  type ReglaTablaJugada,
  normalizarCodigoJugada,
  obtenerReglaTablaJugada,
  buscarJugadaPorComponentes,
  calcularMultiplicadorJugada,
  parsearNomenclatura,
  type Nomenclatura,
} from "@/features/motores/lib/puestos";

export {
  normalizarJugadaPremio,
  getMejorPos,
  extraerEjemplaresMultiples,
  calcularRiesgoCliente2,
  TABLA_JUGADAS,
  type ReglaTablaJugada,
  normalizarCodigoJugada,
  obtenerReglaTablaJugada,
  buscarJugadaPorComponentes,
  calcularMultiplicadorJugada,
};

export type RolJugada = "juega" | "da";

export type ModalidadCruceCarrera = "con_cruces" | "sin_cruces";

/** Normaliza el nombre de un cliente para cruces e identificación. */
export function normalizarNombreCliente(nombre: unknown): string {
  return String(nombre ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

export type JugadaActivaSimulacion = {
  id?: string | number;
  jugador: string;
  tercio?: string;
  jugada: string;
  caballo: string;
  monto: number;
  comisionPct?: number;
  estado?: string | null;
  anulada?: boolean | null;
  esAdelantada?: boolean | null;
};

/**
 * Extrae los ejemplares involucrados en una jugada (`"3"`, `"1y2"`, `"3y4"`, `"3x6"`, `"1,2x3"`).
 * En jugadas posicionales de puestos (`1P`..`6Y7NY7N`, `2N`, `1Y2N`, etc.), cualquier lista de
 * ejemplares (`1y2`, `1-2`, `1,2`, `1x2`, `3y4`, `2 5 8`) pertenece íntegramente a Cliente 1 (`c1`),
 * mientras Cliente 2 actúa como Dador (`c2 = []`).
 */
export function extraerCaballosJugada(caballoRaw: string | null | undefined, jugadaRaw?: string | null): {
  c1: string[];
  c2: string[];
  todos: string[];
} {
  const texto = String(caballoRaw ?? "").trim() || String(jugadaRaw ?? "").trim();
  if (!texto) return { c1: ["1"], c2: [], todos: ["1"] };

  const cod = normalizarCodigoJugada(jugadaRaw);
  const regla = obtenerReglaTablaJugada(cod);
  const esPosicionalPuestos =
    Boolean(regla) && !regla?.esPP && regla?.factor10Ax == null && !/^\d+X\d+$/i.test(String(jugadaRaw ?? "").trim());

  const extraerNums = (s: string) =>
    extraerEjemplaresMultiples(s).map((n) => String(n));

  if (esPosicionalPuestos) {
    const c1 = extraerNums(texto);
    const unicos = c1.length ? [...new Set(c1)] : ["1"];
    return { c1: unicos, c2: [], todos: unicos };
  }

  const partes = texto.split(/\s*(?:x|\*|\bpor\b)\s*/i);

  if (partes.length >= 2) {
    const c1 = extraerNums(partes[0]);
    const c2 = extraerNums(partes[1]);
    const todos = [...new Set([...c1, ...c2])];
    return { c1: c1.length ? c1 : ["1"], c2, todos: todos.length ? todos : ["1"] };
  }

  const c1 = extraerNums(partes[0]);
  return { c1: c1.length ? c1 : ["1"], c2: [], todos: c1.length ? [...new Set(c1)] : ["1"] };
}

/**
 * `_rolEfectivo`:
 * Para jugadas simétricas como `PP` (mano a mano 10/10), canonicaliza el orden del par `(min, max)`
 * e invierte el rol si los caballos estaban en orden descendente (`6x3` -> `3x6` con rol opuesto).
 * Para `10Ax` preserva estrictamente la asimetría entre `C1` y `C2`.
 */
export function _rolEfectivo(
  codigoJugada: string,
  c1: string[],
  c2: string[],
  rolOriginal: RolJugada
): { c1Canon: string[]; c2Canon: string[]; rol: RolJugada; invertido: boolean } {
  const cod = normalizarCodigoJugada(codigoJugada);
  const regla = obtenerReglaTablaJugada(cod);
  const esAsimetrico10Ax = Boolean(regla?.factor10Ax && regla.factor10Ax !== 10);

  if (!esAsimetrico10Ax && c1.length === 1 && c2.length === 1 && (cod === "PP" || /^\d+X\d+$/i.test(codigoJugada))) {
    const n1 = Number(c1[0]);
    const n2 = Number(c2[0]);
    if (Number.isFinite(n1) && Number.isFinite(n2) && n1 > n2) {
      return {
        c1Canon: [String(n2)],
        c2Canon: [String(n1)],
        rol: rolOriginal === "juega" ? "da" : "juega",
        invertido: true,
      };
    }
  }
  return {
    c1Canon: c1,
    c2Canon: c2,
    rol: rolOriginal,
    invertido: false,
  };
}

/**
 * Evalúa el resultado neto de una jugada individual dadas las posiciones simuladas de llegada
 * (`mapaPosiciones: Map<caballo, posicion 1..10 | 99>`).
 * Devuelve `{ netoJuega, netoDa, brutoGanadoJuega, brutoGanadoDa }`.
 */
export function evaluarJugadaEnEscenario(
  j: JugadaActivaSimulacion,
  mapaPosiciones: Map<string, number>,
  comisionPctDefault = 5
): {
  netoJuega: number;
  netoDa: number;
  brutoGanadoJuega: number;
  brutoPerdidoJuega: number;
  brutoGanadoDa: number;
  brutoPerdidoDa: number;
} {
  const monto = redondearCentavos(j.monto);
  if (monto <= 0) {
    return {
      netoJuega: 0,
      netoDa: 0,
      brutoGanadoJuega: 0,
      brutoPerdidoJuega: 0,
      brutoGanadoDa: 0,
      brutoPerdidoDa: 0,
    };
  }

  const comPct = j.comisionPct != null ? Number(j.comisionPct) : comisionPctDefault;
  const cod = normalizarCodigoJugada(j.jugada);
  const { c1, c2 } = extraerCaballosJugada(j.caballo, j.jugada);
  const canon = _rolEfectivo(cod, c1, c2, "juega");

  const posMejor = (lista: string[]): number => {
    if (!lista.length) return 99;
    let m = 99;
    for (const cab of lista) {
      const p = mapaPosiciones.get(String(cab)) ?? 99;
      if (p < m) m = p;
    }
    return m;
  };

  const p1 = posMejor(canon.c1Canon);
  const p2 = posMejor(canon.c2Canon);
  const regla = obtenerReglaTablaJugada(cod);
  const factorRival = regla?.factor10Ax != null ? regla.factor10Ax : 10;
  const riesgoJuega = monto;
  const riesgoDa = factorRival !== 10 ? calcularProporcionExacta(monto, factorRival, 10) : monto;

  // Caso 1: Mano a mano (hay caballos en ambos lados C1 y C2)
  if (canon.c2Canon.length > 0) {
    if (p1 === p2) {
      return {
        netoJuega: 0,
        netoDa: 0,
        brutoGanadoJuega: 0,
        brutoPerdidoJuega: 0,
        brutoGanadoDa: 0,
        brutoPerdidoDa: 0,
      };
    }
    const ganaCanon1 = p1 < p2;
    const ganaJuegaOriginal = canon.invertido ? !ganaCanon1 : ganaCanon1;

    if (ganaJuegaOriginal) {
      const com = calcularComisionExacta(riesgoDa, comPct);
      const netoJ = restarDinero(riesgoDa, com);
      return {
        netoJuega: netoJ,
        netoDa: -riesgoDa,
        brutoGanadoJuega: riesgoDa,
        brutoPerdidoJuega: 0,
        brutoGanadoDa: 0,
        brutoPerdidoDa: riesgoDa,
      };
    } else {
      const com = calcularComisionExacta(riesgoJuega, comPct);
      const netoD = restarDinero(riesgoJuega, com);
      return {
        netoJuega: -riesgoJuega,
        netoDa: netoD,
        brutoGanadoJuega: 0,
        brutoPerdidoJuega: riesgoJuega,
        brutoGanadoDa: riesgoJuega,
        brutoPerdidoDa: 0,
      };
    }
  }

  // Caso 2: Jugada posicional o proporción 10Ax sobre C1 contra Dador (C2)
  const tramos = regla?.tramos ?? [{ puesto: 1, esNini: false }];
  const nTramos = tramos.length;
  let centavosBrutoJuega = 0;
  let centavosBrutoDa = 0;

  const centavosJuegaTotal = aCentavos(riesgoJuega);
  const centavosDaTotal = aCentavos(riesgoDa);

  for (let i = 0; i < nTramos; i++) {
    const t = tramos[i];
    // Reparto exacto del tramo
    const cJ =
      i === nTramos - 1
        ? centavosJuegaTotal - Math.floor(centavosJuegaTotal / nTramos) * (nTramos - 1)
        : Math.floor(centavosJuegaTotal / nTramos);
    const cD =
      i === nTramos - 1
        ? centavosDaTotal - Math.floor(centavosDaTotal / nTramos) * (nTramos - 1)
        : Math.floor(centavosDaTotal / nTramos);

    if (t.esNini) {
      if (p1 < t.puesto) {
        centavosBrutoJuega += cD;
      } else if (p1 === t.puesto) {
        // NINI llega exacto en N: se empata/anula ese tramo
      } else {
        centavosBrutoDa += cJ;
      }
    } else {
      if (p1 <= t.puesto) {
        centavosBrutoJuega += cD;
      } else {
        centavosBrutoDa += cJ;
      }
    }
  }

  const netoBrutoCentavos = centavosBrutoJuega - centavosBrutoDa;
  if (netoBrutoCentavos > 0) {
    const brutoGanado = deCentavos(netoBrutoCentavos);
    const com = calcularComisionExacta(brutoGanado, comPct);
    const netoJuega = restarDinero(brutoGanado, com);
    return {
      netoJuega,
      netoDa: -brutoGanado,
      brutoGanadoJuega: brutoGanado,
      brutoPerdidoJuega: 0,
      brutoGanadoDa: 0,
      brutoPerdidoDa: brutoGanado,
    };
  } else if (netoBrutoCentavos < 0) {
    const brutoGanadoDa = deCentavos(-netoBrutoCentavos);
    const com = calcularComisionExacta(brutoGanadoDa, comPct);
    const netoDa = restarDinero(brutoGanadoDa, com);
    return {
      netoJuega: -brutoGanadoDa,
      netoDa,
      brutoGanadoJuega: 0,
      brutoPerdidoJuega: brutoGanadoDa,
      brutoGanadoDa,
      brutoPerdidoDa: 0,
    };
  }

  return {
    netoJuega: 0,
    netoDa: 0,
    brutoGanadoJuega: 0,
    brutoPerdidoJuega: 0,
    brutoGanadoDa: 0,
    brutoPerdidoDa: 0,
  };
}

/**
 * `_comprometidoSimuladoCli`:
 * Calcula el saldo en riesgo real (comprometido neto) de un cliente en una carrera abierta
 * agrupando sus jugadas activas por clusters de caballos compartidos y simulando el peor
 * escenario posible entre las posiciones de llegada `1..10` y `99` (fuera de pizarra).
 *
 * Excluye estrictamente jugadas con `estado = 'ANULADA'` (o `anulada === true`) y caballos retirados.
 */
export function _comprometidoSimuladoCli(
  clienteNombre: string,
  jugadasCarrera: JugadaActivaSimulacion[],
  comisionPctDefault = 5,
  caballosRetirados: Set<string> = new Set()
): number {
  const target = normalizarNombreCliente(clienteNombre);
  if (!target) return 0;

  const activas = jugadasCarrera.filter((j) => {
    if (!j) return false;
    if (j.anulada === true) return false;
    const est = String(j.estado ?? "PENDIENTE").trim().toUpperCase();
    if (["ANULADA", "ANULADO", "CANCELADA", "ELIMINADA", "RETIRADO", "RECHAZADO"].includes(est)) {
      return false;
    }
    const { todos } = extraerCaballosJugada(j.caballo, j.jugada);
    if (todos.some((c) => caballosRetirados.has(String(c)))) return false;

    const j1 = normalizarNombreCliente(j.jugador);
    const j2 = normalizarNombreCliente(j.tercio);
    return j1 === target || j2 === target;
  });

  if (activas.length === 0) return 0;

  // Construcción de grafos de adyacencia (clusters de caballos compartidos)
  const items = activas.map((j, idx) => {
    const { todos } = extraerCaballosJugada(j.caballo, j.jugada);
    return { idx, j, caballos: todos };
  });

  const visitado = new Set<number>();
  let comprometidoTotalCentavos = 0;

  for (let i = 0; i < items.length; i++) {
    if (visitado.has(i)) continue;
    const clusterIndices: number[] = [];
    const clusterCaballos = new Set<string>();
    const cola = [i];
    visitado.add(i);

    while (cola.length > 0) {
      const actual = cola.shift()!;
      clusterIndices.push(actual);
      for (const c of items[actual].caballos) {
        clusterCaballos.add(c);
      }
      for (let k = 0; k < items.length; k++) {
        if (visitado.has(k)) continue;
        if (items[k].caballos.some((c) => clusterCaballos.has(c))) {
          visitado.add(k);
          cola.push(k);
        }
      }
    }

    const caballosLista = [...clusterCaballos];
    const jugadasCluster = clusterIndices.map((idx) => items[idx].j);
    const posicionesCandidatas = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 99];

    let peorNetoCentavos = 0;

    const evaluarMapa = (mapa: Map<string, number>) => {
      let netoAcumuladoCentavos = 0;
      for (const jug of jugadasCluster) {
        const ev = evaluarJugadaEnEscenario(jug, mapa, comisionPctDefault);
        const esJ1 = normalizarNombreCliente(jug.jugador) === target;
        const esJ2 = normalizarNombreCliente(jug.tercio) === target;
        if (esJ1) netoAcumuladoCentavos += aCentavos(ev.netoJuega);
        if (esJ2) netoAcumuladoCentavos += aCentavos(ev.netoDa);
      }
      if (netoAcumuladoCentavos < peorNetoCentavos) {
        peorNetoCentavos = netoAcumuladoCentavos;
      }
    };

    if (caballosLista.length === 1) {
      const cab = caballosLista[0];
      for (const pos of posicionesCandidatas) {
        evaluarMapa(new Map([[cab, pos]]));
      }
    } else if (caballosLista.length === 2) {
      const [cA, cB] = caballosLista;
      for (const pA of posicionesCandidatas) {
        for (const pB of posicionesCandidatas) {
          if (pA !== 99 && pA === pB) continue; // posiciones de pizarra distintas
          evaluarMapa(
            new Map([
              [cA, pA],
              [cB, pB],
            ])
          );
        }
      }
    } else {
      // Para clusters de 3 o más caballos: muestreo exhaustivo de posiciones críticas (1..8 y 99)
      const posReducidas = [1, 2, 3, 4, 5, 6, 7, 99];
      const nCab = Math.min(caballosLista.length, 4);
      const usados = new Set<number>();
      const asignacion = new Map<string, number>();

      const backtrack = (idxCab: number) => {
        if (idxCab >= nCab) {
          for (let r = nCab; r < caballosLista.length; r++) {
            asignacion.set(caballosLista[r], 99);
          }
          evaluarMapa(asignacion);
          return;
        }
        const cab = caballosLista[idxCab];
        for (const p of posReducidas) {
          if (p !== 99 && usados.has(p)) continue;
          if (p !== 99) usados.add(p);
          asignacion.set(cab, p);
          backtrack(idxCab + 1);
          if (p !== 99) usados.delete(p);
        }
      };
      backtrack(0);
    }

    const comprometidoCluster = Math.max(0, -peorNetoCentavos);
    comprometidoTotalCentavos += comprometidoCluster;
  }

  return deCentavos(comprometidoTotalCentavos);
}

export type LineaResultadoParaCruce = {
  cliente: string;
  brutoGanado: number;
  brutoPerdido: number;
  comisionCobrada?: number;
};

export type ReembolsoCruceCliente = {
  cliente: string;
  brutoGanado: number;
  brutoPerdido: number;
  baseCruce: number;
  reembolsoCruce: number;
  etiqueta: string;
};

/**
 * `calcularReembolsosCruce`:
 * Cuando la modalidad activa sea `CON CRUCES` (`modalidad === 'con_cruces'` o `true`):
 * Para cada cliente que participó en la carrera, acumula por separado `brutoGanado` y `brutoPerdido`.
 * Si `brutoGanado > 0` y `brutoPerdido > 0`:
 *   reembolsoCruce = redondearCentavos((comisionPct / 100) * min(brutoGanado, brutoPerdido))
 */
export function calcularReembolsosCruce(
  lineas: LineaResultadoParaCruce[],
  modalidad: ModalidadCruceCarrera | boolean,
  comisionPct = 5
): {
  porCliente: Map<string, ReembolsoCruceCliente>;
  totalReembolsado: number;
  filasCruce: Array<{
    cliente: string;
    reembolso: number;
    etiqueta: string;
  }>;
} {
  const activo = modalidad === true || modalidad === "con_cruces";
  const porCliente = new Map<string, ReembolsoCruceCliente>();
  if (!activo || Number(comisionPct) <= 0) {
    return { porCliente, totalReembolsado: 0, filasCruce: [] };
  }

  const acumulados = new Map<
    string,
    { nombreOriginal: string; ganadoCentavos: number; perdidoCentavos: number }
  >();

  for (const l of lineas) {
    const clave = normalizarNombreCliente(l.cliente);
    if (!clave) continue;
    const prev = acumulados.get(clave) ?? {
      nombreOriginal: String(l.cliente).trim(),
      ganadoCentavos: 0,
      perdidoCentavos: 0,
    };
    prev.ganadoCentavos += Math.max(0, aCentavos(l.brutoGanado));
    prev.perdidoCentavos += Math.max(0, aCentavos(l.brutoPerdido));
    acumulados.set(clave, prev);
  }

  let totalCentavos = 0;
  const filasCruce: Array<{ cliente: string; reembolso: number; etiqueta: string }> = [];

  for (const [clave, acc] of acumulados) {
    if (acc.ganadoCentavos > 0 && acc.perdidoCentavos > 0) {
      const baseCentavos = Math.min(acc.ganadoCentavos, acc.perdidoCentavos);
      const baseCruce = deCentavos(baseCentavos);
      const reembolsoCruce = calcularComisionExacta(baseCruce, comisionPct);
      if (reembolsoCruce > 0) {
        const item: ReembolsoCruceCliente = {
          cliente: acc.nombreOriginal,
          brutoGanado: deCentavos(acc.ganadoCentavos),
          brutoPerdido: deCentavos(acc.perdidoCentavos),
          baseCruce,
          reembolsoCruce,
          etiqueta: `🔀 CRUCE (+${reembolsoCruce.toFixed(2)})`,
        };
        porCliente.set(clave, item);
        totalCentavos += aCentavos(reembolsoCruce);
        filasCruce.push({
          cliente: acc.nombreOriginal,
          reembolso: reembolsoCruce,
          etiqueta: "🔀 CRUCE",
        });
      }
    }
  }

  return {
    porCliente,
    totalReembolsado: deCentavos(totalCentavos),
    filasCruce,
  };
}

/**
 * Alias de compatibilidad `_reembolsosCruce` (Motor `Gestión de Planos`):
 * Acepta tanto líneas con `{ cliente, brutoGanado, brutoPerdido }` como líneas
 * con `{ cliente, resultado }` donde `resultado > 0` es ganancia neta (ya descontada
 * la comisión `comisionPct`) y `resultado < 0` es pérdida bruta.
 */
export function _reembolsosCruce(
  lineas: Array<{
    cliente: string;
    brutoGanado?: number;
    brutoPerdido?: number;
    resultado?: number | null;
    comisionCobrada?: number;
  }>,
  modalidad: ModalidadCruceCarrera | boolean = "con_cruces",
  comisionPct = 5
) {
  const factorNeto = 1 - Math.max(0, Number(comisionPct)) / 100;
  const normalizadas: LineaResultadoParaCruce[] = lineas.map((l) => {
    let brutoGanado = Number(l.brutoGanado ?? 0);
    let brutoPerdido = Number(l.brutoPerdido ?? 0);
    if (brutoGanado === 0 && brutoPerdido === 0 && typeof l.resultado === "number") {
      if (l.resultado > 0) {
        brutoGanado =
          factorNeto > 0 ? redondearCentavos(l.resultado / factorNeto) : redondearCentavos(l.resultado);
      } else if (l.resultado < 0) {
        brutoPerdido = redondearCentavos(Math.abs(l.resultado));
      }
    }
    return {
      cliente: l.cliente,
      brutoGanado,
      brutoPerdido,
      comisionCobrada: l.comisionCobrada,
    };
  });
  return calcularReembolsosCruce(normalizadas, modalidad, comisionPct);
}
