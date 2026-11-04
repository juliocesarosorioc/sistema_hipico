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
  compararEjemplares,
  fusionarCarrerasSinPerder,
  numeroDeCarrera,
  ordenarCarrerasYEjemplares,
  repararNumerosCarreras,
  type ReporteReparacion,
} from "@/features/gaceta/lib/numeros";
import { armarBloques, consolidarPorNumero, segmentarPorCarreras } from "@/features/gaceta/lib/segmentar";
import type { CarreraRegistro } from "@/features/gaceta/lib/ui";

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
  archivoOrigen?: string;
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
  "AQUEDUCT", "BELMONT PARK", "CHARLES TOWN", "CHURCHILL DOWNS", "DELTA DOWNS",
  "EVANGELINE DOWNS", "FAIR GROUNDS", "FINGER LAKES", "GOLDEN GATE FIELDS", "GULFSTREAM PARK",
  "HAWTHORNE", "HORSESHOE INDIANAPOLIS", "KEENELAND", "LAUREL PARK", "LOS ALAMITOS",
  "MAHONING VALLEY", "MONMOUTH PARK", "MOUNTAINEER", "OAKLAWN PARK", "PARX RACING",
  "PENN NATIONAL", "PIMLICO", "REMINGTON PARK", "SANTA ANITA", "SARATOGA",
  "SUNLAND PARK", "TAMPA BAY DOWNS", "TURF PARADISE", "WOODBINE", "DEL MAR",
];

const SYS = `Eres el transcriptor oficial de máxima precisión para gacetas hípicas (Venezuela y Estados Unidos).
Recibes páginas escaneadas, texto o imágenes del programa oficial de carreras.

REGLAS CRÍTICAS DE ORDENAMIENTO, VERIFICACIÓN MINUCIOSA DE NÚMEROS/NOMBRES Y COMPLETITUD:
1. ORDEN SECUENCIAL ESTRICTO DE CARRERAS:
   - Las carreras DEBEN devolverse ordenadas de forma estrictamente secuencial y correlativa: Carrera 1, Carrera 2, Carrera 3, ..., Carrera N.
   - NUNCA devuelvas carreras salteadas, desordenadas ni repetidas.
2. VERIFICACIÓN MINUCIOSA DEL NÚMERO DE EJEMPLAR ("numero"):
   - "numero" es ÚNICAMENTE el número oficial de dorsal/gualdrapa/programa con el que corre el caballo (1, 1A, 2, 2A, 3, 4, ..., 16).
   - PROHIBIDO confundir "numero" con:
     * El peso en kilos o libras (ej. 50, 52, 53, 54, 55, 56, 118, 120, 122, 124). Un dorsal NUNCA es > 24.
     * La edad del caballo (2a, 3a, 4a, 5a).
     * Llegadas de carreras anteriores (1º, 2º, 3º) ni dividendos Morning Line (5/2, 3-1).
     * El Puesto de Partida / Puesto de Pista ("pp") cuando difiere del dorsal (ej. en llaves 1/1A o elegibles AE/MTO).
   - Verifica la secuencia correlativa 1, 2, 3, ..., N dentro de cada carrera. Si pasas del 3 al 5, busca minuciosamente el ejemplar #4 en el texto/imagen antes de continuar.
3. VERIFICACIÓN MINUCIOSA DEL NOMBRE DEL EJEMPLAR ("nombre"):
   - Transcribe letra por letra el nombre oficial exacto del caballo en MAYÚSCULAS (ej: "MAXIMUM SECURITY", "EL GRAN SOL", "MI QUERIDA EMMA").
   - PROHIBIDO incluir dentro de "nombre":
     * El número de dorsal o PP al inicio (NO pongas "1 MAXIMUM SECURITY" ni "#3 EL GRAN SOL").
     * El país entre paréntesis (NO pongas "GRAN SOL (VEN)" ni "STAR (USA)"; pon el país en "nacionalidad").
     * Medicamentos o implementos como "(L)", "(L1)", "(B)", "BB, V, Gr" (esos van en "medicamento" / "implementos").
     * El pedigrí (padre, madre, abuelo), sexo/edad ("C.A. 4a"), peso ("53 Kg"), ni el nombre del jinete o entrenador.
   - NUNCA inventes, abrevies ni sustituyas letras del nombre del caballo.
4. ORDEN ASCENDENTE ESTRICTO DE EJEMPLARES:
   - Dentro del array "ejemplares" de cada carrera, los caballos DEBEN listarse rigurosamente ordenados por su número oficial de dorsal/gualdrapa de menor a mayor (1, 1A, 2, 2A, 3, 4, ..., 12, 13, 14).
5. COMPLETITUD TOTAL (CERO OMISIONES):
   - Extrae ABSOLUTAMENTE TODOS los ejemplares participantes de cada carrera sin omitir ninguno.
   - Si una carrera tiene 12 inscritos, el array de ejemplares debe contener exactamente los 12 participantes.
   - Incluye ejemplares elegibles (AE - Also Eligible), sólo pista principal (MTO - Main Track Only) y retirados (SCR).
6. EXTRACCIÓN Y NORMALIZACIÓN DE DISTANCIAS:
   - Purasangres (Thoroughbreds): 1000m, 1100m, 1200m, 1300m, 1400m, 1500m, 1600m, 1700m, 1800m, 1900m, 2000m, 2200m, 2400m. Si viene en Furlongs (f): 5f=1000m, 5.5f=1100m, 6f=1200m, 6.5f=1300m, 7f=1400m, 8f/1m=1600m, 8.5f=1700m, 9f=1800m, 10f=2000m, 12f=2400m.
   - Quarter Horses (Cuarto de Milla): 200m (220y), 228m (250y), 272m (300y), 300m (330y), 318m (350y), 364m (400y), 400m (440y), 500m (550y).
7. EXTRACCIÓN AUTOMÁTICA DE FECHA DEL ENCABEZADO:
   - Extrae la fecha de la reunión del encabezado de la página (ej: "04Nov26", "November 4, 2026", "Miércoles 4 de Noviembre 2026") y devuélvela en formato ISO YYYY-MM-DD.
8. VENEZUELA (LA RINCONADA / VALENCIA - 5 Y 6):
   - Las carreras válidas del 5 y 6 (tituladas "1ª VÁLIDA", "2ª VÁLIDA", ..., "6ª VÁLIDA") NO reinician la numeración en 1.
   - Mapea siempre al número correlativo general de la reunión (ej: Carrera 5 a 10, o Carrera 7 a 12 según las no válidas previas).

Estructura de salida JSON para cada carrera:
- carrera: número entero de la carrera (1, 2, 3...)
- hipodromo: nombre oficial en MAYÚSCULAS (ej: "CHURCHILL DOWNS", "CHARLES TOWN", "DELTA DOWNS", "LA RINCONADA", "VALENCIA")
- fecha: YYYY-MM-DD si es legible en el encabezado, si no null
- distancia: distancia en metros (entero, ej: 1200, 1400, 1600, 300, 364)
- superficie: ARENA, CESPED, FANGO o TAPETA
- premio: número si aparece, si no 0
- ejemplares: lista de objetos con:
  - numero: dorsal del caballo (1, 2, 3, 1A, 13, 14...)
  - pp: puesto de pista (entero o null)
  - nombre: nombre exacto en MAYÚSCULAS limpio (ej: "MAXIMUM SECURITY")
  - nacionalidad: USA, VE, etc.
  - valor: 0
  - jockey, entrenador, peso, medicamento, implementos si aparecen legibles (si no, null).

Si el documento no tiene carreras, devuelve {"carreras":[]}. Responde ÚNICAMENTE con JSON válido.`;

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

const MAPA_PAISES_PARENTESIS: Record<string, string> = {
  VE: "VE",
  VEN: "VE",
  US: "USA",
  USA: "USA",
  KY: "USA",
  FL: "USA",
  NY: "USA",
  CA: "USA",
  PA: "USA",
  MD: "USA",
  WV: "USA",
  LA: "USA",
  OH: "USA",
  IN: "USA",
  OK: "USA",
  TX: "USA",
  AR: "AR",
  ARG: "AR",
  BR: "BR",
  BRZ: "BR",
  CL: "CL",
  CHI: "CL",
  PE: "PE",
  PER: "PE",
  CO: "CO",
  COL: "CO",
  UY: "UY",
  URU: "UY",
  PA_NAC: "PA",
  PAN: "PA",
  MX: "MX",
  MEX: "MX",
  EC: "EC",
  ECU: "EC",
};

/**
 * Limpia y normaliza el número de dorsal/gualdrapa de un ejemplar.
 * Evita prefijos como "#", "Nº", "PP", ceros a la izquierda ("03" -> 3)
 * y descarta pesos (50..62 kg o 110..130 lbs) mal asignados como dorsal.
 */
function limpiarNumeroEjemplar(rawNum: unknown): string | number {
  const s = String(rawNum ?? "")
    .trim()
    .toUpperCase()
    .replace(/^(?:N[º°.]?|DORSAL|GUALDRAPA|CABALLO|EJEMPLAR|PP|#)\s*/i, "")
    .replace(/[().]/g, "")
    .trim();
  if (!s) return "";
  const m = s.match(/^0*(\d{1,3})\s*([A-Z]?)$/);
  if (m) {
    const n = parseInt(m[1], 10);
    const suf = m[2] || "";
    if (n > 0 && n <= 24) {
      return suf ? `${n}${suf}` : n;
    }
    // Si n > 24 (ej. peso 53, 54, 120 lbs), no es un dorsal válido
    return "";
  }
  return s;
}

/**
 * Limpia minuciosamente el nombre del ejemplar:
 * - Extrae nacionalidad si viene al final entre paréntesis: "GRAN SOL (VEN)" -> "GRAN SOL", nac="VE"
 * - Quita etiquetas de medicamento o condición al final: "(L)", "(L1)", "(B)", "(MTO)", "(AE)", "(SCR)"
 * - Quita número de dorsal o PP pegado al inicio: "1. GRAN SOL", "#3 TORMENTA"
 * - Quita pesos o edades pegados al final: "53 KG", "120 LBS", "C.A. 4A"
 */
function limpiarNombreEjemplar(
  rawNombre: unknown,
  ej: EjemplarExtraido
): string {
  let s = String(rawNombre ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
  if (!s) return "";

  // 1) Si el nombre empieza con un número de dorsal (ej. "1. GRAN SOL", "#2 RELAMPAGO", "3 - RAYO")
  // y el nombre restante tiene al menos 3 letras:
  const mInicioNum = s.match(/^(?:#|N[º°.]?\s*)?0*(\d{1,2}[A-Z]?)(?:\s*[-.):]\s*|\s+)([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ0-9' .\-]{2,})$/);
  if (mInicioNum) {
    const posibleNum = mInicioNum[1];
    const restoNombre = mInicioNum[2].trim();
    // Evitar cortar nombres reales de caballos que empiezan por número si ya tiene el mismo número o no tiene número
    if (!ej.numero || String(ej.numero).trim() === "" || String(ej.numero).trim() === posibleNum) {
      if (!ej.numero || String(ej.numero).trim() === "") {
        ej.numero = limpiarNumeroEjemplar(posibleNum);
      }
      s = restoNombre;
    }
  }

  // 2) Extraer códigos entre paréntesis al final: (VEN), (USA), (L), (MTO), (AE), (SCR), (RET)
  let seguirParentesis = true;
  while (seguirParentesis) {
    seguirParentesis = false;
    const mPar = s.match(/\s*\(([^()]{1,12})\)\s*$/);
    if (mPar) {
      const token = mPar[1].trim().toUpperCase();
      if (MAPA_PAISES_PARENTESIS[token]) {
        if (!ej.nacionalidad || !NACIONALIDADES.includes(String(ej.nacionalidad).toUpperCase())) {
          ej.nacionalidad = MAPA_PAISES_PARENTESIS[token];
        }
        s = s.slice(0, mPar.index).trim();
        seguirParentesis = true;
      } else if (/^(?:L|L1|L2|B|BL|MTO|AE|SCR|RET|PP\s*\d+|BB|V|GR|LA|OT|CC|BZ|M)$/i.test(token)) {
        if (/^L\d?$/i.test(token) && !ej.medicamento) ej.medicamento = token;
        s = s.slice(0, mPar.index).trim();
        seguirParentesis = true;
      }
    }
  }

  // 3) Quitar pesos pegados al final (ej. " - 53 KG", " 54KG", " 120 LBS")
  s = s.replace(/(?:\s*[-/|]\s*|\s+)\d{2,3}(?:[.,]\d)?\s*(?:KG|KGS|KILOS|LBS|LB)\.?\s*$/i, "").trim();

  // 4) Quitar medicación suelta con guion al final (ej. " - L", " / L1")
  s = s.replace(/\s*[-/|]\s*(?:L|L1|B|MTO|AE|SCR)\s*$/i, "").trim();

  // 5) Limpiar signos sobrantes en bordes
  s = s.replace(/^[-•*.,:;/_#]+|[-•*,:;/_#]+$/g, "").replace(/\s+/g, " ").trim();

  return s;
}

/** Normaliza y verifica minuciosamente una carrera extraída (números 1..N, nombres limpios,
 *  nacionalidad y deduplicación) antes de fusionarla. */
function normalizarExtraida(c: CarreraExtraida): void {
  const crudos = Array.isArray(c.ejemplares) ? c.ejemplares : [];
  const procesados: EjemplarExtraido[] = [];

  for (const ej of crudos) {
    if (!ej || typeof ej !== "object") continue;
    ej.numero = limpiarNumeroEjemplar(ej.numero);
    ej.nombre = limpiarNombreEjemplar(ej.nombre, ej);
    ej.nacionalidad = nacEjemplar(ej, c.hipodromo);
    ej.valor = 0;

    // Si el número quedó vacío pero `pp` es un entero válido <= 24, usar `pp` como respaldo inicial
    if ((ej.numero === "" || ej.numero == null) && ej.pp != null) {
      const ppLimpio = limpiarNumeroEjemplar(ej.pp);
      if (ppLimpio !== "") ej.numero = ppLimpio;
    }

    // Descartar filas completamente vacías (sin nombre y sin número)
    if (!ej.nombre && (ej.numero === "" || ej.numero == null)) continue;
    procesados.push(ej);
  }

  // Verificar y reparar numeración correlativa cuando algún ejemplar perdió su dorsal
  // o tenía un peso (>24) en el campo `numero` pero viene en su posición correlativa 1..N:
  const total = procesados.length;
  if (total >= 2 && total <= 24) {
    const usados = new Set<number>();
    for (const ej of procesados) {
      const n = parseInt(String(ej.numero ?? "").replace(/\D/g, ""), 10);
      if (!Number.isNaN(n) && n >= 1 && n <= 24) usados.add(n);
    }
    for (let idx = 0; idx < total; idx++) {
      const ej = procesados[idx];
      const n = parseInt(String(ej.numero ?? "").replace(/\D/g, ""), 10);
      if (Number.isNaN(n) || n < 1 || n > 24) {
        const esperado = idx + 1;
        if (!usados.has(esperado)) {
          ej.numero = esperado;
          usados.add(esperado);
        }
      }
    }

    // Si hay dos caballos con el MISMO número pero distinto nombre, y uno tiene `pp` igual
    // a un hueco libre de 1..total, reparar con ese hueco:
    const conteoPorNum = new Map<string, EjemplarExtraido[]>();
    for (const ej of procesados) {
      const k = String(ej.numero ?? "").trim();
      if (!k) continue;
      const arr = conteoPorNum.get(k) || [];
      arr.push(ej);
      conteoPorNum.set(k, arr);
    }
    for (const [, grupo] of conteoPorNum) {
      if (grupo.length > 1) {
        for (let g = 1; g < grupo.length; g++) {
          const dup = grupo[g];
          const ppInt = parseInt(String(dup.pp ?? "").replace(/\D/g, ""), 10);
          if (!Number.isNaN(ppInt) && ppInt >= 1 && ppInt <= 24 && !usados.has(ppInt)) {
            dup.numero = ppInt;
            usados.add(ppInt);
          }
        }
      }
    }
  }

  // Deduplicar filas que tengan exactamente el mismo número y el mismo nombre
  const unicos: EjemplarExtraido[] = [];
  const vistos = new Set<string>();
  for (const ej of procesados) {
    const clave = `${String(ej.numero ?? "").trim()}|${String(ej.nombre ?? "").trim()}`;
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    unicos.push(ej);
  }

  c.ejemplares = unicos;
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
      temperature: 0,
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
 * Detecta si una carrera extraída presenta huecos en la numeración 1..N de sus ejemplares,
 * números duplicados o caballos sin nombre, para activar una re-verificación focalizada automática.
 */
function detectarIncidenciasNumeracionYNombres(c: CarreraExtraida): string[] {
  const ejs = Array.isArray(c.ejemplares) ? c.ejemplares : [];
  if (ejs.length === 0) return ["No se detectaron ejemplares en la carrera."];
  const incidencias: string[] = [];
  const numeros = new Set<number>();
  const duplicados = new Set<number>();
  const sinNombre: Array<string | number> = [];

  ejs.forEach((ej, idx) => {
    const n = parseInt(String(ej.numero ?? "").replace(/\D/g, ""), 10);
    if (!Number.isNaN(n) && n >= 1 && n <= 24) {
      if (numeros.has(n)) duplicados.add(n);
      numeros.add(n);
    } else {
      incidencias.push(`Ejemplar en posición ${idx + 1} (${ej.nombre || "sin nombre"}) no tiene número de dorsal válido.`);
    }
    const nom = String(ej.nombre || "").trim();
    if (!nom || /^(?:SIN NOMBRE|EJEMPLAR|CABALLO|\?|-)$/i.test(nom)) {
      sinNombre.push(ej.numero || idx + 1);
    }
  });

  if (duplicados.size > 0) {
    incidencias.push(`Números de dorsal duplicados: #${[...duplicados].join(", #")}.`);
  }
  if (sinNombre.length > 0) {
    incidencias.push(`Ejemplares sin nombre válido: #${sinNombre.join(", #")}.`);
  }
  if (numeros.size >= 2) {
    const ordenados = [...numeros].sort((a, b) => a - b);
    const max = ordenados[ordenados.length - 1];
    if (ordenados[0] <= 2 && max <= 24) {
      const faltantes: number[] = [];
      for (let k = 1; k <= max; k++) {
        if (!numeros.has(k)) faltantes.push(k);
      }
      if (faltantes.length > 0) {
        incidencias.push(`Faltan en la secuencia 1..${max} los ejemplares con dorsal: #${faltantes.join(", #")}.`);
      }
    }
  }
  return incidencias;
}

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
  onEstado?: (s: string) => void,
  archivoOrigen?: string
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
          if (archivoOrigen && !c.archivoOrigen) c.archivoOrigen = archivoOrigen;
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

    // Verificación automática de segunda pasada para carreras con huecos de numeración o nombres faltantes
    if (!cuotaTotal) {
      let autoVerificadas = 0;
      for (let idxC = 0; idxC < carreras.length && autoVerificadas < 3; idxC++) {
        const c = carreras[idxC];
        const inc = detectarIncidenciasNumeracionYNombres(c);
        if (inc.length > 0) {
          const numC = numeroDeCarrera(c.carrera);
          const segCarrera = numC != null ? segmentos.find((s) => s.numero === numC)?.texto : undefined;
          const textoFuenteCarrera = segCarrera || texto;
          autoVerificadas++;
          onEstado?.(`🔍 Verificando minuciosamente números y nombres de Carrera ${c.carrera}…`);
          try {
            const rev = await reverificarCarreraConIA(clave, c, textoFuenteCarrera, inc, [], onEstado);
            if (rev.ok && rev.carrera && Array.isArray(rev.carrera.ejemplares) && rev.carrera.ejemplares.length >= (c.ejemplares?.length ?? 0)) {
              carreras[idxC] = {
                ...c,
                ...rev.carrera,
                carrera: c.carrera,
                hipodromo: rev.carrera.hipodromo || c.hipodromo,
                archivoOrigen: c.archivoOrigen || rev.carrera.archivoOrigen,
              };
            }
          } catch {
            /* conservar extracción inicial si falla la segunda pasada */
          }
        }
      }
    }

    // Ordenamiento determinista de carreras y ejemplares
    ordenarCarrerasYEjemplares(carreras);

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
  onEstado?: (s: string) => void,
  archivoOrigen?: string
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
          if (archivoOrigen) {
            nuevas.forEach((c) => {
              if (!c.archivoOrigen) c.archivoOrigen = archivoOrigen;
            });
          }
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
      if (!cuotaTotal) {
        let autoVerificadas = 0;
        for (let idxC = 0; idxC < carreras.length && autoVerificadas < 2; idxC++) {
          const c = carreras[idxC];
          const inc = detectarIncidenciasNumeracionYNombres(c);
          if (inc.length > 0) {
            autoVerificadas++;
            onEstado?.(`🔍 Verificando minuciosamente números y nombres de Carrera ${c.carrera}…`);
            try {
              const rev = await reverificarCarreraConIA(clave, c, "", inc, imagenes.slice(0, 4), onEstado);
              if (rev.ok && rev.carrera && Array.isArray(rev.carrera.ejemplares) && rev.carrera.ejemplares.length >= (c.ejemplares?.length ?? 0)) {
                carreras[idxC] = {
                  ...c,
                  ...rev.carrera,
                  carrera: c.carrera,
                  hipodromo: rev.carrera.hipodromo || c.hipodromo,
                  archivoOrigen: c.archivoOrigen || rev.carrera.archivoOrigen,
                };
              }
            } catch {
              /* conservar extracción inicial */
            }
          }
        }
      }
      // Ordenamiento determinista de carreras y ejemplares
      ordenarCarrerasYEjemplares(carreras);
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

/**
 * Re-verifica una carrera específica con la IA cuando se detectan omisiones o datos incompletos.
 * Envía una instrucción focalizada de corrección y devuelve la carrera reconstruida.
 */
export async function reverificarCarreraConIA(
  clave: string,
  carrera: CarreraExtraida | CarreraRegistro,
  fuenteTexto: string,
  incidencias: string[],
  imagenes: string[] = [],
  onEstado?: (s: string) => void
): Promise<{ ok: boolean; carrera?: CarreraExtraida; error?: string }> {
  if (!clave.trim()) {
    return { ok: false, error: "Falta la clave de Gemini." };
  }

  const numCarrera = carrera.carrera ?? "N/A";
  const hipo = String(carrera.hipodromo || "").trim().toUpperCase();

  const instruccionFocalizada = `ATENCIÓN: Se detectó que la CARRERA ${numCarrera} de ${hipo || "la reunión"} se extrajo de manera INCOMPLETA.
Problemas reportados por el validador:
${incidencias.map((i) => ` - ${i}`).join("\n")}

INSTRUCCIÓN PRIORITARIA:
Re-analiza con suma minuciosidad el texto o imágenes adjuntos correspondientes a la CARRERA ${numCarrera}.
Debes extraer TODOS y cada uno de los ejemplares participantes sin omitir ninguno.
Asegúrate de incluir:
 - carrera: ${numCarrera}
 - hipodromo: "${hipo}"
 - distancia: número entero en metros (si se lee)
 - superficie: ARENA, CESPED, FANGO o TAPETA
 - premio: número si aparece
 - ejemplares: lista completa con:
     * numero: número oficial / de gualdrapa
     * pp: puesto de pista (si se indica)
     * nombre: nombre exacto en mayúsculas
     * jockey: nombre del jinete
     * entrenador: nombre del entrenador
     * peso: peso en kg o libras asignado
     * nacionalidad: código de país (VE, USA, etc.)
Responde ÚNICAMENTE con JSON con formato {"carreras": [...]}.`;

  const diag = { respondio: "", ultimoError: "" };
  try {
    const descubiertos = await listaModelosFlash(clave);
    const modelos = elegirModelos(descubiertos);
    if (!modelos.length) {
      return { ok: false, error: "No se encontraron modelos de Gemini disponibles con esta clave." };
    }

    onEstado?.(`🤖 Re-verificando Carrera ${numCarrera} con IA...`);

    const contenido: ContenidoLote = fuenteTexto && fuenteTexto.trim().length > 100
      ? { durls: [], texto: `${instruccionFocalizada}\n\n=== DOCUMENTO ORIGINAL ===\n${fuenteTexto}` }
      : { durls: imagenes, texto: instruccionFocalizada };

    const parte: Parte = {
      contenido,
      etiqueta: `Re-verificación C${numCarrera}`,
      partir: () => null,
    };

    const res = await extraerParte(clave, modelos, parte, diag, onEstado);
    if (res && res.length > 0) {
      // Tomar la carrera correspondiente
      const encontrada = res.find((c) => numeroDeCarrera(c.carrera) === numeroDeCarrera(numCarrera)) || res[0];
      normalizarExtraida(encontrada);
      if (carrera.archivoOrigen && !encontrada.archivoOrigen) {
        encontrada.archivoOrigen = carrera.archivoOrigen;
      }
      return { ok: true, carrera: encontrada };
    }

    return { ok: false, error: diag.ultimoError || `No se pudo re-extraer la carrera ${numCarrera}.` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Busca específicamente una carrera faltante en la gaceta (ej: Carrera 5 omitida) usando Gemini.
 * Analiza minuciosamente el documento/imágenes y extrae la carrera con todos sus participantes ordenados.
 */
export async function buscarCarreraFaltanteConIA(
  clave: string,
  numeroCarrera: number | string,
  hipodromo: string,
  fuenteTexto: string,
  imagenes: string[] = [],
  instruccionesExtra?: string,
  onEstado?: (s: string) => void
): Promise<{ ok: boolean; carrera?: CarreraExtraida; error?: string }> {
  if (!clave.trim()) {
    return { ok: false, error: "Falta la clave de Gemini." };
  }

  const num = numeroDeCarrera(numeroCarrera) ?? numeroCarrera;
  const hipo = String(hipodromo || "").trim().toUpperCase();

  const prompt = `ALERTA DE CARRERA FALTANTE:
En la importación de la gaceta no se encontró o se omitió la CARRERA ${num} de ${hipo || "la jornada"}.
Tu misión es buscar minuciosamente en el documento/imágenes adjuntos y EXTRAER ÚNICAMENTE la CARRERA ${num}.

INSTRUCCIONES ESPECÍFICAS:
1. Localiza la sección, tabla o página de la CARRERA ${num}.
   - Recuerda que en Venezuela, si es una carrera de 5 y 6, puede titularse "1ª VÁLIDA", "2ª VÁLIDA", etc.
2. Extrae TODOS los ejemplares participantes de menor a mayor dorsal (1, 2, 3, ...).
   - numero: dorsal del caballo (columna gualdrapa)
   - pp: puesto de pista (si se indica)
   - nombre: nombre oficial en MAYÚSCULAS
   - jockey: jinete
   - entrenador: entrenador
   - peso: peso asignado
   - nacionalidad: país (VE, USA, etc.)
${instruccionesExtra ? `3. Órdenes adicionales del usuario: ${instruccionesExtra}\n` : ""}
Responde estrictamente con JSON en el formato {"carreras": [{"carrera": ${num}, "hipodromo": "${hipo}", "distancia": 0, "superficie": "ARENA", "premio": 0, "ejemplares": [...]}]}.`;

  const diag = { respondio: "", ultimoError: "" };
  try {
    const descubiertos = await listaModelosFlash(clave);
    const modelos = elegirModelos(descubiertos);
    if (!modelos.length) {
      return { ok: false, error: "No se encontraron modelos Flash disponibles con esta clave." };
    }

    onEstado?.(`🔍 Buscando Carrera ${num} con IA...`);

    const contenido: ContenidoLote = fuenteTexto && fuenteTexto.trim().length > 100
      ? { durls: [], texto: `${prompt}\n\n=== TEXTO DE LA GACETA ===\n${fuenteTexto}` }
      : { durls: imagenes, texto: prompt };

    const parte: Parte = {
      contenido,
      etiqueta: `Buscar Carrera Faltante C${num}`,
      partir: () => null,
    };

    const res = await extraerParte(clave, modelos, parte, diag, onEstado);
    if (res && res.length > 0) {
      const encontrada = res.find((c) => numeroDeCarrera(c.carrera) === numeroDeCarrera(num)) || res[0];
      encontrada.carrera = num;
      if (hipo && !encontrada.hipodromo) encontrada.hipodromo = hipo;
      normalizarExtraida(encontrada);
      if (Array.isArray(encontrada.ejemplares)) {
        encontrada.ejemplares.sort(compararEjemplares);
      }
      return { ok: true, carrera: encontrada };
    }

    return { ok: false, error: diag.ultimoError || `No se encontró la carrera ${num} en el documento.` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Ejecuta una orden particular o correctiva del usuario sobre la gaceta o una carrera específica.
 * Permite corregir nombres, re-numerar carreras, agregar ejemplares faltantes, etc.
 */
export async function ejecutarOrdenParticularConIA(
  clave: string,
  orden: string,
  carrerasActuales: CarreraExtraida[] | CarreraRegistro[],
  carreraIndice?: number,
  fuenteTexto: string = "",
  imagenes: string[] = [],
  onEstado?: (s: string) => void
): Promise<{ ok: boolean; carreras?: CarreraExtraida[]; error?: string; mensaje?: string }> {
  if (!clave.trim()) {
    return { ok: false, error: "Falta la clave de Gemini." };
  }
  if (!orden.trim()) {
    return { ok: false, error: "Escriba la orden o instrucción para el agente IA." };
  }

  const diag = { respondio: "", ultimoError: "" };
  try {
    const descubiertos = await listaModelosFlash(clave);
    const modelos = elegirModelos(descubiertos);
    if (!modelos.length) {
      return { ok: false, error: "No se encontraron modelos Flash disponibles con esta clave." };
    }

    onEstado?.("🤖 Ejecutando orden particular con IA...");

    // Si es para una carrera en particular o todas
    const esParaUnaCarrera = carreraIndice !== undefined && carreraIndice >= 0 && carreraIndice < carrerasActuales.length;
    const carrerasTarget = esParaUnaCarrera ? [carrerasActuales[carreraIndice]] : carrerasActuales;

    const prompt = `ORDEN PARTICULAR DEL OPERADOR / CORRECCIÓN DE GACETA:
"${orden.trim()}"

CARRERA(S) ACTUALMENTE EXTRAÍDAS:
${JSON.stringify(carrerasTarget, null, 2)}

INSTRUCCIONES DE CORRECCIÓN:
1. Aplica con exactitud quirúrgica la orden dada por el operador sobre las carreras y ejemplares.
2. Si la orden pide agregar un caballo faltante, busca en la fuente sus datos o créalo según la orden.
3. Si la orden pide re-numerar, ajustar distancias, nombres o puestos de pista (PP), hazlo fielmente.
4. Asegúrate de que los ejemplares queden estrictamente ordenados de menor a mayor por su número dorsal (1, 2, 3...).
5. Responde ÚNICAMENTE con JSON en el formato {"carreras": [...]}, conteniendo la(s) carrera(s) modificada(s) con todos sus ejemplares.`;

    const contenido: ContenidoLote = fuenteTexto && fuenteTexto.trim().length > 100
      ? { durls: [], texto: `${prompt}\n\n=== TEXTO FUENTE ORIGINAL ===\n${fuenteTexto}` }
      : { durls: imagenes, texto: prompt };

    const parte: Parte = {
      contenido,
      etiqueta: "Orden Particular IA",
      partir: () => null,
    };

    const res = await extraerParte(clave, modelos, parte, diag, onEstado);
    if (res && res.length > 0) {
      for (const c of res) {
        normalizarExtraida(c);
        if (Array.isArray(c.ejemplares)) {
          c.ejemplares.sort(compararEjemplares);
        }
      }

      if (esParaUnaCarrera) {
        // Reemplazar la carrera modificada en la lista completa
        const copia = [...carrerasActuales] as CarreraExtraida[];
        copia[carreraIndice] = res[0];
        ordenarCarrerasYEjemplares(copia);
        return { ok: true, carreras: copia, mensaje: "Carrera corregida exitosamente." };
      } else {
        ordenarCarrerasYEjemplares(res);
        return { ok: true, carreras: res, mensaje: "Gaceta corregida exitosamente según sus órdenes." };
      }
    }

    return { ok: false, error: diag.ultimoError || "La IA no pudo procesar la orden solicitada." };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}