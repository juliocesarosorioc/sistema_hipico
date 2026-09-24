// ============================================================
//  Motor de extracción de carreras con Gemini (Gemini REST API).
//  RÉPLICA EXACTA del motor legacy `js/gaceta_ia.js` (+ helpers):
//  envío por LOTES, reintentos por saturación/cuota, cambio de
//  modelo, partición de lotes pesados y fusión de resultados.
//  Todo ocurre en el navegador: NO hay servidor Next.js de por
//  medio (el build es `output:"export"`, 100% estático; no hay
//  API Routes ni Server Actions que reciban el PDF).
// ============================================================

export type EjemplarExtraido = {
  numero: string | number;
  nombre: string;
  nacionalidad?: string;
  valor?: number;
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
};

export const CLAVE_GEMINI_KEY = "club_gemini_key";

// Modelos Flash de respaldo (la app primero consulta a la API cuáles existen
// hoy). Mismo listado que js/gaceta_helpers.js.
export const MODELOS_GEMINI = ["gemini-3.6-flash", "gemini-3-flash", "gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"];

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
Para cada carrera devuelve:
  - carrera: número de la carrera (entero)
  - hipodromo: nombre del hipódromo (MAYÚSCULAS; ej: LA RINCONADA, SANTA RITA). Si no se lee usa "".
  - fecha: fecha de la jornada en formato YYYY-MM-DD si aparece, si no null
  - distancia: distancia de la carrera en metros (entero) si se lee, si no 0
  - superficie: una de ARENA, CESPED, FANGO, TAPETA u otra si se lee explícita; si no ARENA
  - premio: número si se lee (ej: 15000), si no 0
  - ejemplares: lista con numero (puesto/orden del ejemplar), nombre (MAYÚSCULAS, EXACTO como aparece), nacionalidad (país si se indica: VE, USA, BR, AR, CL, MX, PA, PE, CO, EC, UY; si NO se indica: USA si el hipódromo es de Estados Unidos, si no VE), valor (monta del ejemplar: SOLO número si aparece, si no 0)
REGLAS: NO inventes nombres ni datos; transcribe exactamente lo que lees. REGISTRA TODOS los ejemplares de cada carrera sin omitir ninguno (todos los números de participante que aparezcan). Si un ejemplar aparece repetido entre páginas, mantenlo tal cual. Si el documento no tiene carreras, devuelve {"carreras":[]}.`;

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

/** Parser tolerante de la respuesta de Gemini (markdown, JSON suelto, arrays). */
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

/** Fusiona carreras extraídas (merge por hipódromo|número, igual que el legacy). */
function fusionarCarreras(carreras: CarreraExtraida[], nuevas: CarreraExtraida[]): void {
  for (const c of Array.isArray(nuevas) ? nuevas : []) {
    if (!c || typeof c !== "object") continue;
    c.ejemplares = Array.isArray(c.ejemplares) ? c.ejemplares : [];
    c.ejemplares.forEach((ej) => {
      ej.nacionalidad = nacEjemplar(ej, c.hipodromo);
      ej.nombre = String(ej.nombre || "").trim().toUpperCase();
    });
    const key = `${String(c.hipodromo || "").toUpperCase()}|${c.carrera ?? ""}`;
    const ex = key === "|" ? null : carreras.find((x) => `${String(x.hipodromo || "").toUpperCase()}|${x.carrera ?? ""}` === key);
    if (!ex) {
      carreras.push(c);
      continue;
    }
    const nums = new Set((ex.ejemplares || []).map((e) => String(e.numero)));
    (c.ejemplares || []).forEach((e) => {
      if (!nums.has(String(e.numero))) {
        ex.ejemplares.push(e);
        nums.add(String(e.numero));
      }
    });
  }
}

// ---------- Modelos ----------

async function listaModelosFlash(clave: string): Promise<string[]> {
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(clave)}`);
    if (!r.ok) return [];
    const datos = (await r.json()) as { models?: Array<{ name: string; supportedGenerationMethods?: string[] }> };
    const flash = (datos.models || [])
      .map((m) => ({ name: m.name.replace("models/", ""), metodos: m.supportedGenerationMethods ?? null }))
      // Solo modelos que sirven para transcribir la gaceta: Flash de chat.
      // Se descarta cualquier nombre que no acepte generateContent (p.ej. los
      // modelos TTS gemini-3.x-flash-tts y -lite-tts SIEMPRE dan HTTP 400) y
      // audio/imagen/preview/tuned/embedding.
      .filter(
        (m) =>
          /flash/i.test(m.name) &&
          !/(?:-tts|image|preview|tuned|babbage|embedding)/i.test(m.name) &&
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
    // Nota: supportedGenerationMethods es opcional en la respuesta; filtrar
    // SOLO por el nombre evita que una respuesta sin ese campo deje la lista
    // vacía y degrade la experiencia (ya se descartan TTS/imagen arriba).
    return flash;
  } catch {
    return [];
  }
}

/** Cada familia de Flash tiene SU PROPIA cuota gratuita diaria. Se ordenan
 *  primero por familia vieja y luego por versión dentro de la familia. */
function elegirModelos(descubiertos: string[]): string[] {
  const unicos = [...new Set(descubiertos.concat(MODELOS_GEMINI))].filter(
    (m) => !/image|preview|tuned|babbage|-tts|embedding/i.test(m)
  );
  const porFamilia: Record<string, string[]> = {};
  for (const m of unicos) {
    const v = (m.match(/gemini[_-]?(\d+)/i) || [])[1] || "0";
    const fam = v.slice(0, 1);
    (porFamilia[fam] = porFamilia[fam] || []).push(m);
  }
  const orden = ["1", "2", "3"];
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

function armarBody(durls: string[], estricto: boolean): Record<string, unknown> {
  const imgs = durls.map((d) => {
    const [, meta] = d.split(",");
    const mime = d.split(";")[0].replace("data:", "");
    return { inline_data: { mime_type: mime, data: meta } };
  });
  const parteTexto = estricto
    ? 'Gaceta adjunta. Extrae las carreras y responde ÚNICAMENTE con JSON válido con el formato {"carreras":[...]}, sin markdown, sin decoraciones ni explicaciones.'
    : "Gaceta adjunta. Extrae las carreras y sus ejemplares.";
  return {
    contents: [{ parts: [{ text: parteTexto }, ...imgs] }],
    systemInstruction: { parts: [{ text: SYS }] },
    generationConfig: {
      temperature: estricto ? 0.2 : 0,
      maxOutputTokens: 8192,
      responseMimeType: "application/json",
    },
  };
}

async function postIA(url: string, body: Record<string, unknown>, clave: string, ms = 120000): Promise<Response> {
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

async function llamarModelo(clave: string, model: string, durls: string[], estricto: boolean): Promise<LlamadaIA> {
  let resp: Response;
  try {
    resp = await postIA(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      armarBody(durls, estricto),
      clave
    );
  } catch (errNet) {
    const e = errNet instanceof Error ? errNet : new Error(String(errNet));
    return {
      ok: false,
      tipo: "salto",
      msg: `Sin conexión al probar ${model} (${e.name === "AbortError" ? "tiempo agotado (120s)" : e.message || "red"}).`,
    };
  }
  if (resp.status === 429) {
    const txt429 = await resp.text().catch(() => "");
    const esDiaria = /RESOURCE_EXHAUSTED|quota|per day|daily|rpd/i.test(txt429);
    return { ok: false, tipo: esDiaria ? "cuotaDia" : "cuotaRpm", msg: `${esDiaria ? "CUOTA DIARIA" : "LÍMITE POR MINUTO"} en ${model} (HTTP 429).` };
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
    if (resp.status === 400 && durls.length > 1 && /large|tokens|size|payload|maximum|invalid argument/i.test(msg)) {
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

async function extraerLote(
  clave: string,
  modelos: string[],
  paginas: Array<{ num: number; durl: string }>,
  etiqueta: string,
  diag: { respondio: string; ultimoError: string },
  onEstado?: (s: string) => void
): Promise<CarreraExtraida[]> {
  const durls = paginas.map((p) => p.durl);
  let reintento503 = false;
  let reintentoRpm = false;
  for (let i = 0; i < modelos.length; i++) {
    const model = modelos[i];
    if (i > 0) await esperar(1200);
    let r = await llamarModelo(clave, model, durls, false);
    if (r.ok) {
      let lotesCarreras = parsearJSON(r.texto);
      if (lotesCarreras.length === 0) {
        if (onEstado) onEstado(`${etiqueta}: sin carreras, segundo intento (JSON estricto)…`);
        const r2 = await llamarModelo(clave, model, durls, true);
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
        diag.ultimoError = `${etiqueta}: ${model} devolvió 0 carreras.`;
        continue;
      }
    }
    if (r.tipo === "clave") throw new Error(r.msg + " Revisa la clave en aistudio.google.com/apikey y guárdala de nuevo.");
    if (r.tipo === "cuotaDia") {
      // Cuota DIARIA de esta familia agotada: NUNCA se espera en vano.
      diag.ultimoError = `${etiqueta}: ${r.msg}`;
      continue;
    }
    if (r.tipo === "cuotaRpm") {
      // Límite por MINUTO (transitorio): una sola espera larga y se reintenta.
      if (!reintentoRpm) {
        reintentoRpm = true;
        if (onEstado) onEstado(`${etiqueta}: límite por minuto de ${model}, esperando 65s y reintentando…`);
        await esperar(65000);
        i--;
        continue;
      }
      diag.ultimoError = `${etiqueta}: ${r.msg}`;
      continue;
    }
    if (r.tipo === "salto503" && !reintento503) {
      // Pico temporal de demanda: se espera 20s y se reintenta el MISMO modelo una vez.
      reintento503 = true;
      if (onEstado) onEstado(`${etiqueta}: ${model} saturado, esperando 20s y reintentando…`);
      await esperar(20000);
      i--;
      continue;
    }
    if (r.tipo === "grande" && durls.length > 1) {
      const mitad = Math.ceil(durls.length / 2);
      if (onEstado) onEstado(`${etiqueta}: lote muy pesado, dividiendo en 2…`);
      const a = await extraerLote(clave, modelos, paginas.slice(0, mitad), etiqueta + "a", diag, onEstado);
      const b = await extraerLote(clave, modelos, paginas.slice(mitad), etiqueta + "b", diag, onEstado);
      return a.concat(b);
    }
    diag.ultimoError = `${etiqueta}: ${r.msg}`;
  }
  throw new Error(diag.ultimoError + " Se probaron los modelos Flash disponibles para este lote.");
}

// ---------- Punto de entrada ----------

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
          onEstado?.(`${etiqueta}: ${nuevas.length} carrera(s). Total acumulado: ${carreras.length}.`);
        } catch (errLote) {
          const msg = errLote instanceof Error ? errLote.message : String(errLote);
          if (/clave|API key/i.test(msg)) {
            return { ok: false, carreras, error: msg, diag: pintarDiag(), cuotaTotal };
          }
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
      // Sin resultados por fallo/saturación: se rehace el ciclo (máx 3).
      if (ciclo >= 3 || !diag.ultimoError) break;
      ciclo++;
      onEstado?.(`Sin carreras aún: ${diag.ultimoError}. Reintentando el ciclo completo (${ciclo}/3) en 30 seg…`);
      await esperar(30000);
      loteN = 0;
    }

    if (carreras.length > 0) {
      return { ok: true, carreras, diag: pintarDiag(), cuotaTotal };
    }
    return {
      ok: false,
      carreras: [],
      error: diag.ultimoError || "No se obtuvieron carreras de la IA (páginas sin texto legible).",
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