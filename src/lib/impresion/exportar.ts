/**
 * Exportación de páginas A4 (DOM de 1240×1754 px @150dpi) a JPG / PNG / PDF.
 * Misma cadena que el legacy js (canvas en alta a 300dpi efectiva) pero con
 * html2canvas sobre el DOM real + jsPDF para el PDF.
 *
 * ⚠ html2canvas NO comparte motor de layout con el navegador. Si el CSS de la
 * hoja se confluence con reglas que la librería no resuelve bien
 * (`line-height` numérico, `transform:scale()` sobre un ancestro del texto,
 * webfonts sin esperar) la previsualización se ve perfecta y el archivo
 * exportado sale con las letras cortadas. Aquí se corrige en tres frentes:
 * `esperarFuentes()` + opciones de captura honestas + `CSS_SANEO_CAPTURA`
 * aplicado solo al clon. Para contenidos que no caben a 1:1 en A4 se compone la
 * hoja a mano con `componerA4Paisaje` en vez de confiar en un `transform`.
 */
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import type { Orientacion } from "@/lib/impresion/util";
import { plantillaPorId, reemplazarVarsTablas, fechaHoy } from "@/lib/whatsapp";

export type ImgFormato = "PNG" | "JPG" | "PDF";

export type ProgresoExpor = {
  /** total de páginas detectadas. */
  total: number;
  /** página recién capturada (1-based). */
  actual: number;
};

export type OpcionesExportar = {
  /** Vertical (A4 retrato) u horizontal (A4 paisaje). Por defecto vertical. */
  orientacion?: Orientacion;
  /**
   * Multiplicador de captura. Por defecto 2 (300dpi efectivos sobre la hoja
   * @150dpi). Se baja cuando la hoja se construye a tamaño natural grande
   * (Dupletas anchas) para no reventar el límite de píxeles del navegador.
   */
  escala?: number;
};

/* ─────────────────────────── ENDURECER LA CAPTURA (html2canvas) ─────────────────────────── */

/**
 * html2canvas NO usa el motor de layout del navegador: vuelve a medir cada
 * nodo de texto desde cero y dibuja la línea base con esta fórmula
 *
 *     baseline = parseFloat(getComputedStyle(el).lineHeight) * 0.8
 *
 * El detalle que rompe los documentos: CSS conserva los `line-height`
 * numéricos como NÚMEROS, no como píxeles. Con `line-height:1` el navegador
 * coloca la línea base correctamente, pero `parseFloat("1") * 0.8 = 0.8` y
 * html2canvas pinta el texto pegado al borde superior de su caja. Encima, en
 * los badges `.im-num` / `.imr-num` hay `height:1.4em` + `overflow:hidden`, así
 * que el `overflow` se come la mitad superior de la letra. De ahí que la
 * previsualización se vea perfecta y el PNG/JPG/PDF salgan mutilados.
 *
 * La regla: en cualquier hoja impresa, `line-height` va en `px` o `em` (que
 * `getComputedStyle` resuelve a px), nunca en número suelto.
 *
 * Este saneo se aplica SOLO al clon que dibuja html2canvas (`onclone`), nunca
 * al DOM visible: la previsualización no cambia ni un píxel, pero la captura
 * deja de depender de la aritmética frágil de la librería.
 */
const CSS_SANEO_CAPTURA = `
.im-fila,.imr-frac,.fila-legacy,.im-nom,.imr-cab,.cab-legacy,.im-mon,.mon-legacy,
.im-jj,.im-pp,.im-hip,.imr-hip,.hip-legacy,.im-cc,.imr-cc,.cc-legacy,
.im-l1,.im-l2,.l1-legacy,.l2-legacy,.imr-cl1,.imr-cl2,
.im-meta,.imr-meta,.meta-legacy,.im-fecha,.imr-fecha,.fecha-legacy,
.im-badge,.im-ctot,.im-cjug,.imr-cjug{
  line-height:1.25em !important;
}
.im-num,.imr-num,.num-legacy{line-height:1.4em !important;overflow:visible !important;}
/* El recorte vertical es lo que mata los glifos: la caja conserva su tamaño
   (el fondo redondeado sigue igual), solo se deja de recortar arriba/abajo. */
.im-enc,.imr-enc,.im-hip,.imr-hip,.hip-legacy,.im-cjug,.imr-cjug{overflow:visible !important;}
.im-pagina,.imr-ppagina,.im-tarjeta,.imr-card,.im-filas,.imr-filas,.imr-cuerpo{
  box-sizing:border-box !important;
}
`;

/**
 * html2canvas dibuja el texto con la fuente que esté CARGADA en el momento de
 * medir. Si `Inter` (o cualquier webfont) todavía no llegó, mide con el
 * fallback, calcula mal la línea base y almagra el documento. Se espera a
 * `document.fonts.ready` y además se fuerzan los pesos que usan las hojas.
 */
async function esperarFuentes(): Promise<void> {
  if (typeof document === "undefined" || !("fonts" in document)) return;
  try {
    const familias = ["Inter", "system-ui", "Arial"];
    const pesos = ["400", "600", "700", "800", "900"];
    await Promise.all(
      familias.flatMap((f) => pesos.map((p) => document.fonts.load(`${p} 12px "${f}"`).catch(() => undefined)))
    );
    await document.fonts.ready;
  } catch {
    /* sin soporte de FontFaceSet: se sigue con la fuente por defecto */
  }
}

/** Opciones de captura: geometría honesta + saneo del clon. */
function opcionesCaptura(el: HTMLElement, escala: number) {
  const r = el.getBoundingClientRect();
  return {
    scale: escala,
    backgroundColor: "#ffffff",
    logging: false,
    useCORS: true,
    // La hoja vive en `left:-99999px`: sin esto html2canvas usa el
    // `window.innerWidth` (p. ej. 1920) como viewport del clon y las medidas
    // del elemento se descuadran.
    scrollX: 0,
    scrollY: 0,
    windowWidth: Math.max(Math.ceil(r.width) + 64, 320),
    windowHeight: Math.max(Math.ceil(r.height) + 64, 320),
    imageTimeout: 30000,
    removeContainer: true,
    onclone: (_doc: Document, clon: HTMLElement) => {
      const style = clon.ownerDocument.createElement("style");
      style.setAttribute("data-saneo-captura", "");
      style.textContent = CSS_SANEO_CAPTURA;
      clon.appendChild(style);
    },
  } as const;
}

/**
 * Captura cada `.im-pagina` / `.imr-ppagina` dentro de `root` como canvas
 * a 300dpi efectivos (scale 2 sobre la hoja @150dpi) y las serializa según
 * la orientación elegida:
 *  · PDF → jsPDF A4 en la orientación pedida, cada página a tamaño completo
 *    e incrustada como PNG SIN pérdida (texto nítido, sin artefactos JPEG).
 *  · PNG / JPG → un canvas alto por todas las páginas, descargado al instante.
 *
 * Rendimiento: se hace UNA sola captura del contenedor (las hojas están
 * apiladas) y cada página se recorta del mismo canvas — N accesos a
 * html2canvas menos que antes. Si hay muchas páginas (área enorme) se
 * conserva el recorte por hoja para no agotar memoria.
 */
export async function exportarPaginas(
  root: HTMLElement,
  formato: ImgFormato,
  archivoBase: string,
  opciones?: OpcionesExportar,
  onProgreso?: (p: ProgresoExpor) => void
): Promise<void> {
  const paginas = Array.from(
    root.querySelectorAll<HTMLElement>(".im-pagina, .imr-ppagina")
  );
  if (paginas.length === 0) throw new Error("No hay páginas para exportar.");

  const escala = opciones?.escala ?? 2; // 300dpi efectivos sobre la hoja @150dpi
  onProgreso?.({ total: paginas.length, actual: 0 });

  // Las webfonts deben estar listas ANTES de que html2canvas mida el texto: si no,
  // mide con la fallback y el interlineado sale corrido (letras cortadas).
  await esperarFuentes();

  const rootRect = root.getBoundingClientRect();
  const rects = paginas.map((p) => p.getBoundingClientRect());
  const totalW = rootRect.width * escala;
  const totalH = rootRect.height * escala;
  // Máximo razonable de píxeles para un lienzo único (~40 Mpx ≈ 160 MB).
  const cabeUnido = paginas.length > 0 && totalW * totalH <= 40_000_000;

  // Recote de la i-ésima hoja desde un canvas maestro (coordenadas relativas al root).
  const sliceDe = (master: HTMLCanvasElement, i: number) => {
    const r = rects[i];
    const x = Math.round((r.left - rootRect.left) * escala);
    const y = Math.round((r.top - rootRect.top) * escala);
    const w = Math.round(r.width * escala);
    const h = Math.round(r.height * escala);
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D no disponible.");
    ctx.drawImage(master, x, y, w, h, 0, 0, w, h);
    return c;
  };

  const maestras: HTMLCanvasElement[] = cabeUnido
    ? [await html2canvas(root, opcionesCaptura(root, escala))]
    : await Promise.all(
        paginas.map((p, i) => {
          onProgreso?.({ total: paginas.length, actual: i + 1 });
          return html2canvas(p, opcionesCaptura(p, escala));
        })
      );

  const canvases: HTMLCanvasElement[] = paginas.map((_, i) =>
    cabeUnido ? sliceDe(maestras[0], i) : (maestras[i] as HTMLCanvasElement)
  );

  await guardarLienzos(canvases, formato, archivoBase, opciones?.orientacion === "horizontal", onProgreso);
}

/**
 * Captura un nodo suelto con las opciones ya endurecidas (fuentes + saneo).
 * Se usa cuando la maquetación se compone a mano en un lienzo A4 en vez de
 * dejar que una hoja CSS haga el ajuste — ver `exportarA4Compuesto`.
 */
export async function capturarNodo(el: HTMLElement, escala = 2): Promise<HTMLCanvasElement> {
  await esperarFuentes();
  return html2canvas(el, opcionesCaptura(el, escala));
}

export type PiezaA4 = {
  /** Lienzo ya capturado con `capturarNodo`. */
  canvas: HTMLCanvasElement;
  /** Posición y tamaño final dentro de la hoja, en px de la hoja @150dpi. */
  x: number;
  y: number;
  w: number;
  h: number;
};

/** Hoja A4 apaisada @150dpi, igual que `.im-or-h` en las hojas de impresión. */
export const A4_PAISAGE = { w: 1240, h: 877 } as const;

/**
 * Compone una hoja A4 apaisada a partir de piezas YA capturadas y devuelve el
 * lienzo (para `guardarLienzos`).
 *
 * Existe para los módulos cuyo contenido no cabe en A4 a 1:1 — las Dupletas
 * pueden medir 3000px de ancho. Antes se resolvía con
 * `transform:scale()` sobre el clon: html2canvas no escala el texto de forma
 * coherente con el ancestro escalado, así que las letras salían cortadas y
 * fuera de caja. Aquí la reducción es aritmética de píxeles con `drawImage`,
 * que es exacta, y el texto se captura siempre a su tamaño natural.
 */
export function componerA4Paisaje(piezas: PiezaA4[], escala = 2): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = Math.round(A4_PAISAGE.w * escala);
  out.height = Math.round(A4_PAISAGE.h * escala);
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D no disponible.");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, out.width, out.height);
  for (const p of piezas) {
    // `imageSmoothingQuality` alto: al reducir, el navegador promedia en vez
    // de descartar filas de píxeles (que es lo que produce el serrado).
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(p.canvas, Math.round(p.x * escala), Math.round(p.y * escala), Math.round(p.w * escala), Math.round(p.h * escala));
  }
  return out;
}

/**
 * Serializa uno o varios lienzos YA RENDERIZADOS a PDF / PNG / JPG.
 * Separate de la captura para que quien compone la página a mano (Dupletas,
 * que necesita reducir la tabla con `drawImage` y no con un `transform:scale`
 * que html2canvas no escala bien) pueda reutilizar el guardado y la fecha.
 */
export async function guardarLienzos(
  canvases: HTMLCanvasElement[],
  formato: ImgFormato,
  archivoBase: string,
  landscape = false,
  onProgreso?: (p: ProgresoExpor) => void
): Promise<void> {
  if (canvases.length === 0) throw new Error("No hay páginas para exportar.");
  onProgreso?.({ total: canvases.length, actual: 0 });

  const fecha = new Date().toISOString().slice(0, 10);
  const nombre = `${archivoBase}_${fecha}`;

  if (formato === "PDF") {
    const pdf = new jsPDF({
      orientation: landscape ? "landscape" : "portrait",
      unit: "mm",
      format: "a4",
    });
    const pw = pdf.internal.pageSize.getWidth();
    const ph = pdf.internal.pageSize.getHeight();
    canvases.forEach((cv, i) => {
      onProgreso?.({ total: canvases.length, actual: i + 1 });
      if (i > 0) pdf.addPage();
      const img = cv.toDataURL("image/png");
      pdf.addImage(img, "PNG", 0, 0, pw, ph);
    });
    pdf.save(`${nombre}.pdf`);
    return;
  }

  // PNG / JPG: lienzo alto con todas las páginas apiladas (usa el tamaño real
  // de cada captura: 2480×3508 en vertical, 3508×2480 en horizontal).
  const w0 = canvases[0].width;
  const h0 = canvases[0].height;
  const lienzo = document.createElement("canvas");
  lienzo.width = w0;
  lienzo.height = h0 * canvases.length;
  const ctx = lienzo.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D no disponible.");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w0, lienzo.height);
  canvases.forEach((cv, i) => ctx.drawImage(cv, 0, i * h0));

  const a = document.createElement("a");
  a.href =
    formato === "PNG"
      ? lienzo.toDataURL("image/png")
      : lienzo.toDataURL("image/jpeg", 0.95);
  a.download = `${nombre}.${formato.toLowerCase()}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function fmtNum(n: number): string {
  try {
    return new Intl.NumberFormat("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
  } catch {
    return (n || 0).toFixed(2);
  }
}

/** No muestra símbolo de moneda: la moneda se estipula por el grupo del usuario. */

/**
 * Texto WhatsApp de la MATRIZ (resumen por carrera), generado con la plantilla
 * editable "tablas_matriz" del Centro de WhatsApp ({fecha} {lineas} {totales}).
 */
export function textoWhatsAppMatriz(
  carreras: Array<{ hipodromo: string; carrera: string; superficie: string; fecha: string; moneda: string; ejemplares: unknown[]; premio: number }>,
  telefono = "584141234567"
): string {
  const lineas = carreras
    .map((c) => `${c.hipodromo} C${c.carrera} · ${c.superficie || ""} · ${String(c.fecha).slice(0, 10)} · ${c.ejemplares.length} ej. · PAGO/TABLA ${fmtNum(c.premio)}\n`)
    .join("");
  const totales = String(carreras.reduce((a, c) => a + (c.ejemplares?.length ?? 0), 0));
  let plantilla = plantillaPorId("tablas_matriz");
  if (!plantilla.trim()) {
    plantilla = "TABLAS FIJAS PUBLICADAS {fecha}\n{lineas}\nTOTAL EJEMPLARES: {totales}\nNORMAS: válida solo para la carrera y el ejemplar indicados. Presente en caja.";
  }
  const texto = reemplazarVarsTablas(plantilla, { fecha: fechaHoy(), lineas, totales });
  window.open(`https://wa.me/${telefono}?text=${encodeURIComponent(texto)}`, "_blank");
  return texto;
}

/**
 * Texto WhatsApp del REPORTE (resumen por jugador), generado con la plantilla
 * editable "tablas_reporte" del Centro de WhatsApp ({fecha} {lineas} {totales}).
 */
export function textoWhatsAppReporte(
  jugadores: Array<{ jugador: string; grupo: string; nivel: string; montoJugado: number; montoPagado: number }>,
  telefono = "584141234567"
): string {
  const lineas = jugadores
    .map((p) => `${p.jugador} [${p.grupo} - ${p.nivel}] JUGADO ${fmtNum(p.montoJugado)} / PAGADO ${fmtNum(p.montoPagado)}`)
    .join("\n");
  const totales = fmtNum(jugadores.reduce((a, p) => a + (p.montoJugado - p.montoPagado), 0));
  let plantilla = plantillaPorId("tablas_reporte");
  if (!plantilla.trim()) {
    plantilla = "REPORTE DE TABLAS {fecha}\n{lineas}\nDiferencia total: {totales}\nNORMAS: reporte de control interno de tablas fijas.";
  }
  const texto = reemplazarVarsTablas(plantilla, { fecha: fechaHoy(), lineas, totales });
  window.open(`https://wa.me/${telefono}?text=${encodeURIComponent(texto)}`, "_blank");
  return texto;
}