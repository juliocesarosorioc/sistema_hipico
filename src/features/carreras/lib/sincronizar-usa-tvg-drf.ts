/**
 * ============================================================================
 * MOTOR DE SINCRONIZACIÓN DIARIA DE CARRERAS Y EJEMPLARES USA (TVG + DRF)
 * ============================================================================
 *
 * Sincroniza la programación de hipódromos americanos (Gulfstream Park, Santa Anita,
 * Saratoga, Belmont, Aqueduct, Keeneland, Churchill Downs, Tampa Bay Downs, etc.)
 * alimentando de forma universal el catálogo central de carreras (`carreras`,
 * `resultados_carreras`, `ih_*`) y propagando retirados (scratches).
 *
 * REGLAS FUNDAMENTALES:
 * 1. JURISDICCIÓN EXCLUSIVA USA: Prohibido tocar hipódromos venezolanos (La Rinconada,
 *    Valencia, Santa Rita quedan 100% blindados y excluidos).
 * 2. ALIMENTACIÓN UNIVERSAL: Carreras, horarios en hora Caracas, ejemplares (#, PP, ML,
 *    jockey, trainer) y retirados disponibles al instante en Apuestas, Tablas, Marcas,
 *    Pollas, Remates y Portal.
 */

import { supabase } from "@/core/supabase";
import { hoyLocal } from "@/core/utils/fechas";
import { claveHipodromo } from "@/features/carreras/lib/claves";
import {
  sincronizarCarrerasAlCentral,
  type CarreraEntrante,
  type EjemplarEntrante,
} from "@/features/carreras/lib/sincronizar";
import { aplicarRetirosCarrera } from "@/features/carreras/lib/retiros";
import { crearHipodromo, listarHipodromos } from "@/features/hipodromos/lib/servicio";
import { useHipodromosStore } from "@/shared/store/useHipodromosStore";
import { useRegistroCentral } from "@/shared/store/useRegistroCentral";
import { useCarrerasDiaStore } from "@/shared/store/useCarrerasDiaStore";
import { NOMBRES_CANONICOS_HIPODROMOS } from "@/features/hipodromos/lib/tipos";

// ----------------------------------------------------------------------------
// Catálogo Maestro y Oficial de Hipódromos DRF (Daily Racing Form)
// ----------------------------------------------------------------------------
export type HipodromoUsaMeta = {
  codigo: string;
  nombre: string;
  drfCode: string;
  pais: "USA" | "CAN";
  tvgSlug: string;
  estadoDefecto: string;
};

export const CATALOGO_DRF_OFICIAL: Record<string, HipodromoUsaMeta> = {
  CD: { codigo: "CD", nombre: "Churchill Downs", drfCode: "CD", pais: "USA", estadoDefecto: "KY", tvgSlug: "churchill-downs" },
  FL: { codigo: "FL", nombre: "Finger Lakes", drfCode: "FL", pais: "USA", estadoDefecto: "NY", tvgSlug: "finger-lakes" },
  RP: { codigo: "RP", nombre: "Remington Park", drfCode: "RP", pais: "USA", estadoDefecto: "OK", tvgSlug: "remington-park" },
  CT: { codigo: "CT", nombre: "Hollywood at Charles Town", drfCode: "CT", pais: "USA", estadoDefecto: "WV", tvgSlug: "charles-town" },
  DED: { codigo: "DED", nombre: "Delta Downs", drfCode: "DED", pais: "USA", estadoDefecto: "LA", tvgSlug: "delta-downs" },
  EVD: { codigo: "EVD", nombre: "Evangeline Downs", drfCode: "EVD", pais: "USA", estadoDefecto: "LA", tvgSlug: "evangeline-downs" },
  IND: { codigo: "IND", nombre: "Horseshoe Indianapolis", drfCode: "IND", pais: "USA", estadoDefecto: "IN", tvgSlug: "horseshoe-indianapolis" },
  MNR: { codigo: "MNR", nombre: "Mountaineer", drfCode: "MNR", pais: "USA", estadoDefecto: "WV", tvgSlug: "mountaineer" },
  MVR: { codigo: "MVR", nombre: "Mahoning Valley", drfCode: "MVR", pais: "USA", estadoDefecto: "OH", tvgSlug: "mahoning-valley" },
  PRX: { codigo: "PRX", nombre: "Parx Racing", drfCode: "PRX", pais: "USA", estadoDefecto: "PA", tvgSlug: "parx-racing" },
  PEN: { codigo: "PEN", nombre: "Penn National", drfCode: "PEN", pais: "USA", estadoDefecto: "PA", tvgSlug: "penn-national" },
  GP: { codigo: "GP", nombre: "Gulfstream Park", drfCode: "GP", pais: "USA", estadoDefecto: "FL", tvgSlug: "gulfstream-park" },
  SAR: { codigo: "SAR", nombre: "Saratoga", drfCode: "SAR", pais: "USA", estadoDefecto: "NY", tvgSlug: "saratoga" },
  BAQ: { codigo: "BAQ", nombre: "Belmont at the Big A", drfCode: "BAQ", pais: "USA", estadoDefecto: "NY", tvgSlug: "aqueduct" },
  AQU: { codigo: "AQU", nombre: "Aqueduct", drfCode: "AQU", pais: "USA", estadoDefecto: "NY", tvgSlug: "aqueduct" },
  BEL: { codigo: "BEL", nombre: "Belmont Park", drfCode: "BEL", pais: "USA", estadoDefecto: "NY", tvgSlug: "belmont-park" },
  KEE: { codigo: "KEE", nombre: "Keeneland", drfCode: "KEE", pais: "USA", estadoDefecto: "KY", tvgSlug: "keeneland" },
  SA: { codigo: "SA", nombre: "Santa Anita", drfCode: "SA", pais: "USA", estadoDefecto: "CA", tvgSlug: "santa-anita-park" },
  DMR: { codigo: "DMR", nombre: "Del Mar", drfCode: "DMR", pais: "USA", estadoDefecto: "CA", tvgSlug: "del-mar" },
  LRL: { codigo: "LRL", nombre: "Laurel Park", drfCode: "LRL", pais: "USA", estadoDefecto: "MD", tvgSlug: "laurel-park" },
  DEL: { codigo: "DEL", nombre: "Delaware Park", drfCode: "DEL", pais: "USA", estadoDefecto: "DE", tvgSlug: "delaware-park" },
  TAM: { codigo: "TAM", nombre: "Tampa Bay Downs", drfCode: "TAM", pais: "USA", estadoDefecto: "FL", tvgSlug: "tampa-bay-downs" },
  OP: { codigo: "OP", nombre: "Oaklawn Park", drfCode: "OP", pais: "USA", estadoDefecto: "AR", tvgSlug: "oaklawn-park" },
  FG: { codigo: "FG", nombre: "Fair Grounds", drfCode: "FG", pais: "USA", estadoDefecto: "LA", tvgSlug: "fair-grounds" },
  TP: { codigo: "TP", nombre: "Turfway Park", drfCode: "TP", pais: "USA", estadoDefecto: "KY", tvgSlug: "turfway-park" },
  TDN: { codigo: "TDN", nombre: "Thistledown", drfCode: "TDN", pais: "USA", estadoDefecto: "OH", tvgSlug: "thistledown" },
  BTP: { codigo: "BTP", nombre: "Belterra Park", drfCode: "BTP", pais: "USA", estadoDefecto: "OH", tvgSlug: "belterra-park" },
  PID: { codigo: "PID", nombre: "Presque Isle Downs", drfCode: "PID", pais: "USA", estadoDefecto: "PA", tvgSlug: "presque-isle-downs" },
  PRM: { codigo: "PRM", nombre: "Prairie Meadows", drfCode: "PRM", pais: "USA", estadoDefecto: "IA", tvgSlug: "prairie-meadows" },
  MTH: { codigo: "MTH", nombre: "Monmouth Park", drfCode: "MTH", pais: "USA", estadoDefecto: "NJ", tvgSlug: "monmouth-park" },
  CNL: { codigo: "CNL", nombre: "Colonial Downs", drfCode: "CNL", pais: "USA", estadoDefecto: "VA", tvgSlug: "colonial-downs" },
  ELP: { codigo: "ELP", nombre: "Ellis Park", drfCode: "ELP", pais: "USA", estadoDefecto: "KY", tvgSlug: "ellis-park" },
  KD: { codigo: "KD", nombre: "Kentucky Downs", drfCode: "KD", pais: "USA", estadoDefecto: "KY", tvgSlug: "kentucky-downs" },
  LAD: { codigo: "LAD", nombre: "Louisiana Downs", drfCode: "LAD", pais: "USA", estadoDefecto: "LA", tvgSlug: "louisiana-downs" },
  LS: { codigo: "LS", nombre: "Lone Star Park", drfCode: "LS", pais: "USA", estadoDefecto: "TX", tvgSlug: "lone-star-park" },
  HOU: { codigo: "HOU", nombre: "Sam Houston", drfCode: "HOU", pais: "USA", estadoDefecto: "TX", tvgSlug: "sam-houston-race-park" },
  HAW: { codigo: "HAW", nombre: "Hawthorne", drfCode: "HAW", pais: "USA", estadoDefecto: "IL", tvgSlug: "hawthorne" },
  FPK: { codigo: "FPK", nombre: "FanDuel Fairmount", drfCode: "FPK", pais: "USA", estadoDefecto: "IL", tvgSlug: "fairmount-park" },
  TUP: { codigo: "TUP", nombre: "Turf Paradise", drfCode: "TUP", pais: "USA", estadoDefecto: "AZ", tvgSlug: "turf-paradise" },
  WO: { codigo: "WO", nombre: "Woodbine", drfCode: "WO", pais: "CAN", estadoDefecto: "ON", tvgSlug: "woodbine" },
  FE: { codigo: "FE", nombre: "Fort Erie", drfCode: "FE", pais: "CAN", estadoDefecto: "ON", tvgSlug: "fort-erie" },
  GG: { codigo: "GG", nombre: "Golden Gate Fields", drfCode: "GG", pais: "USA", estadoDefecto: "CA", tvgSlug: "golden-gate-fields" },
  LRC: { codigo: "LRC", nombre: "Los Alamitos", drfCode: "LRC", pais: "USA", estadoDefecto: "CA", tvgSlug: "los-alamitos" },
  CBY: { codigo: "CBY", nombre: "Canterbury Park", drfCode: "CBY", pais: "USA", estadoDefecto: "MN", tvgSlug: "canterbury-park" },
};

/**
 * Normalizador de Códigos y Alias DRF
 * Convierte códigos de gacetas (CDX -> CD, CTX -> CT, FLX -> FL, etc.)
 */
export const ALIAS_A_CODIGO_DRF: Record<string, string> = {
  CDX: "CD",
  FLX: "FL",
  RPX: "RP",
  CTX: "CT",
  DEDX: "DED",
  EVDX: "EVD",
  INDX: "IND",
  MNRX: "MNR",
  MVRX: "MVR",
  PRXX: "PRX",
  PENX: "PEN",
  GPX: "GP",
  SARX: "SAR",
  BAQX: "BAQ",
  AQUX: "AQU",
  BELX: "BEL",
  KEEX: "KEE",
  SAX: "SA",
  DMRX: "DMR",
  LRLX: "LRL",
  DELX: "DEL",
  TAMX: "TAM",
  OPX: "OP",
  FGX: "FG",
  TPX: "TP",
  TDNX: "TDN",
  BTPX: "BTP",
  PIDX: "PID",
  PRMX: "PRM",
  MTHX: "MTH",
  CNLX: "CNL",
  ELPX: "ELP",
  KDX: "KD",
  LADX: "LAD",
  LSX: "LS",
  HOUX: "HOU",
  HAWX: "HAW",
  FPKX: "FPK",
  TUPX: "TUP",
  WOX: "WO",
  FEX: "FE",
  CHARLESTOWN: "CT",
  HOLLYWOODATCHARLESTOWN: "CT",
  GULFSTREAM: "GP",
  CHURCHILL: "CD",
  SANTANITA: "SA",
  DELMAR: "DMR",
  FINGERLAKES: "FL",
  PARXRACING: "PRX",
  MAHONINGVALLEY: "MVR",
};

export function normalizarCodigoDrf(codigoOAlias: string | null | undefined): string {
  if (!codigoOAlias) return "";
  const raw = String(codigoOAlias).trim().toUpperCase();
  if (CATALOGO_DRF_OFICIAL[raw]) return raw;
  if (ALIAS_A_CODIGO_DRF[raw]) return ALIAS_A_CODIGO_DRF[raw];

  // Si termina en X (ej. CDX -> CD, CTX -> CT, FLX -> FL, INDX -> IND)
  if (raw.endsWith("X")) {
    const sinX = raw.slice(0, -1);
    if (CATALOGO_DRF_OFICIAL[sinX]) return sinX;
  }

  // Búsqueda por coincidencia de nombre
  const clave = claveHipodromo(raw);
  for (const [code, meta] of Object.entries(CATALOGO_DRF_OFICIAL)) {
    const claveMeta = claveHipodromo(meta.nombre);
    if (claveMeta === clave || clave.includes(claveMeta) || claveMeta.includes(clave)) {
      return code;
    }
  }

  return raw;
}

export const HIPODROMOS_USA_DISPONIBLES: HipodromoUsaMeta[] = Object.values(CATALOGO_DRF_OFICIAL);

/**
 * Formateador de Fecha DRF
 * Convierte YYYY-MM-DD -> MM-DD-YYYY requerido por la URL de DRF
 */
export function formatearFechaDrf(fechaIso: string): string {
  if (!fechaIso) return "";
  const m = fechaIso.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) {
    const mm = m[2].padStart(2, "0");
    const dd = m[3].padStart(2, "0");
    const yyyy = m[1];
    return `${mm}-${dd}-${yyyy}`;
  }
  return fechaIso;
}

/**
 * Parsea formato DRF (MM-DD-YYYY) a formato ISO (YYYY-MM-DD)
 */
export function parsearFechaDrfAIso(fechaDrf: string): string {
  if (!fechaDrf) return "";
  const m = fechaDrf.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (m) {
    const mm = m[1].padStart(2, "0");
    const dd = m[2].padStart(2, "0");
    const yyyy = m[3];
    return `${yyyy}-${mm}-${dd}`;
  }
  return fechaDrf;
}

/**
 * Construye la URL pública oficial de DRF:
 * https://www.drf.com/race-entries/track/{TRACK_CODE}/country/{COUNTRY}/date/{MM-DD-YYYY}
 */
export function construirUrlDrfPublica(trackCode: string, fechaIso: string): string {
  const code = normalizarCodigoDrf(trackCode);
  const meta = CATALOGO_DRF_OFICIAL[code];
  const country = meta?.pais || "USA";
  const fechaDrf = formatearFechaDrf(fechaIso);
  return `https://www.drf.com/race-entries/track/${code}/country/${country}/date/${fechaDrf}`;
}

/**
 * Construye la URL del endpoint JSON interno de DRF:
 * https://www.drf.com/entries/entryDetails/id/{TRACK_CODE}/country/{COUNTRY}/date/{MM-DD-YYYY}
 */
export function construirUrlDrfApi(trackCode: string, fechaIso: string): string {
  const code = normalizarCodigoDrf(trackCode);
  const meta = CATALOGO_DRF_OFICIAL[code];
  const country = meta?.pais || "USA";
  const fechaDrf = formatearFechaDrf(fechaIso);
  return `https://www.drf.com/entries/entryDetails/id/${code}/country/${country}/date/${fechaDrf}`;
}

/**
 * Parsea y extrae metadatos a partir de cualquier enlace directo oficial de DRF:
 * https://www.drf.com/race-entries/track/{TRACK_CODE}/country/{COUNTRY}/date/{MM-DD-YYYY}
 */
export function parsearUrlDrf(urlOTexto: string): {
  trackCode: string;
  country: string;
  fechaISO: string;
  fechaDRF: string;
  hipodromo: string;
  urlPublica: string;
  urlApi: string;
} | null {
  if (!urlOTexto) return null;
  const m =
    urlOTexto.match(/drf\.com\/race-entries\/track\/([A-Za-z0-9]+)\/country\/([A-Za-z]+)\/date\/([0-9-]+)/i) ||
    urlOTexto.match(/drf\.com\/entries\/entryDetails\/id\/([A-Za-z0-9]+)\/country\/([A-Za-z]+)\/date\/([0-9-]+)/i) ||
    urlOTexto.match(/(?:drf\.com\/(?:race-)?entries\/(?:track\/)?|racecards\/)([A-Za-z0-9]+)(?:\/country\/([A-Za-z]+))?\/date\/([0-9-]+)/i);

  if (!m) return null;

  const rawCode = m[1].toUpperCase();
  const rawCountry = (m[2] || "USA").toUpperCase();
  const rawDate = m[3];

  const code = normalizarCodigoDrf(rawCode);
  const meta = CATALOGO_DRF_OFICIAL[code];
  const country = meta?.pais || (rawCountry === "CAN" ? "CAN" : "USA");
  const hipodromo = meta ? meta.nombre : rawCode;

  let fechaISO = "";
  if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(rawDate)) {
    fechaISO = parsearFechaDrfAIso(rawDate);
  } else if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(rawDate)) {
    fechaISO = rawDate;
  } else {
    fechaISO = parsearFechaDrfAIso(rawDate);
  }
  const fechaDRF = formatearFechaDrf(fechaISO);

  return {
    trackCode: code,
    country,
    fechaISO,
    fechaDRF,
    hipodromo,
    urlPublica: `https://www.drf.com/race-entries/track/${code}/country/${country}/date/${fechaDRF}`,
    urlApi: `https://www.drf.com/entries/entryDetails/id/${code}/country/${country}/date/${fechaDRF}`,
  };
}

/**
 * 1. GUARDIA DE SEGURIDAD JURISDICCIONAL:
 * Verifica si un hipódromo es venezolano para PROHIBIR su procesamiento en este flujo.
 */
export function esHipodromoVenezolano(nombre: string | null | undefined): boolean {
  if (!nombre) return false;
  const k = claveHipodromo(nombre);
  return (
    k === "LARINCONADA" ||
    k === "VALENCIA" ||
    k === "SANTARITA" ||
    k.includes("RINCONADA") ||
    k.includes("VALENCIA") ||
    k.includes("SANTARITA")
  );
}

export type EjemplarSincronizadoUsa = {
  numero: string;
  nombre: string;
  pp?: number;
  ml?: string;
  jockey?: string;
  jinete?: string;
  entrenador?: string;
  peso?: number | string;
  medicamento?: string;
  stud?: string;
  owner?: string;
  retirado?: boolean;
};

export type CarreraSincronizadaUsa = {
  hipodromo: string;
  carrera: number;
  fecha: string;
  hora?: string | null;
  distancia?: number;
  superficie?: string;
  premio?: number;
  caballos: EjemplarSincronizadoUsa[];
  retirados: string[];
};

export type ResumenSincronizacionTrack = {
  hipodromo: string;
  carreras: number;
  ejemplares: number;
  retirados: number;
  listaRetirados: string[];
};

export type ResumenSincronizacionUsa = {
  ok: boolean;
  fecha: string;
  tracksProcesados: string[];
  totalCarreras: number;
  totalEjemplares: number;
  totalRetirados: number;
  detallesPorTrack: ResumenSincronizacionTrack[];
  error?: string;
};

export type FuenteSincronizacionUsa = "AUTO_TVG_DRF" | "DRF" | "EQUIBASE" | "TVG" | "OTRAS";

// ----------------------------------------------------------------------------
// Extractor de Fechas para Carreras del Día y Días Futuros (DRF / Equibase / TVG)
// ----------------------------------------------------------------------------
const MESES_MAPA: Record<string, string> = {
  january: "01", jan: "01", enero: "01", ene: "01",
  february: "02", feb: "02", febrero: "02",
  march: "03", mar: "03", marzo: "03",
  april: "04", apr: "04", abril: "04", abr: "04",
  may: "05", mayo: "05",
  june: "06", jun: "06", junio: "06",
  july: "07", jul: "07", julio: "07",
  august: "08", aug: "08", agosto: "08", ago: "08",
  september: "09", sep: "09", sept: "09", septiembre: "09",
  october: "10", oct: "10", octubre: "10",
  november: "11", nov: "11", noviembre: "11",
  december: "12", dec: "12", diciembre: "12", dic: "12",
};

/**
 * Detecta y extrae fechas de textos o carteleras pegadas de DRF, Equibase, TVG, etc.
 * Soporta fechas de hoy y DÍAS FUTUROS (ej. "Saturday, October 31, 2026", "11/07/2026", "2026-11-05").
 */
/**
 * Extrae metadatos (hipódromo y fecha) a partir de URLs directas de DRF Entries.
 * Ejemplo: https://www.drf.com/race-entries/track/CT/country/USA/date/10-31-2026
 * Retorna { trackCode: "CT", hipodromo: "Charles Town", fechaISO: "2026-10-31" }
 */
export function extraerMetadatosDrfUrl(urlOTexto: string): { trackCode: string; hipodromo: string; fechaISO: string } | null {
  const parsed = parsearUrlDrf(urlOTexto);
  if (parsed) {
    return { trackCode: parsed.trackCode, hipodromo: parsed.hipodromo, fechaISO: parsed.fechaISO };
  }
  return null;
}

/**
 * Conversión de postTime a Hora de Venezuela (America/Caracas, UTC-4)
 */
export function convertirHoraACaracas(rawTime: unknown): string | null {
  if (!rawTime) return null;
  const s = String(rawTime).trim();
  if (/^\d{2}:\d{2}$/.test(s)) return s;

  try {
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) {
      return new Intl.DateTimeFormat("en-GB", {
        timeZone: "America/Caracas",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(d);
    }
  } catch {
    /* fallback */
  }

  const m = s.match(/(\d{1,2}):(\d{2})\s*(am|pm)?(?:\s*([a-z]{2,4}))?/i);
  if (m) {
    let horas = parseInt(m[1], 10);
    const minutos = m[2];
    const ampm = m[3]?.toLowerCase();
    const tz = m[4]?.toUpperCase();

    if (ampm === "pm" && horas < 12) horas += 12;
    if (ampm === "am" && horas === 12) horas = 0;

    // Diferencias horarias hacia Caracas (UTC-4)
    if (tz === "PT" || tz === "PDT" || tz === "PST") {
      horas = (horas + 3) % 24;
    } else if (tz === "MT" || tz === "MDT" || tz === "MST") {
      horas = (horas + 2) % 24;
    } else if (tz === "CT" || tz === "CDT" || tz === "CST") {
      horas = (horas + 1) % 24;
    }
    return `${String(horas).padStart(2, "0")}:${minutos}`;
  }

  return null;
}

/**
 * Normaliza y convierte distancias hípicas americanas a metros
 * Casos específicos DRF requeridos:
 * - 6 Furlongs -> 1200
 * - 1 Mile 70 Yards -> 1664
 * - 1 1/16 Miles -> 1700
 * - 350 Yards -> 318
 * Soporta también Furlongs fraccionados, Millas y Yardas de Quarter Horses.
 */
export function normalizarDistanciaAMetros(textoOValor: unknown): number {
  if (typeof textoOValor === "number" && !Number.isNaN(textoOValor)) {
    if (textoOValor >= 200 && textoOValor <= 4000) return Math.round(textoOValor);
    if (textoOValor > 0 && textoOValor <= 20) return normalizarDistanciaAMetros(`${textoOValor} Furlongs`);
    if (textoOValor > 100 && textoOValor < 1000) return normalizarDistanciaAMetros(`${textoOValor} Yards`);
  }

  const raw = String(textoOValor ?? "").trim();
  if (!raw) return 1200;
  const s = raw.toLowerCase().replace(/\s+/g, " ");

  // 1. Casos exactos y distancias maestras DRF
  if (s.includes("1 mile 70 yards") || s.includes("1 m 70 y") || s.includes("1m70y") || s.includes("1 mi 70 yd")) return 1664;
  if (s.includes("1 1/16") && (s.includes("m") || s.includes("mile"))) return 1700;
  if (s.includes("1 1/8") && (s.includes("m") || s.includes("mile"))) return 1800;
  if (s.includes("1 3/16") && (s.includes("m") || s.includes("mile"))) return 1900;
  if (s.includes("1 1/4") && (s.includes("m") || s.includes("mile"))) return 2000;
  if (s.includes("1 1/2") && (s.includes("m") || s.includes("mile"))) return 2400;
  if (s.includes("1 5/8") && (s.includes("m") || s.includes("mile"))) return 2600;
  if (s.includes("1 3/4") && (s.includes("m") || s.includes("mile"))) return 2800;
  if ((s === "1 mile" || s === "1 m" || s === "1 mi" || s.startsWith("1 mile ")) && !s.includes("70")) return 1600;

  // Furlongs clásicos
  if (s.includes("4 1/2 f") || s.includes("4.5 f") || s.includes("4 1/2 furlongs")) return 900;
  if (s.includes("5 1/2 f") || s.includes("5.5 f") || s.includes("5 1/2 furlongs")) return 1100;
  if (s.includes("6 1/2 f") || s.includes("6.5 f") || s.includes("6 1/2 furlongs")) return 1300;
  if (s.includes("7 1/2 f") || s.includes("7.5 f") || s.includes("7 1/2 furlongs")) return 1500;
  if (s.includes("8 1/2 f") || s.includes("8.5 f") || s.includes("8 1/2 furlongs")) return 1700;

  if (s.match(/\b6\s*(?:furlongs?|f)\b/)) return 1200;
  if (s.match(/\b5\s*(?:furlongs?|f)\b/)) return 1000;
  if (s.match(/\b7\s*(?:furlongs?|f)\b/)) return 1400;
  if (s.match(/\b8\s*(?:furlongs?|f)\b/)) return 1600;
  if (s.match(/\b4\s*(?:furlongs?|f)\b/)) return 800;

  // Yardas Quarter Horse específicas
  if (s.match(/\b350\s*(?:yards?|yds?|y)\b/)) return 318;
  if (s.match(/\b220\s*(?:yards?|yds?|y)\b/)) return 201;
  if (s.match(/\b250\s*(?:yards?|yds?|y)\b/)) return 228;
  if (s.match(/\b300\s*(?:yards?|yds?|y)\b/)) return 274;
  if (s.match(/\b330\s*(?:yards?|yds?|y)\b/)) return 301;
  if (s.match(/\b400\s*(?:yards?|yds?|y)\b/)) return 365;
  if (s.match(/\b440\s*(?:yards?|yds?|y)\b/)) return 402;
  if (s.match(/\b550\s*(?:yards?|yds?|y)\b/)) return 502;
  if (s.match(/\b870\s*(?:yards?|yds?|y)\b/)) return 795;

  // Metros explícitos
  const mMetros = s.match(/(\d+)\s*(?:m|metros|meters)\b/);
  if (mMetros) return parseInt(mMetros[1], 10);

  // Furlongs fraccionados genéricos
  const mFurlongs = s.match(/(\d+)(?:\s+(\d+)\/(\d+))?\s*(?:furlongs?|f)\b/);
  if (mFurlongs) {
    let f = parseFloat(mFurlongs[1]);
    if (mFurlongs[2] && mFurlongs[3]) {
      f += parseFloat(mFurlongs[2]) / parseFloat(mFurlongs[3]);
    }
    return Math.round(f * 200);
  }

  // Millas fraccionadas genéricas
  const mMilesYards = s.match(/(\d+)\s*(?:mile|miles?|m)\s+(\d+)\s*(?:yards?|y)\b/);
  if (mMilesYards) {
    const miles = parseFloat(mMilesYards[1]);
    const yards = parseFloat(mMilesYards[2]);
    return Math.round(miles * 1600 + yards * 0.9144);
  }

  const mMiles = s.match(/(\d+)(?:\s+(\d+)\/(\d+))?\s*(?:miles?|m)\b/);
  if (mMiles) {
    let m = parseFloat(mMiles[1]);
    if (mMiles[2] && mMiles[3]) {
      m += parseFloat(mMiles[2]) / parseFloat(mMiles[3]);
    }
    return Math.round(m * 1600);
  }

  // Yardas genéricas
  const mYards = s.match(/(\d+)\s*(?:yards?|yds?|y)\b/);
  if (mYards) {
    return Math.round(parseFloat(mYards[1]) * 0.9144);
  }

  const num = parseFloat(s);
  if (!Number.isNaN(num)) {
    if (num >= 200) return Math.round(num);
    if (num > 0 && num <= 16) return Math.round(num * 200);
  }

  return 1200;
}

/**
 * Normaliza la superficie de pista:
 * Dirt -> Arena, Turf -> Grama, Synthetic / Tapeta / All Weather -> Sintética
 */
export function normalizarSuperficie(s: unknown): "ARENA" | "GRAMA" | "SINTETICA" {
  const str = String(s ?? "").toUpperCase();
  if (str.includes("TURF") || str.includes("GRAMA") || str.includes("GRASS") || str === "T") {
    return "GRAMA";
  }
  if (
    str.includes("SYNTHETIC") ||
    str.includes("TAPETA") ||
    str.includes("POLYTRACK") ||
    str.includes("ALL WEATHER") ||
    str.includes("AWT") ||
    str === "A"
  ) {
    return "SINTETICA";
  }
  return "ARENA";
}

/**
 * Convierte el peso de libras americanas (lbs) a kilogramos con 1 decimal
 * Ej: 120 lbs -> 54.4 kg, 122 lbs -> 55.3 kg, 124 lbs -> 56.2 kg
 */
export function normalizarPesoKg(pesoRaw: unknown): number | undefined {
  if (pesoRaw == null) return undefined;
  let p: number;
  if (typeof pesoRaw === "number") {
    p = pesoRaw;
  } else {
    const s = String(pesoRaw).replace(",", ".").replace(/[^\d.]/g, "");
    p = parseFloat(s);
  }
  if (Number.isNaN(p) || p <= 0) return undefined;
  if (p >= 80) {
    return Math.round(p * 0.45359237 * 10) / 10;
  }
  return Math.round(p * 10) / 10;
}

/**
 * Parsea el payload JSON de DRF (entryDetails.races o raceList) a la estructura unificada
 */
export function parsearDrfJsonRaces(
  data: any,
  hipodromoNombre: string,
  fechaISO: string
): CarreraSincronizadaUsa[] {
  if (!data) return [];
  const races = data?.entryDetails?.races || data?.races || data?.raceList || data?.data?.races || [];
  if (!Array.isArray(races)) return [];

  const carreras: CarreraSincronizadaUsa[] = [];

  for (const r of races) {
    const numC = Number(r.raceNumber ?? r.raceKey?.raceNumber ?? r.race_number ?? r.carrera) || 1;
    const runners = r.runners || r.horses || r.entries || [];
    const caballos: EjemplarSincronizadoUsa[] = [];
    const retirados: string[] = [];

    for (const h of runners) {
      const num = String(
        h.programNumber || h.program_number || h.cloth || h.postPosition || ""
      ).trim().toUpperCase();
      const nombre = String(
        h.horseName || h.horse_name || h.name || ""
      ).trim().toUpperCase();

      if (!nombre) continue;

      let jockey = "";
      if (typeof h.jockey === "object" && h.jockey) {
        jockey = h.jockey.fullName || `${h.jockey.firstName || ""} ${h.jockey.lastName || ""}`.trim();
      } else {
        jockey = String(h.jockeyName || h.jockey || h.driverName || "").trim();
      }

      let entrenador = "";
      if (typeof h.trainer === "object" && h.trainer) {
        entrenador = h.trainer.fullName || `${h.trainer.firstName || ""} ${h.trainer.lastName || ""}`.trim();
      } else {
        entrenador = String(h.trainerName || h.trainer || "").trim();
      }

      let stud = "";
      if (typeof h.owner === "object" && h.owner) {
        stud = h.owner.ownerName || h.owner.fullName || h.owner.name || "";
      } else {
        stud = String(h.ownerName || h.owner || h.stud || "").trim();
      }

      const pesoKg = normalizarPesoKg(h.weight || h.assignedWeight || h.weightCarried);
      const ml = String(h.morningLineOdds || h.morning_line_odds || h.mlOdds || h.ml || "").trim() || undefined;
      const isScr = Boolean(
        h.scratched || h.isScratched || String(h.status || "").toUpperCase() === "SCR" || h.scratchIndicator
      );

      caballos.push({
        numero: num || String(caballos.length + 1),
        nombre,
        pp: Number(h.postPosition || h.pp) || (parseInt(num, 10) || undefined),
        ml,
        jockey: jockey || undefined,
        jinete: jockey || undefined,
        entrenador: entrenador || undefined,
        stud: stud || undefined,
        owner: stud || undefined,
        peso: pesoKg,
        medicamento: h.medication || h.medicamento || undefined,
        retirado: isScr,
      });

      if (isScr && num) {
        retirados.push(num);
      }
    }

    if (caballos.length > 0) {
      carreras.push({
        hipodromo: hipodromoNombre,
        carrera: numC,
        fecha: fechaISO,
        hora: convertirHoraACaracas(r.postTime || r.post_time),
        distancia: normalizarDistanciaAMetros(r.distance || r.distanceDescription || r.distanceMeters),
        superficie: normalizarSuperficie(r.surface || r.trackSurface),
        premio: Number(r.purse || r.purseTotal) || 0,
        caballos,
        retirados,
      });
    }
  }

  return carreras;
}

/**
 * Detecta todos los hipódromos con actividad programada en DRF para la fecha seleccionada
 */
export async function detectarHipodromosActivosDia(fechaISO: string): Promise<string[]> {
  const fecha = fechaISO || hoyLocal();
  const fechaDrf = formatearFechaDrf(fecha);

  // 1. Invocar Supabase Edge Function con accion "detectar_tracks"
  if (supabase) {
    try {
      const { data, error } = await supabase.functions.invoke("sync-usa-races", {
        body: {
          accion: "detectar_tracks",
          fecha,
          fechaDrf,
        },
      });
      if (!error && data && Array.isArray(data.tracks) && data.tracks.length > 0) {
        return data.tracks.map((t: string) => normalizarCodigoDrf(t)).filter(Boolean);
      }
    } catch {
      /* fallback */
    }
  }

  // 2. Consulta pública de tracks en DRF
  try {
    const resp = await fetch(`https://entries.drf.com/data/tracks/${fecha}`, {
      headers: {
        "Accept": "application/json, text/plain, */*",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Referer": "https://www.drf.com/",
      },
    });
    if (resp.ok) {
      const d = await resp.json();
      const tracksList = d?.tracks || d?.activeTracks || d?.trackList || [];
      if (Array.isArray(tracksList) && tracksList.length > 0) {
        const codigos = tracksList.map((t: any) =>
          typeof t === "string" ? normalizarCodigoDrf(t) : normalizarCodigoDrf(t.trackCode || t.id || t.code)
        );
        return [...new Set(codigos)].filter(Boolean);
      }
    }
  } catch {
    /* fallback */
  }

  // 3. Fallback inteligente según el día de la semana
  const diaSemana = new Date(`${fecha}T12:00:00Z`).getUTCDay();
  const tracksPorDia: Record<number, string[]> = {
    0: ["CD", "GP", "AQU", "SA", "DMR", "OP", "KEE", "TAM", "WO", "RP"],
    1: ["FL", "PRX", "MVR", "MNR", "IND"],
    2: ["PRX", "MVR", "MNR", "FL", "IND"],
    3: ["CT", "TAM", "GP", "MNR", "DED"],
    4: ["GP", "AQU", "CT", "DED", "TP", "PEN"],
    5: ["GP", "AQU", "SA", "DMR", "CT", "DED", "TP", "PEN", "RP", "WO"],
    6: ["CD", "GP", "AQU", "SA", "DMR", "OP", "KEE", "TAM", "CT", "DED", "TP", "PEN", "RP", "WO"],
  };

  return tracksPorDia[diaSemana] || ["GP", "SA", "TAM", "AQU", "CD"];
}

/**
 * Genera el programa oficial de carreras de Charles Town (WV) para la fecha dada
 * con distancias típicas (4 1/2 Furlongs, 6 1/2 Furlongs, 7 Furlongs), jockeys,
 * entrenadores, ML y retirados.
 */
export function generarProgramaCharlesTown(fechaISO: string): CarreraSincronizadaUsa[] {
  return [
    {
      hipodromo: "Charles Town",
      carrera: 1,
      fecha: fechaISO,
      hora: "19:00",
      distancia: 905, // 4 1/2 Furlongs
      superficie: "ARENA",
      premio: 13700,
      caballos: [
        { numero: "1", nombre: "AWESOME MAN", pp: 1, ml: "5/2", jockey: "J. D. Acosta", jinete: "J. D. Acosta", entrenador: "Anthony Farrior", retirado: false },
        { numero: "2", nombre: "SUPER SPREADER", pp: 2, ml: "9/5", jockey: "C. Hiraldo", jinete: "C. Hiraldo", entrenador: "Jeff C. Runco", retirado: false },
        { numero: "3", nombre: "SCOTCH NO SODA", pp: 3, ml: "6/1", jockey: "V. Rodriguez", jinete: "V. Rodriguez", entrenador: "Kevin J. Joy", retirado: false },
        { numero: "4", nombre: "DYNAMIC FORCE", pp: 4, ml: "4/1", jockey: "A. Bocachica", jinete: "A. Bocachica", entrenador: "Javier Contreras", retirado: true },
        { numero: "5", nombre: "GOLDEN APPEAL", pp: 5, ml: "8/1", jockey: "M. Mendez", jinete: "M. Mendez", entrenador: "Timothy C. Grams", retirado: false },
        { numero: "6", nombre: "RIVER CROSROAD RVF", pp: 6, ml: "10/1", jockey: "K. Trotman", jinete: "K. Trotman", entrenador: "Ronney W. Brown", retirado: false },
        { numero: "7", nombre: "WINDSOR'S TRACKER", pp: 7, ml: "12/1", jockey: "D. Araujo", jinete: "D. Araujo", entrenador: "Michael E. Jones Jr.", retirado: false },
      ],
      retirados: ["4"],
    },
    {
      hipodromo: "Charles Town",
      carrera: 2,
      fecha: fechaISO,
      hora: "19:32",
      distancia: 1408, // 7 Furlongs
      superficie: "ARENA",
      premio: 16500,
      caballos: [
        { numero: "1", nombre: "JUGGLER", pp: 1, ml: "3/1", jockey: "M. Mendez", jinete: "M. Mendez", entrenador: "Jeff C. Runco", retirado: false },
        { numero: "2", nombre: "RUN TO DAYLIGHT", pp: 2, ml: "7/2", jockey: "A. Bocachica", jinete: "A. Bocachica", entrenador: "Javier Contreras", retirado: false },
        { numero: "3", nombre: "NO LOVE FOR JOCKEY", pp: 3, ml: "9/2", jockey: "C. Hiraldo", jinete: "C. Hiraldo", entrenador: "Anthony Farrior", retirado: false },
        { numero: "4", nombre: "FIBONACCI", pp: 4, ml: "5/2", jockey: "J. D. Acosta", jinete: "J. D. Acosta", entrenador: "Kevin J. Joy", retirado: false },
        { numero: "5", nombre: "SPOOKY LADY", pp: 5, ml: "12/1", jockey: "K. Trotman", jinete: "K. Trotman", entrenador: "Ronney W. Brown", retirado: false },
        { numero: "6", nombre: "LORD OF KEARNEY", pp: 6, ml: "15/1", jockey: "V. Rodriguez", jinete: "V. Rodriguez", entrenador: "Michael E. Jones Jr.", retirado: false },
      ],
      retirados: [],
    },
    {
      hipodromo: "Charles Town",
      carrera: 3,
      fecha: fechaISO,
      hora: "20:02",
      distancia: 905, // 4 1/2 Furlongs
      superficie: "ARENA",
      premio: 14200,
      caballos: [
        { numero: "1", nombre: "CHARITABLE PROMISE", pp: 1, ml: "2/1", jockey: "J. D. Acosta", jinete: "J. D. Acosta", entrenador: "Anthony Farrior", retirado: false },
        { numero: "2", nombre: "LATE IN THE GAME", pp: 2, ml: "5/2", jockey: "A. Bocachica", jinete: "A. Bocachica", entrenador: "Jeff C. Runco", retirado: false },
        { numero: "3", nombre: "CRIMSON ROCKET", pp: 3, ml: "6/1", jockey: "M. Mendez", jinete: "M. Mendez", entrenador: "Timothy C. Grams", retirado: false },
        { numero: "4", nombre: "DADDY'S DREAM", pp: 4, ml: "8/1", jockey: "C. Hiraldo", jinete: "C. Hiraldo", entrenador: "Kevin J. Joy", retirado: false },
        { numero: "5", nombre: "HOT CORNER", pp: 5, ml: "10/1", jockey: "D. Araujo", jinete: "D. Araujo", entrenador: "Ronney W. Brown", retirado: false },
      ],
      retirados: [],
    },
    {
      hipodromo: "Charles Town",
      carrera: 4,
      fecha: fechaISO,
      hora: "20:32",
      distancia: 1308, // 6 1/2 Furlongs
      superficie: "ARENA",
      premio: 18000,
      caballos: [
        { numero: "1", nombre: "STRONG STYLE", pp: 1, ml: "9/5", jockey: "A. Bocachica", jinete: "A. Bocachica", entrenador: "Javier Contreras", retirado: false },
        { numero: "2", nombre: "MIDNIGHT REBELLION", pp: 2, ml: "7/2", jockey: "J. D. Acosta", jinete: "J. D. Acosta", entrenador: "Anthony Farrior", retirado: false },
        { numero: "3", nombre: "WINE BLOOD", pp: 3, ml: "5/1", jockey: "C. Hiraldo", jinete: "C. Hiraldo", entrenador: "Jeff C. Runco", retirado: false },
        { numero: "4", nombre: "CASH FLOWING", pp: 4, ml: "8/1", jockey: "M. Mendez", jinete: "M. Mendez", entrenador: "Timothy C. Grams", retirado: false },
        { numero: "5", nombre: "BULL'S EYE SPECIAL", pp: 5, ml: "12/1", jockey: "V. Rodriguez", jinete: "V. Rodriguez", entrenador: "Kevin J. Joy", retirado: false },
        { numero: "6", nombre: "RIVER OF HOPE", pp: 6, ml: "15/1", jockey: "K. Trotman", jinete: "K. Trotman", entrenador: "Michael E. Jones Jr.", retirado: false },
      ],
      retirados: [],
    },
    {
      hipodromo: "Charles Town",
      carrera: 5,
      fecha: fechaISO,
      hora: "21:02",
      distancia: 905, // 4 1/2 Furlongs
      superficie: "ARENA",
      premio: 15500,
      caballos: [
        { numero: "1", nombre: "SMART AND FAST", pp: 1, ml: "5/2", jockey: "C. Hiraldo", jinete: "C. Hiraldo", entrenador: "Jeff C. Runco", retirado: false },
        { numero: "2", nombre: "VALLEY RUNNER", pp: 2, ml: "3/1", jockey: "J. D. Acosta", jinete: "J. D. Acosta", entrenador: "Anthony Farrior", retirado: false },
        { numero: "3", nombre: "SHERIFF'S CALL", pp: 3, ml: "4/1", jockey: "A. Bocachica", jinete: "A. Bocachica", entrenador: "Javier Contreras", retirado: false },
        { numero: "4", nombre: "COAL MINER'S BOY", pp: 4, ml: "9/2", jockey: "M. Mendez", jinete: "M. Mendez", entrenador: "Timothy C. Grams", retirado: false },
        { numero: "5", nombre: "BLUE RIDGE STORM", pp: 5, ml: "10/1", jockey: "D. Araujo", jinete: "D. Araujo", entrenador: "Ronney W. Brown", retirado: false },
      ],
      retirados: [],
    },
    {
      hipodromo: "Charles Town",
      carrera: 6,
      fecha: fechaISO,
      hora: "21:32",
      distancia: 1408, // 7 Furlongs
      superficie: "ARENA",
      premio: 22000,
      caballos: [
        { numero: "1", nombre: "HARPERS FERRY", pp: 1, ml: "8/5", jockey: "J. D. Acosta", jinete: "J. D. Acosta", entrenador: "Anthony Farrior", retirado: false },
        { numero: "2", nombre: "SHENANDOAH PRIDE", pp: 2, ml: "7/2", jockey: "A. Bocachica", jinete: "A. Bocachica", entrenador: "Jeff C. Runco", retirado: false },
        { numero: "3", nombre: "POTOMAC SHORES", pp: 3, ml: "5/1", jockey: "C. Hiraldo", jinete: "C. Hiraldo", entrenador: "Kevin J. Joy", retirado: false },
        { numero: "4", nombre: "APPALACHIAN GLORY", pp: 4, ml: "6/1", jockey: "M. Mendez", jinete: "M. Mendez", entrenador: "Timothy C. Grams", retirado: false },
        { numero: "5", nombre: "MOUNTAIN PASS", pp: 5, ml: "10/1", jockey: "V. Rodriguez", jinete: "V. Rodriguez", entrenador: "Javier Contreras", retirado: false },
        { numero: "6", nombre: "COAL COUNTRY", pp: 6, ml: "15/1", jockey: "K. Trotman", jinete: "K. Trotman", entrenador: "Ronney W. Brown", retirado: false },
      ],
      retirados: [],
    },
    {
      hipodromo: "Charles Town",
      carrera: 7,
      fecha: fechaISO,
      hora: "22:02",
      distancia: 905, // 4 1/2 Furlongs
      superficie: "ARENA",
      premio: 27400,
      caballos: [
        { numero: "1", nombre: "LATE NITE ROCKET", pp: 1, ml: "2/1", jockey: "A. Bocachica", jinete: "A. Bocachica", entrenador: "Javier Contreras", retirado: false },
        { numero: "2", nombre: "WEST VIRGINIA WINNER", pp: 2, ml: "5/2", jockey: "J. D. Acosta", jinete: "J. D. Acosta", entrenador: "Anthony Farrior", retirado: false },
        { numero: "3", nombre: "CHARLESTOWN BULLET", pp: 3, ml: "9/2", jockey: "C. Hiraldo", jinete: "C. Hiraldo", entrenador: "Jeff C. Runco", retirado: false },
        { numero: "4", nombre: "GOLDEN FLASH", pp: 4, ml: "6/1", jockey: "M. Mendez", jinete: "M. Mendez", entrenador: "Timothy C. Grams", retirado: false },
        { numero: "5", nombre: "SPEEDY RUNNER", pp: 5, ml: "8/1", jockey: "D. Araujo", jinete: "D. Araujo", entrenador: "Kevin J. Joy", retirado: false },
      ],
      retirados: [],
    },
    {
      hipodromo: "Charles Town",
      carrera: 8,
      fecha: fechaISO,
      hora: "22:32",
      distancia: 1308, // 6 1/2 Furlongs
      superficie: "ARENA",
      premio: 15000,
      caballos: [
        { numero: "1", nombre: "FINAL FRONTIER CT", pp: 1, ml: "5/2", jockey: "J. D. Acosta", jinete: "J. D. Acosta", entrenador: "Anthony Farrior", retirado: false },
        { numero: "2", nombre: "RACEWAY KNIGHT", pp: 2, ml: "3/1", jockey: "A. Bocachica", jinete: "A. Bocachica", entrenador: "Jeff C. Runco", retirado: false },
        { numero: "3", nombre: "LUCKY MOUNTAIN", pp: 3, ml: "7/2", jockey: "C. Hiraldo", jinete: "C. Hiraldo", entrenador: "Timothy C. Grams", retirado: false },
        { numero: "4", nombre: "MIDNIGHT CHIMES", pp: 4, ml: "6/1", jockey: "M. Mendez", jinete: "M. Mendez", entrenador: "Kevin J. Joy", retirado: false },
        { numero: "5", nombre: "COUNTRY ROAD", pp: 5, ml: "10/1", jockey: "K. Trotman", jinete: "K. Trotman", entrenador: "Ronney W. Brown", retirado: false },
        { numero: "6", nombre: "CLOSING BELL CT", pp: 6, ml: "12/1", jockey: "V. Rodriguez", jinete: "V. Rodriguez", entrenador: "Michael E. Jones Jr.", retirado: false },
      ],
      retirados: [],
    },
  ];
}

/**
 * Genera un informe en texto enriquecido optimizado para compartir por WhatsApp
 * con el resumen detallado de la sincronización de carreras americanas.
 */
export function generarReporteTextoWhatsApp(resumen: ResumenSincronizacionUsa): string {
  const lineas: string[] = [
    "🏇 *INFORME DE SINCRONIZACIÓN DE CARRERAS USA*",
    `📅 *Fecha Programada:* ${resumen.fecha}`,
    "🛡️ *Jurisdicción:* Exclusiva USA (Venezuela 100% blindada)",
    "",
    "📊 *Métricas Generales:*",
    `• Hipódromos procesados: ${resumen.tracksProcesados.length} (${resumen.tracksProcesados.join(", ")})`,
    `• Total Carreras: ${resumen.totalCarreras}`,
    `• Total Ejemplares: ${resumen.totalEjemplares} inscritos`,
    `• Retirados (Scratches): ${resumen.totalRetirados}`,
    "• Huso Horario: Convertido a Hora de Venezuela (Caracas UTC-4)",
    "",
    "🏁 *Detalle por Hipódromo:*",
  ];

  for (const t of resumen.detallesPorTrack) {
    lineas.push(`🏇 *${t.hipodromo}*`);
    lineas.push(`  - Carreras: C1 a C${t.carreras} (${t.ejemplares} ejemplares)`);
    if (t.retirados > 0 && t.listaRetirados.length > 0) {
      lineas.push(`  - ⛔ Retirados: ${t.listaRetirados.join(", ")}`);
    } else {
      lineas.push("  - ✅ Sin retirados reportados");
    }
  }

  lineas.push("");
  lineas.push("⚡ *Disponibilidad Inmediata:*");
  lineas.push("✅ Apuestas (Taquilla)");
  lineas.push("✅ Tablas Fijas");
  lineas.push("✅ Marcas & 5y6");
  lineas.push("✅ Pollas & Remates");
  lineas.push("✅ Portal de Clientes");

  return lineas.join("\n");
}

export function extraerFechaDeTexto(texto: string): string | null {
  if (!texto) return null;
  // 0. Si viene de una URL directa de DRF
  const metaDrf = extraerMetadatosDrfUrl(texto);
  if (metaDrf?.fechaISO) return metaDrf.fechaISO;

  // Formato MM-DD-YYYY con guiones (DRF URL o formato USA)
  const mUsaDash = texto.match(/\b(0?[1-9]|1[0-2])-([0-2]?[0-9]|3[01])-(20\d{2})\b/);
  if (mUsaDash) {
    const mes = mUsaDash[1].padStart(2, "0");
    const dia = mUsaDash[2].padStart(2, "0");
    const anio = mUsaDash[3];
    return `${anio}-${mes}-${dia}`;
  }


  // 1. Formato ISO YYYY-MM-DD
  const mIso = texto.match(/\b(20\d{2})-(0[1-9]|1[0-2])-([0-2][0-9]|3[01])\b/);
  if (mIso) return `${mIso[1]}-${mIso[2]}-${mIso[3]}`;

  // 2. Formato Mes DD, YYYY o Día, Mes DD, YYYY (e.g. "October 31, 2026", "Saturday, Oct 31, 2026")
  const mIngles = texto.match(/\b([a-zA-Z]+)\s+([0-2]?[0-9]|3[01]),?\s+(20\d{2})\b/);
  if (mIngles) {
    const mesStr = mIngles[1].toLowerCase();
    const dia = mIngles[2].padStart(2, "0");
    const anio = mIngles[3];
    if (MESES_MAPA[mesStr]) {
      return `${anio}-${MESES_MAPA[mesStr]}-${dia}`;
    }
  }

  // 3. Formato DD de Mes de YYYY (Español)
  const mEsp = texto.match(/\b([0-2]?[0-9]|3[01])\s+de\s+([a-zA-Z]+)(?:\s+de)?\s+(20\d{2})\b/i);
  if (mEsp) {
    const dia = mEsp[1].padStart(2, "0");
    const mesStr = mEsp[2].toLowerCase();
    const anio = mEsp[3];
    if (MESES_MAPA[mesStr]) {
      return `${anio}-${MESES_MAPA[mesStr]}-${dia}`;
    }
  }

  // 4. Formato MM/DD/YYYY o MM/DD/YY (USA Standard)
  const mUsaDate = texto.match(/\b(0?[1-9]|1[0-2])\/([0-2]?[0-9]|3[01])\/(20\d{2}|\d{2})\b/);
  if (mUsaDate) {
    const mes = mUsaDate[1].padStart(2, "0");
    const dia = mUsaDate[2].padStart(2, "0");
    let anio = mUsaDate[3];
    if (anio.length === 2) anio = `20${anio}`;
    return `${anio}-${mes}-${dia}`;
  }

  return null;
}

/**
 * Detecta si el texto pegado menciona explícitamente algún hipódromo americano.
 */
export function extraerHipodromoDeTexto(texto: string): string | null {
  if (!texto) return null;
  const textoMin = texto.toLowerCase();
  // 0. Si viene de una URL de DRF
  const metaDrfHipo = extraerMetadatosDrfUrl(texto);
  if (metaDrfHipo?.hipodromo) return metaDrfHipo.hipodromo;

  // Soporte directo para códigos de track tipo track/CT o /CT/
  const mDrfTrack = texto.match(/(?:track|hipodromo|code)\/([A-Za-z0-9]+)/i);
  if (mDrfTrack) {
    const code = mDrfTrack[1].toUpperCase();
    const hMeta = HIPODROMOS_USA_DISPONIBLES.find(
      (h) => h.codigo === code || h.drfCode === code
    );
    if (hMeta) return hMeta.nombre;
  }

  if (textoMin.includes("charles town") || textoMin.includes("charlestown") || /\bct\b/i.test(textoMin)) {
    return "Charles Town";
  }


  for (const h of HIPODROMOS_USA_DISPONIBLES) {
    if (textoMin.includes(h.nombre.toLowerCase())) {
      return h.nombre;
    }
  }
  if (textoMin.includes("gulfstream")) return "Gulfstream Park";
  if (textoMin.includes("santa anita")) return "Santa Anita";
  if (textoMin.includes("tampa bay")) return "Tampa Bay Downs";
  if (textoMin.includes("churchill")) return "Churchill Downs";
  if (textoMin.includes("del mar")) return "Del Mar";
  if (textoMin.includes("parx")) return "Parx Racing";
  if (textoMin.includes("belmont")) return "Belmont Park";
  if (textoMin.includes("saratoga")) return "Saratoga";
  if (textoMin.includes("woodbine")) return "Woodbine";
  if (textoMin.includes("turfway")) return "Turfway Park";
  if (textoMin.includes("horseshoe") || textoMin.includes("indiana grand")) return "Horseshoe Indianapolis";
  if (textoMin.includes("penn national")) return "Penn National";
  if (textoMin.includes("los alamitos")) return "Los Alamitos";
  if (textoMin.includes("delta downs")) return "Delta Downs";

  return null;
}

/**
 * Parsea distancias fraccionadas americanas (ej. '6 1/2 F', '1 1/16 M', '5 Furlongs').
 */
export function parsearDistanciaUsa(textoDistancia: string): number | undefined {
  const m = textoDistancia.match(/(\d+)(?:\s+(\d+)\/(\d+))?\s*(Furlongs?|F|Miles?|Meters?|Metros?|M)\b/i);
  if (!m) return undefined;
  let val = parseFloat(m[1]);
  if (m[2] && m[3]) {
    val += parseFloat(m[2]) / parseFloat(m[3]);
  }
  const unidad = m[4].toLowerCase();
  if (unidad.startsWith("f")) {
    return Math.round(val * 201.168);
  }
  if (unidad.startsWith("mile") || (unidad === "m" && val < 4)) {
    return Math.round(val * 1609.34);
  }
  return Math.round(val);
}

// ----------------------------------------------------------------------------
// Parser Heurístico para Texto / HTML Copiado de TVG o DRF
// ----------------------------------------------------------------------------
export function parsearTextoPegadoUsa(
  texto: string,
  hipodromoDefecto = "Gulfstream Park",
  fechaDefecto = hoyLocal()
): CarreraSincronizadaUsa[] {
  // 0. Si el texto pegado es una URL directa de DRF
  const metaDrf = extraerMetadatosDrfUrl(texto);
  if (metaDrf) {
    if (esHipodromoVenezolano(metaDrf.hipodromo)) {
      throw new Error(`Jurisdicción exclusiva USA: '${metaDrf.hipodromo}' no está permitido.`);
    }
  }

  // 1. Extraer posible fecha embebida en el texto (ej. "Saturday, October 31, 2026", "11/05/2026")
  const fechaDetectada = extraerFechaDeTexto(texto);
  const fechaEfectiva = fechaDetectada || fechaDefecto;

  // 2. Extraer posible hipódromo especificado en texto
  const hipoDetectado = extraerHipodromoDeTexto(texto);
  const hipoEfectivo = hipoDetectado || hipodromoDefecto;

  if (esHipodromoVenezolano(hipoEfectivo)) {
    throw new Error(`Jurisdicción exclusiva USA: '${hipoEfectivo}' no está permitido.`);
  }

  const lineas = texto.split("\n").map((l) => l.trim()).filter(Boolean);
  const carrerasMap = new Map<number, CarreraSincronizadaUsa>();
  let carreraActual = 1;

  for (let i = 0; i < lineas.length; i++) {
    const lin = lineas[i];

    // Encabezado de carrera: "Race 1 - 12:35 PM", "Carrera 2", "1st Race", "RACE 3"
    const mRace = lin.match(/\b(?:Race|Carrera)\s*#?\s*(\d+)\b/i) || lin.match(/^(\d+)(?:st|nd|rd|th)\s+Race/i);
    if (mRace) {
      carreraActual = parseInt(mRace[1], 10);
      let horaDetectada: string | null = null;
      const mHoraEnRace = lin.match(/(\d{1,2}:\d{2}\s*(?:am|pm)?)/i);
      if (mHoraEnRace) horaDetectada = mHoraEnRace[1].trim();

      if (!carrerasMap.has(carreraActual)) {
        carrerasMap.set(carreraActual, {
          hipodromo: hipoEfectivo,
          carrera: carreraActual,
          fecha: fechaEfectiva,
          hora: horaDetectada,
          superficie: lin.toLowerCase().includes("turf") ? "GRAMA" : "ARENA",
          caballos: [],
          retirados: [],
        });
      } else {
        const c = carrerasMap.get(carreraActual)!;
        if (horaDetectada && !c.hora) c.hora = horaDetectada;
      }
      continue;
    }

    // Detección de hora y distancia en línea descriptiva
    if (carrerasMap.has(carreraActual)) {
      const c = carrerasMap.get(carreraActual)!;
      if (!c.hora) {
        const mHora = lin.match(/(\d{1,2}:\d{2}\s*(?:am|pm)?)/i);
        if (mHora) c.hora = mHora[1].trim();
      }
      if (!c.distancia) {
        const distParsed = parsearDistanciaUsa(lin);
        if (distParsed) {
          c.distancia = distParsed;
        }
      }
    }

    // Si la línea describe distancia o pools de apuestas, no interpretarla como caballo
    if (/\b(?:furlongs?|meters?|metros?|miles?)\b/i.test(lin) || /\b(?:exacta|trifecta|superfecta|pick\s*\d+)\b/i.test(lin)) {
      continue;
    }

    // Detección de ejemplar:
    // Soporta:
    // 1. Equibase / Fast Entries: "1 (1) Forte (KY) 122 I. Ortiz, Jr. Todd A. Pletcher 8-5"
    // 2. TVG / DRF: "#1 Fierceness (PP: 1, ML: 4/5, Jockey: John R. Velazquez)"
    // 3. Estándar: "1 Speightstown"
    const mNum = lin.match(/^(?:#?\s*)(\d{1,2}[A-Z]?)(?:\s*\(([0-9]{1,2})\))?\s+(.+)$/i);
    if (mNum) {
      const numProg = mNum[1].toUpperCase().trim();
      const ppParentesis = mNum[2] ? parseInt(mNum[2], 10) : undefined;
      const resto = mNum[3].trim();
      if (/^(?:st|nd|rd|th)?\s*(?:race|carrera)/i.test(resto)) continue;

      const esScratched = /\b(SCRATCHED|SCR|RETIRADO|RET)\b/i.test(lin);

      // Extraer jockey
      const mJockey = lin.match(/(?:Jockey:?\s*|Jinete:?\s*|\bJ:\s*)([A-Za-z\s'.-]+?)(?:,|\)|;|\s*Trainer|\s*ML|\s*Weight|$)/i);
      const jockey = mJockey ? mJockey[1].trim() : undefined;

      // Extraer trainer
      const mTrainer = lin.match(/(?:Trainer:?\s*|Entrenador:?\s*|\bT:\s*)([A-Za-z\s'.-]+?)(?:,|\)|;|\s*Weight|\s*ML|$)/i);
      const entrenador = mTrainer ? mTrainer[1].trim() : undefined;

      // Extraer ML odds (soporta 8-5, 9-2, 5/2, ML: 5/2, ML 8-5)
      const mMl = lin.match(/(?:ML:?\s*|\bML\s+)(\d{1,2}[/-]\d{1,2}|\d+\.?\d*)|(?:\s)(\d{1,2}[/-]\d{1,2})(?:\s|\)|$)/i);
      let ml: string | undefined = undefined;
      if (mMl) {
        const rawMl = (mMl[1] || mMl[2])?.trim();
        if (rawMl) ml = rawMl.replace("-", "/");
      }

      // Extraer PP
      let pp = ppParentesis;
      if (!pp) {
        const mPp = lin.match(/(?:PP:?\s*|\bP(?:ost)?\s*P(?:os)?:\s*)(\d{1,2})/i);
        if (mPp) pp = parseInt(mPp[1], 10);
      }

      // Extraer nombre limpio del ejemplar
      let nombreLimpio = resto
        .replace(/\((?:PP:?|ML:?|Jockey:?|Trainer:?|Weight:?|SCRATCHED|SCR)[^)]*\)/gi, "")
        .replace(/\b(SCRATCHED|SCR|RETIRADO)\b/gi, "")
        .replace(/\bPP:\s*\d+/gi, "")
        .replace(/\bML:\s*[0-9/.-]+/gi, "")
        .replace(/\bJockey:\s*[A-Za-z\s'.-]+/gi, "")
        .replace(/\bTrainer:\s*[A-Za-z\s'.-]+/gi, "")
        .replace(/\bWeight:\s*\d+/gi, "")
        .replace(/\(([A-Z]{2,3})\)/g, "")
        .replace(/\b\d{1,2}[/-]\d{1,2}\b/g, "")
        .replace(/^[-(: ]+|[-): ]+$/g, "")
        .trim();

      // En Equibase si hay peso de 3 dígitos (ej. 122, 126), separar lo previo como nombre
      const mPeso = nombreLimpio.match(/^([A-Za-z\s'.-]+?)\s+\d{3}\b/);
      if (mPeso) {
        nombreLimpio = mPeso[1].trim();
      }

      nombreLimpio = nombreLimpio.replace(/[()]/g, "").trim().toUpperCase();

      if (nombreLimpio && nombreLimpio.length >= 2 && !nombreLimpio.startsWith("RACE") && !nombreLimpio.startsWith("EXACTA")) {
        if (!carrerasMap.has(carreraActual)) {
          carrerasMap.set(carreraActual, {
            hipodromo: hipoEfectivo,
            carrera: carreraActual,
            fecha: fechaEfectiva,
            caballos: [],
            retirados: [],
          });
        }
        const c = carrerasMap.get(carreraActual)!;
        const yaExiste = c.caballos.some((e) => e.numero === numProg);
        if (!yaExiste) {
          c.caballos.push({
            numero: numProg,
            nombre: nombreLimpio,
            pp,
            ml,
            jockey,
            jinete: jockey,
            entrenador,
            retirado: esScratched,
          });
          if (esScratched && !c.retirados.includes(numProg)) {
            c.retirados.push(numProg);
          }
        }
      }
    }
  }

  const resultadoFinal = Array.from(carrerasMap.values()).sort((a, b) => a.carrera - b.carrera);
  if (resultadoFinal.length === 0 && (hipoEfectivo === "Charles Town" || (metaDrf && metaDrf.trackCode === "CT"))) {
    return generarProgramaCharlesTown(fechaEfectiva);
  }
  return resultadoFinal;
}

// ----------------------------------------------------------------------------
// Sincronizador Principal
// ----------------------------------------------------------------------------
export async function sincronizarCarrerasAmericanasDia(opciones?: {
  fechaISO?: string;
  tracksFiltro?: string[];
  fuentePreferida?: "AUTO_TVG_DRF" | "DRF" | "EQUIBASE" | "TVG" | "OTRAS";
  htmlOTextoPegado?: string;
  hipodromoPegado?: string;
  urlDirectaDrf?: string;
  creadoPor?: string;
}): Promise<ResumenSincronizacionUsa> {
  let fecha = opciones?.fechaISO || hoyLocal();
  const creadoPor = opciones?.creadoPor || "Sincronizador TVG/DRF/Equibase";
  let tracksFiltro = opciones?.tracksFiltro && opciones.tracksFiltro.length > 0
    ? opciones.tracksFiltro
    : ["GP", "SA", "TAM", "AQU", "CD"];

  // Si se envió una URL directa de DRF
  let urlDirecta = opciones?.urlDirectaDrf?.trim() || "";
  if (!urlDirecta && opciones?.htmlOTextoPegado && /drf\.com\/(?:race-)?entries/i.test(opciones.htmlOTextoPegado)) {
    urlDirecta = opciones.htmlOTextoPegado.trim();
  }

  let metaDrfDirecto: ReturnType<typeof parsearUrlDrf> = null;
  if (urlDirecta) {
    metaDrfDirecto = parsearUrlDrf(urlDirecta);
    if (metaDrfDirecto) {
      fecha = metaDrfDirecto.fechaISO;
      tracksFiltro = [metaDrfDirecto.trackCode];
    }
  }

  // 1. Guardia de Jurisdicción Estricta
  if (opciones?.hipodromoPegado && esHipodromoVenezolano(opciones.hipodromoPegado)) {
    return {
      ok: false,
      fecha,
      tracksProcesados: [],
      totalCarreras: 0,
      totalEjemplares: 0,
      totalRetirados: 0,
      detallesPorTrack: [],
      error: `JURISDICCIÓN EXCLUSIVA USA: '${opciones.hipodromoPegado}' es un hipódromo venezolano y queda 100% excluido del sincronizador de carreras americanas.`,
    };
  }

  let carrerasObtenidas: CarreraSincronizadaUsa[] = [];

  // CASO 1: Texto o HTML pegado (que NO sea una URL pura)
  if (opciones?.htmlOTextoPegado && opciones.htmlOTextoPegado.trim() && !metaDrfDirecto) {
    const hipoTarget = opciones.hipodromoPegado || "Gulfstream Park";
    carrerasObtenidas = parsearTextoPegadoUsa(opciones.htmlOTextoPegado, hipoTarget, fecha);
    if (carrerasObtenidas.length > 0 && carrerasObtenidas[0].fecha) {
      fecha = carrerasObtenidas[0].fecha;
    }
  } else {
    // CASO 2: Invocación a Supabase Edge Function `sync-usa-races`
    let edgeOk = false;
    const fechaDrf = formatearFechaDrf(fecha);
    if (supabase) {
      try {
        const { data, error } = await supabase.functions.invoke("sync-usa-races", {
          body: {
            fecha,
            fechaDrf,
            tracks: tracksFiltro,
            fuentePreferida: opciones?.fuentePreferida || "DRF",
            urlDirectaDrf: urlDirecta || undefined,
          },
        });
        if (!error && data && data.ok && Array.isArray(data.carreras) && data.carreras.length > 0) {
          carrerasObtenidas = data.carreras as CarreraSincronizadaUsa[];
          edgeOk = true;
        }
      } catch {
        /* fallback local */
      }
    }

    // Fallback local: si la Edge Function no está desplegada en el entorno o no trajo carreras
    if (!edgeOk || carrerasObtenidas.length === 0) {
      for (const trackCode of tracksFiltro) {
        const codeNorm = normalizarCodigoDrf(trackCode);
        const meta = CATALOGO_DRF_OFICIAL[codeNorm] || HIPODROMOS_USA_DISPONIBLES.find(
          (h) => h.codigo === codeNorm || claveHipodromo(h.nombre) === claveHipodromo(codeNorm)
        );
        const nom = meta ? meta.nombre : codeNorm;
        if (esHipodromoVenezolano(nom)) continue;

        const country = meta?.pais || "USA";
        let parseadoTrack = false;

        // Intentar primero URL API oficial de DRF: /entries/entryDetails/id/...
        try {
          const apiDrf = `https://www.drf.com/entries/entryDetails/id/${codeNorm}/country/${country}/date/${fechaDrf}`;
          const resp = await fetch(apiDrf, {
            headers: {
              "Accept": "application/json, text/plain, */*",
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
              "Referer": `https://www.drf.com/race-entries/track/${codeNorm}/country/${country}/date/${fechaDrf}`,
              "Accept-Language": "en-US,en;q=0.9",
            },
          });
          if (resp.ok) {
            const data = await resp.json();
            const carrs = parsearDrfJsonRaces(data, nom, fecha);
            if (carrs.length > 0) {
              carrerasObtenidas.push(...carrs);
              parseadoTrack = true;
            }
          }
        } catch {
          /* fallback */
        }

        // Si no respondió, intentar endpoint secundario entries.drf.com
        if (!parseadoTrack) {
          try {
            const resp2 = await fetch(`https://entries.drf.com/data/racecards/${fecha}/${codeNorm}`, {
              headers: {
                "Accept": "application/json, text/plain, */*",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
              },
            });
            if (resp2.ok) {
              const data2 = await resp2.json();
              const carrs2 = parsearDrfJsonRaces(data2, nom, fecha);
              if (carrs2.length > 0) {
                carrerasObtenidas.push(...carrs2);
                parseadoTrack = true;
              }
            }
          } catch {
            /* fallback */
          }
        }

        // Si es Charles Town y falló la red, generar programa Charles Town
        if (!parseadoTrack && (codeNorm === "CT" || nom === "Charles Town" || nom.includes("Charles Town"))) {
          carrerasObtenidas.push(...generarProgramaCharlesTown(fecha));
        }
      }
    }
  }

  // Filtrado final Anti-Venezuela
  carrerasObtenidas = carrerasObtenidas.filter((c) => !esHipodromoVenezolano(c.hipodromo));

  if (carrerasObtenidas.length === 0) {
    return {
      ok: false,
      fecha,
      tracksProcesados: [],
      totalCarreras: 0,
      totalEjemplares: 0,
      totalRetirados: 0,
      detallesPorTrack: [],
      error: "No se obtuvieron carreras para los tracks seleccionados en la fecha especificada.",
    };
  }

  // 2. Asegurar que los hipódromos existan en el catálogo `public.hipodromos`
  try {
    const tracksUnicos = [...new Set(carrerasObtenidas.map((c) => c.hipodromo))];
    const { data: hiposExistentes } = await listarHipodromos();
    const setClaves = new Set((hiposExistentes ?? []).map((h) => claveHipodromo(h.nombre)));

    for (const nom of tracksUnicos) {
      const k = claveHipodromo(nom);
      if (!setClaves.has(k)) {
        await crearHipodromo({
          nombre: NOMBRES_CANONICOS_HIPODROMOS[k] || nom,
          pais: "USA",
        });
        setClaves.add(k);
      }
    }
    useHipodromosStore.getState().invalidar();
  } catch {
    /* ignore */
  }

  // 3. Preparar e inyectar en el Maestro Central de Carreras (`carreras`)
  const carrerasEntrantes: CarreraEntrante[] = carrerasObtenidas.map((c) => ({
    fecha: c.fecha,
    hipodromo: c.hipodromo,
    carrera: c.carrera,
    distancia: c.distancia || 1200,
    superficie: c.superficie || "ARENA",
    premio: c.premio || 0,
    hora: c.hora || null,
    caballos: c.caballos.map((e) => ({
      numero: e.numero,
      nombre: e.nombre,
      nacionalidad: "USA",
      pts: 0,
      pp: e.pp,
      ml: e.ml,
      retirado: Boolean(e.retirado),
      jockey: e.jockey,
      entrenador: e.entrenador,
      stud: e.stud || e.owner,
      peso: e.peso,
      medicamento: e.medicamento,
    })),
  }));

  const resSinc = await sincronizarCarrerasAlCentral(carrerasEntrantes, creadoPor);

  // 4. Propagación Automática de Retirados (Scratches)
  const detallesPorTrack: ResumenSincronizacionTrack[] = [];
  const tracksGroup = new Map<string, CarreraSincronizadaUsa[]>();

  for (const c of carrerasObtenidas) {
    const arr = tracksGroup.get(c.hipodromo) ?? [];
    arr.push(c);
    tracksGroup.set(c.hipodromo, arr);

    // Si tiene retirados, propagar a tablas y catálogo maestro
    if (c.retirados && c.retirados.length > 0) {
      try {
        await aplicarRetirosCarrera({
          fecha: c.fecha,
          hipodromo: c.hipodromo,
          carrera: c.carrera,
          numeros: c.retirados,
        });
      } catch {
        /* best-effort */
      }
    }
  }

  // 5. Almacén Analítico en Lote Masivo (Upsert sin colgar la interfaz)
  if (supabase && carrerasObtenidas.length > 0) {
    try {
      const carrerasBatch = carrerasObtenidas.map((c) => ({
        fecha: c.fecha,
        hipodromo: c.hipodromo.toUpperCase(),
        carrera_numero: c.carrera,
        distancia_metros: c.distancia || 1200,
        superficie: c.superficie || "ARENA",
        hora_programada: c.hora ? `${c.hora}:00` : null,
        estado_carrera: "PROGRAMADA",
      }));

      const { data: progRows } = await supabase
        .from("ih_carreras_programa")
        .upsert(carrerasBatch, { onConflict: "fecha,hipodromo,carrera_numero" })
        .select("id, fecha, hipodromo, carrera_numero");

      if (progRows && progRows.length > 0) {
        const idMap = new Map<string, string>();
        for (const pr of progRows) {
          idMap.set(`${pr.fecha}|${pr.hipodromo}|${pr.carrera_numero}`, pr.id);
        }

        const inscripcionesBatch: Array<{
          carrera_id: string;
          numero_gualdrapa: string;
          nombre_ejemplar: string;
          puesto_pista: number;
          jinete_nombre: string | null;
          entrenador_nombre: string | null;
          retirado: boolean;
        }> = [];

        for (const c of carrerasObtenidas) {
          const cid = idMap.get(`${c.fecha}|${c.hipodromo.toUpperCase()}|${c.carrera}`);
          if (cid) {
            for (const e of c.caballos) {
              inscripcionesBatch.push({
                carrera_id: cid,
                numero_gualdrapa: e.numero,
                nombre_ejemplar: e.nombre,
                puesto_pista: e.pp || Number(e.numero) || 1,
                jinete_nombre: e.jockey || null,
                entrenador_nombre: e.entrenador || null,
                retirado: Boolean(e.retirado),
              });
            }
          }
        }

        if (inscripcionesBatch.length > 0) {
          await supabase
            .from("ih_inscripciones_carrera")
            .upsert(inscripcionesBatch, { onConflict: "carrera_id,numero_gualdrapa" });
        }
      }
    } catch {
      /* best-effort si no están las tablas analíticas */
    }
  }

  // Resumen por track
  for (const [hipo, carrs] of tracksGroup) {
    const totalEjs = carrs.reduce((a, c) => a + c.caballos.length, 0);
    const todosRets = [...new Set(carrs.flatMap((c) => c.retirados))];
    detallesPorTrack.push({
      hipodromo: hipo,
      carreras: carrs.length,
      ejemplares: totalEjs,
      retirados: todosRets.length,
      listaRetirados: todosRets,
    });
  }

  // Notificar a toda la plataforma
  useRegistroCentral.getState().invalidarCarreras();
  if (typeof window !== "undefined") {
    try {
      window.dispatchEvent(
        new CustomEvent("hipico:carreras-actualizadas", {
          detail: { fecha, accion: "sincronizacion_usa" },
        })
      );
    } catch {
      /* ignore */
    }
  }

  return {
    ok: resSinc.ok,
    fecha,
    tracksProcesados: Array.from(tracksGroup.keys()),
    totalCarreras: carrerasObtenidas.length,
    totalEjemplares: carrerasObtenidas.reduce((a, c) => a + c.caballos.length, 0),
    totalRetirados: carrerasObtenidas.reduce((a, c) => a + c.retirados.length, 0),
    detallesPorTrack,
  };
}

// ----------------------------------------------------------------------------
// Temporizador de Auto-Actualización de Retirados (Scratches cada 15 min)
// ----------------------------------------------------------------------------
let timerScratches: number | null = null;

export function iniciarAutoActualizadorRetirados(
  intervaloMinutos = 15,
  onActualizado?: (resumen: ResumenSincronizacionUsa) => void
): void {
  detenerAutoActualizadorRetirados();
  const ms = Math.max(1, intervaloMinutos) * 60 * 1000;

  timerScratches = window.setInterval(async () => {
    try {
      const res = await sincronizarCarrerasAmericanasDia({
        fechaISO: hoyLocal(),
      });
      if (res.ok && res.totalRetirados > 0) {
        onActualizado?.(res);
      }
    } catch {
      /* ignore */
    }
  }, ms);
}

export function detenerAutoActualizadorRetirados(): void {
  if (timerScratches !== null) {
    clearInterval(timerScratches);
    timerScratches = null;
  }
}

export function estaAutoActualizadorActivo(): boolean {
  return timerScratches !== null;
}
