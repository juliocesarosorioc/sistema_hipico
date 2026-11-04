// ============================================================================
// MOTOR DE IMPORTACIÓN, EXTRACCIÓN Y ANÁLISIS DE GACETA HÍPICA PDF (IA v4)
// ============================================================================
// Procesa documentos PDF oficiales de la Gaceta Hípica venezolana (La Rinconada / Valencia):
//   1. Lee el PDF (capa de texto directo o renderizado a imágenes de alta definición).
//   2. Extrae mediante IA Gemini estructurada todas las carreras y participantes.
//   3. Ejecuta el Motor Analista Venezuela v4 (22 factores, MACTOR, SMIC y Actuario).
//   4. Detecta automáticamente las 6 Válidas del 5y6 y las clasifica en Líneas y Morochas.
// ============================================================================

import {
  transformarGaceta,
  transformarGacetaTexto,
  type CarreraExtraida,
  type EjemplarExtraido,
} from "@/features/gaceta/lib/ia";
import {
  parsearPaginaRetrospectosNativo,
  parsearGacetaRetrospectosNativo,
  type CarreraParseadaNativa,
} from "@/features/gaceta/lib/segmentar";
import type { CarreraCatalogo, EjemplarCarreraCentral } from "@/features/carreras/lib/maestro-nucleo";
import {
  simularCarreraV4,
  type ResultadoCarreraV4,
  type ResultadoEjemplarV4,
  type EjemplarAnalisisV4,
  type EstiloCarrera,
} from "@/features/inteligencia/lib/analista-venezuela-v4";
import { construirEjemplarAnalisisIndividual } from "@/features/inteligencia/lib/evaluador-factores-individuales";

// Tipos para pdfjs-dist cargado dinámicamente en el cliente
type PdfLib = {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument: (opts: { data: ArrayBuffer }) => { promise: Promise<PdfDoc> };
};

type PdfDoc = {
  numPages: number;
  getPage: (n: number) => Promise<{
    getViewport: (o: { scale: number }) => { width: number; height: number };
    getTextContent: () => Promise<{ items: Array<{ str?: string; hasEOL?: boolean }> }>;
    render: (p: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }) => { promise: Promise<void> };
    cleanup: () => void;
  }>;
  destroy: () => Promise<void>;
};

async function cargarPdfJs(): Promise<PdfLib> {
  const mod = (await import("pdfjs-dist/legacy/build/pdf")) as unknown as
    | { default?: PdfLib }
    | PdfLib;
  const lib = (mod as { default?: PdfLib }).default ?? (mod as PdfLib);
  lib.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/legacy/build/pdf.worker.min.mjs";
  return lib;
}

/**
 * Extrae la capa de texto digital del PDF página por página de forma no bloqueante,
 * cediendo el event loop con setTimeout(r, 0) para no congelar la UI de Next.js.
 */
export async function extraerPaginasTextoPdf(
  file: File,
  onProgreso?: (paginaActual: number, totalPaginas: number) => void,
  topePaginas?: number
): Promise<string[]> {
  const lib = await cargarPdfJs();
  const buffer = await file.arrayBuffer();
  let doc: PdfDoc;
  try {
    doc = await lib.getDocument({ data: buffer }).promise;
  } catch (e) {
    throw new Error(`No se pudo leer el archivo PDF: ${e instanceof Error ? e.message : String(e)}`);
  }

  const total = topePaginas && topePaginas > 0 ? Math.min(topePaginas, doc.numPages) : doc.numPages;
  const paginas: string[] = [];
  try {
    for (let i = 1; i <= total; i++) {
      onProgreso?.(i, total);
      // Ceder el event loop de JavaScript para que el navegador responda a eventos y redibuje
      await new Promise((r) => setTimeout(r, 0));

      const page = await doc.getPage(i);
      try {
        const contenido = await page.getTextContent();
        const lineas = (contenido?.items ?? [])
          .map((it) => `${it.str ?? ""}${it.hasEOL ? "\n" : " "}`)
          .join("");
        if (lineas.trim()) paginas.push(lineas);
      } catch {
        // Página sin texto directo
      }
      try {
        page.cleanup();
      } catch {
        /* noop */
      }
    }
  } finally {
    try {
      await doc.destroy();
    } catch {
      /* noop */
    }
  }
  return paginas;
}

/**
 * Extrae la capa de texto digital del PDF como un solo string concatenado
 */
export async function extraerTextoPdf(
  file: File,
  topePaginas?: number,
  onProgreso?: (paginaActual: number, totalPaginas: number) => void
): Promise<string> {
  const paginas = await extraerPaginasTextoPdf(file, onProgreso, topePaginas);
  return paginas.join("\n\n");
}

/**
 * Renderiza páginas del PDF a imágenes JPEG para gacetas escaneadas o fotos.
 */
export async function renderizarPdfAImagenes(
  file: File,
  onProgreso?: (pagina: number, total: number) => void,
  topePaginas?: number
): Promise<string[]> {
  const lib = await cargarPdfJs();
  const buffer = await file.arrayBuffer();
  let doc: PdfDoc;
  try {
    doc = await lib.getDocument({ data: buffer }).promise;
  } catch (e) {
    throw new Error(`No se pudo leer el archivo PDF: ${e instanceof Error ? e.message : String(e)}`);
  }

  const total = topePaginas && topePaginas > 0 ? Math.min(topePaginas, doc.numPages) : doc.numPages;
  const paginas: string[] = [];
  const MAX_ENVIO_PX = 1500;
  const CALIDAD_JPEG = 0.65;

  try {
    for (let i = 1; i <= total; i++) {
      if (onProgreso) onProgreso(i, total);
      const page = await doc.getPage(i);
      const vp = page.getViewport({ scale: 1.5 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.min(vp.width, MAX_ENVIO_PX);
      canvas.height = Math.round(canvas.width * (vp.height / vp.width));
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      paginas.push(canvas.toDataURL("image/jpeg", CALIDAD_JPEG));
      try {
        page.cleanup();
      } catch {
        /* noop */
      }
    }
  } finally {
    try {
      await doc.destroy();
    } catch {
      /* noop */
    }
  }
  return paginas;
}

/**
 * Convierte un archivo de imagen a data URL
 */
export function leerImagenComoDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export type ProgresoExtraccion = {
  fase: "leyendo" | "extrayendo" | "analizando" | "listo" | "error";
  mensaje: string;
  paginaActual?: number;
  totalPaginas?: number;
};

export type OpcionesExtraccionGaceta = {
  file: File;
  claveGemini?: string;
  hipodromoDestino?: string;
  fechaJornada?: string;
  fechaOverride?: string;
  topePaginas?: number;
  onProgreso?: (progreso: ProgresoExtraccion) => void;
};

export type ResultadoArchivoGaceta = {
  nombreArchivo: string;
  ok: boolean;
  carreras: CarreraExtraida[];
  modo: "determinista" | "texto" | "imagenes";
  error?: string;
  aviso?: string;
};

/**
 * Orquestador principal de archivo único:
 * 1. Extrae página por página no bloqueante.
 * 2. Aplica Parser Determinístico Nativo instantáneo (Cero cuelgues, Cero gasto innecesario de tokens).
 * 3. Fallback inteligente a IA Gemini con timeout de 25s sólo si quedan páginas sin resolver.
 */
export async function importarYExtraerGacetaPdf(
  opciones: OpcionesExtraccionGaceta
): Promise<ResultadoArchivoGaceta> {
  const { file, claveGemini = "", hipodromoDestino, fechaJornada, fechaOverride, topePaginas, onProgreso } = opciones;
  const fechaEfectiva = fechaOverride || fechaJornada;
  const esPdf = /\.pdf$/i.test(file.name) || file.type === "application/pdf";

  // -------------------------------------------------------------
  // CASO 1: Es un archivo de imagen directo (JPG, PNG, WEBP)
  // -------------------------------------------------------------
  if (!esPdf) {
    if (!claveGemini.trim()) {
      return {
        nombreArchivo: file.name,
        ok: false,
        carreras: [],
        modo: "imagenes",
        error: "Se requiere la clave API de Gemini para transcribir imágenes de gaceta escaneada.",
      };
    }
    onProgreso?.({ fase: "leyendo", mensaje: "Cargando imagen de la Gaceta..." });
    const dataUrl = await leerImagenComoDataUrl(file);
    onProgreso?.({ fase: "extrayendo", mensaje: "Transcribiendo carreras con IA Gemini (timeout 25s)..." });
    const res = await transformarGaceta(
      claveGemini,
      [dataUrl],
      undefined,
      (s: string) => onProgreso?.({ fase: "extrayendo", mensaje: s })
    );
    return {
      nombreArchivo: file.name,
      ok: res.ok,
      carreras: res.carreras,
      modo: "imagenes",
      error: res.error,
      aviso: res.avisoNumeracion,
    };
  }

  // -------------------------------------------------------------
  // CASO 2: Es un archivo PDF
  // -------------------------------------------------------------
  onProgreso?.({
    fase: "leyendo",
    mensaje: "Leyendo páginas del PDF de forma no bloqueante...",
  });

  let paginasTexto: string[] = [];
  try {
    paginasTexto = await extraerPaginasTextoPdf(
      file,
      (pag, tot) => {
        onProgreso?.({
          fase: "leyendo",
          mensaje: `Procesando página ${pag} de ${tot}...`,
          paginaActual: pag,
          totalPaginas: tot,
        });
      },
      topePaginas
    );
  } catch (e) {
    console.warn("Fallo lectura de texto PDF:", e);
  }

  // Si tiene texto digital:
  if (paginasTexto.length > 0 && paginasTexto.some((p) => p.trim().length > 100)) {
    onProgreso?.({
      fase: "extrayendo",
      mensaje: "Ejecutando motor determinístico nativo ultra-rápido (Sistema Profesional)...",
    });

    // 1. Ejecutar Parser Determinístico Nativo
    const nativoRes = parsearGacetaRetrospectosNativo(paginasTexto, {
      fechaOverride: fechaEfectiva,
      hipodromoOverride: hipodromoDestino,
    });

    const carrerasNativas: CarreraExtraida[] = nativoRes.carreras.map((c) => ({
      carrera: c.carrera,
      hipodromo: c.hipodromo,
      fecha: c.fecha,
      hora: c.hora,
      distancia: c.distancia,
      superficie: c.superficie,
      premio: c.premio,
      archivoOrigen: file.name,
      ejemplares: c.ejemplares.map((e) => ({
        numero: e.numero,
        nombre: e.nombre,
        nacionalidad: "USA",
        pp: e.pp,
        jockey: e.jinete,
        entrenador: e.entrenador,
        peso: e.peso,
        ml: e.ml,
        stud: e.stud,
        pedigri: e.pedigri,
        retirado: e.retirado ?? false,
        condicionElegibilidad: e.condicionElegibilidad,
      })),
    }));

    // Si el parser determinístico extrajo carreras y no quedaron páginas dudosas, ¡listo instantáneo!
    if (carrerasNativas.length > 0 && (nativoRes.paginasParaFallback.length === 0 || !claveGemini.trim())) {
      onProgreso?.({
        fase: "listo",
        mensaje: `¡Éxito! ${carrerasNativas.length} carrera(s) extraídas instantáneamente por motor nativo.`,
      });
      return {
        nombreArchivo: file.name,
        ok: true,
        carreras: carrerasNativas,
        modo: "determinista",
      };
    }

    // Si hay páginas que necesitan fallback IA y el usuario configuró clave Gemini:
    if (nativoRes.paginasParaFallback.length > 0 && claveGemini.trim()) {
      onProgreso?.({
        fase: "extrayendo",
        mensaje: `Analizando ${nativoRes.paginasParaFallback.length} página(s) con fallback IA (timeout 25s)...`,
      });

      const textoFallback = nativoRes.paginasParaFallback.map((p) => p.texto).join("\n\n");
      const resIa = await transformarGacetaTexto(
        claveGemini,
        textoFallback,
        (hecho: number, tot: number) =>
          onProgreso?.({
            fase: "extrayendo",
            mensaje: `Procesando bloque IA ${hecho} de ${tot}...`,
            paginaActual: hecho,
            totalPaginas: tot,
          }),
        (s: string) => onProgreso?.({ fase: "extrayendo", mensaje: s })
      );

      if (resIa.ok && resIa.carreras.length > 0) {
        // Fusionar sin duplicar
        const mapa = new Map<number, CarreraExtraida>();
        for (const c of carrerasNativas) {
          mapa.set(Number(c.carrera), c);
        }
        for (const c of resIa.carreras) {
          const num = Number(c.carrera);
          if (!mapa.has(num)) {
            mapa.set(num, { ...c, archivoOrigen: file.name });
          }
        }
        const todas = Array.from(mapa.values()).sort((a, b) => Number(a.carrera) - Number(b.carrera));
        return {
          nombreArchivo: file.name,
          ok: true,
          carreras: todas,
          modo: "texto",
          aviso: resIa.avisoNumeracion,
        };
      }
    }

    if (carrerasNativas.length > 0) {
      return {
        nombreArchivo: file.name,
        ok: true,
        carreras: carrerasNativas,
        modo: "determinista",
      };
    }

    // Si el parser determinístico no encontró nada pero hay clave, enviar todo el texto a transformarGacetaTexto
    if (claveGemini.trim()) {
      onProgreso?.({
        fase: "extrayendo",
        mensaje: "Procesando texto completo con IA Gemini...",
      });
      const res = await transformarGacetaTexto(
        claveGemini,
        paginasTexto.join("\n\n"),
        (hecho: number, tot: number) =>
          onProgreso?.({
            fase: "extrayendo",
            mensaje: `Procesando bloque ${hecho} de ${tot}...`,
            paginaActual: hecho,
            totalPaginas: tot,
          }),
        (s: string) => onProgreso?.({ fase: "extrayendo", mensaje: s })
      );
      return {
        nombreArchivo: file.name,
        ok: res.ok,
        carreras: res.carreras.map((c) => ({ ...c, archivoOrigen: file.name })),
        modo: "texto",
        error: res.error,
        aviso: res.avisoNumeracion,
      };
    }

    return {
      nombreArchivo: file.name,
      ok: false,
      carreras: [],
      modo: "texto",
      error: "No se pudieron extraer carreras con el parser nativo y no hay clave Gemini configurada.",
    };
  }

  // -------------------------------------------------------------
  // CASO 3: PDF escaneado / sin texto digital
  // -------------------------------------------------------------
  if (!claveGemini.trim()) {
    return {
      nombreArchivo: file.name,
      ok: false,
      carreras: [],
      modo: "imagenes",
      error: "El PDF es una imagen escaneada y requiere clave API Gemini para el reconocimiento visual.",
    };
  }

  onProgreso?.({
    fase: "leyendo",
    mensaje: "PDF escaneado: renderizando páginas de alta definición...",
  });

  const imagenes = await renderizarPdfAImagenes(
    file,
    (pag, tot) =>
      onProgreso?.({
        fase: "leyendo",
        mensaje: `Procesando página ${pag} de ${tot}...`,
        paginaActual: pag,
        totalPaginas: tot,
      }),
    topePaginas
  );

  if (!imagenes.length) {
    return {
      nombreArchivo: file.name,
      ok: false,
      carreras: [],
      modo: "imagenes",
      error: "No se pudieron obtener imágenes legibles del archivo PDF.",
    };
  }

  onProgreso?.({
    fase: "extrayendo",
    mensaje: `Analizando ${imagenes.length} páginas con visión multimodal Gemini...`,
  });

  const res = await transformarGaceta(
    claveGemini,
    imagenes,
    (hecho: number, tot: number) =>
      onProgreso?.({
        fase: "extrayendo",
        mensaje: `Procesando lote ${hecho} de ${tot}...`,
        paginaActual: hecho,
        totalPaginas: tot,
      }),
    (s: string) => onProgreso?.({ fase: "extrayendo", mensaje: s })
  );

  return {
    nombreArchivo: file.name,
    ok: res.ok,
    carreras: res.carreras.map((c) => ({ ...c, archivoOrigen: file.name })),
    modo: "imagenes",
    error: res.error,
    aviso: res.avisoNumeracion,
  };
}

/**
 * Procesa un lote multi-archivo de gacetas PDF con concurrencia controlada
 * (máximo 2 archivos en paralelo con Promise.allSettled) para no colgar la UI.
 */
export async function importarLoteGacetasPdf(params: {
  files: File[];
  claveGemini?: string;
  fechaOverride?: string;
  onProgresoLote?: (progreso: {
    archivoActual: number;
    totalArchivos: number;
    nombreArchivo: string;
    mensaje: string;
  }) => void;
}): Promise<{
  exitosas: ResultadoArchivoGaceta[];
  fallidas: Array<{ nombreArchivo: string; error: string }>;
  todasLasCarreras: CarreraExtraida[];
}> {
  const { files, claveGemini, fechaOverride, onProgresoLote } = params;
  const exitosas: ResultadoArchivoGaceta[] = [];
  const fallidas: Array<{ nombreArchivo: string; error: string }> = [];

  const maxConcurrencia = 2;
  const cola = [...files];
  let procesados = 0;

  async function procesarArchivo(file: File): Promise<ResultadoArchivoGaceta> {
    const idx = ++procesados;
    onProgresoLote?.({
      archivoActual: idx,
      totalArchivos: files.length,
      nombreArchivo: file.name,
      mensaje: `Iniciando ${file.name}...`,
    });

    const res = await importarYExtraerGacetaPdf({
      file,
      claveGemini,
      fechaOverride,
      onProgreso: (p) => {
        onProgresoLote?.({
          archivoActual: idx,
          totalArchivos: files.length,
          nombreArchivo: file.name,
          mensaje: p.mensaje,
        });
      },
    });

    return res;
  }

  // Ejecución en grupos de tamaño maxConcurrencia
  for (let i = 0; i < cola.length; i += maxConcurrencia) {
    const grupo = cola.slice(i, i + maxConcurrencia);
    const resultados = await Promise.allSettled(grupo.map(procesarArchivo));

    for (let j = 0; j < resultados.length; j++) {
      const r = resultados[j];
      const f = grupo[j];
      if (r.status === "fulfilled") {
        if (r.value.ok && r.value.carreras.length > 0) {
          exitosas.push(r.value);
        } else {
          fallidas.push({
            nombreArchivo: f.name,
            error: r.value.error || "No se detectaron carreras válidas en el documento.",
          });
        }
      } else {
        fallidas.push({
          nombreArchivo: f.name,
          error: r.reason instanceof Error ? r.reason.message : String(r.reason),
        });
      }
    }
  }

  // Agrupar todas las carreras extraídas
  const todasLasCarreras: CarreraExtraida[] = [];
  for (const ex of exitosas) {
    todasLasCarreras.push(...ex.carreras);
  }

  return { exitosas, fallidas, todasLasCarreras };
}

/**
 * Convierte carreras extraídas de la Gaceta a formato estándar `CarreraCatalogo`
 */
export function convertirCarrerasExtraidasACatalogo(
  carrerasExtraidas: CarreraExtraida[],
  fecha: string,
  hipodromoDefault: string = "LA RINCONADA"
): CarreraCatalogo[] {
  return carrerasExtraidas.map((ce) => {
    const hip = String(ce.hipodromo || hipodromoDefault).trim().toUpperCase() || hipodromoDefault;
    const numCarrera = Number(ce.carrera) || 1;
    // Si la carrera extrajo su fecha del encabezado, usarla; si no, la fecha objetivo
    const fechaCarrera = (ce.fecha && ce.fecha.length >= 8) ? ce.fecha : fecha;
    const caballos: EjemplarCarreraCentral[] = (ce.ejemplares || []).map((ej, idx) => {
      // Normalizar peso coma decimal ej: "54,4" -> "54.4" o número 54.4
      let pesoNorm: number | string | null = null;
      if (ej.peso != null) {
        if (typeof ej.peso === "number") {
          pesoNorm = ej.peso;
        } else {
          const s = String(ej.peso).trim().replace(",", ".");
          const n = parseFloat(s);
          pesoNorm = isNaN(n) ? s : n;
        }
      }

      return {
        numero: String(ej.numero ?? idx + 1),
        nombre: String(ej.nombre || "").trim().toUpperCase(),
        nacionalidad: ej.nacionalidad ?? "USA",
        pp: ej.pp ?? null,
        puestoPista: ej.pp ?? null,
        retirado: ej.retirado ?? false,
        jockey: ej.jockey ?? null,
        entrenador: ej.entrenador ?? null,
        peso: pesoNorm,
        ml: ej.ml ?? null,
        stud: ej.stud ?? null,
        pedigri: ej.pedigri ?? null,
        condicionElegibilidad: ej.condicionElegibilidad ?? null,
        medicamento: ej.medicamento ?? null,
        implementos: ej.implementos ?? null,
      };
    });

    return {
      fecha: fechaCarrera,
      hipodromo: hip,
      carrera: numCarrera,
      distancia: ce.distancia ? String(ce.distancia) : "1200",
      superficie: ce.superficie || "ARENA",
      premio: ce.premio ?? 0,
      hora: ce.hora ?? null,
      caballos,
      retirados: caballos.filter((c) => c.retirado).map((c) => c.numero),
      estado: "ABIERTA",
      origen: "gaceta-ia-pdf",
    };
  });
}

export type ResumenAnalisisGaceta = {
  totalCarreras: number;
  carrerasAnalizadas: ResultadoCarreraV4[];
  carrerasValidas5y6: ResultadoCarreraV4[];
  lineasDetectadas: Array<{
    carrera: number;
    numeroValida: number;
    ejemplar: ResultadoEjemplarV4;
  }>;
  morochasDetectadas: Array<{
    carrera: number;
    numeroValida: number;
    morocha: [ResultadoEjemplarV4, ResultadoEjemplarV4];
  }>;
  sorpresasDetectadas: Array<{
    carrera: number;
    numeroValida: number;
    ejemplar: ResultadoEjemplarV4;
  }>;
};

/**
 * Ejecuta el análisis actuarial y prospectivo v4 sobre todas las carreras extraídas
 */
export function analizarCarrerasGacetaV4(params: {
  carreras: CarreraCatalogo[];
  fecha: string;
  primeraValidaCarrera?: number; // Por defecto detecta según total carreras
}): ResumenAnalisisGaceta {
  const { carreras, fecha } = params;

  // Ordenar por número de carrera
  const ordenadas = [...carreras].sort((a, b) => Number(a.carrera) - Number(b.carrera));
  const total = ordenadas.length;

  // Determinar inicio del 5y6 si no se especifica
  // En Venezuela: 10 carreras → Válidas 5 a 10; 11 carreras → Válidas 6 a 11; etc.
  const inicioValidas =
    params.primeraValidaCarrera && params.primeraValidaCarrera > 0
      ? params.primeraValidaCarrera
      : total >= 11
      ? total - 5
      : total === 10
      ? 5
      : total >= 6
      ? total - 5
      : 1;

  const analizadas: ResultadoCarreraV4[] = [];
  const validas5y6: ResultadoCarreraV4[] = [];
  const lineas: ResumenAnalisisGaceta["lineasDetectadas"] = [];
  const morochas: ResumenAnalisisGaceta["morochasDetectadas"] = [];
  const sorpresas: ResumenAnalisisGaceta["sorpresasDetectadas"] = [];

  for (const c of ordenadas) {
    const numC = Number(c.carrera);
    const esValida = numC >= inicioValidas && numC < inicioValidas + 6;
    const numValida = esValida ? numC - inicioValidas + 1 : undefined;

    const ejs: EjemplarAnalisisV4[] = (c.caballos || []).map((cab, idx) => {
      return construirEjemplarAnalisisIndividual(
        {
          numero: cab.numero,
          nombre: cab.nombre,
          pp: cab.pp ?? cab.puestoPista,
          puestoPista: cab.puestoPista ?? cab.pp,
          jockey: cab.jockey,
          entrenador: cab.entrenador,
          peso: cab.peso,
          medicamento: cab.medicamento,
          implementos: cab.implementos,
          stud: (cab as unknown as { stud?: string }).stud,
          divisaTexto: (cab as unknown as { divisaTexto?: string }).divisaTexto,
          retirado: cab.retirado,
        },
        idx,
        numC,
        Number(c.distancia) || 1200,
        c.hipodromo
      );
    });

    const resCarrera = simularCarreraV4({
      hipodromo: c.hipodromo,
      carreraNumero: numC,
      distancia: Number(c.distancia) || 1200,
      fecha,
      esValida5y6: esValida,
      numeroValida5y6: numValida,
      ejemplares: ejs,
    });

    analizadas.push(resCarrera);

    if (esValida && numValida) {
      validas5y6.push(resCarrera);

      if (resCarrera.lineaRecomendada5y6) {
        lineas.push({
          carrera: numC,
          numeroValida: numValida,
          ejemplar: resCarrera.lineaRecomendada5y6,
        });
      }

      if (resCarrera.morochaRecomendada5y6) {
        morochas.push({
          carrera: numC,
          numeroValida: numValida,
          morocha: resCarrera.morochaRecomendada5y6,
        });
      }

      if (resCarrera.sorpresaRecomendada5y6) {
        sorpresas.push({
          carrera: numC,
          numeroValida: numValida,
          ejemplar: resCarrera.sorpresaRecomendada5y6,
        });
      }
    }
  }

  return {
    totalCarreras: total,
    carrerasAnalizadas: analizadas,
    carrerasValidas5y6: validas5y6,
    lineasDetectadas: lineas,
    morochasDetectadas: morochas,
    sorpresasDetectadas: sorpresas,
  };
}
