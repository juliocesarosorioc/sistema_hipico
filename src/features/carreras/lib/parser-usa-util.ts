import { hoyLocal } from "@/core/utils/fechas";
import { claveHipodromo } from "@/features/carreras/lib/claves";

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
  CT: { codigo: "CT", nombre: "Charles Town", drfCode: "CT", pais: "USA", estadoDefecto: "WV", tvgSlug: "charles-town" },
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

export const ALIAS_A_CODIGO_DRF: Record<string, string> = {
  CDX: "CD", FLX: "FL", RPX: "RP", CTX: "CT", DEDX: "DED", EVDX: "EVD",
  INDX: "IND", MNRX: "MNR", MVRX: "MVR", PRXX: "PRX", PENX: "PEN", GPX: "GP",
  SARX: "SAR", BAQX: "BAQ", AQUX: "AQU", BELX: "BEL", KEEX: "KEE", SAX: "SA",
  DMRX: "DMR", LRLX: "LRL", DELX: "DEL", TAMX: "TAM", OPX: "OP", FGX: "FG",
  TPX: "TP", TDNX: "TDN", BTPX: "BTP", PIDX: "PID", PRMX: "PRM", MTHX: "MTH",
  CNLX: "CNL", ELPX: "ELP", KDX: "KD", LADX: "LAD", LSX: "LS", HOUX: "HOU",
  HAWX: "HAW", FPKX: "FPK", TUPX: "TUP", WOX: "WO", FEX: "FE",
  CHARLESTOWN: "CT", HOLLYWOODATCHARLESTOWN: "CT", GULFSTREAM: "GP", GULFSTREAMPARK: "GP",
  CHURCHILL: "CD", CHURCHILLDOWNS: "CD", SANTANITA: "SA", DELMAR: "DMR", FINGERLAKES: "FL",
  PARXRACING: "PRX", MAHONINGVALLEY: "MVR", OAKLAWN: "OP", OAKLAWNPARK: "OP",
  FAIRGROUNDS: "FG", TURFWAY: "TP", TURFWAYPARK: "TP", TAMPABAY: "TAM", TAMPABAYDOWNS: "TAM",
  AQUEDUCT: "AQU", SARATOGA: "SAR", KEENELAND: "KEE", BELMONT: "BEL", WOODBINE: "WO",
  PENNNATIONAL: "PEN", REMINGTON: "RP", REMINGTONPARK: "RP", DELTADOWNS: "DED",
  SAMHOUSTON: "HOU", LONESTAR: "LS", LOSALAMITOS: "LRC", INDIANAPOLIS: "IND", HORSESHOEINDIANAPOLIS: "IND",
};

export const SLUG_A_CODIGO_USA: Record<string, string> = {
  "gulfstream-park": "GP",
  "gulfstream": "GP",
  "santa-anita-park": "SA",
  "santa-anita": "SA",
  "churchill-downs": "CD",
  "churchill": "CD",
  "aqueduct": "AQU",
  "belmont-at-the-big-a": "BAQ",
  "belmont-park": "BEL",
  "belmont": "BEL",
  "saratoga": "SAR",
  "keeneland": "KEE",
  "del-mar": "DMR",
  "tampa-bay-downs": "TAM",
  "tampa-bay": "TAM",
  "oaklawn-park": "OP",
  "oaklawn": "OP",
  "turfway-park": "TP",
  "turfway": "TP",
  "fair-grounds": "FG",
  "charles-town": "CT",
  "delta-downs": "DED",
  "finger-lakes": "FL",
  "remington-park": "RP",
  "woodbine": "WO",
  "parx-racing": "PRX",
  "parx": "PRX",
  "penn-national": "PEN",
  "mahoning-valley": "MVR",
  "horseshoe-indianapolis": "IND",
  "laurel-park": "LRL",
  "laurel": "LRL",
  "delaware-park": "DEL",
  "monmouth-park": "MTH",
  "colonial-downs": "CNL",
  "ellis-park": "ELP",
  "kentucky-downs": "KD",
  "louisiana-downs": "LAD",
  "lone-star-park": "LS",
  "sam-houston-race-park": "HOU",
  "sam-houston": "HOU",
  "hawthorne": "HAW",
  "fairmount-park": "FPK",
  "turf-paradise": "TUP",
  "golden-gate-fields": "GG",
  "los-alamitos": "LRC",
  "canterbury-park": "CBY",
  "evangeline-downs": "EVD",
  "mountaineer": "MNR",
  "thistledown": "TDN",
  "belterra-park": "BTP",
  "presque-isle-downs": "PID",
  "prairie-meadows": "PRM",
};

export function normalizarCodigoDrf(codigoOAlias: string | null | undefined): string {
  if (!codigoOAlias) return "";
  const raw = String(codigoOAlias).trim().toUpperCase();
  if (CATALOGO_DRF_OFICIAL[raw]) return raw;
  if (ALIAS_A_CODIGO_DRF[raw]) return ALIAS_A_CODIGO_DRF[raw];

  if (raw.endsWith("X")) {
    const sinX = raw.slice(0, -1);
    if (CATALOGO_DRF_OFICIAL[sinX]) return sinX;
  }

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

export type PortalCarreraUsa = "DRF" | "EQUIBASE" | "TVG" | "FANDUEL" | "TWINSPIRES" | "OTRO";

export type MetadatosUrlCarreraUsa = {
  portal: PortalCarreraUsa;
  trackCode: string;
  country: string;
  fechaISO: string;
  fechaDRF: string;
  hipodromo: string;
  urlPublica: string;
  urlApi: string;
};

export function parsearUrlCarreraUsa(urlOTexto: string): MetadatosUrlCarreraUsa | null {
  if (!urlOTexto) return null;
  const texto = urlOTexto.trim();

  // 1. DRF
  const mDrf =
    texto.match(/drf\.com\/race-entries\/track\/([A-Za-z0-9]+)\/country\/([A-Za-z]+)\/date\/([0-9-]+)/i) ||
    texto.match(/drf\.com\/entries\/entryDetails\/id\/([A-Za-z0-9]+)\/country\/([A-Za-z]+)\/date\/([0-9-]+)/i) ||
    texto.match(/(?:drf\.com\/(?:race-)?entries\/(?:track\/)?|racecards\/)([A-Za-z0-9]+)(?:\/country\/([A-Za-z]+))?\/date\/([0-9-]+)/i);

  if (mDrf) {
    const rawCode = mDrf[1].toUpperCase();
    const rawCountry = (mDrf[2] || "USA").toUpperCase();
    const rawDate = mDrf[3];

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
      portal: "DRF",
      trackCode: code,
      country,
      fechaISO,
      fechaDRF,
      hipodromo,
      urlPublica: `https://www.drf.com/race-entries/track/${code}/country/${country}/date/${fechaDRF}`,
      urlApi: `https://www.drf.com/entries/entryDetails/id/${code}/country/${country}/date/${fechaDRF}`,
    };
  }

  // 2. Equibase Static Entry: GP111426USA-EQB.html
  const mEqb =
    texto.match(/equibase\.com\/(?:static\/entry\/)?([A-Za-z]{2,4})(\d{2})(\d{2})(\d{2})([A-Za-z]{3})?-EQB\.html/i) ||
    texto.match(/equibase\.com\/entries\/([A-Za-z]{2,4})\/.*[?&]date=(\d{4}-\d{2}-\d{2}|\d{2}-\d{2}-\d{4})/i);

  if (mEqb) {
    const rawCode = mEqb[1].toUpperCase();
    let fechaISO = "";
    let country = "USA";

    if (mEqb[2] && mEqb[3] && mEqb[4]) {
      const mm = mEqb[2];
      const dd = mEqb[3];
      const yy = `20${mEqb[4]}`;
      fechaISO = `${yy}-${mm}-${dd}`;
      if (mEqb[5]) country = mEqb[5].toUpperCase() === "CAN" ? "CAN" : "USA";
    } else if (mEqb[2]) {
      fechaISO = mEqb[2].includes("-") && mEqb[2].length === 10 ? mEqb[2] : hoyLocal();
    }

    const code = normalizarCodigoDrf(rawCode);
    const meta = CATALOGO_DRF_OFICIAL[code];
    const hipodromo = meta ? meta.nombre : rawCode;
    const fechaDRF = formatearFechaDrf(fechaISO);

    return {
      portal: "EQUIBASE",
      trackCode: code,
      country: meta?.pais || country,
      fechaISO,
      fechaDRF,
      hipodromo,
      urlPublica: `https://www.drf.com/race-entries/track/${code}/country/${meta?.pais || country}/date/${fechaDRF}`,
      urlApi: `https://www.drf.com/entries/entryDetails/id/${code}/country/${meta?.pais || country}/date/${fechaDRF}`,
    };
  }

  // 3. TVG y FanDuel Racing
  const mTvg =
    texto.match(/(?:tvg|racing\.fanduel|fanduel)\.com\/(?:races|racecards)\/([a-z0-9-]+)\/(\d{4}-\d{2}-\d{2})/i);

  if (mTvg) {
    const slug = mTvg[1].toLowerCase();
    const fechaISO = mTvg[2];
    const portal: PortalCarreraUsa = texto.includes("fanduel") ? "FANDUEL" : "TVG";

    const codeFromSlug = SLUG_A_CODIGO_USA[slug] || normalizarCodigoDrf(slug);
    const meta = CATALOGO_DRF_OFICIAL[codeFromSlug];
    const country = meta?.pais || "USA";
    const hipodromo = meta ? meta.nombre : codeFromSlug;
    const fechaDRF = formatearFechaDrf(fechaISO);

    return {
      portal,
      trackCode: codeFromSlug,
      country,
      fechaISO,
      fechaDRF,
      hipodromo,
      urlPublica: `https://www.drf.com/race-entries/track/${codeFromSlug}/country/${country}/date/${fechaDRF}`,
      urlApi: `https://www.drf.com/entries/entryDetails/id/${codeFromSlug}/country/${country}/date/${fechaDRF}`,
    };
  }

  return null;
}

export const parsearUrlDrf = parsearUrlCarreraUsa;

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

export function limpiarTextoOHtmlPegado(raw: string): string {
  if (!raw) return "";
  let t = raw;
  if (t.includes("<") && t.includes(">")) {
    t = t.replace(/<\/(?:tr|div|p|li|h[1-6])>/gi, "\n");
    t = t.replace(/<br\s*\/?>/gi, "\n");
    t = t.replace(/<\/(?:td|th)>/gi, " \t ");
    t = t.replace(/<[^>]+>/g, " ");
    t = t
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">");
  }
  return t;
}

const MESES_MAPA: Record<string, string> = {
  january: "01", february: "02", march: "03", april: "04", may: "05", june: "06",
  july: "07", august: "08", september: "09", october: "10", november: "11", december: "12",
  jan: "01", feb: "02", mar: "03", apr: "04", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
  enero: "01", febrero: "02", marzo: "03", abril: "04", mayo: "05", junio: "06",
  julio: "07", agosto: "08", septiembre: "09", octubre: "10", noviembre: "11", diciembre: "12",
};

export function extraerFechaDeTexto(texto: string): string | null {
  if (!texto) return null;
  const metaDrf = parsearUrlCarreraUsa(texto);
  if (metaDrf?.fechaISO) return metaDrf.fechaISO;

  const mUsaDash = texto.match(/\b(0?[1-9]|1[0-2])-([0-2]?[0-9]|3[01])-(20\d{2})\b/);
  if (mUsaDash) {
    const mm = mUsaDash[1].padStart(2, "0");
    const dd = mUsaDash[2].padStart(2, "0");
    const yyyy = mUsaDash[3];
    return `${yyyy}-${mm}-${dd}`;
  }

  const mIso = texto.match(/\b(20\d{2})-(0?[1-9]|1[0-2])-([0-2]?[0-9]|3[01])\b/);
  if (mIso) {
    const yyyy = mIso[1];
    const mm = mIso[2].padStart(2, "0");
    const dd = mIso[3].padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  const mIngles = texto.match(/\b(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)?\s*,?\s*([a-z]+)\s+([0-2]?[0-9]|3[01])\s*,?\s*(20\d{2})\b/i);
  if (mIngles) {
    const mesStr = mIngles[1].toLowerCase();
    const dia = mIngles[2].padStart(2, "0");
    const anio = mIngles[3];
    if (MESES_MAPA[mesStr]) {
      return `${anio}-${MESES_MAPA[mesStr]}-${dia}`;
    }
  }

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

export function extraerHipodromoDeTexto(texto: string): string | null {
  if (!texto) return null;
  const textoMin = texto.toLowerCase();
  const metaDrfHipo = parsearUrlCarreraUsa(texto);
  if (metaDrfHipo?.hipodromo) return metaDrfHipo.hipodromo;

  const mDrfTrack = texto.match(/(?:track|hipodromo|code)\/([A-Za-z0-9]+)/i);
  if (mDrfTrack) {
    const code = mDrfTrack[1].toUpperCase();
    const hMeta = HIPODROMOS_USA_DISPONIBLES.find((h) => h.codigo === code || h.drfCode === code);
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

export type EjemplarSincronizadoUsa = {
  numero: string;
  nombre: string;
  pp?: number;
  ml?: string;
  jockey?: string;
  jinete?: string;
  entrenador?: string;
  stud?: string;
  owner?: string;
  peso?: number | string;
  medicamento?: string;
  retirado?: boolean;
};

export type CarreraSincronizadaUsa = {
  hipodromo: string;
  carrera: number;
  fecha: string;
  hora?: string | null;
  distancia?: number;
  superficie?: "ARENA" | "GRAMA" | "SINTETICA";
  premio?: number;
  caballos: EjemplarSincronizadoUsa[];
  retirados: string[];
};

export function parsearTextoPegadoUsa(
  textoRaw: string,
  hipodromoDefecto = "Gulfstream Park",
  fechaDefecto = hoyLocal()
): CarreraSincronizadaUsa[] {
  const texto = limpiarTextoOHtmlPegado(textoRaw);

  const metaDrf = parsearUrlCarreraUsa(texto);
  if (metaDrf) {
    if (esHipodromoVenezolano(metaDrf.hipodromo)) {
      throw new Error(`Jurisdicción exclusiva USA: '${metaDrf.hipodromo}' no está permitido.`);
    }
  }

  const fechaDetectada = extraerFechaDeTexto(texto);
  const fechaEfectiva = fechaDetectada || fechaDefecto;

  const hipoDetectado = extraerHipodromoDeTexto(texto);
  const hipoEfectivo = hipoDetectado || hipodromoDefecto;

  if (esHipodromoVenezolano(hipoEfectivo)) {
    throw new Error(`Jurisdicción exclusiva USA: '${hipoEfectivo}' no está permitido.`);
  }

  const lineas = texto.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const carrerasMap = new Map<number, CarreraSincronizadaUsa>();
  let carreraActual = 1;

  for (let i = 0; i < lineas.length; i++) {
    const lin = lineas[i];

    const mRace =
      lin.match(/\b(?:Race|Carrera)\s*#?\s*(\d{1,2})\b/i) ||
      lin.match(/^(\d{1,2})(?:st|nd|rd|th|a|ra|da|ta|ª)?\s+(?:Race|Carrera)\b/i) ||
      lin.match(/^[RC](\d{1,2})\s*[-:]/i);

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
          superficie: lin.toLowerCase().includes("turf") || lin.toLowerCase().includes("grama") ? "GRAMA" : "ARENA",
          caballos: [],
          retirados: [],
        });
      } else {
        const c = carrerasMap.get(carreraActual)!;
        if (horaDetectada && !c.hora) c.hora = horaDetectada;
      }
      continue;
    }

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

    if (/\b(?:furlongs?|meters?|metros?|miles?)\b/i.test(lin) || /\b(?:exacta|trifecta|superfecta|pick\s*\d+)\b/i.test(lin)) {
      continue;
    }

    const mNum = lin.match(/^(?:#?\s*)(\d{1,2}[A-Z]?)(?:[.:\-)]|\s*\(([0-9]{1,2})\))?\s+(.+)$/i);
    if (mNum) {
      const numProg = mNum[1].toUpperCase().trim();
      const ppParentesis = mNum[2] ? parseInt(mNum[2], 10) : undefined;
      const resto = mNum[3].trim();
      if (/^(?:st|nd|rd|th)?\s*(?:race|carrera)/i.test(resto)) continue;

      const esScratched = /\b(SCRATCHED|SCR|RETIRADO|RET)\b/i.test(lin);

      const mJockey = lin.match(/(?:Jockey:?\s*|Jinete:?\s*|\bJ:\s*)([A-Za-z\s'.-]+?)(?:,|\)|;|\t|\s*Trainer|\s*ML|\s*Weight|$)/i);
      const jockey = mJockey ? mJockey[1].trim() : undefined;

      const mTrainer = lin.match(/(?:Trainer:?\s*|Entrenador:?\s*|\bT:\s*)([A-Za-z\s'.-]+?)(?:,|\)|;|\t|\s*Weight|\s*ML|$)/i);
      const entrenador = mTrainer ? mTrainer[1].trim() : undefined;

      const mMl = lin.match(/(?:ML:?\s*|\bML\s+)(\d{1,2}[/-]\d{1,2}|\d+\.?\d*)|(?:\s|\t)(\d{1,2}[/-]\d{1,2})(?:\s|\t|\)|$)/i);
      let ml: string | undefined = undefined;
      if (mMl) {
        const rawMl = (mMl[1] || mMl[2])?.trim();
        if (rawMl) ml = rawMl.replace("-", "/");
      }

      let pp = ppParentesis;
      if (!pp) {
        const mPp = lin.match(/(?:PP:?\s*|\bP(?:ost)?\s*P(?:os)?:\s*)(\d{1,2})/i);
        if (mPp) pp = parseInt(mPp[1], 10);
      }

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

      const mPeso = nombreLimpio.match(/^([A-Za-z\s'.-]+?)\s+\d{3}\b/);
      if (mPeso) {
        nombreLimpio = mPeso[1].trim();
      }

      if (nombreLimpio.includes("\t")) {
        const primerCol = nombreLimpio.split("\t")[0].trim();
        if (primerCol) nombreLimpio = primerCol;
      }

      nombreLimpio = nombreLimpio.replace(/[()]/g, "").trim().toUpperCase();

      if (nombreLimpio && nombreLimpio.length >= 2 && !nombreLimpio.startsWith("RACE") && !nombreLimpio.startsWith("EXACTA") && !nombreLimpio.startsWith("TRIFECTA")) {
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

  return Array.from(carrerasMap.values()).sort((a, b) => a.carrera - b.carrera);
}
