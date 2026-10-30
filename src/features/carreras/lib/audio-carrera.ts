import { expandirLineaHablada } from "@/features/taquilla/lib/normalizar";
import { CLAVE_GEMINI_KEY, MODELOS_GEMINI } from "@/features/gaceta/lib/ia";

export type EjemplarDictado = {
  numero: string;
  nombre: string;
  nacionalidad?: string;
  valor?: number;
};

export type InterpretacionAudioCarrera = {
  textoOriginal: string;
  textoNormalizado: string;
  carrera?: string;
  rangoCarreras?: { desde: number; hasta: number };
  cantidadEjemplares?: number;
  ejemplaresLista: EjemplarDictado[];
  ejemplaresTexto: string;
  distancia?: string;
  superficie?: string;
  premio?: string;
  hora?: string;
  retirados?: string;
  resumen: string[];
};

const ORDINALES_CARRERA: Record<string, number> = {
  primera: 1,
  primer: 1,
  segunda: 2,
  segundo: 2,
  tercera: 3,
  tercer: 3,
  cuarta: 4,
  quinta: 5,
  sexta: 6,
  septima: 7,
  séptima: 7,
  octava: 8,
  novena: 9,
  decima: 10,
  décima: 10,
  undecima: 11,
  undécima: 11,
  duodecima: 12,
  duodécima: 12,
};

/**
 * Normaliza palabras habladas comunes en dictado hípico de carreras y ejemplares.
 */
export function normalizarTextoAudioCarrera(raw: string): string {
  let t = String(raw ?? "")
    .replace(/[;]+/g, "\n")
    .trim();

  // Reemplazar ordinales junto a "carrera" (ej. "tercera carrera" -> "carrera 3")
  t = t.replace(
    /\b(primera|primer|segunda|segundo|tercera|tercer|cuarta|quinta|sexta|s[eé]ptima|octava|novena|d[eé]cima|und[eé]cima|duod[eé]cima)\s+carrera\b/gi,
    (_, ord: string) => `carrera ${ORDINALES_CARRERA[ord.toLowerCase()] ?? 1}`
  );

  // Expandir números hablados línea por línea
  const lineas = t
    .split(/\r?\n/)
    .map((l) => expandirLineaHablada(l.toLowerCase()).texto)
    .join("\n");

  return lineas;
}

/**
 * Interpreta un dictado de voz o transcripción de audio para configurar o cargar
 * una carrera (o lote de carreras) y sus ejemplares desde el celular.
 *
 * Ejemplos soportados:
 *  - "Carrera 3 con 12 ejemplares 1600 metros arena premio 5000 hora 14:30 retirados 2 y 5"
 *  - "De la carrera 1 a la 9 con 12 caballos"
 *  - "Carrera 1 ejemplares 1 Duque de Alba 150, 2 Gato Negro 120, 3 Reina del Sur"
 *  - "1 Alfombra, 2 Quinto Patio, 3 Relámpago, 4 Centella"
 */
export function interpretarAudioCarrera(raw: string): InterpretacionAudioCarrera {
  const textoOriginal = String(raw ?? "").trim();
  const norm = normalizarTextoAudioCarrera(textoOriginal);
  const plano = norm.replace(/\n+/g, " ").replace(/\s+/g, " ").trim();
  const resumen: string[] = [];

  let carrera: string | undefined;
  let rangoCarreras: { desde: number; hasta: number } | undefined;
  let cantidadEjemplares: number | undefined;
  let distancia: string | undefined;
  let superficie: string | undefined;
  let premio: string | undefined;
  let hora: string | undefined;
  let retirados: string | undefined;

  // 1. Rango de carreras en lote: "de la carrera 1 a la 8", "carreras 1 a 10", "10 carreras"
  const mRango =
    plano.match(/\b(?:de\s+la\s+)?carreras?\s+(\d{1,2})\s*(?:a\s+la|al|a|hasta\s+la|hasta|-)\s*(\d{1,2})\b/i) ||
    plano.match(/\bdel?\s+(\d{1,2})\s+al?\s+(\d{1,2})\s+carreras?\b/i);
  if (mRango) {
    const d = Number(mRango[1]);
    const h = Number(mRango[2]);
    if (d >= 1 && h >= d && h <= 20) {
      rangoCarreras = { desde: d, hasta: h };
      carrera = String(d);
      resumen.push(`Lote C${d}–C${h}`);
    }
  } else {
    const mTotalCarreras = plano.match(/\b(?:cargar|registrar|crear)\s+(\d{1,2})\s+carreras?\b/i);
    if (mTotalCarreras) {
      const tot = Number(mTotalCarreras[1]);
      if (tot >= 2 && tot <= 20) {
        rangoCarreras = { desde: 1, hasta: tot };
        carrera = "1";
        resumen.push(`Lote C1–C${tot}`);
      }
    }
  }

  // 2. Número de carrera individual: "carrera 4", "carrera numero 4", "c4"
  if (!carrera) {
    const mCarrera =
      plano.match(/\bcarrera\s*(?:n[uú]mero|nro|n[°º])?\s*(\d{1,2})\b/i) ||
      plano.match(/\bc\s*(\d{1,2})\b/i);
    if (mCarrera) {
      const n = Number(mCarrera[1]);
      if (n >= 1 && n <= 25) {
        carrera = String(n);
        resumen.push(`Carrera C${n}`);
      }
    }
  }

  // 3. Cantidad de ejemplares: "12 ejemplares", "con 10 caballos", "14 inscritos"
  const mCant = plano.match(/\b(?:con\s+|de\s+)?(\d{1,2})\s+(?:ejemplares|caballos|inscritos|participantes)\b/i);
  if (mCant) {
    const cant = Number(mCant[1]);
    if (cant >= 1 && cant <= 30) {
      cantidadEjemplares = cant;
      resumen.push(`${cant} ejemplares`);
    }
  }

  // 4. Distancia: "1600 metros", "distancia 1200", "1400 mts"
  const mDist =
    plano.match(/\bdistancia\s*(?:de\s*)?(\d{3,4})\b/i) ||
    plano.match(/\b(\d{3,4})\s*(?:metros|mts|m)\b/i);
  if (mDist) {
    distancia = mDist[1];
    resumen.push(`${distancia}m`);
  }

  // 5. Superficie: arena, pasto, césped, sintética, tapeta, fango
  const mSup = plano.match(/\b(arena|pasto|c[eé]sped|grama|sint[eé]tica|tapeta|fango|h[ií]pica)\b/i);
  if (mSup) {
    const s = mSup[1].toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    superficie = s === "GRAMA" ? "PASTO" : s;
    resumen.push(superficie);
  }

  // 6. Premio: "premio 5000", "bolsa 2500"
  const mPremio = plano.match(/\b(?:premio|bolsa)\s*(?:de\s*)?(?:\$|usd|bs)?\s*(\d+(?:[.,]\d+)?)\b/i);
  if (mPremio) {
    premio = mPremio[1].replace(",", ".");
    resumen.push(`Premio ${premio}`);
  }

  // 7. Hora: "hora 14 30", "hora 2:30", "a las 3 y 15"
  const mHora =
    plano.match(/\b(?:hora|a\s+las)\s*(\d{1,2})(?:\s*[:y]\s*|\s+)(\d{2})\b/i) ||
    plano.match(/\b(\d{1,2}):(\d{2})\b/);
  if (mHora) {
    const hh = mHora[1].padStart(2, "0");
    const mm = mHora[2].padStart(2, "0");
    hora = `${hh}:${mm}`;
    resumen.push(`Hora ${hora}`);
  }

  // 8. Retirados: "retirados 2 y 5", "retirado el 3"
  const mRet = plano.match(/\bretirados?\s+(?:el\s+|los\s+)?([0-9,\s]+(?:\s+y\s+\d{1,2})?)/i);
  if (mRet) {
    const nums = mRet[1].match(/\d{1,2}/g) ?? [];
    if (nums.length > 0) {
      retirados = [...new Set(nums)].join(",");
      resumen.push(`Retirados: ${retirados}`);
    }
  }

  // 9. Lista de ejemplares con nombre (p. ej. "1 Duque de Alba 150, 2 Gato Negro 120" o "número 1 Relámpago número 2 Trueno")
  const ejemplaresLista: EjemplarDictado[] = [];
  // Limpiamos partes de metadatos ya extraídas para buscar ejemplares con nombre
  let cuerpoCaballos = norm
    .replace(/\b(?:de\s+la\s+)?carreras?\s+\d{1,2}\s*(?:a\s+la|al|a|hasta\s+la|hasta|-)\s*\d{1,2}\b/gi, " ")
    .replace(/\bcarrera\s*(?:n[uú]mero|nro|n[°º])?\s*\d{1,2}\b/gi, " ")
    .replace(/\b(?:con\s+|de\s+)?\d{1,2}\s+(?:ejemplares|caballos|inscritos|participantes)\b/gi, " ")
    .replace(/\bdistancia\s*(?:de\s*)?\d{3,4}\b/gi, " ")
    .replace(/\b\d{3,4}\s*(?:metros|mts|m)\b/gi, " ")
    .replace(/\b(?:superficie\s+)?(arena|pasto|c[eé]sped|grama|sint[eé]tica|tapeta|fango|h[ií]pica)\b/gi, " ")
    .replace(/\b(?:premio|bolsa)\s*(?:de\s*)?(?:\$|usd|bs)?\s*\d+(?:[.,]\d+)?\b/gi, " ")
    .replace(/\b(?:hora|a\s+las)\s*\d{1,2}(?:\s*[:y]\s*|\s+)\d{2}\b/gi, " ")
    .replace(/\bretirados?\s+(?:el\s+|los\s+)?[0-9,\s]+(?:\s+y\s+\d{1,2})?/gi, " ")
    .replace(/\b(?:ejemplares|caballos|inscritos)\s*[:,-]?\s*/gi, " ");

  // Separar por saltos de línea, comas, o antes de "número X" / "caballo X" / "el X"
  cuerpoCaballos = cuerpoCaballos
    .replace(/[,]+/g, "\n")
    .replace(/\b(?:n[uú]mero|nro|caballo|ejemplar|chaleco)\s+(\d{1,2})\b/gi, "\n$1 ")
    .replace(/\s+(?=\d{1,2}\s+[a-záéíóúñ]{2,})/gi, "\n");

  for (const rawLinea of cuerpoCaballos.split(/\n+/)) {
    const lin = rawLinea.trim().replace(/\s+/g, " ");
    if (!lin) continue;
    const mEj = lin.match(/^(\d{1,2})\s+([a-záéíóúñ][a-záéíóúñ0-9\s'.-]*?)(?:\s+(\d+(?:[.,]\d+)?))?$/i);
    if (mEj) {
      const num = mEj[1];
      const nombre = mEj[2]
        .replace(/\b(valor|precio|con|de|pesos|dolares|dólares)\b/gi, "")
        .trim()
        .toUpperCase();
      const val = mEj[3] ? Number(mEj[3].replace(",", ".")) : undefined;
      if (nombre && nombre.length >= 2 && !/^(CARRERA|METROS|EJEMPLARES|CABALLOS|RETIRADOS)$/i.test(nombre)) {
        ejemplaresLista.push({
          numero: num,
          nombre,
          valor: Number.isFinite(val) ? val : undefined,
        });
      }
    }
  }

  let ejemplaresTexto = "";
  if (ejemplaresLista.length > 0) {
    ejemplaresTexto = ejemplaresLista
      .map((e) => (e.valor ? `${e.numero} ${e.nombre} ${e.valor}` : `${e.numero} ${e.nombre}`))
      .join("\n");
    resumen.push(`${ejemplaresLista.length} ejemplar(es) con nombre`);
  } else if (cantidadEjemplares) {
    ejemplaresTexto = String(cantidadEjemplares);
  } else if (/^\d{1,2}$/.test(plano)) {
    cantidadEjemplares = Number(plano);
    ejemplaresTexto = plano;
    resumen.push(`${cantidadEjemplares} ejemplares`);
  }

  return {
    textoOriginal,
    textoNormalizado: norm,
    carrera,
    rangoCarreras,
    cantidadEjemplares,
    ejemplaresLista,
    ejemplaresTexto,
    distancia,
    superficie,
    premio,
    hora,
    retirados,
    resumen,
  };
}

/**
 * Divide un dictado continuo de jugadas por voz en líneas individuales listas
 * para el normalizador difuso (`normalizarLineaRapida`).
 *
 * Soporta separadores hablados como:
 *  - "otra", "otra jugada", "siguiente", "punto", "aparte"
 *  - o múltiples cláusulas que comienzan con "juega ..."
 */
export function formatearDictadoJugadas(raw: string): string {
  const limpio = String(raw ?? "")
    .replace(/\b(otra\s+jugada|siguiente\s+jugada|otra\s+linea|otra\s+l[ií]nea|punto\s+y\s+aparte|nueva\s+jugada|siguiente)\b/gi, "\n")
    .replace(/[;]+/g, "\n")
    // Si dicen "... da Juan juega Pedro ..." separamos antes de "juega"
    .replace(/\s+(?=juega\s+[a-záéíóúñ])/gi, "\n");

  return limpio
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => expandirLineaHablada(l.toLowerCase()).texto)
    .join("\n");
}

function archivoABase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = String(reader.result ?? "");
      const base64 = res.includes(",") ? res.split(",")[1] : res;
      resolve(base64);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/**
 * Transcribe un archivo de audio (nota de voz de WhatsApp, grabación del celular)
 * usando Gemini Multimodal si hay API Key disponible.
 */
export async function transcribirArchivoAudioConIA(
  file: File,
  modo: "carrera" | "jugadas" = "carrera"
): Promise<{ ok: boolean; texto: string; error?: string }> {
  try {
    const apiKey =
      (typeof window !== "undefined" ? localStorage.getItem(CLAVE_GEMINI_KEY) : null) ||
      process.env.NEXT_PUBLIC_GEMINI_API_KEY ||
      "";
    if (!apiKey.trim()) {
      return {
        ok: false,
        texto: "",
        error: "Usa el botón 🎙️ Dictar en vivo (gratis en el navegador) o configura tu clave Gemini en Carga de Gaceta (IA) para subir archivos de audio.",
      };
    }

    const base64 = await archivoABase64(file);
    const mimeType = file.type || "audio/mp3";
    const prompt =
      modo === "carrera"
        ? "Transcribe este audio hípico en español. Si menciona número de carrera, cantidad de ejemplares, distancia, superficie, hora, retirados o lista de caballos (número y nombre), escríbelo de forma clara. Ejemplo: 'Carrera 3 con 12 ejemplares 1600 metros arena retirados 2,5' o una línea por ejemplar '1 NOMBRE VALOR'. Devuelve SOLO la transcripción limpia sin explicaciones."
        : "Transcribe este audio de apuestas hípicas en español. Escribe una jugada por línea con el formato: JUGADA CABALLO MONTO CLIENTE1 CLIENTE2 (ejemplo: '2p 5 100 PEDRO JUAN' o tal cual se escuche cada jugada en su propia línea). Devuelve SOLO las líneas transcritas sin explicaciones.";

    for (const modelo of MODELOS_GEMINI) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${encodeURIComponent(apiKey.trim())}`;
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: prompt },
                { inline_data: { mime_type: mimeType, data: base64 } },
              ],
            },
          ],
          generationConfig: { temperature: 0.1 },
        }),
      });
      if (!resp.ok) continue;
      const json = (await resp.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const texto = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("\n").trim() ?? "";
      if (texto) return { ok: true, texto };
    }

    return { ok: false, texto: "", error: "No se pudo transcribir el archivo de audio con IA." };
  } catch (e) {
    return {
      ok: false,
      texto: "",
      error: e instanceof Error ? e.message : "Error al procesar el archivo de audio.",
    };
  }
}
