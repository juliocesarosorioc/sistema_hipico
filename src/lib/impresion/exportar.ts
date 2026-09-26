/**
 * Exportación de páginas A4 (DOM de 1240×1754 px @150dpi) a JPG / PNG / PDF.
 * Misma cadena que el legacy js (canvas en alta a 300dpi efectiva) pero con
 * html2canvas sobre el DOM real + jsPDF para el PDF.
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
};

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

  const escala = 2; // 300dpi efectivos sobre la hoja @150dpi
  onProgreso?.({ total: paginas.length, actual: 0 });

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
    ? [await html2canvas(root, { scale: escala, backgroundColor: "#ffffff", logging: false, useCORS: true })]
    : await Promise.all(
        paginas.map((p, i) => {
          onProgreso?.({ total: paginas.length, actual: i + 1 });
          return html2canvas(p, { scale: escala, backgroundColor: "#ffffff", logging: false, useCORS: true });
        })
      );

  const canvases: HTMLCanvasElement[] = paginas.map((_, i) =>
    cabeUnido ? sliceDe(maestras[0], i) : (maestras[i] as HTMLCanvasElement)
  );

  const fecha = new Date().toISOString().slice(0, 10);
  const nombre = `${archivoBase}_${fecha}`;
  const landscape = opciones?.orientacion === "horizontal";

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