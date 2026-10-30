// ============================================================
//  Motor de extracción de carreras con Gemini (Gemini REST API).
//  RÉPLICA EXACTA del motor legacy `js/gaceta_ia.js` (+ helpers):
//  envío por LOTES, reintentos por saturación/cuota, cambio de
//  modelo, partición de lotes pesados y fusión de resultados.
//  Todo ocurre en el navegador: NO hay servidor Next.js de por
//  medio (el build es `output:"export"`, 100% estático; no hay
//  API Routes ni Server Actions que reciban el PDF).
// ============================================================

import {
  carrerasFaltantes,
  fusionarCarrerasSinPerder,
  numeroDeCarrera,
  repararNumerosCarreras,
  type ReporteReparacion,
} from "@/features/gaceta/lib/numeros";
import { armarBloques, consolidarPorNumero, segmentarPorCarreras } from "@/features/gaceta/lib/segmentar";

export type EjemplarExtraido = {
  numero: string | number;
  nombre: string;
  nacionalidad?: string;
  pp?: number | string;
  valor?: number;
  jockey?: string;
  entrenador?: string;
  peso?: number | string;
  medicamento?: string;
  implementos?: string;
};

export type CarreraExtraida = {
  carrera: number | string;
  hipodromo?: string;
  fecha?: string | null;
  distancia?: number;
  superficie?: string;
  premio?: number;
  ejemplares: EjemplarExtraido[];
};

export type ResultadoGaceta = {
  ok: boolean;
  carreras: CarreraExtraida[];
  error?: string;
  diag?: string;
  cuotaTotal?: boolean;
  /** Aviso de la reparación de numeración (números corregidos / faltantes). */
  avisoNumeracion?: string;
};

export const CLAVE_GEMINI_KEY = "club_gemini_key";

// Modelos Flash de respaldo estables (con cuota oficial y alta disponibilidad).
export const MODELOS_GEMINI = [
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
  "gemini-1.5-flash",
  "gemini-1.5-flash-8b",
];

// Modelos experimentales, inestables o que devuelven 503/429/404 al invocar generateContent
const FLASH_EXCLUIDOS = /image|preview|tuned|babbage|-tts|embedding|gemini-3\./i;

const NACIONALIDADES = ["VE", "USA", "BR", "AR", "CL", "MX", "PA", "PE", "CO", "EC", "UY", "OTRA"];

// Hipódromos de EE.UU. sembrados en la BD: si la carrera es de uno de ellos,
// sus ejemplares quedan con nacionalidad USA por defecto; los de Venezuela (o
// no reconocidos, el programa es venezolano) quedan VE. Igual que el legacy.
const HIPODROMOS_USA = [
  "AQUEDUCT", "BELMONT PARK", "CHARLES TOWN", "CHURCHILL DOWNS", "DEL MAR",
  "FAIR GROUNDS", "FINGER LAKES", "GOLDEN GATE FIELDS", "GULFSTREAM PARK",
  "KEENELAND", "LAUREL PARK", "LOS ALAMITOS", "MONMOUTH PARK", "OAKLAWN PARK",
  "PIMLICO", "SANTA ANITA", "SARATOGA", "TAMPA BAY DOWNS",
];

const SYS = `Eres el transcriptor de la gaceta hípica venezolana. Recibes páginas/imágenes del programa oficial de carreras.
Extrae TODAS las carreras visibles y sus ejemplares participantes.
La gaceta numera las carreras de forma CONSECUTIVA del 1 al total (1, 2, 3, …, 12 o 13): devuelve TODAS sin omitir ninguna y SIN repetir ni saltar números. Si el programa trae 12 o 13 carreras, la respuesta tiene 12 o 13 objetos (la última incluida).
Para cada carrera devuelve:
  - carrera: número de la carrera (entero general correlativo)
  - hipodromo: nombre del hipódromo (MAYÚSCULAS; ej: LA RINCONADA, SANTA RITA, VALENCIA). Si no se lee usa "".
  - fecha: fecha de la jornada en formato YYYY-MM-DD si aparece, si no null
  - distancia: distancia de la carrera en metros (entero) si se lee, si no 0
  - superficie: una de ARENA, CESPED, FANGO, TAPETA u otra si se lee explícita; si no ARENA
  - premio: número si se lee (ej: 15000), si no 0
  - ejemplares: lista con:
    - numero (número oficial / de gualdrapa del ejemplar)
    - pp (PUESTO DE PARTIDA: En Venezuela el puesto de pista PP es el número de partidor vertical en la columna PP, ej: en 1400m o 1500m el caballo con gualdrapa 1 puede partir por el PP 6. Extrae exactamente el entero del 1 al 14 del puesto de partida si aparece; si no, null o el mismo número de gualdrapa)
    - nombre (MAYÚSCULAS, EXACTO como aparece)
    - nacionalidad (país si se indica: VE, USA, BR, AR, CL, MX, PA, PE, CO, EC, UY; si NO se indica: USA si el hipódromo es de Estados Unidos, si no VE)
    - valor (monta del ejemplar: SOLO número si aparece, si no 0)
    - jockey, entrenador, peso, medicamento e implementos solo si son legibles (si no, null)
REGLAS: NO inventes nombres ni datos; transcribe exactamente lo que lees. REGISTRA TODOS los ejemplares de cada carrera sin omitir ninguno (todos los números de participante que aparezcan). Si un ejemplar aparece repetido entre páginas, mantenlo tal cual. Si el documento no tiene carreras, devuelve {"carreras":[]}.
PARA EL CAMPO carrera: lee el número de carrera EXACTAMENTE como aparece impreso (puede ser numérico: 1, 2, ..., 14 o romano: I, II, ..., XIV). Convierte los romanos a entero (XIII → 13) y los ordinales escritos a entero ("primera" → 1, "séptima" → 7, "decimotercera" → 13).
ATENCIÓN ESPECIAL HIPÓDROMOS DE VENEZUELA (LA RINCONADA / VALENCIA):
En los programas de carreras de Venezuela, las carreras del bloque de apuestas "5 y 6" se titulan como "1ª VÁLIDA", "2ª VÁLIDA", "3ª VÁLIDA", "4ª VÁLIDA", "5ª VÁLIDA" y "6ª VÁLIDA".
1. En La Rinconada, la "1ª VÁLIDA" corresponde habitualmente a la SÉPTIMA CARRERA (Carrera 7) del programa general (las carreras 1 a 6 son ordinarias no válidas, y la 1ª Válida es la 7ª carrera; o carrera 5 si hay 4 no válidas).
2. NUNCA devuelvas carrera: 1 para la 1ª Válida si ya hubo carreras previas en la reunión.
3. El campo "carrera" debe ser SIEMPRE el número correlativo general del programa oficial (ej: Carrera 1, 2, 3, 4, 5, 6, 7 [1ª Válida], 8 [2ª Válida], 9 [3ª Válida], 10 [4ª Válida], 11 [5ª Válida], 12 [6ª Válida]).
4. Si la cabecera dice "1ª VÁLIDA" o "1ª VÁLIDA (7ª CARRERA)" o "SÉPTIMA CARRERA - 1ª VÁLIDA", el número de carrera es 7 (o el correlativo correspondiente).
5. Extrae la 7ª carrera con TODOS sus ejemplares participantes exactamente igual que las demás carreras; NUNCA la omitas ni la unas con la 1ª carrera.`;

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

function pesoKB(durls: string[]): number {
  return Math.round(durls.reduce((a, d) => a + ((d.split(",")[1] || "").length * 3) / 4, 0) / 1024);
}

// ---------- Helpers puros (iguales a js/gaceta_helpers.js) ----------

function paisHipodromo(hipo?: string): string | null {
  const h = String(hipo || "").trim().toUpperCase();
  if (!h) return null;
  if (HIPODROMOS_USA.some((n) => h.includes(n))) return "USA";
  return "VE";
}

/** Nacionalidad por defecto de un ejemplar: la que trajo la IA si es válida,
 *  si no la del país del hipódromo de la carrera (USA/VE). */
function nacEjemplar(ej?: { nacionalidad?: string } | null, hipo?: string): string {
  const nac = String(ej?.nacionalidad || "").trim().toUpperCase();
  if (NACIONALIDADES.includes(nac)) return nac;
  return paisHipodromo(hipo) || "VE";
}

function coaccionarCarreras(v: unknown): CarreraExtraida[] {
  if (Array.isArray(v)) return v as CarreraExtraida[];
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.carrera)) return o.carrera as CarreraExtraida[];
    const vals = Object.values(o);
    if (vals.length && typeof vals[0] === "object") return vals as CarreraExtraida[];
  }
  return [];
}

/**
 * Intenta recuperar objetos de carrera completos de un JSON truncado al final
 * (cuando el LLM cortó la salida por límite de tokens).
 */
function recuperarJsonTruncado(t: string): unknown | null {
  const idxCarreras = t.indexOf('"carreras"');
  const base = idxCarreras >= 0 ? t.slice(idxCarreras) : t;
  const iniArr = base.indexOf("[");
  if (iniArr < 0) return null;
  const cuerpo = base.slice(iniArr + 1);

  // Buscar cierres posibles de objetos de carrera `}]}` o `]}` de derecha a izquierda
  for (let pos = cuerpo.length - 1; pos > 10; pos--) {
    if (cuerpo[pos] === "}") {
      const candidato = `{"carreras":[${cuerpo.slice(0, pos + 1)}]}`;
      try {
        return JSON.parse(candidato);
      } catch {
        // Seguir buscando el cierre anterior
      }
    }
  }
  return null;
}

/** Parser tolerante de la respuesta de Gemini (markdown, JSON suelto, arrays y JSON truncado). */
function parsearJSON(texto: string): CarreraExtraida[] {
  let t = (texto || "").trim();
  const cercos = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (cercos) t = cercos[1].trim();
  const intentos: unknown[] = [];
  try {
    intentos.push(JSON.parse(t));
  } catch {
    /* sigue */
  }
  const ini = t.indexOf("{");
  const fin = t.lastIndexOf("}");
  if (ini >= 0 && fin > ini) {
    try {
      intentos.push(JSON.parse(t.slice(ini, fin + 1)));
    } catch {
      /* sigue */
    }
  }
  const iniArr = t.indexOf("[");
  const finArr = t.lastIndexOf("]");
  if (iniArr >= 0 && finArr > iniArr) {
    try {
      intentos.push(JSON.parse(t.slice(iniArr, finArr + 1)));
    } catch {
      /* sigue */
    }
  }
  if (intentos.length === 0) {
    const recuperado = recuperarJsonTruncado(t);
    if (recuperado) intentos.push(recuperado);
  }
  for (const obj of intentos) {
    if (Array.isArray(obj)) return obj as CarreraExtraida[];
    if (obj && typeof obj === "object") {
      const o = obj as Record<string, unknown>;
      const c = coaccionarCarreras(o.carreras);
      if (c.length) return c;
      const c2 = coaccionarCarreras(o.carrera);
      if (c2.length) return c2;
    }
  }
  return [];
}

/** Normaliza una carrera extraída (nacionalidad/nombre/valor + número entero)
 *  antes de fusionarla. */
function normalizarExtraida(c: CarreraExtraida): void {
  c.ejemplares = Array.isArray(c.ejemplares) ? c.ejemplares : [];
  c.ejemplares.forEach((ej) => {
    ej.nacionalidad = nacEjemplar(ej, c.hipodromo);
    ej.nombre = String(ej.nombre || "").trim().toUpperCase();
    ej.valor = 0;
  });
  const n = numeroDeCarrera(c.carrera);
  if (n != null) c.carrera = n;
}

/** Fusiona carreras extraídas SIN perder carreras distintas (ver numeros.ts):
 *  une por hipódromo+número solo cuando es LA MISMA carrera; si el número
 *  coincide pero los ejemplares son disjuntos, conserva ambas (una está mal
 *  numerada) y la reparación final corrige el número. Antes esta fusión
 *  colapsaba las dos y la Gaceta perdía una carrera en silencio. */
function fusionarCarreras(carreras: CarreraExtraida[], nuevas: CarreraExtraida[]): void {
  const limpias: CarreraExtraida[] = [];
  for (const c of Array.isArray(nuevas) ? nuevas : []) {
    if (!c || typeof c !== "object") continue;
    normalizarExtraida(c);
    limpias.push(c);
  }
  fusionarCarrerasSinPerder(carreras, limpias);
}

// ---------- Modelos ----------

async function listaModelosFlash(clave: string): Promise<string[]> {
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(clave)}`);
    if (!r.ok) return [];
    const datos = (await r.json()) as { models?: Array<{ name: string; supportedGenerationMethods?: string[] }> };
    const flash = (datos.models || [])
      .map((m) => ({ name: m.name.replace("models/", ""), metodos: m.supportedGenerationMethods ?? null }))
      // Solo modelos que sirven para transcribir la gaceta: Flash de chat y visión estables.
      // Se descartan gemini-3.* (generan 503/429 continuos), modelos TTS (dan HTTP 400),
      // y audio/imagen/preview/tuned/embedding.
      .filter(
        (m) =>
          /flash/i.test(m.name) &&
          !FLASH_EXCLUIDOS.test(m.name) &&
          (m.metodos == null || m.metodos.length === 0 || m.metodos.includes("generateContent"))
      )
      .map((m) => m.name);
    if (!flash.length) return [];
    const ver = (n: string) => {
      const m = n.match(/gemini-([\d.]+)/);
      return m ? parseFloat(m[1]) : 0;
    };
    const lite = (n: string) => /-lite/i.test(n);
    flash.sort((a, b) => ver(b) - ver(a) || (lite(a) ? 1 : 0) - (lite(b) ? 1 : 0));
    return flash;
  } catch {
    return [];
  }
}

/** Cada familia de Flash tiene SU PROPIA cuota gratuita diaria. Se ordenan
 *  por estabilidad (2.5 -> 2.0 -> 1.5). Se excluyen modelos experimentales
 *  gemini-3.x con errores 503/429 y los no aptos (imagen/tts). */
function elegirModelos(descubiertos: string[]): string[] {
  const unicos = [...new Set(descubiertos.concat(MODELOS_GEMINI))].filter(
    (m) => !FLASH_EXCLUIDOS.test(m)
  );
  const porFamilia: Record<string, string[]> = {};
  for (const m of unicos) {
    const v = (m.match(/gemini[_-]?(\d+)/i) || [])[1] || "0";
    const fam = v.slice(0, 1);
    (porFamilia[fam] = porFamilia[fam] || []).push(m);
  }
  // Familia 2 es la más rápida y con visión multimodal completa; luego familia 1
  const orden = ["2", "1"];
  const out: string[] = [];
  for (const fam of orden) {
    const ms = (porFamilia[fam] || []).sort((a, b) => {
      const va = parseFloat((a.match(/gemini[_-]?([\d.]+)/i) || [])[1] || "0");
      const vb = parseFloat((b.match(/gemini[_-]?([\d.]+)/i) || [])[1] || "0");
      return vb - va;
    });
    out.push(...ms);
  }
  for (const fam of Object.keys(porFamilia).sort()) if (!orden.includes(fam)) out.push(...porFamilia[fam]);
  return out.slice(0, 10);
}

// ---------- Cuerpo de la petición (idéntico al legacy) ----------

/**
 * Contenido de UNA llamada al modelo: páginas como imágenes o un bloque de
 * TEXTO de gaceta.
 *
 * El camino de texto existe porque el de imágenes se trunca: un documento
 * largo no cabe en la respuesta del modelo y las últimas carreras se pierden
 * en silencio (Belmont 1-3 OK, Charles Town 4-6 OK, Keeneland 4-6 perdido).
 * Al mandar 2 o 3 carreras por bloque de texto, cada llamada cierra su JSON
 * y todas las carreras llegan.
 */
export type ContenidoLote = {
  /** Páginas (dataURLs) a enviar como imágenes. */
  durls: string[];
  /** Texto de la gaceta a transcribir (alternativa a las imágenes). */
  texto?: string;
};

function armarBody(contenido: ContenidoLote, estricto: boolean): Record<string, unknown> {
  const partes: Array<Record<string, unknown>> = [];
  const durls = contenido.durls || [];
  if (contenido.texto && contenido.texto.trim()) {
    const instruccion = estricto
      ? 'Gaceta textual adjunta. Extrae las carreras que aparecen y responde ÚNICAMENTE con JSON válido con el formato {"carreras":[...]}, sin markdown, sin decoraciones ni explicaciones.'
      : "Gaceta textual adjunta. Extrae las carreras y sus ejemplares.";
    partes.push({ text: `${instruccion}\n\n${contenido.texto}` });
  } else {
    const imgs = durls.map((d) => {
      const [, meta] = d.split(",");
      const mime = d.split(";")[0].replace("data:", "");
      return { inline_data: { mime_type: mime, data: meta } };
    });
    const parteTexto = estricto
      ? 'Gaceta adjunta. Extrae las carreras y responde ÚNICAMENTE con JSON válido con el formato {"carreras":[...]}, sin markdown, sin decoraciones ni explicaciones.'
      : "Gaceta adjunta. Extrae las carreras y sus ejemplares.";
    partes.push({ text: parteTexto }, ...imgs);
  }
  return {
    contents: [{ parts: partes }],
    systemInstruction: { parts: [{ text: SYS }] },
    generationConfig: {
      temperature: estricto ? 0.2 : 0,
      maxOutputTokens: 8192,
      responseMimeType: "application/json",
    },
  };
}

async function postIA(url: string, body: Record<string, unknown>, clave: string, ms = 45000): Promise<Response> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": clave },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
  } finally {
    clearTimeout(t);
  }
}

type LlamadaIA =
  | { ok: true; texto: string }
  | { ok: false; tipo: "salto" | "clave" | "cuotaDia" | "cuotaRpm" | "salto503" | "grande" | "duro"; msg: string };

type RespuestaGemini = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
  promptFeedback?: { blockReason?: string };
};

async function llamarModelo(
  clave: string,
  model: string,
  contenido: ContenidoLote,
  estricto: boolean
): Promise<LlamadaIA> {
  let resp: Response;
  try {
    resp = await postIA(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      armarBody(contenido, estricto),
      clave
    );
  } catch (errNet) {
    const e = errNet instanceof Error ? errNet : new Error(String(errNet));
    return {
      ok: false,
      tipo: "salto",
      msg: `Sin conexión al probar ${model} (${e.name === "AbortError" ? "tiempo agotado (45s)" : e.message || "red"}).`,
    };
  }
  if (resp.status === 429) {
    const txt429 = await resp.text().catch(() => "");
    // IMPORTANTE: todas las respuestas 429 de Gemini traen "RESOURCE_EXHAUSTED" y "quota".
    // Solo es cuota diaria si explícitamente menciona "PerDay" / "per day" / "daily" y NO "PerMinute" / "per minute".
    const esPorMinuto = /per minute|PerMinute|rpm|tpm|TokensPerMinute|RequestsPerMinute/i.test(txt429);
    const esDiaria = !esPorMinuto && /per day|PerDay|daily|rpd|RequestsPerDay/i.test(txt429);
    return {
      ok: false,
      tipo: esDiaria ? "cuotaDia" : "cuotaRpm",
      msg: `${esDiaria ? "CUOTA DIARIA" : "LÍMITE POR MINUTO"} en ${model} (HTTP 429).`,
    };
  }
  if (resp.status === 503) return { ok: false, tipo: "salto503", msg: `Modelo ${model} saturado (HTTP 503, alta demanda temporal).` };
  if (resp.status === 404) return { ok: false, tipo: "salto", msg: `Modelo ${model} no disponible (HTTP 404).` };
  if (!resp.ok) {
    const txtErr = await resp.text().catch(() => "");
    let msg = `Error de IA (HTTP ${resp.status}).`;
    try {
      msg = "IA: " + ((JSON.parse(txtErr) as { error?: { message?: string } }).error?.message || msg);
    } catch {
      if (txtErr) msg = txtErr.slice(0, 220);
    }
    if (/API_KEY_INVALID|API key not valid|API_KEY_NOT_FOUND|PERMISSION_DENIED/i.test(msg)) {
      return { ok: false, tipo: "clave", msg };
    }
    const esMultimedia = (contenido.durls?.length ?? 0) > 1;
    if (resp.status === 400 && esMultimedia && /large|tokens|size|payload|maximum|invalid argument/i.test(msg)) {
      return { ok: false, tipo: "grande", msg };
    }
    // Un bloque de TEXTO que no cabe también se puede partir por la mitad.
    if (resp.status === 400 && contenido.texto && /large|tokens|size|payload|maximum|invalid argument/i.test(msg)) {
      return { ok: false, tipo: "grande", msg };
    }
    return { ok: false, tipo: "duro", msg };
  }
  let datos: RespuestaGemini | null = null;
  try {
    datos = (await resp.json()) as RespuestaGemini;
  } catch {
    return { ok: false, tipo: "salto", msg: `Modelo ${model} devolvió respuesta ilegible.` };
  }
  const texto = (datos?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "").trim();
  if (!texto) {
    const fr = datos?.candidates?.[0]?.finishReason || datos?.promptFeedback?.blockReason || "vacío";
    return { ok: false, tipo: "salto", msg: `Modelo ${model} respondió vacío (${fr}).` };
  }
  return { ok: true, texto };
}

// ---------- Extracción por lotes (idéntico al legacy) ----------

/**
 * Qué se puede partir por la mitad cuando el modelo dice "esto no entra".
 * Para imágenes son las páginas; para texto, el bloque por su punto medio.
 */
type Parte = {
  /** Contenido del lote. */
  contenido: ContenidoLote;
  /** Etiqueta legible del lote (para los mensajes en vivo). */
  etiqueta: string;
  /** Parte este lote en dos. Null si ya no se puede partir. */
  partir: () => [Parte, Parte] | null;
};

async function extraerLote(
  clave: string,
  modelos: string[],
  paginas: Array<{ num: number; durl: string }>,
  etiqueta: string,
  diag: { respondio: string; ultimoError: string },
  onEstado?: (s: string) => void
): Promise<CarreraExtraida[]> {
  const mitad = Math.ceil(paginas.length / 2);
  const imagenes = (ps: Array<{ num: number; durl: string }>, suf: string): Parte => ({
    contenido: { durls: ps.map((p) => p.durl) },
    etiqueta: `${etiqueta}${suf}`,
    partir: () => null,
  });
  return extraerParte(
    clave,
    modelos,
    {
      contenido: { durls: paginas.map((p) => p.durl) },
      etiqueta,
      partir: () =>
        paginas.length > 1
          ? [imagenes(paginas.slice(0, mitad), "a"), imagenes(paginas.slice(mitad), "b")]
          : null,
    },
    diag,
    onEstado
  );
}

/**
 * Núcleo del reintento: prueba los modelos Flash uno a uno, con las mismas
 * esperas y los mismos saltos del legacy, hasta que uno devuelve carreras.
 *
 * Se separó del camino de imágenes para que el camino de TEXTO reutilice EXACTAMENTE
 * la misma política de reintentos, cuota y saturación: dos copias de esa
 * lógica acabarían divergiendo, y la que importa es la que se ejecuta.
 */
async function extraerParte(
  clave: string,
  modelos: string[],
  parte: Parte,
  diag: { respondio: string; ultimoError: string },
  onEstado?: (s: string) => void
): Promise<CarreraExtraida[]> {
  let huboTransitorio = false;
  for (let ronda = 0; ronda < 2; ronda++) {
    if (ronda > 0) {
      if (!huboTransitorio) break;
      if (onEstado) onEstado(`${parte.etiqueta}: reintentando lote tras pausa breve (3s)…`);
      await esperar(3000);
    }
    for (let i = 0; i < modelos.length; i++) {
      const model = modelos[i];
      if (i > 0) await esperar(400);
      let r = await llamarModelo(clave, model, parte.contenido, false);
      if (r.ok) {
        let lotesCarreras = parsearJSON(r.texto);
        if (lotesCarreras.length === 0) {
          if (onEstado) onEstado(`${parte.etiqueta}: reintento en JSON estricto con ${model}…`);
          const r2 = await llamarModelo(clave, model, parte.contenido, true);
          if (r2.ok) {
            r = r2;
            lotesCarreras = parsearJSON(r2.texto);
          } else {
            r = r2;
          }
        }
        if (r.ok && lotesCarreras.length > 0) {
          diag.respondio = model;
          return lotesCarreras;
        }
        if (r.ok) {
          diag.ultimoError = `${parte.etiqueta}: ${model} devolvió 0 carreras.`;
          continue;
        }
      }
      if (r.tipo === "clave") {
        throw new Error(r.msg + " Revisa la clave en aistudio.google.com/apikey y guárdala de nuevo.");
      }
      if (r.tipo === "cuotaDia") {
        // Cuota diaria de este modelo agotada: saltar de inmediato al siguiente modelo Flash.
        diag.ultimoError = `${parte.etiqueta}: ${r.msg}`;
        continue;
      }
      if (r.tipo === "cuotaRpm" || r.tipo === "salto503") {
        // Rotar de inmediato al siguiente modelo disponible sin congelar la interfaz.
        huboTransitorio = true;
        diag.ultimoError = `${parte.etiqueta}: ${r.msg}`;
        if (onEstado && i + 1 < modelos.length) {
          onEstado(`${parte.etiqueta}: ${model} ocupado, cambiando a ${modelos[i + 1]}…`);
        }
        continue;
      }
      if (r.tipo === "grande") {
        const mitad = parte.partir();
        if (mitad) {
          if (onEstado) onEstado(`${parte.etiqueta}: lote muy pesado, dividiendo en 2…`);
          const a = await extraerParte(clave, modelos, mitad[0], diag, onEstado);
          const b = await extraerParte(clave, modelos, mitad[1], diag, onEstado);
          return a.concat(b);
        }
      }
      diag.ultimoError = `${parte.etiqueta}: ${r.msg}`;
    }
  }
  throw new Error(diag.ultimoError + " Se probaron los modelos Flash disponibles para este lote.");
}

// ---------- Punto de entrada ----------

/**
 * Transcribe una gaceta EN TEXTO partiéndola en bloques de 2-3 carreras.
 *
 * Es la vía que resuelve la carga incompleta: el documento entero no cabe en
 * una respuesta del modelo y las últimas carreras se pierden sin aviso. Aquí
 * cada bloque se manda por separado (así su JSON cierra completo) y al final
 * TODO se consolida en un `Map<number, Carrera>` indexado por número de
 * carrera, de modo que una carrera partida entre dos bloques se una con sus
 * ejemplares y no se duplique.
 *
 * Devuelve parcial si algunos bloques fallan: la UI muestra lo que hay y
 * avisa qué faltó, en vez de quedarse en blanco.
 */
export async function transformarGacetaTexto(
  clave: string,
  texto: string,
  onLote?: (hecho: number, total: number) => void,
  onEstado?: (s: string) => void
): Promise<ResultadoGaceta> {
  const diag = { respondio: "", ultimoError: "" };
  let cuotaTotal = false;

  const segmentos = segmentarPorCarreras(texto);
  const bloques = armarBloques(segmentos, 3);
  if (!bloques.length) {
    return { ok: false, carreras: [], error: "El documento no tiene texto legible para transcribir." };
  }

  const pintarDiag = (extra?: string): string =>
    [
      `clave: ${clave ? clave.slice(0, 4) + "…" + clave.slice(-3) + " (" + clave.length + " car.)" : "AUSENTE"}`,
      `bloques de texto: ${bloques.length} · caracteres: ${texto.length}`,
      diag.respondio ? `respondió: ${diag.respondio}` : "",
      diag.ultimoError ? `último error: ${diag.ultimoError}` : "",
      extra || "",
    ]
      .filter(Boolean)
      .join("\n");

  try {
    if (!clave.trim()) {
      return { ok: false, carreras: [], error: "Falta la clave de Gemini.", diag: pintarDiag() };
    }
    const descubiertos = await listaModelosFlash(clave);
    const modelos = elegirModelos(descubiertos);
    if (!modelos.length) {
      return {
        ok: false,
        carreras: [],
        error: "Tu clave no devolvió modelos Flash. Verifica la clave en aistudio.google.com/apikey y tu conexión.",
        diag: pintarDiag(),
      };
    }

    const acumuladas: CarreraExtraida[] = [];
    const bloquesFallidos: number[] = [];

    for (const bloque of bloques) {
      if (!cuotaTotal) {
        onLote?.(bloque.indice, bloques.length);
        const cuales = bloque.numeros.length ? `carrera(s) ${bloque.numeros.join(", ")}` : "carreras del bloque";
        onEstado?.(`Bloque ${bloque.indice}/${bloques.length} (${cuales}): enviando a la IA…`);
      }
      try {
        const nuevas = await extraerParte(
          clave,
          modelos,
          {
            contenido: { durls: [], texto: bloque.texto },
            etiqueta: `Bloque ${bloque.indice}/${bloques.length}`,
            partir: () => {
              // Si el texto no entra, se parte por la mitad. Se busca el salto
              // de línea más cercano al medio para no cortar una carrera.
              const mitad = Math.floor(bloque.texto.length / 2);
              const corte = bloque.texto.lastIndexOf("\n", mitad);
              const punto = corte > bloque.texto.length * 0.2 ? corte : mitad;
              const a = bloque.texto.slice(0, punto);
              const b = bloque.texto.slice(punto);
              if (!a.trim() || !b.trim()) return null;
              const sub = (txt: string, i: number): Parte => ({
                contenido: { durls: [], texto: txt },
                etiqueta: `Bloque ${bloque.indice}/${bloques.length}.${i}`,
                partir: () => null,
              });
              return [sub(a, 1), sub(b, 2)];
            },
          },
          diag,
          onEstado
        );
        // Se acumulan TODAS las carreras de todos los bloques; la
        // consolidación por número se hace AL FINAL (una sola vez), para que
        // la decisión "misma carrera" o "carrera distinta mal numerada" la
        // tome la MISMA función que usa el resto del motor
        // (`consolidarPorNumero`), y no una copia que se pueda desviar.
        for (const c of nuevas) {
          normalizarExtraida(c);
          acumuladas.push(c);
        }
        onEstado?.(
          `Bloque ${bloque.indice}/${bloques.length}: ${nuevas.length} carrera(s). Acumulado: ${acumuladas.length}.`
        );
      } catch (errBloque) {
        const msg = errBloque instanceof Error ? errBloque.message : String(errBloque);
        if (/clave|API key/i.test(msg)) {
          return { ok: false, carreras: acumuladas, error: msg, diag: pintarDiag(), cuotaTotal };
        }
        bloquesFallidos.push(bloque.indice);
        diag.ultimoError = `Bloque ${bloque.indice}: ${msg}`;
        if (/CUOTA DIARIA/i.test(msg)) {
          cuotaTotal = true;
          break;
        }
      }
    }

    // CONSOLIDACIÓN: `Map<number, Carrera>` indexado por número de carrera.
    // La misma carrera partida entre dos bloques se une con sus ejemplares;
    // dos carreras distintas con el mismo número NO se colapsan (la segunda
    // sale como colisión y la reparación final la renumera al hueco).
    const consol = consolidarPorNumero(acumuladas);
    const carreras = [...consol.porNumero.values(), ...consol.colisiones];
    if (!carreras.length) {
      return {
        ok: false,
        carreras: [],
        error:
          (diag.ultimoError || "No se obtuvieron carreras de la IA.") +
          " — Probá de nuevo en unos minutos: los 429 (cuota) y 503 (saturación) son transitorios.",
        diag: pintarDiag(),
        cuotaTotal,
      };
    }

    let avisoNumeracion = "";
    if (carreras.length > 1) {
      const rep: ReporteReparacion = repararNumerosCarreras(carreras);
      const faltan = carrerasFaltantes(carreras);
      const partes: string[] = [];
      if (rep.renumeradas.length) {
        partes.push(`corregí el número mal leído (${rep.renumeradas.map((r) => `${r.de}→${r.a}`).join(", ")})`);
      }
      if (rep.consolidadas) partes.push(`uní ${rep.consolidadas} carrera(s) repetida(s)`);
      if (faltan.length) {
        partes.push(`faltan: ${faltan.map((f) => `${f.faltan.join("/")}${f.hipodromo ? ` (${f.hipodromo})` : ""}`).join("; ")}`);
      }
      if (bloquesFallidos.length) {
        partes.push(`no se pudo leer el bloque(s) ${bloquesFallidos.join(", ")}: puede faltar alguna carrera de ahí`);
      }
      if (partes.length) {
        avisoNumeracion = partes.join(" · ");
        onEstado?.(`Numeración: ${avisoNumeracion}.`);
      }
    }

    return {
      ok: true,
      carreras,
      diag: pintarDiag(avisoNumeracion ? `numeración: ${avisoNumeracion}` : ""),
      cuotaTotal,
      avisoNumeracion: avisoNumeracion || undefined,
    };
  } catch (e) {
    return {
      ok: false,
      carreras: [],
      error: e instanceof Error ? e.message : String(e),
      diag: pintarDiag(),
      cuotaTotal,
    };
  }
}

/** Transforma las páginas (dataURLs) con Gemini por LOTES de 3 (igual que el
 *  legacy), con reintentos de ciclo (máx 3) y entrega resultados parciales.
 *  onLote → progreso; onEstado → mensajes en vivo para la UI. */
export async function transformarGaceta(
  clave: string,
  imagenes: string[],
  onLote?: (hecho: number, total: number) => void,
  onEstado?: (s: string) => void
): Promise<ResultadoGaceta> {
  const diag = { respondio: "", ultimoError: "" };
  let cuotaTotal = false;
  const pintarDiag = (extra?: string): string =>
    [
      `clave: ${clave ? clave.slice(0, 4) + "…" + clave.slice(-3) + " (" + clave.length + " car.)" : "AUSENTE"}`,
      `páginas elegidas: ${imagenes.length} · peso aprox: ${(pesoKB(imagenes) / 1024).toFixed(1)} MB`,
      diag.respondio ? `respondió: ${diag.respondio}` : "",
      diag.ultimoError ? `último error: ${diag.ultimoError}` : "",
      extra || "",
    ]
      .filter(Boolean)
      .join("\n");

  try {
    if (!imagenes.length) {
      return { ok: false, carreras: [], error: "No hay páginas seleccionadas para enviar.", diag: pintarDiag() };
    }
    const descubiertos = await listaModelosFlash(clave);
    const modelos = elegirModelos(descubiertos);
    if (!modelos.length) {
      return {
        ok: false,
        carreras: [],
        error: "Tu clave no devolvió modelos Flash. Verifica la clave en aistudio.google.com/apikey y tu conexión.",
        diag: pintarDiag(),
      };
    }

    const incluidas = (imagenes || []).map((durl, i) => ({ num: i + 1, durl }));
    const TAM_LOTE = 3;
    const lotes: Array<Array<{ num: number; durl: string }>> = [];
    for (let i = 0; i < incluidas.length; i += TAM_LOTE) lotes.push(incluidas.slice(i, i + TAM_LOTE));

    const carreras: CarreraExtraida[] = [];
    const paginasFallidas = new Set<number>();
    let loteN = 0;
    let ciclo = 1;

    while (true) {
      for (const lote of lotes) {
        loteN++;
        const etiqueta = `Lote ${loteN}/${lotes.length} (pág. ${lote.map((p) => p.num).join(",")})`;
        if (!cuotaTotal) {
          onLote?.(Math.min(loteN, lotes.length), lotes.length);
          onEstado?.(`${etiqueta}: enviando a la IA…`);
        }
        try {
          const nuevas = await extraerLote(clave, modelos, lote, etiqueta, diag, onEstado);
          fusionarCarreras(carreras, nuevas);
          lote.forEach((p) => paginasFallidas.delete(p.num));
          onEstado?.(`${etiqueta}: ${nuevas.length} carrera(s). Total acumulado: ${carreras.length}.`);
        } catch (errLote) {
          const msg = errLote instanceof Error ? errLote.message : String(errLote);
          if (/clave|API key/i.test(msg)) {
            return { ok: false, carreras, error: msg, diag: pintarDiag(), cuotaTotal };
          }
          lote.forEach((p) => paginasFallidas.add(p.num));
          diag.ultimoError = `${etiqueta}: ${msg}`;
          if (/CUOTA DIARIA/i.test(msg)) {
            cuotaTotal = true;
            break;
          }
        }
      }
      // ¿Resultado aunque sea parcial? Se entrega AHORA.
      if (carreras.length > 0) break;
      // Cuota diaria agotada en TODAS las familias: esperar es inútil.
      if (cuotaTotal) break;
      // Sin resultados por fallo/saturación: se rehace el ciclo (máx 2).
      if (ciclo >= 2 || !diag.ultimoError) break;
      ciclo++;
      onEstado?.(`Sin carreras aún: ${diag.ultimoError}. Reintentando en 4 seg…`);
      await esperar(4000);
      loteN = 0;
    }

    // NUMERACIÓN: la IA puede leer mal el número de una carrera (p. ej. la 13.ª
    // como la 10.ª). Eso dejaba un repetido + un hueco y la fusión perdía una
    // carrera. Aquí se renumera la mal leída al hueco y se unen los repetidos
    // que sí eran la misma carrera (continuación entre páginas), de modo que la
    // Gaceta trae SIEMPRE las N carreras de la secuencia.
    let avisoNumeracion = "";
    if (carreras.length > 1) {
      const rep: ReporteReparacion = repararNumerosCarreras(carreras);
      const faltan = carrerasFaltantes(carreras);
      const partes: string[] = [];
      if (rep.renumeradas.length) {
        partes.push(`corregí el número mal leído (${rep.renumeradas.map((r) => `${r.de}→${r.a}`).join(", ")})`);
      }
      if (rep.consolidadas) partes.push(`uní ${rep.consolidadas} carrera(s) repetida(s)`);
      if (faltan.length) {
        partes.push(
          `faltan: ${faltan.map((f) => `${f.faltan.join("/")}${f.hipodromo ? ` (${f.hipodromo})` : ""}`).join("; ")}`
        );
      }
      if (paginasFallidas.size) {
        const pgs = [...paginasFallidas].sort((a, b) => a - b);
        partes.push(`no se pudo leer la página(s) ${pgs.join(", ")}: puede faltar alguna carrera de ahí`);
      }
      if (partes.length) {
        avisoNumeracion = partes.join(" · ");
        onEstado?.(`Numeración: ${avisoNumeracion}.`);
      }
    }

    if (carreras.length > 0) {
      return {
        ok: true,
        carreras,
        diag: pintarDiag(avisoNumeracion ? `numeración: ${avisoNumeracion}` : ""),
        cuotaTotal,
        avisoNumeracion: avisoNumeracion || undefined,
      };
    }
    return {
      ok: false,
      carreras: [],
      error:
        (diag.ultimoError || "No se obtuvieron carreras de la IA (páginas sin texto legible).") +
        " — Probá de nuevo en unos minutos: los 429 (cuota) y 503 (saturación) son transitorios. Si persiste con 404/503, regenerá tu clave gratuita en aistudio.google.com/apikey y guardala de nuevo.",
      diag: pintarDiag(),
      cuotaTotal,
    };
  } catch (e) {
    return {
      ok: false,
      carreras: [],
      error: e instanceof Error ? e.message : String(e),
      diag: pintarDiag(),
      cuotaTotal,
    };
  }
}