/**
 * Impresión de Tablas Fijas Publicadas — paridad 1:1 con el legacy
 * `js/components/impresion_tablas.js` (que operaba en GitHub Pages).
 *
 * Todo client-side, SIN backend de Next:
 *  · PDF  → html2canvas de la vista densa + jsPDF (landscape letter, paginado
 *    real por hoja). No depende del diálogo "Guardar como PDF" del navegador.
 *  · JPG/PNG → html2canvas a alta resolución + descarga nativa con <a download>.
 *
 * La vista densa es un bloque oculto (position:fixed; left:-9999px) con:
 *  · cabeceras azul marino oscuro degradadas, fondo blanco,
 *  · alineación ultracompacta sin scroll: 15 tablas por hoja (5×3),
 *  · paleta oficial de 14 gualdrapas (colorDeNumero/textoDeNumero).
 *
 * Recibe las tablas ya cargadas (la UI cierra/captura el documento antes de
 * llamar aquí). NO captura la UI administrativa ni los botones oscuros.
 */
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { colorDeNumero, textoDeNumero, parseNum, fmtMoney } from "@/lib/tablas/tipos";
import type { StoredTablaFija } from "@/store/useTablasFijasStore";

export type FormatoImpresion = "PDF" | "JPG" | "PNG";

export type FiltrosImpresion = {
  hipodromo?: string;
  dia?: string;
};

export type ResultadoImpresion = {
  ok: boolean;
  error?: string;
  archivo?: string;
  paginas?: number;
  tablas?: number;
};

/* Dimensiones de diseño (px). Proporción carta horizontal 11×8.5in. */
const ANCHO = 1400;
const ALTO_HOJA = Math.round((ANCHO * 215.9) / 279.4); // ~1083px
const POR_HOJA = 15;

const ESTILOS = `
* { box-sizing: border-box; }
.imp-pages { position: fixed; left: -9999px; top: 0; width:${ANCHO}px; background:#fff; font-family:'Segoe UI',Arial,sans-serif; color:#0f172a; z-index:-1; }
.hoja { width:${ANCHO}px; height:${ALTO_HOJA}px; padding:12px 12px 10px; display:flex; flex-direction:column; gap:5px; break-after:always; page-break-after:always; background:#fff; }
.hoja:last-child { break-after:auto; page-break-after:auto; }
.cabecera-hoja { border-bottom:3px solid #1d4ed8; padding-bottom:3px; }
.titulo-hoja { font-size:20px; font-weight:900; letter-spacing:1px; color:#1e3a8a; text-transform:uppercase; }
.sub-hoja { font-size:11px; color:#64748b; font-weight:600; margin-top:1px; }
.grilla-15 { flex:1; min-height:0; display:grid; grid-template-columns:repeat(5,1fr); grid-template-rows:repeat(3,1fr); gap:6px; }
.tabla-imp { border:1.5px solid #334155; border-radius:7px; overflow:hidden; display:flex; flex-direction:column; background:#fff; box-shadow:0 1px 2px rgba(15,23,42,.08); min-height:0; }
.hd-tabla { background:linear-gradient(135deg,#1e40af,#4338ca); color:#fff; display:flex; justify-content:space-between; align-items:center; padding:3px 8px; }
.hd-hipo { font-size:13px; font-weight:900; text-transform:uppercase; letter-spacing:.3px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.hd-carrera { font-size:15px; font-weight:900; background:rgba(255,255,255,.18); border-radius:5px; padding:0 7px; }
.hd-premio { display:flex; justify-content:space-between; align-items:center; font-size:10px; font-weight:800; color:#b45309; padding:2px 8px; background:#fffbeb; border-bottom:1px solid #f1f5f9; text-transform:uppercase; }
.hd-premio .premio-val { font-size:13px; font-weight:900; color:#b45309; }
.grilla-prin { flex:1; min-height:0; display:flex; flex-direction:column; padding:0; overflow:hidden; }
.grilla-ej { display:grid; align-items:center; align-content:center; gap:1px; padding:0; margin:0; border-bottom:1px solid #eef2f7; flex:1; min-height:0; line-height:1; }
.grilla-ej:last-child { border-bottom:none; }
.grilla-ej:nth-child(even) { background:#f3f6fb; }
.grilla-ej.retirado { opacity:.40; }
.nro-grilla { border-radius:3px; border:1px solid; display:flex; align-items:center; justify-content:center; font-weight:900; flex:none; flex-shrink:0; align-self:center; margin:0; padding:0; line-height:1; }
.nombre-grilla { font-weight:700; text-transform:uppercase; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; min-width:0; align-self:center; line-height:1; }
.valor-grilla { font-weight:800; color:#1d4ed8; text-align:right; white-space:nowrap; padding-left:4px; align-self:center; line-height:1; }
.sin-ej { grid-column:1/-1; font-size:11px; color:#94a3b8; font-style:italic; padding:12px; }
.notas-hoja { display:flex; justify-content:space-between; gap:14px; font-size:10.5px; color:#78350f; background:#fffbeb; border:1px solid #fcd34d; border-radius:6px; padding:4px 10px; font-weight:700; }
`;

function limpiarValor(c: { valor_ejemplar?: number | string | null; valor?: number | string | null; pts?: number | string | null }): number {
  const v = parseFloat(String(c.valor_ejemplar ?? c.valor ?? c.pts ?? ""));
  return Number.isFinite(v) ? v : 0;
}

/** Devuelve estilos inline de la tarjeta según la cantidad de ejemplares
    (lista VERTICAL compacta; letra adaptativa para que TODO quepa). */
function tamanoTarjeta(n: number) {
  const rows = Math.max(1, n);
  const altoLista = 280;
  const filaH = altoLista / rows;
  const k = Math.min(1, Math.max(0.5, filaH / 18));
  const fsNom = Math.round(Math.min(9.5, Math.max(5.5, filaH * 0.5)) * 10) / 10;
  const fsVal = Math.round(fsNom * 1.3 * 10) / 10;
  return {
    rows,
    k,
    nroW: Math.max(14, Math.round(22 * k)),
    nroH: Math.max(13, Math.round(17 * k)),
    fsNum: Math.round(Math.min(11, Math.max(7, filaH * 0.62)) * 10) / 10,
    fsNom,
    box: `${Math.round(22 * k)}px ${Math.round(17 * k)}px`,
    fsVal,
  };
}

function cardHTML(t: StoredTablaFija): string {
  const premio = parseNum(t.premio_recalculado);
  const ejemplares = Array.isArray(t.caballos) ? t.caballos : [];
  const T = tamanoTarjeta(ejemplares.length);

  const grilla =
    ejemplares
      .map((c) => {
        const bg = colorDeNumero(c.numero);
        const fg = textoDeNumero(c.numero);
        const ret = !!c.retirado;
        return `
          <div class="grilla-ej ${ret ? "retirado" : ""}" style="grid-template-columns:${T.box} 1fr auto">
            <div class="nro-grilla" style="background:${bg};color:${fg};border-color:${bg};width:${T.nroW}px;height:${T.nroH}px;font-size:${T.fsNum}px">${c.numero ?? ""}</div>
            <div class="nombre-grilla" style="font-size:${T.fsNom}px">${String(c.nombre || "").replace(/"/g, "&quot;")}</div>
            <div class="valor-grilla" style="font-size:${T.fsVal}px">${ret ? "RET." : fmtMoney(limpiarValor(c), t.moneda)}</div>
          </div>`;
      })
      .join("") || '<div class="sin-ej">Sin ejemplares registrados.</div>';

  return `
    <div class="tabla-imp">
      <div class="hd-tabla">
        <div class="hd-hipo">${t.hipodromo || ""}</div>
        <div class="hd-carrera">C${t.carrera ?? ""}</div>
      </div>
      <div class="hd-premio">
        <span>Monto a Pagar / Tabla</span>
        <span class="premio-val">${fmtMoney(premio, t.moneda)}</span>
      </div>
      <div class="grilla-prin">${grilla}</div>
    </div>`;
}

function todoTablasHTML(tablas: StoredTablaFija[], paginas: StoredTablaFija[][]): HTMLElement {
  const fecha = new Date().toLocaleString("es-VE", { dateStyle: "short", timeStyle: "short" });
  const hojas = paginas
    .map(
      (pag, pidx) => `
      <div class="hoja">
        <div class="cabecera-hoja">
          <div class="titulo-hoja">TABLAS FIJAS PUBLICADAS</div>
          <div class="sub-hoja">${fecha} · Hoja ${pidx + 1} de ${paginas.length} · Total ${tablas.length} carreras · última versión de valores</div>
        </div>
        <div class="grilla-15">
          ${pag.map(cardHTML).join("")}
        </div>
        <div class="notas-hoja">
          <span>⚠️ Monto a cobrar sujeto a ajuste por retiros de ejemplares.</span>
          <span>⚖️ En caso de empates se divide el premio.</span>
        </div>
      </div>`
    )
    .join("");

  const contenedor = document.createElement("div");
  contenedor.id = "contenedorImagenTablas";
  contenedor.className = "imp-pages";
  const estilos = document.createElement("style");
  estilos.innerHTML = ESTILOS;
  contenedor.appendChild(estilos);
  const envoltura = document.createElement("div");
  envoltura.innerHTML = hojas;
  contenedor.appendChild(envoltura);
  return contenedor;
}

async function renderCanvas(contenedor: HTMLElement, scale: number): Promise<HTMLCanvasElement> {
  document.body.appendChild(contenedor);
  try {
    await new Promise((r) => setTimeout(r, 150));
    if (document.fonts && document.fonts.ready) {
      try {
        await document.fonts.ready;
      } catch {
        /* sin fuentes */
      }
    }
    await new Promise((r) => setTimeout(r, 60));
    const canvas = await html2canvas(contenedor, {
      scale: scale || 2,
      useCORS: true,
      backgroundColor: "#ffffff",
      logging: false,
      // CLAVE: sin el offset de scroll el contenido se dibuja desplazado
      // hacia abajo (todo "cae" y lo tapa la fila inferior).
      scrollX: 0,
      scrollY: 0,
    });
    return canvas;
  } finally {
    contenedor.remove();
  }
}

function descargarURL(url: string, nombre: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export async function generarPDF(canvas: HTMLCanvasElement, nombreArchivo: string): Promise<{ paginas: number }> {
  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "letter" });
  const W_cm = 279.4;
  const H_cm = 215.9;
  // Tamaño en px de cada hoja dentro del canvas (scale aplicado al render).
  const esc = canvas.width / ANCHO;
  const hHojaPx = Math.round(ALTO_HOJA * esc);
  const numHojas = Math.max(1, Math.round(canvas.height / hHojaPx));
  const imagenPorHoja = numHojas <= 1 ? canvas : null;

  if (imagenPorHoja) {
    pdf.addImage(imagenPorHoja.toDataURL("image/jpeg", 0.95), "JPEG", 0, 0, W_cm, H_cm);
  } else {
    const aux = document.createElement("canvas");
    aux.width = canvas.width;
    aux.height = hHojaPx;
    const ctx = aux.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D no disponible.");
    for (let i = 0; i < numHojas; i++) {
      if (i > 0) pdf.addPage();
      const sy = Math.min(i * hHojaPx, canvas.height - hHojaPx);
      ctx.clearRect(0, 0, aux.width, aux.height);
      ctx.drawImage(canvas, 0, sy, canvas.width, hHojaPx, 0, 0, aux.width, hHojaPx);
      pdf.addImage(aux.toDataURL("image/jpeg", 0.95), "JPEG", 0, 0, W_cm, H_cm);
    }
  }
  pdf.save(nombreArchivo);
  return { paginas: numHojas };
}

/**
 * Genera el documento (PDF/JPG/PNG) de las tablas fijas publicadas.
 * Las tablas ya deben venir filtradas por hipódromo/día si se requiere.
 */
export async function imprimirTablasPublicadas(
  tablas: StoredTablaFija[],
  formato: FormatoImpresion,
  filtros: FiltrosImpresion = {}
): Promise<ResultadoImpresion> {
  if (tablas.length === 0) {
    return { ok: false, error: "No hay tablas publicadas para imprimir (estado \"Abierta\")." };
  }
  const ordenadas = [...tablas].sort(
    (a, b) =>
      String(a.hipodromo || "").localeCompare(String(b.hipodromo || ""), "es") ||
      (Number(a.carrera) || 0) - (Number(b.carrera) || 0)
  );
  const paginas: StoredTablaFija[][] = [];
  for (let i = 0; i < ordenadas.length; i += POR_HOJA) paginas.push(ordenadas.slice(i, i + POR_HOJA));

  const contenedor = todoTablasHTML(ordenadas, paginas);
  const prefijo = `tablas_fijas_${(filtros.dia || "todas").replace(/[^0-9-]/g, "")}_${Date.now()}`;

  const esPDF = String(formato).toUpperCase() === "PDF";
  const scale = esPDF ? 2.5 : 2;

  if (!esPDF) {
    // Formato imagen (JPG/PNG): html2canvas sobre un contenedor oculto.
    try {
      const canvas = await renderCanvas(contenedor, scale);
      const ext = String(formato).toUpperCase() === "PNG" ? "png" : "jpg";
      const url = canvas.toDataURL(ext === "png" ? "image/png" : "image/jpeg", ext === "png" ? undefined : 0.94);
      descargarURL(url, `${prefijo}.${ext}`);
      return { ok: true, archivo: `${prefijo}.${ext}`, tablas: ordenadas.length, paginas: paginas.length };
    } catch (err) {
      return { ok: false, error: `Error generando la imagen: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  // Formato PDF: jsPDF real (archivo válido, no depende del diálogo del navegador).
  try {
    const canvas = await renderCanvas(contenedor, scale);
    const { paginas: nHo } = await generarPDF(canvas, `${prefijo}.pdf`);
    return { ok: true, archivo: `${prefijo}.pdf`, tablas: ordenadas.length, paginas: nHo };
  } catch (err) {
    return { ok: false, error: `Error generando el PDF: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/** Descarga los filtros derivados. Útil para la UI del modal. */
export function diasDisponibles(tablas: StoredTablaFija[]): string[] {
  return [
    ...new Set(
      tablas
        .map((t) => String(t.fecha_creacion || t.fecha || "").slice(0, 10))
        .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    ),
  ].sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
}

export function hipodromosDisponibles(tablas: StoredTablaFija[]): string[] {
  return [...new Set(tablas.map((t) => String(t.hipodromo || "").trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "es")
  );
}

/** Aplica los filtros hipódromo/día a la lista de tablas. */
export function filtrarTablas(tablas: StoredTablaFija[], filtros: FiltrosImpresion): StoredTablaFija[] {
  let out = tablas;
  if (filtros.hipodromo) {
    out = out.filter((t) => String(t.hipodromo || "").trim().toLowerCase() === filtros.hipodromo!.trim().toLowerCase());
  }
  if (filtros.dia) {
    out = out.filter((t) => String(t.fecha_creacion || t.fecha || "").slice(0, 10) === String(filtros.dia).slice(0, 10));
  }
  return out;
}