// ============================================================================
// EDGE FUNCTION: sync-usa-races
// Sincronizador de Carreras y Ejemplares de Estados Unidos (TVG + DRF)
// Jurisdicción EXCLUSIVA USA (Prohibido Venezuela).
// ============================================================================

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") || Deno.env.get("GOOGLE_API_KEY") || "";

function json(data: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "authorization, content-type, apikey, x-client-info",
    },
  });
}

// ----------------------------------------------------------------------------
// Diccionario Canónico y Oficial de Tracks DRF (USA & CAN)
// ----------------------------------------------------------------------------
export const TRACKS_USA_CATALOGO: Record<
  string,
  { nombre: string; drfCode: string; pais: "USA" | "CAN"; estado: string; tvgSlug: string }
> = {
  CD: { nombre: "Churchill Downs", drfCode: "CD", pais: "USA", estado: "KY", tvgSlug: "churchill-downs" },
  FL: { nombre: "Finger Lakes", drfCode: "FL", pais: "USA", estado: "NY", tvgSlug: "finger-lakes" },
  RP: { nombre: "Remington Park", drfCode: "RP", pais: "USA", estado: "OK", tvgSlug: "remington-park" },
  CT: { nombre: "Hollywood at Charles Town", drfCode: "CT", pais: "USA", estado: "WV", tvgSlug: "charles-town" },
  DED: { nombre: "Delta Downs", drfCode: "DED", pais: "USA", estado: "LA", tvgSlug: "delta-downs" },
  EVD: { nombre: "Evangeline Downs", drfCode: "EVD", pais: "USA", estado: "LA", tvgSlug: "evangeline-downs" },
  IND: { nombre: "Horseshoe Indianapolis", drfCode: "IND", pais: "USA", estado: "IN", tvgSlug: "horseshoe-indianapolis" },
  MNR: { nombre: "Mountaineer", drfCode: "MNR", pais: "USA", estado: "WV", tvgSlug: "mountaineer" },
  MVR: { nombre: "Mahoning Valley", drfCode: "MVR", pais: "USA", estado: "OH", tvgSlug: "mahoning-valley" },
  PRX: { nombre: "Parx Racing", drfCode: "PRX", pais: "USA", estado: "PA", tvgSlug: "parx-racing" },
  PEN: { nombre: "Penn National", drfCode: "PEN", pais: "USA", estado: "PA", tvgSlug: "penn-national" },
  GP: { nombre: "Gulfstream Park", drfCode: "GP", pais: "USA", estado: "FL", tvgSlug: "gulfstream-park" },
  SAR: { nombre: "Saratoga", drfCode: "SAR", pais: "USA", estado: "NY", tvgSlug: "saratoga" },
  BAQ: { nombre: "Belmont at the Big A", drfCode: "BAQ", pais: "USA", estado: "NY", tvgSlug: "aqueduct" },
  AQU: { nombre: "Aqueduct", drfCode: "AQU", pais: "USA", estado: "NY", tvgSlug: "aqueduct" },
  BEL: { nombre: "Belmont Park", drfCode: "BEL", pais: "USA", estado: "NY", tvgSlug: "belmont-park" },
  KEE: { nombre: "Keeneland", drfCode: "KEE", pais: "USA", estado: "KY", tvgSlug: "keeneland" },
  SA: { nombre: "Santa Anita", drfCode: "SA", pais: "USA", estado: "CA", tvgSlug: "santa-anita-park" },
  DMR: { nombre: "Del Mar", drfCode: "DMR", pais: "USA", estado: "CA", tvgSlug: "del-mar" },
  LRL: { nombre: "Laurel Park", drfCode: "LRL", pais: "USA", estado: "MD", tvgSlug: "laurel-park" },
  DEL: { nombre: "Delaware Park", drfCode: "DEL", pais: "USA", estado: "DE", tvgSlug: "delaware-park" },
  TAM: { nombre: "Tampa Bay Downs", drfCode: "TAM", pais: "USA", estado: "FL", tvgSlug: "tampa-bay-downs" },
  OP: { nombre: "Oaklawn Park", drfCode: "OP", pais: "USA", estado: "AR", tvgSlug: "oaklawn-park" },
  FG: { nombre: "Fair Grounds", drfCode: "FG", pais: "USA", estado: "LA", tvgSlug: "fair-grounds" },
  TP: { nombre: "Turfway Park", drfCode: "TP", pais: "USA", estado: "KY", tvgSlug: "turfway-park" },
  TDN: { nombre: "Thistledown", drfCode: "TDN", pais: "USA", estado: "OH", tvgSlug: "thistledown" },
  BTP: { nombre: "Belterra Park", drfCode: "BTP", pais: "USA", estado: "OH", tvgSlug: "belterra-park" },
  PID: { nombre: "Presque Isle Downs", drfCode: "PID", pais: "USA", estado: "PA", tvgSlug: "presque-isle-downs" },
  PRM: { nombre: "Prairie Meadows", drfCode: "PRM", pais: "USA", estado: "IA", tvgSlug: "prairie-meadows" },
  MTH: { nombre: "Monmouth Park", drfCode: "MTH", pais: "USA", estado: "NJ", tvgSlug: "monmouth-park" },
  CNL: { nombre: "Colonial Downs", drfCode: "CNL", pais: "USA", estado: "VA", tvgSlug: "colonial-downs" },
  ELP: { nombre: "Ellis Park", drfCode: "ELP", pais: "USA", estado: "KY", tvgSlug: "ellis-park" },
  KD: { nombre: "Kentucky Downs", drfCode: "KD", pais: "USA", estado: "KY", tvgSlug: "kentucky-downs" },
  LAD: { nombre: "Louisiana Downs", drfCode: "LAD", pais: "USA", estado: "LA", tvgSlug: "louisiana-downs" },
  LS: { nombre: "Lone Star Park", drfCode: "LS", pais: "USA", estado: "TX", tvgSlug: "lone-star-park" },
  HOU: { nombre: "Sam Houston", drfCode: "HOU", pais: "USA", estado: "TX", tvgSlug: "sam-houston-race-park" },
  HAW: { nombre: "Hawthorne", drfCode: "HAW", pais: "USA", estado: "IL", tvgSlug: "hawthorne" },
  FPK: { nombre: "FanDuel Fairmount", drfCode: "FPK", pais: "USA", estado: "IL", tvgSlug: "fairmount-park" },
  TUP: { nombre: "Turf Paradise", drfCode: "TUP", pais: "USA", estado: "AZ", tvgSlug: "turf-paradise" },
  WO: { nombre: "Woodbine", drfCode: "WO", pais: "CAN", estado: "ON", tvgSlug: "woodbine" },
  FE: { nombre: "Fort Erie", drfCode: "FE", pais: "CAN", estado: "ON", tvgSlug: "fort-erie" },
  GG: { nombre: "Golden Gate Fields", drfCode: "GG", pais: "USA", estado: "CA", tvgSlug: "golden-gate-fields" },
  LRC: { nombre: "Los Alamitos", drfCode: "LRC", pais: "USA", estado: "CA", tvgSlug: "los-alamitos" },
  CBY: { nombre: "Canterbury Park", drfCode: "CBY", pais: "USA", estado: "MN", tvgSlug: "canterbury-park" },
};

export const ALIAS_TRACKS: Record<string, string> = {
  CDX: "CD", FLX: "FL", RPX: "RP", CTX: "CT", DEDX: "DED", EVDX: "EVD",
  INDX: "IND", MNRX: "MNR", MVRX: "MVR", PRXX: "PRX", PENX: "PEN", GPX: "GP",
  SARX: "SAR", BAQX: "BAQ", AQUX: "AQU", BELX: "BEL", KEEX: "KEE", SAX: "SA",
  DMRX: "DMR", LRLX: "LRL", DELX: "DEL", TAMX: "TAM", OPX: "OP", FGX: "FG",
  TPX: "TP", TDNX: "TDN", BTPX: "BTP", PIDX: "PID", PRMX: "PRM", MTHX: "MTH",
  CNLX: "CNL", ELPX: "ELP", KDX: "KD", LADX: "LAD", LSX: "LS", HOUX: "HOU",
  HAWX: "HAW", FPKX: "FPK", TUPX: "TUP", WOX: "WO", FEX: "FE",
  GULFSTREAM: "GP", SANTAANITA: "SA", TAMPABAY: "TAM", CHARLESTOWN: "CT",
};

export function normalizarCodigo(raw: string): string {
  const up = String(raw ?? "").trim().toUpperCase();
  if (TRACKS_USA_CATALOGO[up]) return up;
  if (ALIAS_TRACKS[up]) return ALIAS_TRACKS[up];
  if (up.endsWith("X") && TRACKS_USA_CATALOGO[up.slice(0, -1)]) return up.slice(0, -1);
  return up;
}

export function formatearFechaDrf(iso: string): string {
  const m = String(iso ?? "").match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) {
    return `${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}-${m[1]}`;
  }
  return iso;
}

export function normalizarDistanciaM(val: unknown): number {
  if (typeof val === "number" && !Number.isNaN(val)) {
    if (val >= 200 && val <= 4000) return Math.round(val);
    if (val > 0 && val <= 20) return Math.round(val * 201.168);
    if (val > 100 && val < 1000) return Math.round(val * 0.9144);
  }
  const s = String(val ?? "").trim();
  if (!s) return 1200;

  const mMetros = s.match(/(\d+)\s*(?:m|metros|meters)\b/i);
  if (mMetros) return parseInt(mMetros[1], 10);

  const mF = s.match(/(\d+)(?:\s+(\d+)\/(\d+))?\s*(?:furlongs?|f)\b/i);
  if (mF) {
    let f = parseFloat(mF[1]);
    if (mF[2] && mF[3]) f += parseFloat(mF[2]) / parseFloat(mF[3]);
    return Math.round(f * 201.168);
  }

  const mMY = s.match(/(\d+)\s*(?:mile|miles?|m)\s+(\d+)\s*(?:yards?|y)\b/i);
  if (mMY) {
    return Math.round(parseFloat(mMY[1]) * 1609.34 + parseFloat(mMY[2]) * 0.9144);
  }

  const mM = s.match(/(\d+)(?:\s+(\d+)\/(\d+))?\s*(?:miles?|m)\b/i);
  if (mM) {
    let m = parseFloat(mM[1]);
    if (mM[2] && mM[3]) m += parseFloat(mM[2]) / parseFloat(mM[3]);
    return Math.round(m * 1609.34);
  }

  const mY = s.match(/(\d+)\s*(?:yards?|yds?|y)\b/i);
  if (mY) return Math.round(parseFloat(mY[1]) * 0.9144);

  const n = parseFloat(s);
  if (!Number.isNaN(n)) {
    if (n >= 200) return Math.round(n);
    if (n > 0 && n <= 16) return Math.round(n * 201.168);
  }
  return 1200;
}

export function normalizarPeso(p: unknown): number | undefined {
  if (p == null) return undefined;
  const num = typeof p === "number" ? p : parseFloat(String(p).replace(",", ".").replace(/[^\d.]/g, ""));
  if (Number.isNaN(num) || num <= 0) return undefined;
  if (num >= 80) return Math.round(num * 0.45359237 * 10) / 10;
  return Math.round(num * 10) / 10;
}

// ----------------------------------------------------------------------------
// Filtro Anti-Venezuela Estricto
// ----------------------------------------------------------------------------
export function esHipodromoVenezolano(nombre: string): boolean {
  const n = String(nombre ?? "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "");
  return (
    n === "LARINCONADA" ||
    n === "VALENCIA" ||
    n === "SANTARITA" ||
    n.includes("RINCONADA") ||
    n.includes("VALENCIA") ||
    n.includes("SANTARITA")
  );
}

export type EjemplarNormalizadoUsa = {
  numero: string;
  nombre: string;
  pp?: number;
  ml?: string;
  jockey?: string;
  entrenador?: string;
  peso?: number | string;
  medicamento?: string;
  implementos?: string;
  retirado?: boolean;
};

export type CarreraNormalizadaUsa = {
  hipodromo: string;
  carrera: number;
  fecha: string;
  hora?: string | null;
  distancia?: number;
  superficie?: string;
  premio?: number;
  caballos: EjemplarNormalizadoUsa[];
  retirados: string[];
};

// ----------------------------------------------------------------------------
// Conversión de postTime a Hora de Venezuela (America/Caracas, UTC-4)
// ----------------------------------------------------------------------------
export function convertirHoraACaracas(rawTime: unknown): string | null {
  if (!rawTime) return null;
  const s = String(rawTime).trim();
  // Formato ya HH:MM (24h)
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

  // Patrones tipo "1:15 PM" o "1:15pm EDT"
  const m = s.match(/(\d{1,2}):(\d{2})\s*(am|pm)?(?:\s*([a-z]{3}))?/i);
  if (m) {
    let horas = parseInt(m[1], 10);
    const minutos = m[2];
    const ampm = m[3]?.toLowerCase();
    const tz = m[4]?.toUpperCase();

    if (ampm === "pm" && horas < 12) horas += 12;
    if (ampm === "am" && horas === 12) horas = 0;

    // Si viene de hora del Pacífico PT (Santa Anita/Del Mar, UTC-7/UTC-8): sumar 3h para Caracas (UTC-4)
    if (tz === "PT" || tz === "PDT" || tz === "PST") {
      horas = (horas + 3) % 24;
    } else if (tz === "CT" || tz === "CDT" || tz === "CST") {
      horas = (horas + 1) % 24;
    }
    // Si viene de EDT / EST (Hora del Este): coincide o difiere en 0h/1h con Caracas (UTC-4)
    return `${String(horas).padStart(2, "0")}:${minutos}`;
  }

  return null;
}

// ----------------------------------------------------------------------------
// Capa 1 y 2: Parser Heurístico y de Cruce TVG + DRF
// ----------------------------------------------------------------------------
export function parsearEntradasTextoUsa(
  texto: string,
  hipodromoDefault: string,
  fechaDefault: string
): CarreraNormalizadaUsa[] {
  const lineas = texto.split("\n").map((l) => l.trim()).filter(Boolean);
  const carrerasMap = new Map<number, CarreraNormalizadaUsa>();
  let carreraActual = 1;

  for (let i = 0; i < lineas.length; i++) {
    const lin = lineas[i];

    // Detección de encabezado de carrera: "Race 1", "Carrera 2", "1st Race", "RACE 3 - 6F Dirt"
    const mRace = lin.match(/\b(?:Race|Carrera)\s*#?\s*(\d+)\b/i) || lin.match(/^(\d+)(?:st|nd|rd|th)\s+Race/i);
    if (mRace) {
      carreraActual = parseInt(mRace[1], 10);
      if (!carrerasMap.has(carreraActual)) {
        carrerasMap.set(carreraActual, {
          hipodromo: hipodromoDefault,
          carrera: carreraActual,
          fecha: fechaDefault,
          superficie: lin.toLowerCase().includes("turf") ? "GRAMA" : "ARENA",
          caballos: [],
          retirados: [],
        });
      }
      continue;
    }

    // Detección de hora y distancia en línea descriptiva
    if (carrerasMap.has(carreraActual)) {
      const c = carrerasMap.get(carreraActual)!;
      if (!c.hora) {
        const h = convertirHoraACaracas(lin);
        if (h) c.hora = h;
      }
      if (!c.distancia) {
        const mDist = lin.match(/(\d+(?:\.\d+)?)\s*(?:Furlongs?|F|Meters?|M|Miles?)/i);
        if (mDist) {
          const val = parseFloat(mDist[1]);
          if (lin.toLowerCase().includes("f")) c.distancia = Math.round(val * 201.168);
          else if (lin.toLowerCase().includes("mile")) c.distancia = Math.round(val * 1609.34);
          else c.distancia = Math.round(val);
        }
      }
    }

    // Detección de ejemplar con Morning Line y Jockey/Trainer:
    // Ej: "1  (1)  KNIGHT RUNNER (KY)  5/2  J. Rosario  T. Pletcher"
    // Ej: "1A (2)  TAPIT TRICE  SCR" o "4 BIG INVASION - SCRATCHED"
    const esScratched = /\b(SCRATCHED|SCR|RETIRADO)\b/i.test(lin);

    // Patrón 1: Número de programa al inicio ("1", "1A", "2", "2B", "#3")
    const mCaballo = lin.match(/^(?:#?\s*)(\d{1,2}[A-Z]?)\b(?:\s*\((\d{1,2})\))?\s+([A-Z0-9\s'.-]{2,30}?)(?:\s+(?:ML\s*)?(\d{1,2}\/\d{1,2}|\d+\.?\d*))?(?:\s+([A-Z]\.?\s+[A-Za-z]+))?(?:\s+(?:SCRATCHED|SCR))?$/i) ||
      lin.match(/^(?:#?\s*)(\d{1,2}[A-Z]?)\s+([A-Z0-9\s'.-]{2,30}?)(?:\s+PP:\s*(\d{1,2}))?(?:\s+ML:\s*([0-9/]+))?/i);

    if (mCaballo) {
      const numProg = mCaballo[1].toUpperCase().trim();
      const pp = mCaballo[2] && /^\d+$/.test(mCaballo[2]) ? parseInt(mCaballo[2], 10) : undefined;
      const nombre = mCaballo[3] ? mCaballo[3].replace(/\([A-Z]{2,3}\)/g, "").trim().toUpperCase() : "";
      const ml = mCaballo[4]?.trim();

      if (nombre && nombre.length >= 2 && !nombre.startsWith("RACE") && !nombre.startsWith("EXACTA")) {
        if (!carrerasMap.has(carreraActual)) {
          carrerasMap.set(carreraActual, {
            hipodromo: hipodromoDefault,
            carrera: carreraActual,
            fecha: fechaDefault,
            caballos: [],
            retirados: [],
          });
        }
        const c = carrerasMap.get(carreraActual)!;
        const yaExiste = c.caballos.some((e) => e.numero === numProg);
        if (!yaExiste) {
          c.caballos.push({
            numero: numProg,
            nombre,
            pp,
            ml,
            retirado: esScratched,
          });
          if (esScratched) {
            c.retirados.push(numProg);
          }
        }
      }
    }
  }

  return Array.from(carrerasMap.values()).sort((a, b) => a.carrera - b.carrera);
}

// ----------------------------------------------------------------------------
// Capa 3: Respaldo con IA (Gemini REST API)
// ----------------------------------------------------------------------------
async function extraerConGemini(
  contenido: string,
  hipodromo: string,
  fecha: string
): Promise<CarreraNormalizadaUsa[]> {
  if (!GEMINI_API_KEY) return [];

  const prompt = `Actúa como un extractor especializado de cartelera de carreras de caballos de EE.UU. (TVG / DRF).
Analiza el siguiente texto o HTML para el hipódromo "${hipodromo}" en la fecha "${fecha}".
Extrae todas las carreras, ejemplares, número de programa (admite llaves 1, 1A, 2, 2B), post position PP, jockey, trainer, morning line (ML), hora programada de salida y retirados (scratches).
IMPORTANTE: Devuelve ÚNICAMENTE un JSON válido con la siguiente estructura (sin markdown adicional, sin explicaciones):
[
  {
    "carrera": 1,
    "hora": "13:10",
    "distancia": 1200,
    "superficie": "ARENA",
    "premio": 50000,
    "caballos": [
      {
        "numero": "1",
        "nombre": "HORSE NAME",
        "pp": 1,
        "ml": "5/2",
        "jockey": "J. Ortiz",
        "entrenador": "C. Brown",
        "peso": 120,
        "medicamento": "L",
        "retirado": false
      }
    ],
    "retirados": ["4"]
  }
]

CONTENIDO:
${contenido.slice(0, 30000)}`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, responseMimeType: "application/json" },
      }),
    });

    if (!resp.ok) return [];
    const data = await resp.json();
    const textOut = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!textOut) return [];

    const parsed = JSON.parse(textOut);
    if (!Array.isArray(parsed)) return [];

    return parsed.map((c: any) => ({
      hipodromo,
      carrera: Number(c.carrera) || 1,
      fecha,
      hora: c.hora || null,
      distancia: Number(c.distancia) || 1200,
      superficie: c.superficie || "ARENA",
      premio: Number(c.premio) || 0,
      caballos: Array.isArray(c.caballos)
        ? c.caballos.map((e: any) => ({
            numero: String(e.numero || "").trim().toUpperCase(),
            nombre: String(e.nombre || "").trim().toUpperCase(),
            pp: Number(e.pp) || undefined,
            ml: e.ml ? String(e.ml) : undefined,
            jockey: e.jockey ? String(e.jockey) : undefined,
            entrenador: e.entrenador ? String(e.entrenador) : undefined,
            peso: e.peso ? Number(e.peso) : undefined,
            medicamento: e.medicamento ? String(e.medicamento) : undefined,
            retirado: Boolean(e.retirado),
          }))
        : [],
      retirados: Array.isArray(c.retirados) ? c.retirados.map(String) : [],
    }));
  } catch {
    return [];
  }
}

// ----------------------------------------------------------------------------
// Handler Principal de la Edge Function
// ----------------------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "authorization, content-type, apikey, x-client-info",
      },
    });
  }

  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const url = new URL(req.url);
    const accion = String(body.accion || url.searchParams.get("accion") || "");
    const fecha = String(body.fecha || url.searchParams.get("fecha") || new Date().toISOString().slice(0, 10));
    const fechaDrf = String(body.fechaDrf || formatearFechaDrf(fecha));
    const urlDirectaDrf = String(body.urlDirectaDrf || "").trim();

    // ACCIÓN ESPECIAL: Detectar hipódromos activos del día en DRF
    if (accion === "detectar_tracks") {
      const tracksActivos: string[] = [];
      try {
        const respTracks = await fetch(`https://entries.drf.com/data/tracks/${fecha}`, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Accept": "application/json, text/plain, */*",
          },
        });
        if (respTracks.ok) {
          const dt = await respTracks.json();
          const list = dt?.tracks || dt?.activeTracks || dt?.trackList || [];
          for (const item of list) {
            const raw = typeof item === "string" ? item : (item.trackCode || item.id || item.code);
            const code = normalizarCodigo(raw);
            if (code && !tracksActivos.includes(code)) tracksActivos.push(code);
          }
        }
      } catch {
        /* fallback */
      }

      if (tracksActivos.length === 0) {
        // Fallback según día de la semana
        const diaSem = new Date(`${fecha}T12:00:00Z`).getUTCDay();
        const defTracks: Record<number, string[]> = {
          0: ["CD", "GP", "AQU", "SA", "DMR", "OP", "KEE", "TAM", "WO", "RP"],
          1: ["FL", "PRX", "MVR", "MNR", "IND"],
          2: ["PRX", "MVR", "MNR", "FL", "IND"],
          3: ["CT", "TAM", "GP", "MNR", "DED"],
          4: ["GP", "AQU", "CT", "DED", "TP", "PEN"],
          5: ["GP", "AQU", "SA", "DMR", "CT", "DED", "TP", "PEN", "RP", "WO"],
          6: ["CD", "GP", "AQU", "SA", "DMR", "OP", "KEE", "TAM", "CT", "DED", "TP", "PEN", "RP", "WO"],
        };
        tracksActivos.push(...(defTracks[diaSem] || ["GP", "SA", "TAM", "AQU", "CD"]));
      }

      return json({
        ok: true,
        fecha,
        fechaDrf,
        tracks: tracksActivos,
      });
    }

    let tracksFiltro = Array.isArray(body.tracks)
      ? body.tracks
      : url.searchParams.get("tracks")
      ? url.searchParams.get("tracks")!.split(",")
      : ["GP", "SA", "TAM", "AQU", "CD"];

    // Si viene URL directa de DRF (ej. https://www.drf.com/race-entries/track/CD/country/USA/date/11-04-2026)
    if (urlDirectaDrf) {
      const mUrl = urlDirectaDrf.match(/track\/([A-Za-z0-9]+)(?:\/country\/([A-Za-z]+))?\/date\/([0-9-]+)/i);
      if (mUrl) {
        tracksFiltro = [mUrl[1].toUpperCase()];
      }
    }

    const htmlOTextoPegado = typeof body.htmlOTextoPegado === "string" ? body.htmlOTextoPegado.trim() : "";
    const hipodromoEspecifico = String(body.hipodromo || "Gulfstream Park").trim();

    // 1. REGLA FUNDAMENTAL: Aislamiento Jurisdiccional USA (Prohibido Venezuela)
    if (esHipodromoVenezolano(hipodromoEspecifico)) {
      return json(
        {
          ok: false,
          error: `JURISDICCIÓN EXCLUSIVA USA: '${hipodromoEspecifico}' es un hipódromo venezolano y queda 100% excluido del sincronizador de carreras americanas.`,
        },
        403
      );
    }

    const carrerasTotales: CarreraNormalizadaUsa[] = [];
    const tracksProcesados: string[] = [];

    // CASO A: El operador envió HTML o texto pegado directo (Capa 3 / Respaldo Anti-Cloudflare)
    if (htmlOTextoPegado && !htmlOTextoPegado.startsWith("http")) {
      let carreras = parsearEntradasTextoUsa(htmlOTextoPegado, hipodromoEspecifico, fecha);
      if (carreras.length === 0 && GEMINI_API_KEY) {
        carreras = await extraerConGemini(htmlOTextoPegado, hipodromoEspecifico, fecha);
      }
      return json({
        ok: true,
        fuente: "TEXTO_PEGADO_PARSER",
        fecha,
        hipodromos: [hipodromoEspecifico],
        carreras,
        resumen: `${hipodromoEspecifico} (${carreras.length} carreras, ${carreras.reduce((a, c) => a + c.caballos.length, 0)} ejemplares, ${carreras.reduce((a, c) => a + c.retirados.length, 0)} retirados)`,
      });
    }

    // CASO B: Extracción Multi-Fuente por Red (DRF Oficial / TVG)
    for (const trackCode of tracksFiltro) {
      const codeClean = normalizarCodigo(trackCode);
      const meta = TRACKS_USA_CATALOGO[codeClean];
      const nombreHipo = meta ? meta.nombre : codeClean;
      const country = meta?.pais || "USA";

      // Guardia Anti-Venezuela
      if (esHipodromoVenezolano(nombreHipo)) continue;

      let carrerasTrack: CarreraNormalizadaUsa[] = [];

      // 1. Endpoint JSON Oficial Interno de DRF: /entries/entryDetails/id/...
      try {
        const urlDrfOficial = `https://www.drf.com/entries/entryDetails/id/${codeClean}/country/${country}/date/${fechaDrf}`;
        const respDrfOficial = await fetch(urlDrfOficial, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Accept": "application/json, text/plain, */*",
            "Referer": `https://www.drf.com/race-entries/track/${codeClean}/country/${country}/date/${fechaDrf}`,
            "Accept-Language": "en-US,en;q=0.9",
          },
        });

        if (respDrfOficial.ok) {
          const jsonOficial = await respDrfOficial.json();
          const races = jsonOficial?.entryDetails?.races || jsonOficial?.races || jsonOficial?.data?.races || [];
          if (Array.isArray(races) && races.length > 0) {
            for (const r of races) {
              const numCarrera = Number(r.raceNumber || r.race_number || r.carrera) || 1;
              const runners = r.runners || r.horses || r.entries || [];
              const caballos: EjemplarNormalizadoUsa[] = [];
              const retirados: string[] = [];

              for (const h of runners) {
                const num = String(h.programNumber || h.program_number || h.postPosition || h.cloth || "").trim().toUpperCase();
                const nombre = String(h.horseName || h.horse_name || h.name || "").trim().toUpperCase();
                const isScr = Boolean(h.scratched || h.isScratched || String(h.status || "").toUpperCase() === "SCR" || h.scratchIndicator);

                if (num && nombre) {
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

                  caballos.push({
                    numero: num,
                    nombre,
                    pp: Number(h.postPosition) || (parseInt(num, 10) || undefined),
                    ml: h.morningLineOdds || h.ml_odds || undefined,
                    jockey: jockey || undefined,
                    entrenador: entrenador || undefined,
                    peso: normalizarPeso(h.weight || h.assignedWeight),
                    medicamento: h.medication || undefined,
                    retirado: isScr,
                  });
                  if (isScr) retirados.push(num);
                }
              }

              if (caballos.length > 0) {
                const distDesc = r.distance || r.distanceDescription || r.distanceMeters;
                const surfStr = String(r.surface || r.trackSurface || "").toUpperCase();
                let superficie = "ARENA";
                if (surfStr.includes("TURF") || surfStr.includes("GRAMA")) superficie = "GRAMA";
                else if (surfStr.includes("SYNTHETIC") || surfStr.includes("TAPETA") || surfStr.includes("ALL WEATHER")) superficie = "SINTETICA";

                carrerasTrack.push({
                  hipodromo: nombreHipo,
                  carrera: numCarrera,
                  fecha,
                  hora: convertirHoraACaracas(r.postTime || r.post_time),
                  distancia: normalizarDistanciaM(distDesc),
                  superficie,
                  premio: Number(r.purse || r.purseTotal) || 0,
                  caballos,
                  retirados,
                });
              }
            }
          }
        }
      } catch {
        /* fallback siguiente endpoint */
      }

      // 2. Si falló el endpoint oficial, intentar endpoint secundario entries.drf.com
      if (carrerasTrack.length === 0) {
        try {
          const drfUrl = `https://entries.drf.com/data/racecards/${fecha}/${meta?.drfCode || codeClean}`;
          const respDrf = await fetch(drfUrl, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
              "Accept": "application/json, text/plain, */*",
            },
          });
          if (respDrf.ok) {
            const drfJson = await respDrf.json();
            const races = drfJson?.races || drfJson?.raceList || [];
            if (Array.isArray(races) && races.length > 0) {
              for (const r of races) {
                const numCarrera = Number(r.raceNumber || r.race_number || r.carrera) || 1;
                const runners = r.runners || r.horses || r.entries || [];
                const caballos: EjemplarNormalizadoUsa[] = [];
                const retirados: string[] = [];

                for (const h of runners) {
                  const num = String(h.programNumber || h.program_number || h.postPosition || "").trim().toUpperCase();
                  const nombre = String(h.horseName || h.horse_name || h.name || "").trim().toUpperCase();
                  const isScr = Boolean(h.isScratched || h.scratched || String(h.status).toUpperCase() === "SCR");

                  if (num && nombre) {
                    caballos.push({
                      numero: num,
                      nombre,
                      pp: Number(h.postPosition) || undefined,
                      ml: h.morningLineOdds || h.ml_odds || undefined,
                      jockey: h.jockeyName || h.jockey,
                      entrenador: h.trainerName || h.trainer,
                      peso: normalizarPeso(h.weight),
                      retirado: isScr,
                    });
                    if (isScr) retirados.push(num);
                  }
                }

                if (caballos.length > 0) {
                  carrerasTrack.push({
                    hipodromo: nombreHipo,
                    carrera: numCarrera,
                    fecha,
                    hora: convertirHoraACaracas(r.postTime || r.post_time),
                    distancia: normalizarDistanciaM(r.distanceMeters || r.distance),
                    superficie: String(r.surface || "").toUpperCase().includes("TURF") ? "GRAMA" : "ARENA",
                    premio: Number(r.purse) || 0,
                    caballos,
                    retirados,
                  });
                }
              }
            }
          }
        } catch {
          /* fallback */
        }
      }

      // 3. Si DRF no respondió o devolvió vacío, intentar TVG Racecards
      if (carrerasTrack.length === 0 && meta?.tvgSlug) {
        try {
          const tvgUrl = `https://www.tvg.com/racecards/${meta.tvgSlug}/${fecha}`;
          const respTvg = await fetch(tvgUrl, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
              "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            },
          });
          if (respTvg.ok) {
            const html = await respTvg.text();
            carrerasTrack = parsearEntradasTextoUsa(html, nombreHipo, fecha);
          }
        } catch {
          /* fallback */
        }
      }

      if (carrerasTrack.length > 0) {
        carrerasTotales.push(...carrerasTrack);
        tracksProcesados.push(nombreHipo);
      }
    }

    return json({
      ok: true,
      fecha,
      tracksProcesados,
      carreras: carrerasTotales,
      totalCarreras: carrerasTotales.length,
      totalEjemplares: carrerasTotales.reduce((a, c) => a + c.caballos.length, 0),
      totalRetirados: carrerasTotales.reduce((a, c) => a + c.retirados.length, 0),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ ok: false, error: msg }, 500);
  }
});
