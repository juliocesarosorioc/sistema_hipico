/**
 * ============================================================================
 * MOTOR ARITMÉTICO CENTRALIZADO EN CENTAVOS ENTEROS (`dinero.ts`)
 * ============================================================================
 *
 * Única fuente de verdad para aritmética financiera sin errores de punto
 * flotante IEEE 754 y formateo de montos SIN símbolos de moneda ($, Bs, USD, VES).
 */

/** Convierte cualquier valor numérico o string a centavos enteros exactos. */
export function aCentavos(v: unknown): number {
  if (typeof v === "number") {
    return Number.isFinite(v) ? Math.round((v + Number.EPSILON) * 100) : 0;
  }
  if (typeof v === "string") {
    const limpio = v.trim().replace(/\s+/g, "");
    if (!limpio) return 0;
    // Soporta tanto "1.234,56" (es-VE) como "1234.56" (estándar)
    const normalizado =
      limpio.includes(",") && limpio.includes(".")
        ? limpio.lastIndexOf(",") > limpio.lastIndexOf(".")
          ? limpio.replace(/\./g, "").replace(",", ".")
          : limpio.replace(/,/g, "")
        : limpio.includes(",") && !limpio.includes(".")
          ? /,\d{1,2}$/.test(limpio)
            ? limpio.replace(",", ".")
            : limpio.replace(/,/g, "")
          : limpio;
    const n = Number(normalizado.replace(/[^0-9.-]/g, ""));
    return Number.isFinite(n) ? Math.round((n + Number.EPSILON) * 100) : 0;
  }
  return 0;
}

/** Convierte centavos enteros a número decimal con máximo 2 decimales exactos. */
export function deCentavos(centavos: number): number {
  if (!Number.isFinite(centavos)) return 0;
  const entero = Math.round(centavos);
  if (entero === 0) return 0;
  return Number((entero / 100).toFixed(2));
}

/** Redondea cualquier monto a 2 decimales operando en centavos enteros. */
export function redondearCentavos(v: unknown): number {
  return deCentavos(aCentavos(v));
}

/** Suma N valores en centavos enteros devolviendo el resultado exacto. */
export function sumarDinero(...valores: unknown[]): number {
  let totalCentavos = 0;
  for (const v of valores) {
    totalCentavos += aCentavos(v);
  }
  return deCentavos(totalCentavos);
}

/** Resta `a - b` en centavos enteros devolviendo el resultado exacto. */
export function restarDinero(a: unknown, b: unknown): number {
  return deCentavos(aCentavos(a) - aCentavos(b));
}

/** Multiplica un monto por un factor escalar en centavos enteros. */
export function multiplicarDinero(monto: unknown, factor: unknown): number {
  const f = Number(factor);
  if (!Number.isFinite(f)) return 0;
  return deCentavos(Math.round(aCentavos(monto) * f));
}

/** Divide un monto entre un divisor escalar en centavos enteros. */
export function dividirDinero(monto: unknown, divisor: unknown): number {
  const d = Number(divisor);
  if (!Number.isFinite(d) || d === 0) return 0;
  return deCentavos(Math.round(aCentavos(monto) / d));
}

/** Calcula la comisión exacta sobre un monto bruto dado un porcentaje (ej. 5%). */
export function calcularComisionExacta(bruto: unknown, comisionPct: unknown): number {
  const pct = Number(comisionPct);
  if (!Number.isFinite(pct) || pct <= 0) return 0;
  const cBruto = aCentavos(bruto);
  if (cBruto <= 0) return 0;
  return deCentavos(Math.round((cBruto * pct) / 100));
}

/**
 * Calcula la parte proporcional `monto * (rival / jugador)` en centavos enteros
 * (ej. jugadas `10Ax` / `10/8` donde `jugador = 10`, `rival = 8`).
 */
export function calcularProporcionExacta(
  monto: unknown,
  numeradorRival: unknown,
  denominadorJugador: unknown = 10
): number {
  const num = Number(numeradorRival);
  const den = Number(denominadorJugador);
  if (!Number.isFinite(num) || !Number.isFinite(den) || den <= 0 || num <= 0) {
    return redondearCentavos(monto);
  }
  return deCentavos(Math.round((aCentavos(monto) * num) / den));
}

const FMT_ES_VE_2 = new Intl.NumberFormat("es-VE", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const FMT_ES_VE_0 = new Intl.NumberFormat("es-VE", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/**
 * Formatea un monto numérico en formato local `es-VE` (ej. `1.000,00`)
 * ESTRICTAMENTE SIN SÍMBOLOS DE MONEDA (`$`, `Bs`, `USD`, `VES`).
 */
export function formatearMontoSinMoneda(v: unknown, decimales: 0 | 2 = 2): string {
  const exacto = redondearCentavos(v);
  return decimales === 0 ? FMT_ES_VE_0.format(Math.round(exacto)) : FMT_ES_VE_2.format(exacto);
}

/**
 * Elimina cualquier símbolo de moneda (`$`, `Bs.`, `Bs`, `USD`, `VES`) de un texto,
 * preservando números, signos y formato.
 */
export function limpiarSimbolosMoneda(texto: string): string {
  if (!texto) return "";
  return texto
    .replace(/\b(?:USD|VES|Bs\.?|BS\.?)\s*/gi, "")
    .replace(/\$\s*(?=[+-]?\d)/g, "")
    .replace(/([+-])\s*\$\s*(?=\d)/g, "$1");
}
