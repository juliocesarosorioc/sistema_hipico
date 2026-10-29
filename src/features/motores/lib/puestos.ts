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
import { registrarProcesador, TicketMotor, ResultadoMotor, COMISION_CASA } from "@/features/betting/lib/bettingEngine";
import type { BloqueDetalleResultado, EstadoBloque } from "@/features/betting/lib/bettingEngine";
import type { PizarraCarrera } from "@/features/liquidacion/lib/liquidacion";
import {
  parsearNomenclatura,
  etiquetaModalidad,
  etiquetaJugada,
  categoriaJugada,
  canonicalizarJugada,
  type Nomenclatura,
  type ModalidadPuestos,
  type Proporcion,
  type CategoriaJugada,
} from "@/features/taquilla/lib/nomenclatura";
import { parsearEjemplaresPorCliente } from "@/features/taquilla/lib/reparto";
import {
  aCentavos,
  deCentavos,
  redondearCentavos,
  sumarDinero,
  restarDinero,
  calcularComisionExacta,
  calcularProporcionExacta,
} from "@/shared/lib/dinero";

export {
  parsearNomenclatura,
  etiquetaModalidad,
  etiquetaJugada,
  categoriaJugada,
  canonicalizarJugada,
  type Nomenclatura,
  type ModalidadPuestos,
  type Proporcion,
  type CategoriaJugada,
};

/**
 * Escalera Estricta de Progresión (Regla 4):
 *   1P ➔ 1Y2N ➔ 2N ➔ 2Y2N ➔ 2P ➔ 2Y3N ➔ 3N ➔ 3Y3N ➔ 3P ➔ 3Y4N ➔ 4N ➔ 4Y4N ➔ 4P ➔ 4Y5N ➔ 5N ➔ 5Y5N ➔ 5P
 */
export const ESCALERA_PROGRESION_PUESTOS = [
  "1P",
  "1Y2N",
  "2N",
  "2Y2N",
  "2P",
  "2Y3N",
  "3N",
  "3Y3N",
  "3P",
  "3Y4N",
  "4N",
  "4Y4N",
  "4P",
  "4Y5N",
  "5N",
  "5Y5N",
  "5P",
] as const;

export type ReglaTablaJugada = {
  codigo: string;
  /** Tramos posicionales: cada tramo define [puestoLimite, esNini]. */
  tramos: Array<{ puesto: number; esNini: boolean }>;
  /** Si es proporción 10Ax, numerador del lado que da (ej. 8 en 10A8). */
  factor10Ax?: number;
  esPP?: boolean;
};

/**
 * Tabla oficial de jugadas de puestos y proporciones (44 combinaciones oficiales + PP + 10Ax).
 * Factores exactos: 1, 0.75, 0.50, 0.25, 0, -0.25, -0.50, -0.75, -1.
 */
export const TABLA_JUGADAS: Record<string, ReglaTablaJugada> = (() => {
  const tabla: Record<string, ReglaTablaJugada> = {};
  const registrarConAliases = (regla: ReglaTablaJugada, aliases: string[]) => {
    tabla[regla.codigo] = regla;
    for (const al of aliases) {
      tabla[al] = regla;
    }
  };

  for (let p = 1; p <= 6; p++) {
    const n = p + 1;
    // Individuales: pP, nN, nP
    registrarConAliases(
      {
        codigo: `${p}P`,
        tramos: [{ puesto: p, esNini: false }],
      },
      []
    );
    registrarConAliases(
      {
        codigo: `${n}N`,
        tramos: [{ puesto: n, esNini: true }],
      },
      []
    );
    registrarConAliases(
      {
        codigo: `${n}P`,
        tramos: [{ puesto: n, esNini: false }],
      },
      []
    );

    // Combinadas (50% / 50% -> 2 tramos):
    // 1) p/nN = pYnN = pP Y nN (50% pP + 50% nN) -> Regla 1: expandir 1/2 -> 1Y2N, 2/3 -> 2Y3N
    registrarConAliases(
      {
        codigo: `${p}Y${n}N`,
        tramos: [
          { puesto: p, esNini: false },
          { puesto: n, esNini: true },
        ],
      },
      [`${p}/${n}N`, `${p}PY${n}N`, `${p}P/${n}N`, `${p}/${n}`, `${p}Y${n}`]
    );

    // 2) n/nN = nYnN = nN/nP = nP/nN = nNYnP = nPYnN (50% nN + 50% nP)
    registrarConAliases(
      {
        codigo: `${n}Y${n}N`,
        tramos: [
          { puesto: n, esNini: true },
          { puesto: n, esNini: false },
        ],
      },
      [`${n}/${n}N`, `${n}N/${n}P`, `${n}P/${n}N`, `${n}NY${n}P`, `${n}PY${n}N`, `${n}Y${n}`, `${n}/${n}`]
    );

    // 3) p/n = p/nP = pYn = pYnP = pPYnP (50% pP + 50% nP)
    registrarConAliases(
      {
        codigo: `${p}Y${n}P`,
        tramos: [
          { puesto: p, esNini: false },
          { puesto: n, esNini: false },
        ],
      },
      [`${p}/${n}P`, `${p}PY${n}P`, `${p}P/${n}P`, `${p}PY${n}`]
    );

    // Bloques en Escalera (Regla 4 -> 4 cuartos de 25% cada uno: 75%/25% y 25%/75%):
    // Escalón 1: pP Y p/nN -> 75% pP + 25% nN
    registrarConAliases(
      {
        codigo: `${p}PY${p}Y${n}N`,
        tramos: [
          { puesto: p, esNini: false },
          { puesto: p, esNini: false },
          { puesto: p, esNini: false },
          { puesto: n, esNini: true },
        ],
      },
      [`${p}PY${p}/${n}N`, `${p}Y${n}NY${p}P`, `${p}/${n}NY${p}P`, `${p}PY${p}P/${n}N`, `${p}P/${n}NY${p}P`]
    );

    // Escalón 2: p/nN Y nN -> 25% pP + 75% nN
    registrarConAliases(
      {
        codigo: `${p}Y${n}NY${n}N`,
        tramos: [
          { puesto: p, esNini: false },
          { puesto: n, esNini: true },
          { puesto: n, esNini: true },
          { puesto: n, esNini: true },
        ],
      },
      [`${p}/${n}NY${n}N`, `${n}NY${p}Y${n}N`, `${n}NY${p}/${n}N`, `${p}/${n}Y${n}N`, `${p}Y${n}Y${n}N`, `${n}NY${p}Y${n}`]
    );

    // Escalón 3: nN Y n/nN -> 75% nN + 25% nP
    registrarConAliases(
      {
        codigo: `${n}NY${n}Y${n}N`,
        tramos: [
          { puesto: n, esNini: true },
          { puesto: n, esNini: true },
          { puesto: n, esNini: true },
          { puesto: n, esNini: false },
        ],
      },
      [`${n}NY${n}/${n}N`, `${n}Y${n}NY${n}N`, `${n}/${n}NY${n}N`, `${n}NY${n}N/${n}P`, `${n}NY${n}NY${n}P`]
    );

    // Escalón 4: n/nN Y nP -> 25% nN + 75% nP
    registrarConAliases(
      {
        codigo: `${n}Y${n}NY${n}P`,
        tramos: [
          { puesto: n, esNini: true },
          { puesto: n, esNini: false },
          { puesto: n, esNini: false },
          { puesto: n, esNini: false },
        ],
      },
      [`${n}/${n}NY${n}P`, `${n}PY${n}Y${n}N`, `${n}PY${n}/${n}N`, `${n}N/${n}PY${n}P`, `${n}NY${n}PY${n}P`]
    );
  }

  tabla["PP"] = {
    codigo: "PP",
    tramos: [{ puesto: 1, esNini: false }],
    esPP: true,
  };

  const factores = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10];
  for (const f of factores) {
    const keyA = `10A${f}`;
    const keySlash = `10/${f}`;
    const regla: ReglaTablaJugada = {
      codigo: keyA,
      tramos: [{ puesto: 1, esNini: false }],
      factor10Ax: f,
    };
    tabla[keyA] = regla;
    tabla[keySlash] = regla;
  }

  return tabla;
})();

/**
 * Normaliza cualquier variante de jugada A Premio (`10a7`, `10/7`, `10A3.5`, `10/3,5`, `10a3,5`, `10a3.5`)
 * al formato canónico `10A<factor>` con punto decimal (`10A7`, `10A3.5`).
 */
export function normalizarJugadaPremio(jugadaRaw: string | null | undefined): string {
  const texto = String(jugadaRaw ?? "").trim();
  const matchPremio = /^10\s*[aA\/]\s*(\d+(?:[.,]\d+)?)$/.exec(texto);
  if (matchPremio) {
    const factor = matchPremio[1].replace(",", ".");
    return `10A${factor}`;
  }
  return texto.toUpperCase().replace(/\s+/g, "");
}

/** Normaliza el código de una jugada para buscarla en `TABLA_JUGADAS` o el motor SSOT. */
export function normalizarCodigoJugada(raw: string | null | undefined): string {
  const normPremio = normalizarJugadaPremio(raw);
  if (!normPremio) return "1P";
  if (normPremio === "10/10" || normPremio === "10A10") return "PP";
  let s = normPremio.replace(/\s+/g, "").replace(/&/g, "Y");
  // Expandir 1/2 -> 1Y2N, 2/3 -> 2Y3N, etc.
  s = s.replace(/^(\d+)\/(\d+)$/, (_m, p, n) => `${p}Y${n}N`);
  return s;
}

function tramosDesdeNomenclatura(nom: Nomenclatura): Array<{ puesto: number; esNini: boolean }> {
  if (!nom.bloques || nom.bloques.length === 0) {
    return [{ puesto: nom.puesto ?? 1, esNini: nom.esNini }];
  }
  const tieneSubBloques = nom.bloques.some((b) => b.bloques && b.bloques.length > 0);
  if (!tieneSubBloques) {
    return nom.bloques.map((b) => ({ puesto: b.puesto ?? 1, esNini: b.esNini }));
  }
  const cuartos: Array<{ puesto: number; esNini: boolean }> = [];
  for (const b of nom.bloques) {
    if (b.bloques && b.bloques.length > 0) {
      for (const sub of b.bloques) {
        cuartos.push({ puesto: sub.puesto ?? 1, esNini: sub.esNini });
      }
    } else {
      cuartos.push({ puesto: b.puesto ?? 1, esNini: b.esNini });
      cuartos.push({ puesto: b.puesto ?? 1, esNini: b.esNini });
    }
  }
  return cuartos;
}

/** Obtiene la regla en `TABLA_JUGADAS` o resuelve dinámicamente desde la nomenclatura SSOT. */
export function obtenerReglaTablaJugada(codigo: string): ReglaTablaJugada | undefined {
  const cod = normalizarCodigoJugada(codigo);
  if (TABLA_JUGADAS[cod]) return TABLA_JUGADAS[cod];
  const mProp = /^10A(\d+(?:\.\d+)?)$/.exec(cod);
  if (mProp) {
    const f = parseFloat(mProp[1]);
    if (Number.isFinite(f) && f > 0) {
      return {
        codigo: cod,
        tramos: [{ puesto: 1, esNini: false }],
        factor10Ax: f,
      };
    }
  }
  const nom = parsearNomenclatura(cod);
  if (nom && (nom.modalidad === "PUESTO_PURO" || nom.modalidad === "NINI" || nom.modalidad === "COMBINADA" || nom.modalidad === "COMPUESTA")) {
    return {
      codigo: cod,
      tramos: tramosDesdeNomenclatura(nom),
    };
  }
  return undefined;
}

/**
 * Busca una jugada en `TABLA_JUGADAS` reconociendo también componentes invertidos
 * (ej. `1Y2NY1P` -> `1PY1Y2N`, `2NY1Y2N` -> `1Y2NY2N`).
 */
export function buscarJugadaPorComponentes(jugada: string): ReglaTablaJugada | undefined {
  const directa = obtenerReglaTablaJugada(jugada);
  if (directa) return directa;

  const cod = normalizarCodigoJugada(jugada);
  const partes = cod.split("Y").filter(Boolean);
  if (partes.length === 2) {
    const inv = `${partes[1]}Y${partes[0]}`;
    const rInv = obtenerReglaTablaJugada(inv);
    if (rInv) return rInv;
  } else if (partes.length === 3) {
    const p = partes;
    const permuts = [
      `${p[0]}Y${p[2]}Y${p[1]}`,
      `${p[1]}Y${p[0]}Y${p[2]}`,
      `${p[1]}Y${p[2]}Y${p[0]}`,
      `${p[2]}Y${p[0]}Y${p[1]}`,
      `${p[2]}Y${p[1]}Y${p[0]}`,
    ];
    for (const perm of permuts) {
      const r = obtenerReglaTablaJugada(perm);
      if (r) return r;
    }
  }
  return undefined;
}

/**
 * Extrae el arreglo de números de ejemplares desde cualquier formato
 * (`"1y2"`, `"3y4"`, `"1-2"`, `"1,2"`, `"1 2"`).
 */
export function extraerEjemplaresMultiples(
  caballoRaw: string | number | Array<string | number> | null | undefined
): number[] {
  if (Array.isArray(caballoRaw)) {
    const nums = caballoRaw
      .flatMap((x) => extraerEjemplaresMultiples(x))
      .filter((n) => Number.isFinite(n) && n > 0);
    return [...new Set(nums)];
  }
  const texto = String(caballoRaw ?? "").trim();
  if (!texto) return [];
  const partes = texto
    .replace(/\b(?:por|el|la|los|las|de|del)\b/gi, " ")
    .split(/[\s,yY\-\/\*xX&]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const resultado: number[] = [];
  for (const p of partes) {
    if (/^\d{1,2}$/.test(p)) {
      const n = Number(p);
      if (Number.isFinite(n) && n > 0 && !resultado.includes(n)) {
        resultado.push(n);
      }
    }
  }
  return resultado;
}

const ORDEN_CAMPOS_PIZARRA_SSOT = [
  "primero",
  "segundo",
  "tercero",
  "cuarto",
  "quinto",
  "sexto",
  "septimo",
  "octavo",
] as const;

/**
 * Convierte cualquier representación de pizarra en un `Map<string, number>`
 * donde la clave es el número de ejemplar y el valor es su posición de llegada (1..8..).
 */
export function construirMapaPosicionesPizarra(
  pizarra:
    | PizarraCarrera
    | Map<string | number, number>
    | Array<string | number>
    | Record<string, unknown>
    | null
    | undefined
): Map<string, number> {
  const mapa = new Map<string, number>();
  if (!pizarra) return mapa;

  if (pizarra instanceof Map) {
    for (const [k, v] of pizarra.entries()) {
      const pos = Number(v);
      if (Number.isFinite(pos) && pos > 0) {
        mapa.set(String(Number(k)), pos);
      }
    }
    return mapa;
  }

  if (Array.isArray(pizarra)) {
    pizarra.forEach((cab, idx) => {
      const num = Number(String(cab ?? "").trim());
      if (Number.isFinite(num) && num > 0 && !mapa.has(String(num))) {
        mapa.set(String(num), idx + 1);
      }
    });
    return mapa;
  }

  const obj = pizarra as Record<string, unknown>;
  let tieneCamposNombrados = false;
  ORDEN_CAMPOS_PIZARRA_SSOT.forEach((campo, idx) => {
    const val = obj[campo];
    if (val !== undefined && val !== null && String(val).trim() !== "") {
      tieneCamposNombrados = true;
      const num = Number(String(val).trim());
      if (Number.isFinite(num) && num > 0) {
        mapa.set(String(num), idx + 1);
      } else {
        mapa.set(String(val).trim(), idx + 1);
      }
    }
  });

  if (!tieneCamposNombrados) {
    for (const [k, v] of Object.entries(obj)) {
      if (k === "empates" || k === "primero_raya") continue;
      const pos = Number(v);
      const cab = Number(k);
      if (Number.isFinite(cab) && cab > 0 && Number.isFinite(pos) && pos > 0) {
        mapa.set(String(cab), pos);
      }
    }
  }

  return mapa;
}

/**
 * Regla de evaluación por la mejor posición del grupo (`getMejorPos`):
 * Devuelve la mejor posición de llegada (la menor numéricamente) alcanzada por cualquiera de ellos.
 * Si ninguno figura en pizarra, devuelve `99`.
 */
export function getMejorPos(
  ejemplares: string | number | Array<string | number>,
  pizarra:
    | PizarraCarrera
    | Map<string | number, number>
    | Array<string | number>
    | Record<string, unknown>
    | null
    | undefined
): number {
  const lista = extraerEjemplaresMultiples(ejemplares);
  if (lista.length === 0) return 99;
  const mapa = construirMapaPosicionesPizarra(pizarra);
  const posiciones = lista.map((num) => mapa.get(String(num)) ?? 99);
  return Math.min(...posiciones);
}

/**
 * Calcula el riesgo exacto del Cliente 2 (dador) para una jugada (incluyendo `10Ax` / `10/x` con decimales).
 * En `10Ax`: `riesgoCliente2 = monto * (parseFloat(factor) * 10 / 100)` = `monto * (factor / 10)`.
 */
export function calcularRiesgoCliente2(monto: number, jugadaRaw: string): number {
  const m = redondearCentavos(monto);
  if (m <= 0) return 0;
  const norm = normalizarJugadaPremio(jugadaRaw);
  const match = /^10A(\d+(?:\.\d+)?)$/.exec(norm);
  if (match) {
    const factor = parseFloat(match[1]);
    if (Number.isFinite(factor) && factor > 0) {
      return calcularProporcionExacta(m, factor, 10);
    }
  }
  return m;
}

/**
 * Calcula el factor multiplicador exacto de una jugada de puestos, premio o PP.
 * Retorna valores exactos en `{1, 0.75, 0.50, 0.25, 0, -0.25, -0.50, -0.75, -1}` o factor porcentual en `10Ax`.
 */
export function calcularMultiplicadorJugada(
  jugada: string,
  mejorPos: number,
  opts?: {
    retirado?: boolean;
    p2?: number;
  }
): number {
  if (opts?.retirado) return 0;
  const regla = buscarJugadaPorComponentes(jugada) ?? obtenerReglaTablaJugada(jugada);
  if (!regla) return 0;

  // Jugadas A Premio (10Ax)
  if (regla.factor10Ax != null) {
    const pct = regla.factor10Ax / 10;
    if (opts?.p2 != null) {
      if (mejorPos < opts.p2) return pct;
      if (opts.p2 < mejorPos) return -1;
      return 0;
    }
    if (mejorPos === 1) return pct;
    return -1;
  }

  // Jugadas PP (Para-Para / Mano a Mano)
  if (regla.esPP || normalizarCodigoJugada(jugada) === "PP") {
    if (opts?.p2 != null) {
      if (mejorPos < opts.p2) return 1;
      if (opts.p2 < mejorPos) return -1;
      return 0;
    }
    if (mejorPos === 1) return 1;
    return -1;
  }

  // Jugadas de puestos estándar de la escalera (1P..6Y7NY7N)
  const tramos = regla.tramos;
  if (!tramos || tramos.length === 0) return 0;

  let suma = 0;
  for (const t of tramos) {
    if (t.esNini) {
      if (mejorPos < t.puesto) suma += 1;
      else if (mejorPos === t.puesto) suma += 0;
      else suma -= 1;
    } else {
      if (mejorPos <= t.puesto) suma += 1;
      else suma -= 1;
    }
  }

  return round2(suma / tramos.length);
}

/**
 * Evalúa una jugada de puestos o a premio (`1P`..`6Y7NY7N`, `PP`, `10Ax`, `10/x`)
 * soportando múltiples ejemplares (ej. `1P` con `1y2`, `2P` con `3y4`) y devolviendo
 * el resultado exacto de liquidación para Cliente 1 (Quien Juega) y Cliente 2 (Quien Da).
 */
export function logicaGanancias(params: {
  jugada: string;
  caballo: string | number | Array<string | number>;
  monto: number;
  pizarra:
    | PizarraCarrera
    | Map<string | number, number>
    | Array<string | number>
    | Record<string, unknown>;
  comisionPct?: number;
  retirados?: Array<string | number>;
}): {
  codigoNormalizado: string;
  ejemplares: number[];
  mejorPos: number;
  ganaJugador1: boolean;
  ganaJugador2: boolean;
  empate: boolean;
  riesgoJugador1: number;
  riesgoJugador2: number;
  netoJugador1: number;
  netoJugador2: number;
} {
  const codigoNormalizado = normalizarCodigoJugada(params.jugada);
  const ejemplares = extraerEjemplaresMultiples(params.caballo);
  const mapa = construirMapaPosicionesPizarra(params.pizarra);
  const comPct = params.comisionPct ?? 5;
  const monto = redondearCentavos(params.monto);

  const regla = buscarJugadaPorComponentes(codigoNormalizado) ?? obtenerReglaTablaJugada(codigoNormalizado);
  const factorRival = regla?.factor10Ax != null ? regla.factor10Ax : 10;
  const riesgoJugador1 = monto;
  const riesgoJugador2 =
    factorRival !== 10 ? calcularProporcionExacta(monto, factorRival, 10) : monto;

  // Verificación de Retirados (Regla 5):
  const pizarraObj = params.pizarra as Record<string, unknown>;
  const retiradosRaw = params.retirados ?? (Array.isArray(pizarraObj?.retirados) ? pizarraObj.retirados : []);
  const listaRetirados = retiradosRaw.map((x) =>
    Number(String(x).trim().replace(/^#/, ""))
  );
  const algunoRetirado = ejemplares.some((e) => listaRetirados.includes(e));

  if (algunoRetirado) {
    return {
      codigoNormalizado,
      ejemplares,
      mejorPos: 99,
      ganaJugador1: false,
      ganaJugador2: false,
      empate: true,
      riesgoJugador1: 0,
      riesgoJugador2: 0,
      netoJugador1: 0,
      netoJugador2: 0,
    };
  }

  // Parseo de caballos si es mano a mano (AxB)
  const caballoStr =
    typeof params.caballo === "string"
      ? params.caballo
      : Array.isArray(params.caballo)
        ? params.caballo.join("y")
        : String(params.caballo ?? "");

  const partesManoAMano = caballoStr.split(/\s*(?:x|\*|\bpor\b)\s*/i);
  const esMatchup = partesManoAMano.length >= 2 && (regla?.esPP || regla?.factor10Ax != null);

  if (esMatchup) {
    const c1 = extraerEjemplaresMultiples(partesManoAMano[0]);
    const c2 = extraerEjemplaresMultiples(partesManoAMano[1]);
    const p1 = c1.length ? Math.min(...c1.map((n) => mapa.get(String(n)) ?? 99)) : 99;
    const p2 = c2.length ? Math.min(...c2.map((n) => mapa.get(String(n)) ?? 99)) : 99;
    const mult = calcularMultiplicadorJugada(codigoNormalizado, p1, { p2 });

    if (mult > 0) {
      const brutoGanado = redondearCentavos(riesgoJugador2 * mult);
      const com = calcularComisionExacta(brutoGanado, comPct);
      const neto1 = restarDinero(brutoGanado, com);
      return {
        codigoNormalizado,
        ejemplares,
        mejorPos: p1,
        ganaJugador1: true,
        ganaJugador2: false,
        empate: false,
        riesgoJugador1,
        riesgoJugador2,
        netoJugador1: neto1,
        netoJugador2: -brutoGanado,
      };
    } else if (mult < 0) {
      const brutoGanadoDa = riesgoJugador1;
      const com = calcularComisionExacta(brutoGanadoDa, comPct);
      const neto2 = restarDinero(brutoGanadoDa, com);
      return {
        codigoNormalizado,
        ejemplares,
        mejorPos: p1,
        ganaJugador1: false,
        ganaJugador2: true,
        empate: false,
        riesgoJugador1,
        riesgoJugador2,
        netoJugador1: -brutoGanadoDa,
        netoJugador2: neto2,
      };
    } else {
      return {
        codigoNormalizado,
        ejemplares,
        mejorPos: p1,
        ganaJugador1: false,
        ganaJugador2: false,
        empate: true,
        riesgoJugador1,
        riesgoJugador2,
        netoJugador1: 0,
        netoJugador2: 0,
      };
    }
  }

  // Jugada posicional de puestos o proporción sobre c1
  const mejorPos = getMejorPos(ejemplares, mapa);
  const tramos = regla?.tramos ?? [{ puesto: 1, esNini: false }];
  const nTramos = tramos.length;

  const centavosJuegaTotal = aCentavos(riesgoJugador1);
  const centavosDaTotal = aCentavos(riesgoJugador2);
  let centavosBrutoJuega = 0;
  let centavosBrutoDa = 0;

  for (let i = 0; i < nTramos; i++) {
    const t = tramos[i];
    const cJ =
      i === nTramos - 1
        ? centavosJuegaTotal - Math.floor(centavosJuegaTotal / nTramos) * (nTramos - 1)
        : Math.floor(centavosJuegaTotal / nTramos);
    const cD =
      i === nTramos - 1
        ? centavosDaTotal - Math.floor(centavosDaTotal / nTramos) * (nTramos - 1)
        : Math.floor(centavosDaTotal / nTramos);

    if (t.esNini) {
      if (mejorPos < t.puesto) {
        centavosBrutoJuega += cD;
      } else if (mejorPos === t.puesto) {
        // Empate en nini
      } else {
        centavosBrutoDa += cJ;
      }
    } else {
      if (mejorPos <= t.puesto) {
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
    const neto1 = restarDinero(brutoGanado, com);
    return {
      codigoNormalizado,
      ejemplares,
      mejorPos,
      ganaJugador1: true,
      ganaJugador2: false,
      empate: false,
      riesgoJugador1,
      riesgoJugador2,
      netoJugador1: neto1,
      netoJugador2: -brutoGanado,
    };
  } else if (netoBrutoCentavos < 0) {
    const brutoGanadoDa = deCentavos(-netoBrutoCentavos);
    const com = calcularComisionExacta(brutoGanadoDa, comPct);
    const neto2 = restarDinero(brutoGanadoDa, com);
    return {
      codigoNormalizado,
      ejemplares,
      mejorPos,
      ganaJugador1: false,
      ganaJugador2: true,
      empate: false,
      riesgoJugador1,
      riesgoJugador2,
      netoJugador1: -brutoGanadoDa,
      netoJugador2: neto2,
    };
  }

  return {
    codigoNormalizado,
    ejemplares,
    mejorPos,
    ganaJugador1: false,
    ganaJugador2: false,
    empate: true,
    riesgoJugador1,
    riesgoJugador2,
    netoJugador1: 0,
    netoJugador2: 0,
  };
}

export interface ValidationResult {
  ok: boolean;
  error?: string;
  minimoCorredores?: number;
}

export interface LiquidationResult {
  /** Ganancia o pérdida neta de la jugada para el Jugador antes de comisión (> 0 gana, < 0 pierde, 0 empate/nini). */
  netoJugadorBruto: number;
  /** Ganancia o pérdida neta del Jugador después de aplicar el 5% de comisión sobre ganancia neta positiva. */
  netoJugador: number;
  /** Ganancia o pérdida neta del Banquero después de aplicar el 5% de comisión sobre ganancia neta positiva. */
  netoBanquero: number;
  /** Monto bruto devuelto al jugador (incluyendo su capital de vuelta). */
  playerBruto: number;
  /** Monto neto devuelto al jugador (incluyendo su capital de vuelta menos comisión si ganó). */
  player: number;
  /** Balance de la banca / banquero (positivo si gana el banquero, negativo si paga al jugador). */
  banker: number;
  /** Comisión del 5% retenida únicamente sobre ganancia neta positiva consolidada. */
  comision: number;
  draw?: boolean;
  anuladaPorRiesgo?: boolean;
}

/**
 * Regla 1 (Principio de Riesgo Bilateral):
 * Calcula el mínimo de ejemplares efectivos en carrera (`N_corredores`) requerido
 * para que exista posibilidad real de que gane el Jugador (> 0) y gane el Banquero (< 0):
 *  - Xp (1p..5p): requiere N_corredores >= X + 1
 *  - Xn (2n..5n, X >= 2): requiere N_corredores >= X + 1
 *  - Combinada o Bloque: el máximo requisito entre sus componentes.
 */
export function minimoCorredoresDeNomenclatura(nom: Nomenclatura | null | undefined): number {
  if (!nom) return Infinity;
  if (nom.bloques && nom.bloques.length > 0) {
    return Math.max(...nom.bloques.map((b) => minimoCorredoresDeNomenclatura(b)));
  }
  if (nom.modalidad === "PUESTO_PURO" || nom.modalidad === "NINI") {
    const x = nom.puesto ?? 1;
    if (nom.esNini && x <= 1) return Infinity; // 1N no existe
    return x + 1;
  }
  return 2;
}

export function minimoCorredoresRequeridos(jugada: string): number {
  const nom = parsearNomenclatura(jugada);
  return minimoCorredoresDeNomenclatura(nom);
}

/**
 * Regla 1 — Validador SSOT de jugadas de puestos, combinadas y bloques:
 *  1. Rechaza '1N' en cualquier modalidad (individual, combinada o bloque).
 *  2. Rechaza saltos de peldaño fuera de la Escalera Estricta de Progresión.
 *  3. Si se indica `nCorredores`, verifica `nCorredores >= minimoCorredoresRequeridos(bet)`.
 */
export function validarPuesto(bet: string, nCorredores?: number | null): ValidationResult {
  const texto = String(bet ?? "").trim();
  if (!texto) {
    return { ok: false, error: "Jugada vacía." };
  }
  if (/(?:^|[^0-9])1\s*n(?![a-z])/i.test(texto)) {
    return { ok: false, error: "La jugada '1N' (Primer Nini) no existe por Principio de Riesgo Bilateral (Regla 1)." };
  }
  const nom = parsearNomenclatura(texto);
  if (!nom) {
    return {
      ok: false,
      error: `Jugada '${texto}' inválida o fuera de la Escalera Estricta de Progresión.`,
    };
  }
  const minReq = minimoCorredoresDeNomenclatura(nom);
  if (!Number.isFinite(minReq)) {
    return { ok: false, error: `Jugada '${texto}' inválida.` };
  }
  if (typeof nCorredores === "number" && Number.isFinite(nCorredores)) {
    if (nCorredores < minReq) {
      return {
        ok: false,
        error: `Riesgo bilateral incumplido: '${texto}' requiere mínimo ${minReq} ejemplares en carrera (corren ${nCorredores}).`,
        minimoCorredores: minReq,
      };
    }
  }
  return { ok: true, minimoCorredores: minReq };
}

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
    const limp = String(bruto).trim().replace(/^#/, "").replace(/^0+(?=\d)/, "");
    if (!limp) return;
    mapa.set(limp, i + 1);
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
    const clave = String(ej).trim().replace(/^#/, "").replace(/^0+(?=\d)/, "");
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
  const esPosicionalPizarra =
    nom.modalidad === "PUESTO_PURO" ||
    nom.modalidad === "NINI" ||
    nom.modalidad === "COMBINADA" ||
    nom.modalidad === "COMPUESTA";

  const todosCol = [...col.izquierda, ...col.derecha];
  const ladoA = esPosicionalPizarra
    ? [...new Set([...nom.ladoA, ...todosCol])]
    : !col.hayDivisor
      ? [...new Set([...nom.ladoA, ...col.izquierda])]
      : nom.ladoA.length > 0
        ? nom.ladoA
        : col.izquierda;
  const ladoB = nom.ladoB.length > 0 ? nom.ladoB : esPosicionalPizarra ? [] : col.derecha;

  let modalidad = nom.modalidad;

  // Un `x` en la columna CABALLO son dos clientes enfrentados cuando la jugada es PP o A_PREMIO
  // (forma legacy "2x3 10/8", o "10/8" con caballo "3x5"). En jugadas posicionales de puestos
  // (1P, 2P, 2N, 1Y2N) todos los ejemplares listados ("1y2", "1x2", "3y4") pertenecen al jugador (ladoA).
  if (col.hayDivisor && !esPosicionalPizarra && modalidad !== "MATCHUP" && modalidad !== "MATCHUP_PROPORCION") {
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

/**
 * Evalúa UN bloque (hoja o anidado) sobre su parte del monto.
 *
 * BUG CORREGIDO: una COMBINADA dentro de una COMPUESTA ("1P Y 1Y2N") se
 * trataba como un simple "puesto 2" (bloque.esNini=false → puestoPuro(2)) y la
 * jugada caía en "Retirado"/EMPATA sin desglose. Ahora el bloque anidado
 * reparte SU monto 50/50 entre sus tramos y se evalúa cada sub-jugada:
 * "1Y2N" = dos jugadas: 1P y 2N.
 */
function evaluarBloque(
  bloque: Nomenclatura,
  puestos: number[],
  empate1: boolean,
  montoBloque: number,
  tasa: number
): BloqueDetalleResultado {
  // Bloqueo de pizarra de las COMBINADAS, también anidadas: el segundo tramo
  // debe ser el mismo puesto que el primero o su inmediato superior.
  if (bloque.tramos) {
    const [p1, p2] = bloque.tramos;
    if (p2 !== p1 && p2 !== p1 + 1) {
      return {
        fuente: bloque.fuente,
        monto: montoBloque,
        bruto: 0,
        estado: "PIERDE",
        motivo:
          "BLOQUEO DE PIZARRA: la parte 2 (" + p2 + ") debe ser igual a la parte 1 (" + p1 +
          ") o su inmediato superior (P1+1). La jugada no se registra.",
      };
    }
  }

  // COMBINADA / COMPUESTA anidada: reparte su monto entre sus tramos y suma.
  if (bloque.bloques && bloque.bloques.length > 0) {
    const share = montoBloque / bloque.bloques.length;
    const bloques = bloque.bloques.map((b) => evaluarBloque(b, puestos, empate1, share, tasa));
    const bruto = round2(bloques.reduce((acc, b) => acc + b.bruto, 0));
    const estado: EstadoBloque = bruto > montoBloque ? "GANA" : bruto === montoBloque ? "EMPATA" : "PIERDE";
    const partes = bloque.bloques.map((b) => b.fuente).join(" y ");
    const etiqueta = bloque.modalidad === "COMBINADA" ? "COMBINADA" : "COMPUESTA";
    const veredicto = estado === "GANA" ? "GANADORA" : estado === "EMPATA" ? "EMPATA" : "PERDIDA";
    return {
      fuente: bloque.fuente,
      monto: montoBloque,
      bruto,
      estado,
      motivo: etiqueta + " (" + partes + ") " + veredicto + ": " + bloques.map((b) => b.motivo).join(" | "),
      bloques,
    };
  }

  // Hoja: puesto puro, nini o pelo a pelo.
  const d = bloque.esNini
    ? winningAny(puestos, bloque.puesto as number, true, "NINI " + bloque.fuente)
    : puestoPuro(puestos, bloque.puesto as number, false, empate1);
  const bruto = d.anulada ? montoBloque : d.ganador === "jugador" ? montoBloque * 2 : 0;
  return {
    fuente: bloque.fuente,
    monto: montoBloque,
    bruto: round2(bruto),
    estado: d.anulada ? "ANULADA" : d.ganador === "jugador" ? "GANA" : "PIERDE",
    motivo: d.motivo,
  };
}

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

  const share = monto / r.bloques.length;
  const puestos = r.ladoA.map((c) => (mapa.has(c) ? (mapa.get(c) as number) : Infinity));
  const detalles = r.bloques.map((bloque) => evaluarBloque(bloque, puestos, empate1, share, tasa));
  const brutoTotal = detalles.reduce((acc, d) => acc + d.bruto, 0);

  const estado = brutoTotal > monto ? "GANADORA" : brutoTotal === monto ? "EMPATA" : "PERDIDA";
  // Solo es ganadora si el jugador sale por encima de lo que puso. Recuperar
  // capital en un tramo y perder el otro NO es ganar: el legacy contaba
  // cualquier bruto > 0 y eso inflaba los premios de los reportes.
  const resultado = finalizar(
    brutoTotal > monto,
    (r.modalidad === "COMBINADA" ? "COMBINADA" : "COMPUESTA") + " (" + r.bloques.map((b) => b.fuente).join(" y ") + ") " + estado + ": " + detalles.map((d) => d.motivo).join(" | "),
    brutoTotal,
    monto,
    tasa,
    0
  );
  resultado.bloquesDetalle = detalles;
  return resultado;
}

/* ============ PuestosEngine ============ */

/**
 * Liquida cualquier jugada de Puestos. Punto de entrada UNICO: la columna
 * JUGADA se parsea con la nomenclatura y la columna CABALLO aporta los
 * ejemplares que la jugada no trae.
 */
export function liquidarPuestos(
  t: TicketMotor,
  tasaComision?: number | null,
  nCorredoresOpt?: number | null
): ResultadoMotor {
  const tasa =
    typeof tasaComision === "number" && isFinite(tasaComision) && tasaComision >= 0
      ? tasaComision
      : TASA_DEFECTO;

  const nom = parsearNomenclatura(t.tipo_jugada);
  if (!nom) {
    return {
      ok: false,
      motivo: "BLOQUEO DE PIZARRA / Nomenclatura inválida: " + t.tipo_jugada,
      totalClienteNeto: 0,
      balanceBanca: t.monto,
      gananciaCasa: 0,
      totalRival: 0,
    };
  }

  const nCorredores = nCorredoresOpt ?? t.n_corredores;
  if (typeof nCorredores === "number" && Number.isFinite(nCorredores)) {
    const minReq = minimoCorredoresDeNomenclatura(nom);
    if (nCorredores < minReq) {
      // Regla 1.3: Anulación automática en liquidación si hubo retiros posteriores que rompen el riesgo bilateral
      return finalizar(
        false,
        `ANULADA por falta de riesgo bilateral (${t.tipo_jugada} requiere mínimo ${minReq} corredores y corren ${nCorredores}): se devuelve el capital`,
        t.monto,
        t.monto,
        tasa,
        0
      );
    }
  }

  const r = resolverJugada(nom, String(t.caballo ?? ""));

  // Verificación de ejemplares retirados (Regla 5):
  const pizarraObj = t.pizarra as Record<string, unknown> | undefined;
  const retiradosRaw = (t as Record<string, unknown>).retirados ?? pizarraObj?.retirados;
  const listaRetirados = (Array.isArray(retiradosRaw) ? retiradosRaw : []).map((x) =>
    String(x).trim().replace(/^#/, "").replace(/^0+(?=\d)/, "")
  );
  if (listaRetirados.length > 0) {
    const todosCaballos = [...r.ladoA, ...r.ladoB].map((c) =>
      String(c).trim().replace(/^#/, "").replace(/^0+(?=\d)/, "")
    );
    const hayRetirado = todosCaballos.some((c) => listaRetirados.includes(c));
    if (hayRetirado) {
      return finalizar(
        false,
        `ANULADA / RETIRADO: Uno o más ejemplares apostados figuran como retirados. Se devuelve el capital íntegro.`,
        t.monto,
        t.monto,
        tasa,
        0
      );
    }
  }

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

export type EntradaCrucePuestos = {
  /** Identidad del cliente (cliente_juega_id / cliente1). Sin cliente no cruza. */
  cliente: string;
  /** true = la jugada ganó (bruto > monto). */
  ok: boolean;
  /** Bruto devuelto por la jugada ANTES de comisión (incluye el monto de vuelta). */
  bruto: number;
  /** Monto arriesgado en la jugada. */
  monto: number;
  /** Ejemplar de la jugada; habilita distinguir las dos modalidades de cruce. */
  caballo?: string;
  /** Jugada anulada/retirada: NO participa del cruce. */
  anulada?: boolean;
};

export interface ModalidadesCruce {
  mismoEjemplar: boolean;
  diferenteEjemplar: boolean;
}

export interface OpcionesCrucesPuestos {
  grupo?: Partial<ModalidadesCruce>;
  porJugadorPermanente?: Record<string, Partial<ModalidadesCruce>>;
  carreraTodosOverride?: Partial<ModalidadesCruce>;
  carreraPorJugadorOverride?: Record<string, Partial<ModalidadesCruce>>;
}

export type OrigenCrucePuestos = "Grupo" | "Ficha Usuario" | "Solo Carrera - Todos" | "Solo Carrera - Jugador";

export type ReglaCrucePuestos = {
  activo: boolean;
  origen: OrigenCrucePuestos;
};

/** Resuelve cada modalidad independientemente, respetando la prioridad por jugador y carrera. */
export function resolverReglaCrucePuestos(
  opciones: OpcionesCrucesPuestos,
  jugador: string,
  modalidad: keyof ModalidadesCruce
): ReglaCrucePuestos {
  const clave = String(jugador ?? "").trim().toUpperCase();
  const reglasJugador = (reglas: Record<string, Partial<ModalidadesCruce>> | undefined) =>
    Object.entries(reglas ?? {}).find(([nombre]) => nombre.trim().toUpperCase() === clave)?.[1];
  const niveles: Array<{ valores?: Partial<ModalidadesCruce>; origen: OrigenCrucePuestos }> = [
    { valores: clave ? reglasJugador(opciones.carreraPorJugadorOverride) : undefined, origen: "Solo Carrera - Jugador" },
    { valores: opciones.carreraTodosOverride, origen: "Solo Carrera - Todos" },
    { valores: clave ? reglasJugador(opciones.porJugadorPermanente) : undefined, origen: "Ficha Usuario" },
    { valores: opciones.grupo, origen: "Grupo" },
  ];
  for (const nivel of niveles) {
    const valor = nivel.valores?.[modalidad];
    if (typeof valor === "boolean") return { activo: valor, origen: nivel.origen };
  }
  return { activo: false, origen: "Grupo" };
}

export type LiquidacionCrucePuestosCliente = {
  cliente: string;
  ganadoBruto: number; // suma de (bruto − monto) de tickets ganadores
  perdidoBruto: number; // suma de montos de tickets perdedores
  neto: number; // ganadoBruto − perdidoBruto
  baseComision: number; // max(0, neto) si permiteCruces, else ganadoBruto
  comision: number; // baseComision * pct / 100
  netoCliente: number; // (ganado − perdido) − comision
  permiteCruces: boolean;
  participantes: number; // cantidad de tickets que participan
  modalidadesAplicadas: Array<{ modalidad: keyof ModalidadesCruce; origen: OrigenCrucePuestos }>;
  explicacionCruce?: string;
};

export function calcularLiquidacionPuestosCarrera(
  entradas: EntradaCrucePuestos[],
  opts: (OpcionesCrucesPuestos & { pctComision: number }) | { permiteCruces: boolean; pctComision: number }
): LiquidacionCrucePuestosCliente[] {
  const participantes: EntradaCrucePuestos[] = (entradas ?? []).filter((e) => !e.anulada);
  const porCliente = new Map<string, EntradaCrucePuestos[]>();
  for (const e of participantes) {
    const c = String(e.cliente ?? "").trim();
    if (!c) continue;
    const arr = porCliente.get(c) ?? [];
    arr.push(e);
    porCliente.set(c, arr);
  }
  const pct = Number(opts.pctComision);
  const esLegacy = "permiteCruces" in opts;
  const result: LiquidacionCrucePuestosCliente[] = [];
  for (const [cliente, arr] of porCliente) {
    let ganadoBruto = 0;
    let perdidoBruto = 0;
    let perdidaCruzada = 0;
    const modalidadesAplicadas: LiquidacionCrucePuestosCliente["modalidadesAplicadas"] = [];
    const ganancias = arr
      .filter((e) => e.ok)
      .map((e) => ({ entrada: e, disponible: Math.max(0, Number(e.bruto) - Number(e.monto)) }));
    const perdidas = arr.filter((e) => !e.ok);
    for (const e of arr) {
      if (e.ok) ganadoBruto += e.bruto - e.monto;
      else perdidoBruto += e.monto;
    }
    const neto = ganadoBruto - perdidoBruto;
    let baseComision = ganadoBruto;
    if (esLegacy) {
      const permite = opts.permiteCruces === true;
      baseComision = permite ? (neto > 0 ? neto : 0) : ganadoBruto;
      if (permite && perdidoBruto > 0 && ganadoBruto > 0) {
        modalidadesAplicadas.push({ modalidad: "mismoEjemplar", origen: "Grupo" });
      }
    } else {
      for (const perdida of perdidas) {
        let disponible = Number(perdida.monto) || 0;
        for (const ganancia of ganancias) {
          if (disponible <= 0 || ganancia.disponible <= 0) continue;
          const mismo = String(perdida.caballo ?? "").trim().toUpperCase() ===
            String(ganancia.entrada.caballo ?? "").trim().toUpperCase();
          const modalidad: keyof ModalidadesCruce = mismo ? "mismoEjemplar" : "diferenteEjemplar";
          if (!String(perdida.caballo ?? "").trim() || !String(ganancia.entrada.caballo ?? "").trim()) continue;
          const regla = resolverReglaCrucePuestos(opts, cliente, modalidad);
          if (!regla.activo) continue;
          const neteado = Math.min(disponible, ganancia.disponible);
          disponible -= neteado;
          ganancia.disponible -= neteado;
          perdidaCruzada += neteado;
          if (!modalidadesAplicadas.some((m) => m.modalidad === modalidad && m.origen === regla.origen)) {
            modalidadesAplicadas.push({ modalidad, origen: regla.origen });
          }
        }
      }
      baseComision = Math.max(0, ganadoBruto - perdidaCruzada);
    }
    const comision = baseComision > 0 ? round2(baseComision * (pct / 100)) : 0;
    const netoCliente = round2(neto - comision);
    result.push({
      cliente,
      ganadoBruto: round2(ganadoBruto),
      perdidoBruto: round2(perdidoBruto),
      neto: round2(neto),
      baseComision: round2(baseComision),
      comision: round2(comision),
      netoCliente,
      permiteCruces: baseComision < ganadoBruto,
      participantes: arr.length,
      modalidadesAplicadas,
      explicacionCruce: perdidaCruzada > 0
        ? `Ganancia ${round2(ganadoBruto)} vs ${round2(perdidaCruzada)} → comisión sobre ${round2(baseComision)}`
        : undefined,
    });
  }
  return result;
}

export function procesarPuestos(t: TicketMotor): ResultadoMotor {
  return liquidarPuestos(t);
}

/**
 * Construye una pizarra sintética donde el ejemplar "1" llega en la posición `posicion` (1..8 o fuera de pizarra).
 */
function pizarraParaPosicion(posicion: number, caballo = "1"): PizarraCarrera {
  const campos = ["primero", "segundo", "tercero", "cuarto", "quinto", "sexto", "septimo", "octavo"] as const;
  const pizarra: PizarraCarrera = { primero: "" };
  const rellenos = ["91", "92", "93", "94", "95", "96", "97", "98"];
  campos.forEach((c, idx) => {
    pizarra[c] = idx + 1 === posicion ? caballo : (rellenos.shift() ?? "");
  });
  return pizarra;
}

/**
 * Evalúa cualquier jugada de puestos (Individual, Combinada o Bloque en Escalera)
 * directamente para una posición de llegada `posicion`, monto `monto`, tasa `tasaComision`
 * y cantidad opcional de ejemplares efectivos `nCorredores`.
 */
export function evaluarPuestoPorPosicion(
  bet: string,
  posicion: number,
  monto: number,
  tasaComision: number = TASA_DEFECTO,
  nCorredores?: number | null
): ResultadoMotor {
  const ticket: TicketMotor = {
    hipodromo: "SSOT",
    carrera: "1",
    caballo: "1",
    fechas: [],
    id: `ssot-${bet}-${posicion}`,
    cruces: 1,
    cuota: null,
    total: monto,
    addedAt: 0,
    tipo_jugada: bet,
    monto,
    puesto_final: posicion <= 8 ? posicion : "SOC",
    pizarra: pizarraParaPosicion(posicion, "1"),
    dividendos: null,
    n_corredores: nCorredores ?? null,
  };
  return liquidarPuestos(ticket, tasaComision, nCorredores);
}

/**
 * Liquida cualquier jugada de puestos (Reglas 1, 2, 3 y 4) devolviendo el desglose
 * bruto y neto de Jugador y Banquero con la comisión del 5% aplicada únicamente sobre
 * la ganancia neta positiva consolidada.
 */
export function liquidarPuesto(
  bet: string,
  posicion: number,
  monto: number,
  nCorredores?: number | null,
  tasaComision: number = TASA_DEFECTO
): LiquidationResult {
  const res = evaluarPuestoPorPosicion(bet, posicion, monto, tasaComision, nCorredores);
  const playerBruto = round2(res.totalClienteNeto + res.gananciaCasa);
  const netoJugadorBruto = round2(playerBruto - monto);
  const comision = res.gananciaCasa;
  const netoJugador = round2(res.totalClienteNeto - monto);
  const comisionBanquero = netoJugadorBruto < 0 ? round2(-netoJugadorBruto * (tasaComision / 100)) : 0;
  const netoBanquero = netoJugadorBruto < 0 ? round2(-netoJugadorBruto - comisionBanquero) : round2(-netoJugadorBruto);
  const anuladaPorRiesgo = /ANULADA por falta de riesgo bilateral/i.test(res.motivo ?? "");
  return {
    netoJugadorBruto,
    netoJugador,
    netoBanquero,
    playerBruto,
    player: res.totalClienteNeto,
    banker: res.balanceBanca,
    comision,
    draw: netoJugadorBruto === 0,
    anuladaPorRiesgo,
  };
}

export function aplicarComision(res: LiquidationResult, tasaPct: number = TASA_DEFECTO): LiquidationResult {
  if (res.netoJugadorBruto <= 0) return res;
  const comision = round2(res.netoJugadorBruto * (tasaPct / 100));
  return {
    ...res,
    comision,
    netoJugador: round2(res.netoJugadorBruto - comision),
    player: round2(res.playerBruto - comision),
    banker: round2(res.banker),
  };
}

export const Puestos = {
  validar: validarPuesto,
  minimoCorredores: minimoCorredoresRequeridos,
  liquidar: liquidarPuesto,
  liquidarTicket: liquidarPuestos,
  evaluarPorPosicion: evaluarPuestoPorPosicion,
  aplicarComision,
  escalera: ESCALERA_PROGRESION_PUESTOS,
  tabla: TABLA_JUGADAS,
  multiplicador: calcularMultiplicadorJugada,
  logicaGanancias,
  normalizarPremio: normalizarJugadaPremio,
  normalizarCodigo: normalizarCodigoJugada,
  extraerEjemplares: extraerEjemplaresMultiples,
  mejorPos: getMejorPos,
  riesgoCliente2: calcularRiesgoCliente2,
};

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
