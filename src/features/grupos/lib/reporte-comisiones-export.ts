/**
 * ============================================================================
 * EXPORTACIONES DEL REPORTE DE COMISIONES POR CONVENIO — capa navegador
 * ============================================================================
 * Los textos y matrices son PUROS y viven en `comisiones-convenio.ts`
 * (`textoReporteWhatsApp`, `csvDetalle`, `matrizDetalle`). Acá solo se toca el
 * navegador: descargar CSV/Excel, copiar/descargar el PNG y copiar el texto de
 * WhatsApp. Nada de esto corre en el servidor ni en las pruebas.
 */
import {
  COLUMNAS_DETALLE,
  csvDetalle,
  fechaLegible,
  formatearDinero,
  matrizDetalle,
  type DetalleJugada,
  type EncabezadoReporte,
  type KpisReporte,
} from "@/features/grupos/lib/comisiones-convenio";

const sanea = (s: string): string => String(s || "reporte").replace(/[\\/:*?"<>|]+/g, "-").trim();

/** Descarga un Blob como archivo (best-effort; no falla si el DOM no coopera). */
function descargar(blob: Blob, nombre: string): boolean {
  if (typeof document === "undefined" || typeof URL === "undefined" || !URL.createObjectURL) return false;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return true;
}

/** Descarga el detalle como CSV (con BOM para Excel). */
export function descargarCsv(detalle: DetalleJugada[], nombreBase: string): boolean {
  const csv = "\uFEFF" + csvDetalle(detalle);
  return descargar(new Blob([csv], { type: "text/csv;charset=utf-8;" }), `${sanea(nombreBase)}.csv`);
}

/** Descarga el detalle como Excel (.xls por HTML, sin dependencias). */
export function descargarExcel(detalle: DetalleJugada[], nombreBase: string): boolean {
  const filas = matrizDetalle(detalle);
  const [cab, ...cuerpo] = filas;
  const th = cab.map((c) => `<th style="background:#0f172a;color:#fff;padding:6px 10px;text-align:left">${c}</th>`).join("");
  const trs = cuerpo
    .map(
      (f) =>
        `<tr>${f
          .map((c, i) => `<td style="padding:5px 10px;border-bottom:1px solid #e2e8f0${i >= 7 ? ";text-align:right" : ""}">${c}</td>`)
          .join("")}</tr>`
    )
    .join("");
  const html = `<!DOCTYPE html>
<html xmlns:x="urn:schemas-microsoft-com:office:excel">
<head><meta charset="UTF-8"><meta name="ProgId" content="Excel.Sheet">
<style>table{border-collapse:collapse;font-family:system-ui,Arial,sans-serif;font-size:12px}</style></head>
<body><table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table></body></html>`;
  return descargar(
    new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8" }),
    `${sanea(nombreBase)}.xls`
  );
}

/** Mide el ancho aproximado (px) de un texto, para dimensionar el PNG. */
function ancho(ctx: CanvasRenderingContext2D, texto: string): number {
  return ctx.measureText(String(texto ?? "")).width;
}

/**
 * Dibuja el reporte en un canvas y devuelve su PNG como Data URL. Es un resumen
 * profesional (encabezado + KPIs + tabla del detalle), sin depender de
 * `html2canvas`. Devuelve "" si el navegador no expone canvas.
 */
export function imagenReportePng(
  kpis: KpisReporte,
  detalle: DetalleJugada[],
  encabezado: EncabezadoReporte
): string {
  if (typeof document === "undefined") return "";
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  const pad = 24;
  const filaAlto = 26;
  const anchos = [90, 130, 60, 150, 110, 130, 80, 90, 70, 100]; // columnas del detalle
  const anchoTabla = anchos.reduce((a, b) => a + b, 0);
  const ancho = Math.max(760, anchoTabla + pad * 2);
  const filasVisibles = detalle.slice(0, 30);
  const yBase = 250;
  const alto = yBase + (filasVisibles.length + 1) * filaAlto + 60;

  canvas.width = ancho;
  canvas.height = alto;

  // Fondo
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, ancho, alto);

  // Cabecera
  ctx.fillStyle = "#0f172a";
  ctx.fillRect(0, 0, ancho, 64);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 20px system-ui, Arial";
  ctx.fillText("REPORTE DE COMISIONES POR CONVENIO", pad, 40);

  ctx.fillStyle = "#0f172a";
  ctx.font = "bold 16px system-ui, Arial";
  ctx.fillText(`Grupo: ${encabezado.grupo || "—"}`, pad, 96);
  ctx.font = "13px system-ui, Arial";
  ctx.fillStyle = "#475569";
  ctx.fillText(
    `Rango: ${fechaLegible(encabezado.desde)} al ${fechaLegible(encabezado.hasta)}`,
    pad,
    118
  );

  // KPIs (4 tarjetas)
  const tarjetas: Array<[string, string]> = [
    ["Volumen jugado", formatearDinero(kpis.volumen, kpis.moneda)],
    ["Jugadas decididas", `${kpis.decididas} de ${kpis.jugadas}`],
    ["% aplicado", `${kpis.pctAplicado}%`],
    ["Comisión a favor", formatearDinero(kpis.comision, kpis.moneda)],
  ];
  const cardW = (ancho - pad * 2 - 3 * 12) / 4;
  tarjetas.forEach(([titulo, valor], i) => {
    const x = pad + i * (cardW + 12);
    ctx.fillStyle = "#f1f5f9";
    ctx.fillRect(x, 140, cardW, 60);
    ctx.fillStyle = "#64748b";
    ctx.font = "11px system-ui, Arial";
    ctx.fillText(titulo.toUpperCase(), x + 10, 162);
    ctx.fillStyle = "#0f172a";
    ctx.font = "bold 16px system-ui, Arial";
    ctx.fillText(valor, x + 10, 186);
  });

  // Tabla
  let y = yBase - filaAlto;
  ctx.fillStyle = "#334155";
  ctx.font = "bold 11px system-ui, Arial";
  let x = pad;
  const cabeceras = [...COLUMNAS_DETALLE];
  cabeceras.forEach((c, i) => {
    ctx.fillText(c.length > 16 ? c.slice(0, 15) + "…" : c, x + 4, y + 17);
    x += anchos[i];
  });
  y += filaAlto;
  ctx.strokeStyle = "#cbd5e1";
  ctx.beginPath();
  ctx.moveTo(pad, y);
  ctx.lineTo(ancho - pad, y);
  ctx.stroke();

  filasVisibles.forEach((d, r) => {
    const celdas = [
      fechaLegible(d.fecha),
      d.hipodromo,
      d.carrera,
      d.cliente,
      d.producto,
      d.detalle,
      d.estado,
      formatearDinero(d.monto, d.moneda),
      `${d.pct}%`,
      formatearDinero(d.comision, d.moneda),
    ];
    if (r % 2 === 1) {
      ctx.fillStyle = "#f8fafc";
      ctx.fillRect(pad, y, ancho - pad * 2, filaAlto);
    }
    ctx.fillStyle = "#0f172a";
    ctx.font = "11px system-ui, Arial";
    let cx = pad;
    celdas.forEach((c, i) => {
      const texto = String(c ?? "");
      const disp = texto.length > 22 ? texto.slice(0, 21) + "…" : texto;
      ctx.fillText(disp, cx + 4, y + 17);
      cx += anchos[i];
    });
    y += filaAlto;
  });

  if (detalle.length > filasVisibles.length) {
    ctx.fillStyle = "#64748b";
    ctx.font = "italic 11px system-ui, Arial";
    ctx.fillText(`… y ${detalle.length - filasVisibles.length} jugada(s) más (ver exportación Excel).`, pad, y + 16);
  }

  return canvas.toDataURL("image/png");
}

/**
 * Copia el PNG del reporte al portapapeles. Si el navegador no soporta
 * `ClipboardItem`, cae a DESCARGAR el PNG. Devuelve "copiado" | "descargado" |
 * "" (si no se pudo generar la imagen).
 */
export async function copiarImagenReporte(
  kpis: KpisReporte,
  detalle: DetalleJugada[],
  encabezado: EncabezadoReporte,
  nombreBase: string
): Promise<"copiado" | "descargado" | ""> {
  const dataUrl = imagenReportePng(kpis, detalle, encabezado);
  if (!dataUrl) return "";

  // Intento 1: portapapeles de imágenes.
  try {
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      const blob = await (await fetch(dataUrl)).blob();
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      return "copiado";
    }
  } catch {
    /* sin permiso/soporte: se descarga */
  }

  // Intento 2: descargar el PNG.
  try {
    const blob = await (await fetch(dataUrl)).blob();
    return descargar(blob, `${sanea(nombreBase)}.png`) ? "descargado" : "";
  } catch {
    return "";
  }
}

/** Copia un texto al portapapeles (WhatsApp). */
export async function copiarTexto(texto: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(texto);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}
