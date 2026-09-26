/**
 * Exportación de páginas A4 (DOM de 1240×1754 px @150dpi) a JPG / PNG / PDF.
 * Misma cadena que el legacy js (canvas en alta a 300dpi efectiva) pero con
 * html2canvas sobre el DOM real + jsPDF para el PDF.
 */
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

export type ImgFormato = "PNG" | "JPG" | "PDF";

export type ProgresoExpor = {
  /** total de páginas detectadas. */
  total: number;
  /** página recién capturada (1-based). */
  actual: number;
};

/**
 * Captura cada `.im-pagina` / `.imr-ppagina` dentro de `root` como canvas
 * 2480×3508 (scale 2 = 300dpi reales por página A4) y las serializa:
 *  · PDF → jsPDF A4 portrait, cada página a tamaño completo.
 *  · PNG / JPG → un canvas alto por todas las páginas, descargado al instante.
 */
export async function exportarPaginas(
  root: HTMLElement,
  formato: ImgFormato,
  archivoBase: string,
  onProgreso?: (p: ProgresoExpor) => void
): Promise<void> {
  const paginas = Array.from(
    root.querySelectorAll<HTMLElement>(".im-pagina, .imr-ppagina")
  );
  if (paginas.length === 0) throw new Error("No hay páginas para exportar.");

  const canvases: HTMLCanvasElement[] = [];
  for (let i = 0; i < paginas.length; i++) {
    onProgreso?.({ total: paginas.length, actual: i + 1 });
    const canvas = await html2canvas(paginas[i], {
      scale: 2,
      backgroundColor: "#ffffff",
      logging: false,
      useCORS: true,
    });
    canvases.push(canvas);
  }

  const fecha = new Date().toISOString().slice(0, 10);
  const nombre = `${archivoBase}_${fecha}`;

  if (formato === "PDF") {
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    canvases.forEach((cv, i) => {
      if (i > 0) pdf.addPage();
      const img = cv.toDataURL("image/jpeg", 0.93);
      pdf.addImage(img, "JPEG", 0, 0, 210, 297);
    });
    pdf.save(`${nombre}.pdf`);
    return;
  }

  // PNG / JPG: lienzo alto con todas las páginas apiladas.
  const ancho = 2480;
  const alto = 3508 * canvases.length;
  const lienzo = document.createElement("canvas");
  lienzo.width = ancho;
  lienzo.height = alto;
  const ctx = lienzo.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D no disponible.");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, ancho, alto);
  canvases.forEach((cv, i) => ctx.drawImage(cv, 0, i * 3508));

  const a = document.createElement("a");
  a.href =
    formato === "PNG"
      ? lienzo.toDataURL("image/png")
      : lienzo.toDataURL("image/jpeg", 0.93);
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

function simb(m?: string | null): string {
  const s = String(m ?? "USD").toUpperCase();
  return s.indexOf("VES") >= 0 || s === "BS" ? "Bs " : "$ ";
}
function fechaHoy(): string {
  const d = new Date();
  return `${("0" + d.getDate()).slice(-2)}/${("0" + (d.getMonth() + 1)).slice(-2)}/${d.getFullYear()}`;
}

/** Texto WhatsApp de la MATRIZ (resumen por carrera). */
export function textoWhatsAppMatriz(
  carreras: Array<{ hipodromo: string; carrera: string; superficie: string; fecha: string; moneda: string; ejemplares: unknown[]; premio: number }>,
  telefono = "584141234567"
): string {
  let texto = `TABLAS FIJAS PUBLICADAS ${fechaHoy()}\n`;
  for (const c of carreras) {
    texto += `${c.hipodromo} C${c.carrera} · ${c.superficie || ""} · ${String(c.fecha).slice(0, 10)} · ${c.ejemplares.length} ej. · PAGO/TABLA ${simb(c.moneda)}${fmtNum(c.premio)}\n`;
  }
  texto += "\nNORMAS: válida solo para la carrera y el ejemplar indicados. Presente en caja.";
  window.open(`https://wa.me/${telefono}?text=${encodeURIComponent(texto)}`, "_blank");
  return texto;
}

/** Texto WhatsApp del REPORTE (resumen por jugador). */
export function textoWhatsAppReporte(
  jugadores: Array<{ jugador: string; grupo: string; nivel: string; montoJugado: number; montoPagado: number }>,
  telefono = "584141234567"
): string {
  let texto = `REPORTE DE TABLAS ${fechaHoy()}\n`;
  for (const p of jugadores) {
    texto += `${p.jugador} [${p.grupo} - ${p.nivel}] JUGADO ${fmtNum(p.montoJugado)} / PAGADO ${fmtNum(p.montoPagado)}\n`;
  }
  const dj = jugadores.reduce((a, p) => a + (p.montoJugado - p.montoPagado), 0);
  texto += `\nDiferencia total: ${fmtNum(dj)}`;
  texto += "\nNORMAS: reporte de control interno de tablas fijas.";
  window.open(`https://wa.me/${telefono}?text=${encodeURIComponent(texto)}`, "_blank");
  return texto;
}