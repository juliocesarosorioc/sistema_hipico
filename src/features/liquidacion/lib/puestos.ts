/**
 * ============================================================================
 * MOTOR DE JUGADAS DE PUESTOS MULTI-EJEMPLAR Y NORMALIZACIÓN 10Ax (`puestos.ts`)
 * ============================================================================
 *
 *  1. `extraerEjemplaresMultiples`: Normaliza separadores (`y`, `Y`, `,`, `-`, `/`, `*`, `x`, espacio)
 *     para extraer el arreglo de números de ejemplares apostados (`"1y2"` -> `[1, 2]`, `"3y4"` -> `[3, 4]`).
 *  2. `getMejorPos`: Regla de evaluación por la mejor posición del grupo (`Math.min(...posiciones)`).
 *  3. `normalizarJugadaPremio`: Parser canónico para jugadas `10Ax` / `10/x` con decimales y coma/punto
 *     (`"10a7"` === `"10/7"` === `"10A7"`, `"10A3.5"` === `"10/3,5"` === `"10a3,5"` === `"10a3.5"` -> `"10A3.5"`).
 *  4. `logicaGanancias`: Evaluación completa de liquidación y riesgo de Cliente 1 y Cliente 2.
 */

import type { PizarraCarrera } from "@/features/liquidacion/lib/liquidacion";
import {
  validarPizarraSinDuplicados,
  type ValidacionUnicidadPizarra,
} from "@/features/liquidacion/lib/posiciones";

export { validarPizarraSinDuplicados, type ValidacionUnicidadPizarra };
import {
  liquidarPuestos,
  posicionesDePizarra,
  calcularLiquidacionPuestosCarrera,
  procesarPuestos,
  finalizar,
  validarPuesto,
  minimoCorredoresRequeridos,
  minimoCorredoresDeNomenclatura,
  evaluarPuestoPorPosicion,
  liquidarPuesto,
  aplicarComision,
  Puestos,
  ESCALERA_PROGRESION_PUESTOS,
  parsearNomenclatura,
  type EntradaCrucePuestos,
  type ModalidadesCruce,
  type OpcionesCrucesPuestos,
  type LiquidacionCrucePuestosCliente,
  type ValidationResult,
  type LiquidationResult,
} from "@/features/motores/lib/puestos";
import {
  TABLA_JUGADAS,
  evaluarJugadaEnEscenario,
} from "@/features/taquilla/lib/cruces-y-tapas";
import { calcularComisionExacta, calcularProporcionExacta, redondearCentavos, restarDinero } from "@/shared/lib/dinero";

export {
  liquidarPuestos,
  posicionesDePizarra,
  calcularLiquidacionPuestosCarrera,
  procesarPuestos,
  finalizar,
  validarPuesto,
  minimoCorredoresRequeridos,
  minimoCorredoresDeNomenclatura,
  evaluarPuestoPorPosicion,
  liquidarPuesto,
  aplicarComision,
  Puestos,
  ESCALERA_PROGRESION_PUESTOS,
  parsearNomenclatura,
  type EntradaCrucePuestos,
  type ModalidadesCruce,
  type OpcionesCrucesPuestos,
  type LiquidacionCrucePuestosCliente,
  type ValidationResult,
  type LiquidationResult,
};

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
 * Extrae el arreglo de números de ejemplares desde cualquier cadena con separadores
 * (`y`, `Y`, `,`, `-`, `/`, `*`, `x`, `&`, `por`, espacio).
 * Ej.: `"1y2"` -> `[1, 2]`, `"3y4"` -> `[3, 4]`, `"2 5 8"` -> `[2, 5, 8]`.
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

const ORDEN_CAMPOS_PIZARRA = [
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
 * Convierte cualquier representación de pizarra (`PizarraCarrera`, `Map<string, number>`,
 * arreglo de llegada `[1°, 2°, 3°...]` o diccionario `{ "1": 1, "2": 2 }`) en un `Map<string, number>`
 * donde la clave es el número de ejemplar (`"1"`, `"2"`) y el valor es su posición de llegada (`1..10`).
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
  ORDEN_CAMPOS_PIZARRA.forEach((campo, idx) => {
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
 * Evalúa todos los ejemplares indicados contra la pizarra oficial y devuelve la
 * mejor posición de llegada (la menor numéricamente) alcanzada por cualquiera de ellos:
 *   `mejorPos = Math.min(...posicionesDeLosEjemplares)`
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
  const codigoNormalizado = normalizarJugadaPremio(params.jugada);
  const ejemplares = extraerEjemplaresMultiples(params.caballo);
  const mapa = construirMapaPosicionesPizarra(params.pizarra);
  const mejorPos = getMejorPos(ejemplares, mapa);
  const comPct = params.comisionPct ?? 5;
  const monto = redondearCentavos(params.monto);

  const caballoTexto =
    typeof params.caballo === "string"
      ? params.caballo
      : Array.isArray(params.caballo)
        ? params.caballo.join("y")
        : String(params.caballo ?? "");

  const ev = evaluarJugadaEnEscenario(
    {
      jugador: "CLIENTE_1",
      tercio: "CLIENTE_2",
      jugada: codigoNormalizado,
      caballo: caballoTexto,
      monto,
      comisionPct: comPct,
    },
    mapa,
    comPct
  );

  const regla = TABLA_JUGADAS[codigoNormalizado];
  const factorRival = regla?.factor10Ax != null ? regla.factor10Ax : 10;
  const riesgoJugador1 = monto;
  const riesgoJugador2 =
    factorRival !== 10 ? calcularProporcionExacta(monto, factorRival, 10) : monto;

  return {
    codigoNormalizado,
    ejemplares,
    mejorPos,
    ganaJugador1: ev.netoJuega > 0,
    ganaJugador2: ev.netoDa > 0,
    empate: ev.netoJuega === 0 && ev.netoDa === 0,
    riesgoJugador1,
    riesgoJugador2,
    netoJugador1: ev.netoJuega,
    netoJugador2: ev.netoDa,
  };
}
