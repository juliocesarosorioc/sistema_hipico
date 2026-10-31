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
// Diccionario Canónico de Tracks USA
// ----------------------------------------------------------------------------
export const TRACKS_USA_CATALOGO: Record<string, { nombre: string; drfCode: string; tvgSlug: string }> = {
  GP: { nombre: "Gulfstream Park", drfCode: "GP", tvgSlug: "gulfstream-park" },
  GULFSTREAM: { nombre: "Gulfstream Park", drfCode: "GP", tvgSlug: "gulfstream-park" },
  SA: { nombre: "Santa Anita", drfCode: "SA", tvgSlug: "santa-anita-park" },
  SANTAANITA: { nombre: "Santa Anita", drfCode: "SA", tvgSlug: "santa-anita-park" },
  TAM: { nombre: "Tampa Bay Downs", drfCode: "TAM", tvgSlug: "tampa-bay-downs" },
  TAMPABAY: { nombre: "Tampa Bay Downs", drfCode: "TAM", tvgSlug: "tampa-bay-downs" },
  AQU: { nombre: "Aqueduct", drfCode: "AQU", tvgSlug: "aqueduct" },
  BAQ: { nombre: "Aqueduct", drfCode: "BAQ", tvgSlug: "aqueduct" },
  BEL: { nombre: "Belmont Park", drfCode: "BEL", tvgSlug: "belmont-park" },
  SAR: { nombre: "Saratoga", drfCode: "SAR", tvgSlug: "saratoga" },
  KEE: { nombre: "Keeneland", drfCode: "KEE", tvgSlug: "keeneland" },
  CD: { nombre: "Churchill Downs", drfCode: "CD", tvgSlug: "churchill-downs" },
  OP: { nombre: "Oaklawn Park", drfCode: "OP", tvgSlug: "oaklawn-park" },
  PRX: { nombre: "Parx Racing", drfCode: "PRX", tvgSlug: "parx-racing" },
  DMR: { nombre: "Del Mar", drfCode: "DMR", tvgSlug: "del-mar" },
  MTH: { nombre: "Monmouth Park", drfCode: "MTH", tvgSlug: "monmouth-park" },
  LRL: { nombre: "Laurel Park", drfCode: "LRL", tvgSlug: "laurel-park" },
  DEL: { nombre: "Delaware Park", drfCode: "DEL", tvgSlug: "delaware-park" },
  CT: { nombre: "Charles Town", drfCode: "CT", tvgSlug: "charles-town" },
  CHARLESTOWN: { nombre: "Charles Town", drfCode: "CT", tvgSlug: "charles-town" },
  FG: { nombre: "Fair Grounds", drfCode: "FG", tvgSlug: "fair-grounds" },
  GG: { nombre: "Golden Gate Fields", drfCode: "GG", tvgSlug: "golden-gate-fields" },
  TP: { nombre: "Turfway Park", drfCode: "TP", tvgSlug: "turfway-park" },
  RP: { nombre: "Remington Park", drfCode: "RP", tvgSlug: "remington-park" },
  MNR: { nombre: "Mountaineer", drfCode: "MNR", tvgSlug: "mountaineer" },
  MVR: { nombre: "Mahoning Valley", drfCode: "MVR", tvgSlug: "mahoning-valley" },
  WO: { nombre: "Woodbine", drfCode: "WO", tvgSlug: "woodbine" },
  WOODBINE: { nombre: "Woodbine", drfCode: "WO", tvgSlug: "woodbine" },
  IND: { nombre: "Horseshoe Indianapolis", drfCode: "IND", tvgSlug: "horseshoe-indianapolis" },
  PEN: { nombre: "Penn National", drfCode: "PEN", tvgSlug: "penn-national" },
  LRC: { nombre: "Los Alamitos", drfCode: "LRC", tvgSlug: "los-alamitos" },
  DED: { nombre: "Delta Downs", drfCode: "DED", tvgSlug: "delta-downs" },
  HOU: { nombre: "Sam Houston", drfCode: "HOU", tvgSlug: "sam-houston-race-park" },
  LS: { nombre: "Lone Star Park", drfCode: "LS", tvgSlug: "lone-star-park" },
  CBY: { nombre: "Canterbury Park", drfCode: "CBY", tvgSlug: "canterbury-park" },
};

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
    const fecha = String(body.fecha || url.searchParams.get("fecha") || new Date().toISOString().slice(0, 10));
    const tracksFiltro = Array.isArray(body.tracks)
      ? body.tracks
      : url.searchParams.get("tracks")
      ? url.searchParams.get("tracks")!.split(",")
      : ["GP", "SA", "TAM", "AQU"];
    const htmlOTextoPegado = typeof body.htmlOTextoPegado === "string" ? body.htmlOTextoPegado.trim() : "";
    const hipodromoEspecifico = String(body.hipodromo || "Gulfstream Park").trim();

    // 1. REGLA FUNDAMENTAL: Aislamiento Jurisdiccional USA (Prohibido Venezuela)
    if (esHipodromoVenezolano(hipodromoEspecifico)) {
      return json(
        {
          ok: false,
          error: `JURISDICCIÓN EXCLUSIVA USA: '${hipodromoEspecifico}' es un hipódromo venezolano (como La Rinconada o Valencia) y queda 100% excluido del sincronizador de carreras americanas.`,
        },
        403
      );
    }

    const carrerasTotales: CarreraNormalizadaUsa[] = [];
    const tracksProcesados: string[] = [];

    // CASO A: El operador envió HTML o texto pegado directo (Capa 3 / Respaldo Anti-Cloudflare)
    if (htmlOTextoPegado) {
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

    // CASO B: Extracción Multi-Fuente por Red (DRF / TVG)
    for (const trackCode of tracksFiltro) {
      const codeClean = String(trackCode).trim().toUpperCase();
      const meta = TRACKS_USA_CATALOGO[codeClean];
      const nombreHipo = meta ? meta.nombre : codeClean;

      // Guardia Anti-Venezuela
      if (esHipodromoVenezolano(nombreHipo)) continue;

      let carrerasTrack: CarreraNormalizadaUsa[] = [];

      // 1. Intentar DRF Entries API pública
      try {
        const drfUrl = `https://entries.drf.com/data/racecards/${fecha}/${meta?.drfCode || codeClean}`;
        const respDrf = await fetch(drfUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
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
                    peso: h.weight,
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
                  distancia: Number(r.distanceMeters || r.distance) || 1200,
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
        /* fallback siguiente fuente */
      }

      // 2. Si DRF no respondió o devolvió vacío, intentar TVG Racecards
      if (carrerasTrack.length === 0 && meta?.tvgSlug) {
        try {
          const tvgUrl = `https://www.tvg.com/racecards/${meta.tvgSlug}/${fecha}`;
          const respTvg = await fetch(tvgUrl, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
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
