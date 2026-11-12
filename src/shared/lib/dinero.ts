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
  const fraccionDecimal = (valor: number): { numerador: number; denominador: number } | null => {
    const texto = String(valor).toLowerCase();
    const match = /^([+-]?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/.exec(texto);
    if (!match) return null;
    const decimales = match[3] ?? "";
    const exponente = Number(match[4] ?? 0);
    let numerador = Number(`${match[2]}${decimales}`);
    const escala = decimales.length - exponente;
    let denominador = 1;
    if (escala > 0) denominador = 10 ** escala;
    else if (escala < 0) numerador *= 10 ** -escala;
    if (match[1] === "-") numerador = -numerador;
    if (!Number.isSafeInteger(numerador) || !Number.isSafeInteger(denominador)) return null;
    return { numerador, denominador };
  };
  const n = fraccionDecimal(num);
  const d = fraccionDecimal(den);
  if (!n || !d) return deCentavos(Math.round((aCentavos(monto) * num) / den));
  const numerador = n.numerador * d.denominador;
  const divisor = n.denominador * d.numerador;
  const totalCentavos = aCentavos(monto);
  const producto = totalCentavos * numerador;
  if (
    !Number.isSafeInteger(numerador) ||
    !Number.isSafeInteger(divisor) ||
    !Number.isSafeInteger(producto)
  ) {
    return deCentavos(Math.round((totalCentavos * num) / den));
  }
  const absoluto = Math.abs(producto);
  let centavos = Math.floor(absoluto / divisor);
  const resto = absoluto % divisor;
  if (resto * 2 >= divisor) centavos += 1;
  if (producto < 0) centavos = -centavos;
  return deCentavos(centavos);
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
 * Formatea un monto numérico en formato local `es-VE` (ej. `1.000,00` o `43,50`)
 * ESTRICTAMENTE SIN SÍMBOLOS DE MONEDA (`$`, `Bs`, `USD`, `VES`).
 */
export function formatearMontoSinMoneda(v: unknown, decimales: 0 | 2 = 2): string {
  const exacto = redondearCentavos(v);
  return decimales === 0 ? FMT_ES_VE_0.format(Math.round(exacto)) : FMT_ES_VE_2.format(exacto);
}

/**
 * Formatea un monto con la configuración regional venezolana (coma `,` como separador decimal,
 * ej. `43,50`, `100,00`). Si `ocultarCerosEnteros` es `true`, muestra enteros sin `,00` y
 * decimales con `,XX` (ej. `100` y `43,50`).
 */
export function formatearMontoRegional(
  v: unknown,
  opciones?: { ocultarCerosEnteros?: boolean }
): string {
  const exacto = redondearCentavos(v);
  if (opciones?.ocultarCerosEnteros && Number.isInteger(exacto)) {
    return FMT_ES_VE_0.format(exacto);
  }
  return FMT_ES_VE_2.format(exacto);
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

export function esGrupoBolivares(moneda?: string | null): boolean {
  const m = String(moneda || "").toUpperCase().trim();
  return m === "VES" || m === "BS" || m === "BS." || m === "BOLIVAR" || m === "BOLIVARES";
}

export function prefijoMonedaGrupo(moneda?: string | null): string {
  return esGrupoBolivares(moneda) ? "Bs. " : "$";
}

export interface MontoParseado {
  monto: number;
  textoPublicacion: string;
  esKilo: boolean;
}

/**
 * Parsea e interpreta montos numéricos ingresados por jugadores:
 * - 5k -> 5.000 (monto: 5000, textoPublicacion: "5k")
 * - 10k -> 10.000 (monto: 10000, textoPublicacion: "10k")
 * - 10.424,50 -> 10424.50 (textoPublicacion: "10.424,50")
 * - 5.000 -> 5000 (textoPublicacion: "5.000")
 * - 10.000 -> 10000 (textoPublicacion: "10.000")
 * - 20.000 -> 20000 (textoPublicacion: "20.000")
 * - 100 -> 100
 */
export function parsearMontoConK(rawInput: string): MontoParseado | null {
  if (!rawInput) return null;
  const limpio = rawInput.trim().replace(/^[\$Bs\.\s]+/i, "").trim();
  if (!limpio) return null;

  // 1. Detectar sufijo k / K (ej: 5k, 10k, 20k, 50k, 100k, 2.5k, 2,5k)
  const matchK = /^(\d+(?:[\.,]\d+)?)\s*k$/i.exec(limpio);
  if (matchK) {
    const base = parseFloat(matchK[1].replace(",", "."));
    if (Number.isFinite(base) && base > 0) {
      const monto = Math.round(base * 1000 * 100) / 100;
      return {
        monto,
        textoPublicacion: `${matchK[1].toLowerCase()}k`,
        esKilo: true,
      };
    }
  }

  // 2. Formato con puntos de miles y coma decimal (ej: "10.424,50")
  if (limpio.includes(".") && limpio.includes(",")) {
    const lastComma = limpio.lastIndexOf(",");
    const lastDot = limpio.lastIndexOf(".");
    let numStr = limpio;
    if (lastComma > lastDot) {
      numStr = limpio.replace(/\./g, "").replace(",", ".");
    } else {
      numStr = limpio.replace(/,/g, "");
    }
    const monto = parseFloat(numStr);
    if (Number.isFinite(monto) && monto > 0) {
      return {
        monto: Math.round(monto * 100) / 100,
        textoPublicacion: limpio,
        esKilo: false,
      };
    }
  }

  // 3. Puntos de miles solos (ej: "5.000", "10.000", "20.000", "50.000", "100.000")
  if (/^\d{1,3}(?:\.\d{3})+$/.test(limpio)) {
    const monto = parseFloat(limpio.replace(/\./g, ""));
    if (Number.isFinite(monto) && monto > 0) {
      return {
        monto: Math.round(monto * 100) / 100,
        textoPublicacion: limpio,
        esKilo: false,
      };
    }
  }

  // 4. Coma decimal sola (ej: "43,50", "100,5")
  if (/^\d+,\d+$/.test(limpio)) {
    const monto = parseFloat(limpio.replace(",", "."));
    if (Number.isFinite(monto) && monto > 0) {
      return {
        monto: Math.round(monto * 100) / 100,
        textoPublicacion: limpio,
        esKilo: false,
      };
    }
  }

  // 5. Número estándar (ej: "100", "50", "20.5")
  const monto = parseFloat(limpio);
  if (Number.isFinite(monto) && monto > 0) {
    return {
      monto: Math.round(monto * 100) / 100,
      textoPublicacion: Number.isInteger(monto) ? String(monto) : formatearMontoRegional(monto),
      esKilo: false,
    };
  }

  return null;
}
