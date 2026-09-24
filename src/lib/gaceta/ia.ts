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
};

export const CLAVE_GEMINI_KEY = "club_gemini_key";

export const MODELOS_GEMINI = ["gemini-2.0-flash", "gemini-2.5-flash", "gemini-1.5-flash", "gemini-1.5-flash-lite"];

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

/** La API REST de Gemini acepta hasta ~20 MB de datos inline por request. */
const MAX_LOTE_KB = 12000;

/** Error tipado con el estado HTTP de la llamada a Gemini (para traducirlo a UI). */
class ErrorIA extends Error {
  status: number | null;
  detalle: string;
  constructor(msg: string, status: number | null, detalle: string) {
    super(msg);
    this.name = "ErrorIA";
    this.status = status;
    this.detalle = detalle;
  }
}

/** Traduce errores crudos de Gemini a mensajes claros para el operador. */
export function traducirErrorIA(status: number | null, detalle: string): string {
  const t = detalle.toLowerCase();
  if (status === 413 || status === 400 && /payload|too large|size.*exceed|exceed.*size|too many|large/i.test(t)) {
    return "Error: el lote de páginas es muy pesado para Gemini (máx. ~20 MB por request). Selecciona menos páginas por vez o usa imágenes más livianas.";
  }
  if (status === 429 || /quota|rate.?limit|resource.*exceed|insufficient/i.test(t)) {
    return "Error: límite de cuota de Gemini free alcanzado (429). Espera unos segundos o prueba con otra clave.";
  }
  if (status === 403 || /forbidden|permission|api.?key.*invalid/i.test(t)) {
    return "Error: la clave fue rechazada por Gemini (403). Verifica la API key en aistudio.google.com/apikey.";
  }
  if (status === 401 || /unauthorized|key.*(invalid|missing)/i.test(t)) {
    return "Error: clave de Gemini inválida o faltante (401). Vuelve a guardar tu clave.";
  }
  if (status === 404 || /model.*found|not ?found/i.test(t)) {
    return "Error: el modelo de IA no está disponible (404). Prueba de nuevo en unos minutos.";
  }
  if (status === 500 || status === 503) {
    return "Error: Gemini está procesando con sobrecarga (500/503). Intenta de nuevo en unos segundos.";
  }
  if (status === 0 || /network|fetch|internet|failed to fetch/i.test(t)) {
    return "Error de red: no se pudo contactar con Gemini. Revisa tu conexión a internet.";
  }
  return `Error de la IA (HTTP ${status ?? "?"}): ${detalle.slice(0, 220)}`;
}

async function listaModelosFlash(clave: string): Promise<string[]> {
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(clave)}`);
    if (!r.ok) return [];
    const datos = (await r.json()) as { models?: Array<{ name: string }> };
    const flash = (datos.models || []).map((m) => m.name.replace("models/", "")).filter((n) => /flash/i.test(n));
    if (!flash.length) return [];
    const ver = (n: string) => {
      const m = n.match(/gemini-([\d.]+)/);
      return m ? parseFloat(m[1]) : 0;
    };
    const lite = (n: string) => /-lite/i.test(n);
    flash.sort((a, b) => ver(b) - ver(a) || (lite(a) ? 1 : 0) - (lite(b) ? 1 : 0));
    return flash;
  } catch (e) {
    void e;
    return [];
  }
}

function elegirModelos(descubiertos: string[]): string[] {
  const unicos = [...new Set(descubiertos.concat(MODELOS_GEMINI))].filter((m) => !/image|preview|tuned|babbage/i.test(m));
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

async function generarLote(
  clave: string,
  modelo: string,
  durls: string[]
): Promise<CarreraExtraida[]> {
  const partes: Array<Record<string, unknown>> = durls.map((d) => {
    const [, meta] = d.split(",");
    const mime = d.split(";")[0].replace("data:", "");
    return { inline_data: { mime_type: mime, data: meta } };
  });
  const cuerpo = {
    contents: [
      {
        role: "user",
        parts: [{ text: SYS }, ...partes, { text: "Gaceta adjunta. Responde ÚNICAMENTE con JSON válido: {\"carreras\":[...]}. Sin markdown, sin decoraciones ni explicaciones." }],
      },
    ],
    generationConfig: { temperature: 0, response_mime_type: "application/json" },
  };
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${encodeURIComponent(clave)}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) }
  );
  if (!r.ok) {
    const txt = await r.text();
    throw new ErrorIA(`HTTP ${r.status}`, r.status, txt.slice(0, 300));
  }
  const datos = (await r.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const txt = datos.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  const json = txt.replace(/```json|```/g, "").trim();
  const inicio = json.indexOf("{");
  const fin = json.lastIndexOf("}");
  if (inicio < 0 || fin < inicio) throw new Error("La IA no devolvió JSON válido.");
  const parsed = JSON.parse(json.slice(inicio, fin + 1)) as { carreras?: CarreraExtraida[] };
  return Array.isArray(parsed.carreras) ? parsed.carreras : [];
}

function normalizarNacionalidad(nac?: string, hipodromo?: string): string {
  if (nac && /^[A-Z]{2,3}$/i.test(nac.trim())) return nac.trim().toUpperCase();
  return /RINCONADA|LA RINCONADA/i.test(hipodromo ?? "") ? "VE" : (hipodromo ? "USA" : "VE");
}

/** Transforma las páginas (dataURLs) con Gemini por lotes (≤ MAX_LOTE_KB) y fusiona carreras. */
export async function transformarGaceta(
  clave: string,
  imagenes: string[],
  onLote?: (hecho: number, total: number) => void
): Promise<ResultadoGaceta> {
  const diag: string[] = [];
  const peso = `${(pesoKB(imagenes) / 1024).toFixed(1)} MB`;
  try {
    if (!imagenes.length) {
      return { ok: false, carreras: [], error: "No hay páginas seleccionadas para enviar.", diag: `peso ${peso}` };
    }
    if (pesoKB(imagenes) > 18 * 1024) {
      return {
        ok: false,
        carreras: [],
        error: "Error: el archivo es muy pesado (" + peso + "). Gemini admite máx. ~20 MB por request. Reduce la selección de páginas o la resolución del PDF.",
        diag: `peso total enviado: ${peso}`,
      };
    }
    const descubiertos = await listaModelosFlash(clave);
    const modelos = elegirModelos(descubiertos);
    if (!modelos.length) {
      return { ok: false, carreras: [], error: "Tu clave no devolvió modelos Flash. Verifica la clave en aistudio.google.com/apikey y tu conexión.", diag: `modelos: 0 · peso: ${peso}` };
    }

    // Lotes dinámicos: nunca superar ~12 MB por request (margen bajo el límite real de 20 MB).
    const lotes: string[][] = [];
    let actual: string[] = [];
    let kbs = 0;
    for (const d of imagenes) {
      const kb = ((d.split(",")[1] || "").length * 3) / 4;
      if (actual.length && kbs + kb > MAX_LOTE_KB) {
        lotes.push(actual);
        actual = [];
        kbs = 0;
      }
      actual.push(d);
      kbs += kb;
    }
    if (actual.length) lotes.push(actual);
    if (!lotes.length) return { ok: false, carreras: [], error: "No hay páginas válidas para enviar.", diag: `peso ${peso}` };

    const carreras: CarreraExtraida[] = [];
    let hecho = 0;
    for (const lote of lotes) {
      let okLote = false;
      let ultimoError = "";
      for (const modelo of modelos) {
        try {
          const nuevas = await generarLote(clave, modelo, lote);
          for (const c of nuevas) {
            c.ejemplares.forEach((ej) => {
              ej.nombre = String(ej.nombre || "").trim().toUpperCase();
              ej.nacionalidad = normalizarNacionalidad(ej.nacionalidad, c.hipodromo);
            });
            const key = `${String(c.hipodromo || "").toUpperCase()}|${c.carrera ?? ""}`;
            const ex = key === "|" ? null : carreras.find((x) => `${String(x.hipodromo || "").toUpperCase()}|${x.carrera ?? ""}` === key);
            if (!ex) {
              carreras.push(c);
            } else {
              const nums = new Set((ex.ejemplares || []).map((e) => String(e.numero)));
              (c.ejemplares || []).forEach((e) => {
                if (!nums.has(String(e.numero))) {
                  ex.ejemplares.push(e);
                  nums.add(String(e.numero));
                }
              });
            }
          }
          okLote = true;
          diag.push(`lote ${hecho + 1}/${lotes.length} · modelo ${modelo} ✔ (${lote.length} págs)`);
          break;
        } catch (e) {
          ultimoError = e instanceof ErrorIA ? traducirErrorIA(e.status, e.detalle) : e instanceof Error ? e.message : String(e);
          diag.push(`lote ${hecho + 1}/${lotes.length} · modelo ${modelo} ✘`);
          await esperar(800);
        }
      }
      hecho += 1;
      onLote?.(hecho, lotes.length);
      if (!okLote) {
        return {
          ok: false,
          carreras: [],
          error: ultimoError || "Fallo de la IA al procesar el lote.",
          diag: `${diag.join(" · ")} · peso total enviado ${peso}`,
        };
      }
    }
    return { ok: true, carreras, diag: `${diag.join(" · ")} · peso total ${peso}` };
  } catch (e) {
    return { ok: false, carreras: [], error: e instanceof Error ? e.message : String(e), diag: `peso total enviado ${peso}` };
  }
}