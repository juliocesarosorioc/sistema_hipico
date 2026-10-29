/**
 * WPS Incentivos y Tabla Oficial de Venezuela (Boleto 100,00 Bs.)
 * 
 * Modulo puro:
 * 1. Tabla canonica de dividendos del INH (Venezuela) para boletos de 100 Bs.
 * 2. Motor de evaluacion y ajuste de incentivos (suma fija o rangos de precios "llevalo a").
 * 3. Parser especializado de jugadas WPS: "Jugador win Ejemplar Monto", "Jugador place...", etc.
 */

import { redondearCentavos } from "@/shared/lib/dinero";

/** Rango de precio para incentivos por escalon (ej: de 2.10 a 2.50 llevalo a 2.50) */
export type RangoIncentivoWps = {
  id?: string;
  min: number;
  max: number;
  llevarA?: number;
  sumar?: number;
};

/** Configuracion de incentivos para Win, Place y Show */
export type ConfiguracionIncentivosWps = {
  activo: boolean;
  /** Suma fija por modalidad o general */
  sumaFijaWin: number;
  sumaFijaPlace: number;
  sumaFijaShow: number;
  /** Rangos de escalones de precios (bracker / tiers) */
  rangos: RangoIncentivoWps[];
  /** Si esta activo, interpreta dividendos venezolanos de boleto de 100 Bs */
  aplicarTablaVenezuela: boolean;
  /** Minimo garantizado fijado por el principal */
  minimoGarantizado?: number;
};

export const CONFIG_WPS_DEFECTO: ConfiguracionIncentivosWps = {
  activo: true,
  sumaFijaWin: 0,
  sumaFijaPlace: 0,
  sumaFijaShow: 0,
  rangos: [
    { id: "r1", min: 2.1, max: 2.5, llevarA: 2.5 },
    { id: "r2", min: 2.51, max: 3.0, llevarA: 3.0 },
    { id: "r3", min: 3.01, max: 3.5, llevarA: 3.5 },
    { id: "r4", min: 3.51, max: 4.0, llevarA: 4.0 },
    { id: "r5", min: 4.01, max: 5.0, llevarA: 5.0 },
  ],
  aplicarTablaVenezuela: true,
  minimoGarantizado: 2.2,
};

/* ────────────────────────── 1. TABLA OFICIAL DE VENEZUELA ────────────────────────── */
/**
 * Tabla oficial: "¿CUANTO PAGA SU EJEMPLAR? VALOR DEL BOLETO 100,00 BS."
 * Mapeo de proporciones tradicionales venezolanas (Gaceta Hipica / INH).
 */
export type EntradaTablaVenezuela = {
  clave: string;
  montoBs: number;
  factorDecimal: number;
  descripcion: string;
};

export const TABLA_VENEZUELA_FRACCIONES: EntradaTablaVenezuela[] = [
  { clave: "1-9", montoBs: 110.0, factorDecimal: 1.1, descripcion: "1 a 9 (Bs. 110,00)" },
  { clave: "1-5", montoBs: 120.0, factorDecimal: 1.2, descripcion: "1 a 5 (Bs. 120,00)" },
  { clave: "2-5", montoBs: 140.0, factorDecimal: 1.4, descripcion: "2 a 5 (Bs. 140,00)" },
  { clave: "1-2", montoBs: 150.0, factorDecimal: 1.5, descripcion: "1 a 2 (Bs. 150,00)" },
  { clave: "3-5", montoBs: 160.0, factorDecimal: 1.6, descripcion: "3 a 5 (Bs. 160,00)" },
  { clave: "4-5", montoBs: 180.0, factorDecimal: 1.8, descripcion: "4 a 5 (Bs. 180,00)" },
  { clave: "6-5", montoBs: 220.0, factorDecimal: 2.2, descripcion: "6 a 5 (Bs. 220,00)" },
  { clave: "7-5", montoBs: 240.0, factorDecimal: 2.4, descripcion: "7 a 5 (Bs. 240,00)" },
  { clave: "3-2", montoBs: 250.0, factorDecimal: 2.5, descripcion: "3 a 2 (Bs. 250,00)" },
  { clave: "8-5", montoBs: 260.0, factorDecimal: 2.6, descripcion: "8 a 5 (Bs. 260,00)" },
  { clave: "9-5", montoBs: 280.0, factorDecimal: 2.8, descripcion: "9 a 5 (Bs. 280,00)" },
  { clave: "5-2", montoBs: 305.0, factorDecimal: 3.05, descripcion: "5 a 2 (Bs. 305,00)" },
  { clave: "7-2", montoBs: 450.0, factorDecimal: 4.5, descripcion: "7 a 2 (Bs. 450,00)" },
  { clave: "9-2", montoBs: 550.0, factorDecimal: 5.5, descripcion: "9 a 2 (Bs. 550,00)" },
];

/** Mapa de busqueda rapida para fracciones (soporta "1-9", "1/9", "1 a 9", "1:9") */
const MAPA_FRACCIONES_VENEZUELA = new Map<string, EntradaTablaVenezuela>();

TABLA_VENEZUELA_FRACCIONES.forEach((e) => {
  const normGuion = e.clave.toLowerCase();
  const normBarra = normGuion.replace("-", "/");
  const normA = normGuion.replace("-", " a ");
  MAPA_FRACCIONES_VENEZUELA.set(normGuion, e);
  MAPA_FRACCIONES_VENEZUELA.set(normBarra, e);
  MAPA_FRACCIONES_VENEZUELA.set(normA, e);
});

/**
 * Resuelve una proporcion o monto segun la tabla de Venezuela.
 * Si es fraccion ("3-2", "5/2"), devuelve el factor exacto tabulado.
 * Si es entero N (1 a 99), devuelve (N + 1).
 * Si es monto directo en bolivares (ej. 250 Bs por cada 100 Bs), devuelve factor 2.50.
 */
export function resolverDividendoVenezuela(input: string | number): EntradaTablaVenezuela | null {
  if (typeof input === "number") {
    if (!Number.isFinite(input) || input <= 0) return null;
    // Si viene como entero entre 1 y 99 (proporcion N a 1)
    if (Number.isInteger(input) && input >= 1 && input <= 99) {
      const montoBs = (input + 1) * 100;
      return {
        clave: String(input),
        montoBs,
        factorDecimal: input + 1,
        descripcion: `${input} a 1 (Bs. ${montoBs.toLocaleString("es-VE", { minimumFractionDigits: 2 })})`,
      };
    }
    // Si viene como factor decimal directo (ej. 2.50)
    return {
      clave: String(input),
      montoBs: Math.round(input * 100 * 100) / 100,
      factorDecimal: input,
      descripcion: `Factor ${input.toFixed(2)}`,
    };
  }

  const raw = String(input ?? "").trim().toLowerCase();
  if (!raw) return null;

  // 1. Busqueda en fracciones tabuladas
  const limpia = raw.replace(/\s+/g, " ").replace(/[:_]/g, "-");
  const matchFraccion = MAPA_FRACCIONES_VENEZUELA.get(limpia);
  if (matchFraccion) return matchFraccion;

  // 2. Si es formato "Bs. 250" o "250 bs" o "250,00"
  const mBs = raw.match(/^(?:bs\.?\s*)?(\d+(?:[.,]\d+)?)(?:\s*bs\.?)?$/i);
  if (mBs) {
    const val = parseFloat(mBs[1].replace(",", "."));
    if (Number.isFinite(val) && val > 0) {
      // Si el valor es >= 100 (ej: 110, 250, 600, 2600): es el valor del boleto de 100 Bs
      if (val >= 100) {
        const factor = redondearCentavos(val / 100);
        return {
          clave: `Bs. ${val}`,
          montoBs: val,
          factorDecimal: factor,
          descripcion: `Boleto Bs. ${val.toFixed(2)} → ${factor.toFixed(2)}x`,
        };
      }
      // Si es un entero de proporcion 1 a 99
      if (Number.isInteger(val) && val >= 1 && val <= 99) {
        const montoBs = (val + 1) * 100;
        return {
          clave: String(val),
          montoBs,
          factorDecimal: val + 1,
          descripcion: `${val} a 1 (Bs. ${montoBs.toFixed(2)})`,
        };
      }
      // Es factor decimal directo (ej. 2.40)
      return {
        clave: String(val),
        montoBs: redondearCentavos(val * 100),
        factorDecimal: val,
        descripcion: `Factor ${val.toFixed(2)}`,
      };
    }
  }

  // 3. Proporcion generica a-b o a/b
  const mFrac = raw.match(/^(\d+)\s*[-/a]\s*(\d+)$/);
  if (mFrac) {
    const a = parseInt(mFrac[1], 10);
    const b = parseInt(mFrac[2], 10);
    if (a > 0 && b > 0) {
      const factor = redondearCentavos(1 + a / b);
      const montoBs = redondearCentavos(factor * 100);
      return {
        clave: `${a}-${b}`,
        montoBs,
        factorDecimal: factor,
        descripcion: `${a} a ${b} (Bs. ${montoBs.toFixed(2)})`,
      };
    }
  }

  return null;
}

/* ────────────────────────── 2. MOTOR DE INCENTIVOS ────────────────────────── */

export type ResultadoCalculoDividendo = {
  dividendoBase: number;
  dividendoFinal: number;
  incentivoTotal: number;
  ajusteRango: number;
  sumaFija: number;
  reglaAplicada: string;
};

/**
 * Aplica los incentivos configurados a un dividendo base:
 * 1. Primero verifica rangos de escalones de precios (ej. de 2.10 a 2.50 llevalo a 2.50).
 * 2. Aplica la suma fija segun la modalidad (Win, Place o Show).
 * 3. Garantiza el minimo si esta configurado.
 */
export function calcularDividendoConIncentivos(
  dividendoBase: number,
  config: Partial<ConfiguracionIncentivosWps> | null | undefined,
  tipo: "W" | "P" | "S" = "W"
): ResultadoCalculoDividendo {
  const base = redondearCentavos(Math.max(0, dividendoBase));
  if (!config || !config.activo || base <= 0) {
    return {
      dividendoBase: base,
      dividendoFinal: base,
      incentivoTotal: 0,
      ajusteRango: 0,
      sumaFija: 0,
      reglaAplicada: "Sin incentivos aplicados",
    };
  }

  let dividendoActual = base;
  let ajusteRango = 0;
  let reglaRango = "";

  // 1. Evaluar rangos de precios (escalones)
  if (Array.isArray(config.rangos) && config.rangos.length > 0) {
    for (const r of config.rangos) {
      if (dividendoActual >= r.min && dividendoActual <= r.max) {
        if (r.llevarA !== undefined && r.llevarA > dividendoActual) {
          ajusteRango = redondearCentavos(r.llevarA - dividendoActual);
          dividendoActual = r.llevarA;
          reglaRango = `Rango [${r.min.toFixed(2)} - ${r.max.toFixed(2)}] → Llevado a ${r.llevarA.toFixed(2)}`;
        } else if (r.sumar !== undefined && r.sumar > 0) {
          ajusteRango = redondearCentavos(r.sumar);
          dividendoActual = redondearCentavos(dividendoActual + r.sumar);
          reglaRango = `Rango [${r.min.toFixed(2)} - ${r.max.toFixed(2)}] → +${r.sumar.toFixed(2)}`;
        }
        break; // Aplica el primer rango coincidente
      }
    }
  }

  // 2. Evaluar suma fija por modalidad
  let sumaFija = 0;
  if (tipo === "W" && config.sumaFijaWin && config.sumaFijaWin > 0) {
    sumaFija = redondearCentavos(config.sumaFijaWin);
  } else if (tipo === "P" && config.sumaFijaPlace && config.sumaFijaPlace > 0) {
    sumaFija = redondearCentavos(config.sumaFijaPlace);
  } else if (tipo === "S" && config.sumaFijaShow && config.sumaFijaShow > 0) {
    sumaFija = redondearCentavos(config.sumaFijaShow);
  }

  dividendoActual = redondearCentavos(dividendoActual + sumaFija);

  // 3. Minimo garantizado (si aplica)
  if (config.minimoGarantizado && config.minimoGarantizado > dividendoActual) {
    dividendoActual = redondearCentavos(config.minimoGarantizado);
  }

  const incentivoTotal = redondearCentavos(dividendoActual - base);
  const detalles: string[] = [];
  if (reglaRango) detalles.push(reglaRango);
  if (sumaFija > 0) detalles.push(`Suma fija ${tipo}: +${sumaFija.toFixed(2)}`);
  if (config.minimoGarantizado && dividendoActual === config.minimoGarantizado && base < config.minimoGarantizado) {
    detalles.push(`Piso minimo garantizado: ${config.minimoGarantizado.toFixed(2)}`);
  }

  return {
    dividendoBase: base,
    dividendoFinal: dividendoActual,
    incentivoTotal,
    ajusteRango,
    sumaFija,
    reglaAplicada: detalles.length > 0 ? detalles.join(" · ") : "Dividendo estandar",
  };
}

/**
 * Calcula el pago total para una apuesta WPS:
 * Pago = monto_en_riesgo * (dividendoBase + incentivo)
 */
export function calcularPagoWps(
  montoRiesgo: number,
  dividendoBase: number,
  config: Partial<ConfiguracionIncentivosWps> | null | undefined,
  tipo: "W" | "P" | "S" = "W"
): {
  montoRiesgo: number;
  dividendoBase: number;
  dividendoFinal: number;
  incentivoTotal: number;
  pagoTotal: number;
  gananciaNeta: number;
  reglaAplicada: string;
} {
  const monto = redondearCentavos(Math.max(0, montoRiesgo));
  const calc = calcularDividendoConIncentivos(dividendoBase, config, tipo);
  const pagoTotal = redondearCentavos(monto * calc.dividendoFinal);
  const gananciaNeta = redondearCentavos(pagoTotal - monto);

  return {
    montoRiesgo: monto,
    dividendoBase: calc.dividendoBase,
    dividendoFinal: calc.dividendoFinal,
    incentivoTotal: calc.incentivoTotal,
    pagoTotal,
    gananciaNeta,
    reglaAplicada: calc.reglaAplicada,
  };
}

/* ────────────────────────── 3. PARSER DE JUGADAS WPS ────────────────────────── */

export type ModalidadWps = "WIN" | "PLACE" | "SHOW";

export type ApuestaWpsParseada = {
  lineaOriginal: string;
  jugador: string;
  modalidad: ModalidadWps;
  tipoWps: "W" | "P" | "S";
  ejemplar: string;
  monto: number;
  esWpsCombo: boolean;
};

/**
 * Parsea lineas con el formato solicitado por el usuario:
 * - "Jugador win Ejemplar Monto"
 * - "Jugador place Ejemplar Monto"
 * - "Jugador show Ejemplar Monto"
 * - "Jugador WPS Ejemplar Monto" (se expande a 3 jugadas: WIN, PLACE, SHOW)
 */
export function parsearLineaWps(linea: string): ApuestaWpsParseada[] {
  const raw = String(linea ?? "").trim();
  if (!raw || raw.startsWith("#")) return [];

  // Expresion regular flexible para: <Jugador> <win|place|show|wps> <ejemplar> <monto>
  // Acepta cualquier orden o separadores de miles y decimales
  const regex = /^(.*?)\s+(win|place|show|wps|w\.p\.s\.)\s+(?:(?:el|caballo|ejemplar|n[°º]?)\s+)?(\d{1,2}(?:[-,]\d{1,2})?)\s+(?:(?:con|por|monto|\$|bs\.?)\s*)?(\d+(?:[.,]\d+)?)\s*$/i;
  const match = raw.match(regex);

  if (!match) {
    // Intento con formato alternativo: <win|place|show|wps> <ejemplar> <monto> <jugador>
    const regexAlt = /^(win|place|show|wps|w\.p\.s\.)\s+(?:(?:el|caballo|ejemplar|n[°º]?)\s+)?(\d{1,2}(?:[-,]\d{1,2})?)\s+(\d+(?:[.,]\d+)?)\s+(?:(?:de|para|jugador)\s+)?(.*?)$/i;
    const matchAlt = raw.match(regexAlt);
    if (!matchAlt) return [];

    const mod = matchAlt[1].toLowerCase().replace(/\./g, "");
    const ejemplar = matchAlt[2].trim();
    const monto = parseFloat(matchAlt[3].replace(",", "."));
    const jugador = matchAlt[4].trim() || "Cliente";

    return expandirModalidadesWps(raw, jugador, mod, ejemplar, monto);
  }

  const jugador = match[1].trim() || "Cliente";
  const mod = match[2].toLowerCase().replace(/\./g, "");
  const ejemplar = match[3].trim();
  const monto = parseFloat(match[4].replace(",", "."));

  return expandirModalidadesWps(raw, jugador, mod, ejemplar, monto);
}

function expandirModalidadesWps(
  lineaOriginal: string,
  jugador: string,
  mod: string,
  ejemplar: string,
  monto: number
): ApuestaWpsParseada[] {
  if (!Number.isFinite(monto) || monto <= 0) return [];

  // Si es WPS: genera las 3 apuestas (WIN, PLACE, SHOW)
  if (mod === "wps") {
    return [
      {
        lineaOriginal,
        jugador,
        modalidad: "WIN",
        tipoWps: "W",
        ejemplar,
        monto,
        esWpsCombo: true,
      },
      {
        lineaOriginal,
        jugador,
        modalidad: "PLACE",
        tipoWps: "P",
        ejemplar,
        monto,
        esWpsCombo: true,
      },
      {
        lineaOriginal,
        jugador,
        modalidad: "SHOW",
        tipoWps: "S",
        ejemplar,
        monto,
        esWpsCombo: true,
      },
    ];
  }

  if (mod === "win" || mod === "w") {
    return [
      {
        lineaOriginal,
        jugador,
        modalidad: "WIN",
        tipoWps: "W",
        ejemplar,
        monto,
        esWpsCombo: false,
      },
    ];
  }

  if (mod === "place" || mod === "p") {
    return [
      {
        lineaOriginal,
        jugador,
        modalidad: "PLACE",
        tipoWps: "P",
        ejemplar,
        monto,
        esWpsCombo: false,
      },
    ];
  }

  if (mod === "show" || mod === "s") {
    return [
      {
        lineaOriginal,
        jugador,
        modalidad: "SHOW",
        tipoWps: "S",
        ejemplar,
        monto,
        esWpsCombo: false,
      },
    ];
  }

  return [];
}

/**
 * Parsea un bloque entero de texto multilineas
 */
export function parsearBloqueWps(texto: string): {
  apuestas: ApuestaWpsParseada[];
  lineasRechazadas: string[];
} {
  const lineas = String(texto ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => Boolean(l) && !l.startsWith("#"));

  const apuestas: ApuestaWpsParseada[] = [];
  const lineasRechazadas: string[] = [];

  for (const l of lineas) {
    const res = parsearLineaWps(l);
    if (res.length > 0) {
      apuestas.push(...res);
    } else {
      lineasRechazadas.push(l);
    }
  }

  return { apuestas, lineasRechazadas };
}
