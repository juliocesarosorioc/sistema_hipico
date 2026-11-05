import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

// ----------------------------------------------------------------------------
// Catálogo DRF Oficial y Normalización
// ----------------------------------------------------------------------------
export type HipodromoUsaMeta = {
  codigo: string;
  nombre: string;
  drfCode: string;
  pais: "USA" | "CAN";
  estadoDefecto: string;
  tvgSlug: string;
};

export const CATALOGO_DRF: Record<string, HipodromoUsaMeta> = {
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

const ALIAS_DRF: Record<string, string> = {
  CDX: "CD", FLX: "FL", RPX: "RP", CTX: "CT", DEDX: "DED", EVDX: "EVD",
  INDX: "IND", MNRX: "MNR", MVRX: "MVR", PRXX: "PRX", PENX: "PEN", GPX: "GP",
  SARX: "SAR", BAQX: "BAQ", AQUX: "AQU", BELX: "BEL", KEEX: "KEE", SAX: "SA",
  DMRX: "DMR", LRLX: "LRL", DELX: "DEL", TAMX: "TAM", OPX: "OP", FGX: "FG",
  TPX: "TP", TDNX: "TDN", BTPX: "BTP", PIDX: "PID", PRMX: "PRM", MTHX: "MTH",
  CNLX: "CNL", ELPX: "ELP", KDX: "KD", LADX: "LAD", LSX: "LS", HOUX: "HOU",
  HAWX: "HAW", FPKX: "FPK", TUPX: "TUP", WOX: "WO", FEX: "FE",
  CHARLESTOWN: "CT", HOLLYWOODATCHARLESTOWN: "CT", GULFSTREAM: "GP", GULFSTREAMPARK: "GP",
  CHURCHILL: "CD", CHURCHILLDOWNS: "CD", SANTANITA: "SA", DELMAR: "DMR", FINGERLAKES: "FL",
  PARXRACING: "PRX", MAHONINGVALLEY: "MVR",
};

export function normalizarCodigo(raw: unknown): string {
  if (!raw) return "";
  const up = String(raw).trim().toUpperCase();
  if (CATALOGO_DRF[up]) return up;
  if (ALIAS_DRF[up]) return ALIAS_DRF[up];
  if (up.endsWith("X") && CATALOGO_DRF[up.slice(0, -1)]) return up.slice(0, -1);

  const clean = up.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Z0-9]/g, "");
  if (ALIAS_DRF[clean]) return ALIAS_DRF[clean];
  for (const [code, meta] of Object.entries(CATALOGO_DRF)) {
    const metaClean = meta.nombre.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Z0-9]/g, "").toUpperCase();
    if (metaClean === clean || clean.includes(metaClean) || metaClean.includes(clean)) {
      return code;
    }
  }
  return up;
}

export function esHipodromoVenezolano(nombre: unknown): boolean {
  if (!nombre) return false;
  const s = String(nombre)
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "");
  return (
    s === "LARINCONADA" ||
    s === "VALENCIA" ||
    s === "SANTARITA" ||
    s.includes("RINCONADA") ||
    s.includes("VALENCIA") ||
    s.includes("SANTARITA")
  );
}

export function formatearFechaDrf(iso: string): string {
  const m = String(iso ?? "").match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) {
    return `${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}-${m[1]}`;
  }
  return iso;
}

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

export function normalizarDistanciaAMetros(textoOValor: unknown): number {
  if (typeof textoOValor === "number" && !Number.isNaN(textoOValor)) {
    if (textoOValor >= 200 && textoOValor <= 4000) return Math.round(textoOValor);
    if (textoOValor > 0 && textoOValor <= 20) return normalizarDistanciaAMetros(`${textoOValor} Furlongs`);
    if (textoOValor > 100 && textoOValor < 1000) return normalizarDistanciaAMetros(`${textoOValor} Yards`);
  }

  const raw = String(textoOValor ?? "").trim();
  if (!raw) return 1200;
  const s = raw.toLowerCase().replace(/\s+/g, " ");

  if (s.includes("1 mile 70 yards") || s.includes("1 m 70 y") || s.includes("1m70y") || s.includes("1 mi 70 yd")) return 1664;
  if (s.includes("1 1/16") && (s.includes("m") || s.includes("mile"))) return 1700;
  if (s.includes("1 1/8") && (s.includes("m") || s.includes("mile"))) return 1800;
  if (s.includes("1 3/16") && (s.includes("m") || s.includes("mile"))) return 1900;
  if (s.includes("1 1/4") && (s.includes("m") || s.includes("mile"))) return 2000;
  if (s.includes("1 1/2") && (s.includes("m") || s.includes("mile"))) return 2400;
  if ((s === "1 mile" || s === "1 m" || s === "1 mi" || s.startsWith("1 mile ")) && !s.includes("70")) return 1600;

  if (s.includes("4 1/2 f") || s.includes("4.5 f") || s.includes("4 1/2 furlongs")) return 905;
  if (s.includes("5 1/2 f") || s.includes("5.5 f") || s.includes("5 1/2 furlongs")) return 1100;
  if (s.includes("6 1/2 f") || s.includes("6.5 f") || s.includes("6 1/2 furlongs")) return 1308;
  if (s.includes("7 1/2 f") || s.includes("7.5 f") || s.includes("7 1/2 furlongs")) return 1500;
  if (s.includes("8 1/2 f") || s.includes("8.5 f") || s.includes("8 1/2 furlongs")) return 1700;

  if (s.match(/\b6\s*(?:furlongs?|f)\b/)) return 1200;
  if (s.match(/\b5\s*(?:furlongs?|f)\b/)) return 1000;
  if (s.match(/\b7\s*(?:furlongs?|f)\b/)) return 1408;
  if (s.match(/\b8\s*(?:furlongs?|f)\b/)) return 1600;
  if (s.match(/\b4\s*(?:furlongs?|f)\b/)) return 800;

  if (s.match(/\b350\s*(?:yards?|yds?|y)\b/)) return 318;
  if (s.match(/\b220\s*(?:yards?|yds?|y)\b/)) return 201;
  if (s.match(/\b250\s*(?:yards?|yds?|y)\b/)) return 228;
  if (s.match(/\b300\s*(?:yards?|yds?|y)\b/)) return 274;
  if (s.match(/\b330\s*(?:yards?|yds?|y)\b/)) return 301;
  if (s.match(/\b400\s*(?:yards?|yds?|y)\b/)) return 365;
  if (s.match(/\b440\s*(?:yards?|yds?|y)\b/)) return 402;
  if (s.match(/\b550\s*(?:yards?|yds?|y)\b/)) return 502;
  if (s.match(/\b870\s*(?:yards?|yds?|y)\b/)) return 795;

  const mMetros = s.match(/(\d+)\s*(?:m|metros|meters)\b/);
  if (mMetros) return parseInt(mMetros[1], 10);

  const mF = s.match(/(\d+)(?:\s+(\d+)\/(\d+))?\s*(?:furlongs?|f)\b/);
  if (mF) {
    let f = parseFloat(mF[1]);
    if (mF[2] && mF[3]) f += parseFloat(mF[2]) / parseFloat(mF[3]);
    return Math.round(f * 201.168);
  }

  const num = parseFloat(s);
  if (!Number.isNaN(num)) {
    if (num >= 200) return Math.round(num);
    if (num > 0 && num <= 16) return Math.round(num * 200);
  }
  return 1200;
}

export function normalizarSuperficie(s: unknown): "ARENA" | "GRAMA" | "SINTETICA" {
  const str = String(s ?? "").toUpperCase();
  if (str.includes("TURF") || str.includes("GRAMA") || str.includes("GRASS") || str === "T") return "GRAMA";
  if (str.includes("SYNTHETIC") || str.includes("TAPETA") || str.includes("ALL WEATHER") || str.includes("POLY")) return "SINTETICA";
  return "ARENA";
}

export function normalizarPesoKg(pesoRaw: unknown): number | undefined {
  if (pesoRaw == null) return undefined;
  const num = typeof pesoRaw === "number" ? pesoRaw : parseFloat(String(pesoRaw).replace(",", ".").replace(/[^\d.]/g, ""));
  if (Number.isNaN(num) || num <= 0) return undefined;
  if (num >= 80) return Math.round(num * 0.45359237 * 10) / 10;
  return Math.round(num * 10) / 10;
}

export type EjemplarParsed = {
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

export type CarreraParsed = {
  hipodromo: string;
  carrera: number;
  fecha: string;
  hora?: string | null;
  distancia?: number;
  superficie?: string;
  premio?: number;
  caballos: EjemplarParsed[];
  retirados: string[];
};

export function parsearDrfRaces(data: any, hipodromoNombre: string, fechaISO: string): CarreraParsed[] {
  if (!data) return [];
  const races = data?.races || data?.entryDetails?.races || data?.raceList || data?.data?.races || [];
  if (!Array.isArray(races)) return [];

  const carreras: CarreraParsed[] = [];

  for (let idx = 0; idx < races.length; idx++) {
    const r = races[idx];
    const numC = Number(r.raceKey?.raceNumber ?? r.raceNumber ?? r.race_number ?? r.carrera ?? idx + 1) || (idx + 1);
    const runners = r.runners || r.horses || r.entries || [];
    const caballos: EjemplarParsed[] = [];
    const retirados: string[] = [];

    for (const h of runners) {
      const num = String(
        h.programNumber || h.programNumberStripped || h.program_number || h.postPos || h.cloth || h.postPosition || ""
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

      // REGLA CRUCIAL: DRF retorna scratchIndicator = 'N' para caballos activos y 'Y' para retirados.
      const isScr =
        String(h.scratchIndicator || "").toUpperCase() === "Y" ||
        Boolean(h.scratched || h.isScratched) ||
        String(h.status || "").toUpperCase() === "SCR";

      const ppNum = Number(h.postPos || h.postPosition || h.pp) || (parseInt(num, 10) || undefined);

      caballos.push({
        numero: num || String(caballos.length + 1),
        nombre,
        pp: ppNum,
        ml,
        jockey: jockey || undefined,
        jinete: jockey || undefined,
        entrenador: entrenador || undefined,
        stud: stud || undefined,
        owner: stud || undefined,
        peso: pesoKg,
        medicamento: h.medication?.trim() || undefined,
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
        distancia: normalizarDistanciaAMetros(r.distanceDescription || r.distance || r.distanceMeters),
        superficie: normalizarSuperficie(r.surfaceDescription || r.surface || r.trackSurface),
        premio: Number(r.purse || r.purseTotal) || 0,
        caballos,
        retirados,
      });
    }
  }

  return carreras;
}

// ----------------------------------------------------------------------------
// GET: Detección Automática de Hipódromos Activos DRF
// ----------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const accion = searchParams.get("accion") || "detectar_tracks";
  const fecha = searchParams.get("fecha") || new Date().toISOString().slice(0, 10);
  const fechaDrf = formatearFechaDrf(fecha);

  if (accion === "detectar_tracks") {
    try {
      const resp = await fetch(`https://www.drf.com/entries/tracks/date/${fechaDrf}`, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          "Accept": "application/json, text/plain, */*",
          "Referer": "https://www.drf.com/",
        },
        cache: "no-store",
      });

      if (resp.ok) {
        const d = await resp.json();
        const list = d?.trackList || d?.tracks || [];
        if (Array.isArray(list) && list.length > 0) {
          const codigos: string[] = [];
          const trackList: Array<{ trackId: string; trackName: string; country: string }> = [];

          for (const item of list) {
            const rawId = item.trackId || item.code || item.id;
            const country = item.country || "USA";
            const name = item.trackName || item.name || rawId;

            if (esHipodromoVenezolano(name)) continue;

            const codeNorm = normalizarCodigo(rawId);
            if (codeNorm && !codigos.includes(codeNorm)) {
              codigos.push(codeNorm);
              trackList.push({
                trackId: codeNorm,
                trackName: CATALOGO_DRF[codeNorm]?.nombre || name,
                country,
              });
            }
          }

          if (codigos.length > 0) {
            return NextResponse.json({
              ok: true,
              fecha,
              fechaDrf,
              tracks: codigos,
              trackList,
              totalTracks: codigos.length,
            });
          }
        }
      }
    } catch {
      /* fallback */
    }

    // Fallback inteligente si DRF estuviese en mantenimiento
    const diaSem = new Date(`${fecha}T12:00:00Z`).getUTCDay();
    const tracksPorDia: Record<number, string[]> = {
      0: ["CD", "GP", "AQU", "SA", "DMR", "OP", "KEE", "TAM", "WO", "RP"],
      1: ["FL", "PRX", "MVR", "MNR", "IND"],
      2: ["PRX", "MVR", "MNR", "FL", "IND"],
      3: ["CT", "TAM", "GP", "MNR", "DED"],
      4: ["GP", "AQU", "CT", "DED", "TP", "PEN"],
      5: ["GP", "AQU", "SA", "DMR", "CT", "DED", "TP", "PEN", "RP", "WO"],
      6: ["CD", "GP", "AQU", "SA", "DMR", "OP", "KEE", "TAM", "CT", "DED", "TP", "PEN", "RP", "WO"],
    };
    const defCodigos = tracksPorDia[diaSem] || ["GP", "SA", "TAM", "AQU", "CD"];

    return NextResponse.json({
      ok: true,
      fecha,
      fechaDrf,
      tracks: defCodigos,
      trackList: defCodigos.map((c) => ({
        trackId: c,
        trackName: CATALOGO_DRF[c]?.nombre || c,
        country: CATALOGO_DRF[c]?.pais || "USA",
      })),
      totalTracks: defCodigos.length,
      fallback: true,
    });
  }

  return NextResponse.json({ ok: false, error: "Acción no reconocida" }, { status: 400 });
}

// ----------------------------------------------------------------------------
// POST: Sincronización y Descarga de Carreras DRF
// ----------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    let fecha = String(body.fecha || new Date().toISOString().slice(0, 10));
    let tracksFiltro: string[] = Array.isArray(body.tracks) && body.tracks.length > 0 ? body.tracks : [];
    const urlDirecta = String(body.urlDirectaDrf || "").trim();

    // Si viene de URL directa DRF
    if (urlDirecta) {
      const m = urlDirecta.match(/track\/([A-Za-z0-9]+)(?:\/country\/([A-Za-z]+))?\/date\/([0-9-]+)/i) ||
                urlDirecta.match(/id\/([A-Za-z0-9]+)(?:\/country\/([A-Za-z]+))?\/date\/([0-9-]+)/i);
      if (m) {
        const code = normalizarCodigo(m[1]);
        tracksFiltro = [code];
        const dateRaw = m[3];
        const mIso = dateRaw.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
        if (mIso) {
          fecha = `${mIso[3]}-${mIso[1].padStart(2, "0")}-${mIso[2].padStart(2, "0")}`;
        } else if (/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) {
          fecha = dateRaw;
        }
      }
    }

    if (tracksFiltro.length === 0) {
      tracksFiltro = ["CD", "GP", "AQU", "SA", "TAM", "CT", "DED"];
    }

    const fechaDrf = formatearFechaDrf(fecha);
    const carrerasObtenidas: CarreraParsed[] = [];
    const tracksProcesados: string[] = [];

    for (const rawTrack of tracksFiltro) {
      const codeNorm = normalizarCodigo(rawTrack);
      const meta = CATALOGO_DRF[codeNorm];
      const nomTrack = meta?.nombre || rawTrack;
      const country = meta?.pais || "USA";

      // 1. REGLA FUNDAMENTAL: Aislamiento Jurisdiccional USA (Prohibido Venezuela)
      if (esHipodromoVenezolano(nomTrack)) continue;

      let carrerasEsteTrack: CarreraParsed[] = [];

      // Intento 1: DRF Endpoint oficial de detalles: /entries/entryDetails/id/{id}/country/{country}/date/{MM-DD-YYYY}
      try {
        const urlDrf = `https://www.drf.com/entries/entryDetails/id/${codeNorm}/country/${country}/date/${fechaDrf}`;
        const resp = await fetch(urlDrf, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Accept": "application/json, text/plain, */*",
            "Referer": `https://www.drf.com/race-entries/track/${codeNorm}/country/${country}/date/${fechaDrf}`,
            "Accept-Language": "en-US,en;q=0.9",
          },
          cache: "no-store",
        });

        if (resp.ok) {
          const data = await resp.json();
          const parsed = parsearDrfRaces(data, nomTrack, fecha);
          if (parsed.length > 0) {
            carrerasEsteTrack = parsed;
          }
        }
      } catch {
        /* fallback */
      }

      // Intento 2: DRF secondary endpoint racecards: /data/racecards/{YYYY-MM-DD}/{trackId}
      if (carrerasEsteTrack.length === 0) {
        try {
          const resp2 = await fetch(`https://entries.drf.com/data/racecards/${fecha}/${codeNorm}`, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
              "Accept": "application/json, text/plain, */*",
            },
            cache: "no-store",
          });
          if (resp2.ok) {
            const data2 = await resp2.json();
            const parsed2 = parsearDrfRaces(data2, nomTrack, fecha);
            if (parsed2.length > 0) {
              carrerasEsteTrack = parsed2;
            }
          }
        } catch {
          /* fallback */
        }
      }

      if (carrerasEsteTrack.length > 0) {
        carrerasObtenidas.push(...carrerasEsteTrack);
        if (!tracksProcesados.includes(nomTrack)) {
          tracksProcesados.push(nomTrack);
        }
      }
    }

    // Filtrado estricto final
    const carrerasValidas = carrerasObtenidas.filter((c) => !esHipodromoVenezolano(c.hipodromo));

    // Si tenemos cliente Supabase en el servidor, guardamos catálogo de hipódromos
    const supabase = getAdminClient();
    if (supabase && carrerasValidas.length > 0) {
      try {
        const hiposUnicos = [...new Set(carrerasValidas.map((c) => c.hipodromo))];
        for (const h of hiposUnicos) {
          try {
            await supabase
              .from("hipodromos")
              .upsert({ nombre: h, pais: "USA", activo: true }, { onConflict: "nombre" });
          } catch {
            /* ignore individual upsert failure */
          }
        }
      } catch {
        /* best-effort */
      }
    }

    // Desglose por track
    const tracksGroup = new Map<string, CarreraParsed[]>();
    for (const c of carrerasValidas) {
      const arr = tracksGroup.get(c.hipodromo) ?? [];
      arr.push(c);
      tracksGroup.set(c.hipodromo, arr);
    }

    const detallesPorTrack = Array.from(tracksGroup.entries()).map(([hipo, carrs]) => {
      const totalEjs = carrs.reduce((a, c) => a + c.caballos.length, 0);
      const todosRets = [...new Set(carrs.flatMap((c) => c.retirados))];
      return {
        hipodromo: hipo,
        carreras: carrs.length,
        ejemplares: totalEjs,
        retirados: todosRets.length,
        listaRetirados: todosRets,
      };
    });

    const totalCarreras = carrerasValidas.length;
    const totalEjemplares = carrerasValidas.reduce((a, c) => a + c.caballos.length, 0);
    const totalRetirados = detallesPorTrack.reduce((a, t) => a + t.retirados, 0);

    return NextResponse.json({
      ok: totalCarreras > 0,
      fecha,
      tracksProcesados,
      totalCarreras,
      totalEjemplares,
      totalRetirados,
      detallesPorTrack,
      carreras: carrerasValidas,
      error: totalCarreras === 0 ? "No se obtuvieron carreras para los tracks seleccionados en la fecha especificada." : undefined,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: `Error en sincronizador USA: ${msg}` }, { status: 500 });
  }
}
