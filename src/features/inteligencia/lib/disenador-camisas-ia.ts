// ============================================================================
// MOTOR DE DISEÑO DE CAMISAS Y DIVISAS DE STUD CON IA Y RECONOCIMIENTO VECTORIAL
// ============================================================================
// Interpreta las especificaciones de divisas publicadas en la Gaceta Hípica
// venezolana e internacional, traduciendo descripciones textuales en
// especificaciones vectoriales SVG de alta fidelidad:
//   - Patrones de cuerpo: Banda diagonal, franjas horizontales, rayas verticales,
//     estrellas, rombos, cuadros, V / chevron, lunares, mitad y mitad.
//   - Patrones de mangas: Lisas, aros/anillos, rayas, estrellas.
//   - Casco y visera.
//   - Soporte para Gemini API para descripciones complejas o poéticas.
// ============================================================================

export type PatronCuerpo =
  | "LISO"
  | "BANDA_DIAGONAL"
  | "FRANJA_HORIZONTAL"
  | "RAYAS_VERTICALES"
  | "CHEVRON_V"
  | "ESTRELLAS"
  | "CUADROS"
  | "ROMBOS"
  | "LUNARES"
  | "MITAD_MITAD"
  | "CRUZ";

export type PatronMangas =
  | "LISAS"
  | "AROS_ANILLOS"
  | "RAYAS"
  | "ESTRELLAS"
  | "MITADES";

export type DisenoCamisaCompleto = {
  colorCuerpoPrincipal: string;
  colorCuerpoSecundario: string;
  patronCuerpo: PatronCuerpo;
  colorMangasPrincipal: string;
  colorMangasSecundario: string;
  patronMangas: PatronMangas;
  colorGorro: string;
  colorVisera: string;
  colorCuello: string;
  detallesTexto?: string;
  fuenteIa?: boolean;
};

// Diccionario cromático estándar de divisas hípicas venezolanas
export const PALETA_DIVISAS_VENEZUELA: Record<string, string> = {
  BLANCO: "#FFFFFF",
  BLANCA: "#FFFFFF",
  BLANCAS: "#FFFFFF",
  NEGRO: "#0F172A",
  NEGRA: "#0F172A",
  NEGRAS: "#0F172A",
  AZUL: "#1D4ED8",
  AZULES: "#1D4ED8",
  CELESTE: "#0284C7",
  CIELO: "#38BDF8",
  MARINO: "#0F2B5C",
  ROJO: "#DC2626",
  ROJA: "#DC2626",
  ROJAS: "#DC2626",
  AMARILLO: "#EAB308",
  AMARILLA: "#EAB308",
  AMARILLAS: "#EAB308",
  VERDE: "#16A34A",
  VERDES: "#16A34A",
  LIMON: "#84CC16",
  NARANJA: "#EA580C",
  ANARANJADO: "#EA580C",
  MORADO: "#7E22CE",
  MORADA: "#7E22CE",
  LILA: "#A855F7",
  GRIS: "#64748B",
  PLATEADO: "#94A3B8",
  PLATA: "#94A3B8",
  ROSADO: "#EC4899",
  ROSADA: "#EC4899",
  FUCSIA: "#D946EF",
  TURQUESA: "#06B6D4",
  MARRON: "#78350F",
  CAFE: "#78350F",
  ORO: "#D97706",
  DORADO: "#D97706",
  DORADA: "#D97706",
  VINO: "#881337",
  VINOTINTO: "#881337",
  GRANATE: "#881337",
};

const CLAVE_CACHE_CAMISAS = "hipico_disenos_camisas_cache";

/** Lee el cache persistente de diseños de camisas */
function leerCacheLocal(): Record<string, DisenoCamisaCompleto> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(CLAVE_CACHE_CAMISAS);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/** Guarda en el cache persistente */
function guardarEnCacheLocal(clave: string, diseno: DisenoCamisaCompleto): void {
  if (typeof window === "undefined") return;
  try {
    const cache = leerCacheLocal();
    cache[clave.trim().toLowerCase()] = diseno;
    window.localStorage.setItem(CLAVE_CACHE_CAMISAS, JSON.stringify(cache));
  } catch {
    // ignorar cuota
  }
}

/**
 * Busca un color hex en el texto dado
 */
export function buscarColorEnTexto(texto: string, porDefecto: string): string {
  const t = texto.toUpperCase();
  for (const [nombre, hex] of Object.entries(PALETA_DIVISAS_VENEZUELA)) {
    // Usar límite de palabra para evitar falsos positivos
    const regex = new RegExp(`\\b${nombre}\\b`, "i");
    if (regex.test(t)) {
      return hex;
    }
  }
  return porDefecto;
}

/**
 * Extrae dos colores contrastantes de un fragmento de texto
 * Ej: "AZUL Y BLANCO", "ROJO CON ESTRELLAS DORADAS"
 */
function extraerDosColores(texto: string, primDefecto: string, secDefecto: string): { prim: string; sec: string } {
  const palabras = texto.toUpperCase().split(/[^A-ZÁÉÍÓÚÑ]+/);
  const coloresEncontrados: string[] = [];

  for (const p of palabras) {
    if (PALETA_DIVISAS_VENEZUELA[p] && !coloresEncontrados.includes(PALETA_DIVISAS_VENEZUELA[p])) {
      coloresEncontrados.push(PALETA_DIVISAS_VENEZUELA[p]);
    }
  }

  const prim = coloresEncontrados[0] ?? primDefecto;
  const sec = coloresEncontrados[1] ?? (prim === "#FFFFFF" ? "#0F172A" : "#FFFFFF");
  return { prim, sec };
}

/**
 * Detecta el patrón geométrico del cuerpo de la camisa a partir del texto
 */
function detectarPatronCuerpo(texto: string): PatronCuerpo {
  const t = texto.toUpperCase();

  if (/\b(ESTRELLA|ESTRELLAS)\b/.test(t)) return "ESTRELLAS";
  if (/\b(BANDA|DIAGONAL|CRUZADA|BANDA DIAGONAL)\b/.test(t)) return "BANDA_DIAGONAL";
  if (/\b(FRANJA|FAJA|HOOPS|HORIZONTAL|FRANJAS HORIZONTALES)\b/.test(t)) return "FRANJA_HORIZONTAL";
  if (/\b(RAYA|RAYAS|LISTA|LISTAS|VERTICAL|VERTICALES)\b/.test(t)) return "RAYAS_VERTICALES";
  if (/\b(V|CHEVRON|VE)\b/.test(t)) return "CHEVRON_V";
  if (/\b(CUADRO|CUADROS|DAMERO|AJEDREZ|AJEDREZADO)\b/.test(t)) return "CUADROS";
  if (/\b(ROMBO|ROMBOS|DIAMANTE|DIAMANTES|ARLEQUIN)\b/.test(t)) return "ROMBOS";
  if (/\b(LUNAR|LUNARES|CIRCULO|CIRCULOS|PUNTOS|MOTEADO)\b/.test(t)) return "LUNARES";
  if (/\b(MITAD|MITADES|DIVIDIDA|BICOLOR)\b/.test(t)) return "MITAD_MITAD";
  if (/\b(CRUZ|LORENA|SANTIAGO)\b/.test(t)) return "CRUZ";

  return "LISO";
}

/**
 * Detecta el patrón de las mangas a partir del texto
 */
function detectarPatronMangas(texto: string): PatronMangas {
  const t = texto.toUpperCase();
  if (/\b(ARO|AROS|ANILLO|ANILLOS|BRAZALETE|BRAZALETES)\b/.test(t)) return "AROS_ANILLOS";
  if (/\b(RAYA|RAYAS|LISTAS)\b/.test(t)) return "RAYAS";
  if (/\b(ESTRELLA|ESTRELLAS)\b/.test(t)) return "ESTRELLAS";
  if (/\b(DISTINTAS|UNA Y UNA)\b/.test(t)) return "MITADES";
  return "LISAS";
}

/**
 * Motor de Procesamiento Lingüístico Hípico (Analizador Sintáctico de Divisas)
 * Procesa expresiones clásicas venezolanas e internacionales con tolerancia total a abreviaturas:
 *   "C: AZUL CON ESTRELLAS BLANCAS, M: ROJAS CON AROS BLANCOS, G: AMARILLA"
 *   "BLANCA CON BANDA ROJA, MANGAS Y GORRA AZUL"
 *   "AMARILLO Y VERDE A CUADROS"
 */
export function interpretarDivisaAvanzada(divisaTexto?: string, studNombre?: string): DisenoCamisaCompleto {
  const textoBase = (divisaTexto || studNombre || "").trim();
  if (!textoBase) {
    return {
      colorCuerpoPrincipal: "#1D4ED8",
      colorCuerpoSecundario: "#FFFFFF",
      patronCuerpo: "LISO",
      colorMangasPrincipal: "#1D4ED8",
      colorMangasSecundario: "#FFFFFF",
      patronMangas: "LISAS",
      colorGorro: "#DC2626",
      colorVisera: "#0F172A",
      colorCuello: "#FFFFFF",
      detallesTexto: "Estándar Clásico",
      fuenteIa: false,
    };
  }

  // Verificar en cache local
  const cache = leerCacheLocal();
  if (cache[textoBase.toLowerCase()]) {
    return cache[textoBase.toLowerCase()];
  }

  const upper = textoBase.toUpperCase();

  // Partición sintáctica en componentes: C (Camisa), M (Mangas), G (Gorra)
  const regexC = /(?:^|[,;\s])(?:C\.|C:|CAMISA|CUERPO)\s*[:\s]?\s*([^,;]+?)(?=[,;\s]+(?:M\.|M:|MANGAS|G\.|G:|GORRA|GORRO|CASCO)|$)/i;
  const regexM = /(?:^|[,;\s])(?:M\.|M:|MANGAS)\s*[:\s]?\s*([^,;]+?)(?=[,;\s]+(?:C\.|C:|CAMISA|CUERPO|G\.|G:|GORRA|GORRO|CASCO)|$)/i;
  const regexG = /(?:^|[,;\s])(?:G\.|G:|GORRA|GORRO|CASCO)\s*[:\s]?\s*([^,;]+?)(?=[,;\s]+(?:C\.|C:|CAMISA|CUERPO|M\.|M:|MANGAS)|$)/i;

  const matchC = upper.match(regexC);
  const matchM = upper.match(regexM);
  const matchG = upper.match(regexG);

  let seccionCuerpo = matchC ? matchC[1].trim() : "";
  const seccionMangas = matchM ? matchM[1].trim() : "";
  const seccionGorra = matchG ? matchG[1].trim() : "";

  // Si no hubo "C:", tomar la parte previa a "MANGAS" o "GORRA", o todo el texto
  if (!seccionCuerpo) {
    const parteAntesDeMangas = upper.split(/(?:M\.|M:|MANGAS|G\.|G:|GORRA|GORRO|CASCO)\b/i)[0];
    seccionCuerpo = (parteAntesDeMangas || upper).replace(/^[,;\s]+|[,;\s]+$/g, "");
  }

  // 1. Cuerpo
  const coloresCuerpo = extraerDosColores(seccionCuerpo, "#1D4ED8", "#FFFFFF");
  const patronCuerpo = detectarPatronCuerpo(seccionCuerpo);

  // 2. Mangas
  let coloresMangas: { prim: string; sec: string };
  let patronMangas: PatronMangas = "LISAS";

  if (seccionMangas) {
    coloresMangas = extraerDosColores(seccionMangas, coloresCuerpo.prim, coloresCuerpo.sec);
    patronMangas = detectarPatronMangas(seccionMangas);
  } else {
    // Si no se especifican mangas, heredan el color principal del cuerpo
    coloresMangas = {
      prim: coloresCuerpo.prim,
      sec: coloresCuerpo.sec,
    };
  }

  // 3. Gorro / Casco
  let colorGorro = "#DC2626";
  if (seccionGorra) {
    colorGorro = buscarColorEnTexto(seccionGorra, coloresCuerpo.sec);
  } else {
    colorGorro = coloresCuerpo.prim === "#DC2626" ? "#EAB308" : "#DC2626";
  }

  const colorVisera = colorGorro === "#0F172A" ? "#FFFFFF" : "#0F172A";

  const resultado: DisenoCamisaCompleto = {
    colorCuerpoPrincipal: coloresCuerpo.prim,
    colorCuerpoSecundario: coloresCuerpo.sec,
    patronCuerpo,
    colorMangasPrincipal: coloresMangas.prim,
    colorMangasSecundario: coloresMangas.sec,
    patronMangas,
    colorGorro,
    colorVisera,
    colorCuello: coloresCuerpo.sec,
    detallesTexto: textoBase,
    fuenteIa: false,
  };

  guardarEnCacheLocal(textoBase, resultado);
  return resultado;
}

/**
 * Consulta la API de Google Gemini para diseñar la camisa con IA
 * Analiza matices artísticos complejos de la Gaceta Hípica y devuelve el JSON estructurado
 */
export async function disenarCamisaConGeminiIa(
  divisaTexto: string,
  studNombre?: string
): Promise<DisenoCamisaCompleto | null> {
  if (typeof window === "undefined") return null;

  const texto = (divisaTexto || studNombre || "").trim();
  if (!texto) return null;

  // Obtener API Key de Gemini
  let apiKey = "";
  try {
    apiKey = window.localStorage.getItem("club_gemini_key") || "";
  } catch {
    // ignorar
  }
  if (!apiKey) {
    apiKey = (process.env.NEXT_PUBLIC_GEMINI_API_KEY || "").trim();
  }

  // Si no hay API key disponible, el motor local ya genera un diseño perfecto
  if (!apiKey) return null;

  const prompt = `Actúa como Director de Arte y Diseñador Gráfico de Chaquetillas y Divisas de Studs Hípicos (Gaceta Hípica).
Analiza la siguiente divisa y produce el diseño vectorial estructurado en formato JSON estrictamente:
TEXTO DE DIVISA / STUD: "${texto}"

Valores permitidos para patronCuerpo:
"LISO", "BANDA_DIAGONAL", "FRANJA_HORIZONTAL", "RAYAS_VERTICALES", "CHEVRON_V", "ESTRELLAS", "CUADROS", "ROMBOS", "LUNARES", "MITAD_MITAD", "CRUZ"

Valores permitidos para patronMangas:
"LISAS", "AROS_ANILLOS", "RAYAS", "ESTRELLAS", "MITADES"

Colores en formato HEX válido (#RRGGBB).
Responde ÚNICAMENTE un bloque JSON sin texto extra:
{
  "colorCuerpoPrincipal": "#...",
  "colorCuerpoSecundario": "#...",
  "patronCuerpo": "...",
  "colorMangasPrincipal": "#...",
  "colorMangasSecundario": "#...",
  "patronMangas": "...",
  "colorGorro": "#...",
  "colorVisera": "#...",
  "colorCuello": "#..."
}`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 500,
          },
        }),
      }
    );

    if (!res.ok) return null;
    const data = await res.json();
    const candidateText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!candidateText) return null;

    let cleanJson = candidateText.trim();
    const match = cleanJson.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) cleanJson = match[1].trim();

    const parsed = JSON.parse(cleanJson);
    if (parsed && parsed.colorCuerpoPrincipal) {
      const disenoIa: DisenoCamisaCompleto = {
        colorCuerpoPrincipal: parsed.colorCuerpoPrincipal || "#1D4ED8",
        colorCuerpoSecundario: parsed.colorCuerpoSecundario || "#FFFFFF",
        patronCuerpo: parsed.patronCuerpo || "LISO",
        colorMangasPrincipal: parsed.colorMangasPrincipal || "#1D4ED8",
        colorMangasSecundario: parsed.colorMangasSecundario || "#FFFFFF",
        patronMangas: parsed.patronMangas || "LISAS",
        colorGorro: parsed.colorGorro || "#DC2626",
        colorVisera: parsed.colorVisera || "#0F172A",
        colorCuello: parsed.colorCuello || "#FFFFFF",
        detallesTexto: texto,
        fuenteIa: true,
      };

      guardarEnCacheLocal(texto, disenoIa);
      return disenoIa;
    }
  } catch (err) {
    console.warn("No se pudo conectar a Gemini para diseño de divisa, usando motor local:", err);
  }

  return null;
}
