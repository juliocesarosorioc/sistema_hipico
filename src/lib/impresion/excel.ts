/**
 * EXPORTACIÓN A EXCEL DE LA MATRIZ DE TABLAS FIJAS
 * ------------------------------------------------
 * Genera un `.xls` real (HTML con el namespace de Office, que Excel abre como
 * hoja de cálculo) que replica la VISTA DE IMPRESIÓN de las Tablas Fijas:
 *  · Misma paleta de MATRIZ_CSS (encabezado #0f172a, gualdrapas PALETA14,
 *    zebra #eef2f7, pie #f1f5f9, premio #047857, badge de alerta).
 *  · Mismo orden de bloques: UNA FILA POR CARRERA con encabezado (hipódromo +
 *    C#, DIST · superficie, moneda, fecha), una fila por ejemplar (número en
 *    su gualdrapa, nombre, monto) y el pie PREMIO/TABLA.
 *  · Anchos de columna fijos en puntos para que la tabla mida ~530pt (el
 *    ancho útil de una hoja A4 vertical), conservando el "tamaño" del impreso.
 *  · Todo el contenido se escribe como TEXTO (`mso-number-format:'\@'`) para
 *    que Excel no reinterprete montos ("1,234") ni números de ejemplar.
 *
 * Nota: la bandera de nacionalidad es un `<svg>` inline en la vista impresa;
 * Excel no importa SVG, así que se conserva el dato como código de país entre
 * paréntesis.
 */
import { esHipoAmericano, type TablaImpresion } from "@/lib/impresion/tablas";
import { esc, col, fmtPts, monSinSimb, monCode, fmtFecha, hoy } from "@/lib/impresion/util";
import { normalizarNacionalidad } from "@/components/ui/BanderaPais";

/* ─────────────────────────── PALETA (espejo de MATRIZ_CSS) ─────────────────────────── */
const C_FONDO = "#0f172a";
const C_FONDO2 = "#334155";
const C_LEG = "#cbd5e1";
const C_FECHA = "#7dd3fc";
const C_MONEDA = "#fde68a";
const C_ZEBRA = "#eef2f7";
const C_NOMBRE = "#334155";
const C_MONTO = "#475569";
const C_MONTO_CERO = "#94a3b8";
const C_RETIRADO = "#dc2626";
const C_PIE_BG = "#f1f5f9";
const C_PIE_TEXTO = "#475569";
const C_PREMIO = "#047857";
const C_BADGE_BG = "#fee2e2";
const C_BADGE_TEXTO = "#b91c1c";
const C_NORMAS = "#64748b";
const C_BORDE = "#cbd5e1";
const BLOQUE_BORDE = `0.75pt solid ${C_BORDE}`;

/** Anchos de columna en puntos (total 530pt ≈ ancho útil de A4 vertical). */
const COLS_PT = [42, 278, 82, 128];

const NORMAS =
  "NORMAS TABLAS FIJAS: tabla válida solo para la carrera y el ejemplar indicados. " +
  "El premio corresponde al valor publicado y vigente al momento del cobro. Presente este tablero en caja junto a su documento de identidad. " +
  "En caso de retiro o empate el pago se ajusta según el reglamento del hipódromo. " +
  "Cualquier alteración invalida la tabla.";

/* ─────────────────────────── CELDA ─────────────────────────── */
type AtributosCelda = {
  span?: number;
  bg?: string;
  fg?: string;
  /** `true` o un peso ≥600 → negrita (Excel solo distingue normal/bold). */
  negrita?: boolean | number;
  /** Tamaño en puntos. */
  tam?: number;
  alinear?: "left" | "right" | "center";
  tachado?: boolean;
  borde?: string;
  alto?: number;
  envolver?: boolean;
};

function celda(texto: string, a: AtributosCelda = {}): string {
  const est: string[] = ["vertical-align:middle"];
  if (a.bg) est.push(`background:${a.bg}`);
  if (a.fg) est.push(`color:${a.fg}`);
  if (a.negrita) est.push("font-weight:bold");
  if (a.tam) est.push(`font-size:${a.tam}pt`);
  if (a.alinear) est.push(`text-align:${a.alinear}`);
  if (a.tachado) est.push("text-decoration:line-through");
  if (a.borde) est.push(`border:${a.borde}`);
  est.push(a.envolver ? "white-space:normal;word-wrap:break-word" : "white-space:nowrap");
  // Todo como texto: si no, Excel "1,234" y el número de gualdrapa se reinterpreten.
  // Atributo con comillas simples para poder dejar las dobles de `"\@"`.
  est.push('mso-number-format:"\\@"');
  const span = a.span && a.span > 1 ? ` colspan="${a.span}"` : "";
  const alto = a.alto ? ` height="${a.alto}"` : "";
  return `<td${span}${alto} style='${est.join(";")}'>${texto}</td>`;
}

function fila(celdas: string[]): string {
  return `<tr>${celdas.join("")}</tr>`;
}

function filaVacia(alto: number): string {
  return `<tr><td colspan="${COLS_PT.length}" style="height:${alto}pt"></td></tr>`;
}

/* ─────────────────────────── CONSTRUCCIÓN ─────────────────────────── */

function bloqueCarrera(t: TablaImpresion, filas: string[]): void {
  const casa = esHipoAmericano(t.hipodromo) ? "USA" : "VE";
  const jugadoTotal = t.ejemplares.reduce((a, e) => a + e.jugado, 0);
  const sinEjemplares = t.ejemplares.length === 0;

  // Encabezado 1: HIPÓDROMO | C#
  filas.push(
    fila([
      celda(esc(t.hipodromo), { span: 3, bg: C_FONDO, fg: "#ffffff", negrita: true, tam: 14, borde: BLOQUE_BORDE, alto: 24 }),
      celda(`C${esc(t.carrera)}`, { bg: C_FONDO2, fg: "#ffffff", negrita: true, tam: 14, alinear: "right", borde: BLOQUE_BORDE }),
    ])
  );

  // Encabezado 2: DIST · superficie | moneda | fecha
  const meta = [t.distancia ? `DIST ${t.distancia} m` : "", t.superficie].filter(Boolean).join(" · ");
  filas.push(
    fila([
      celda(esc(meta), { span: 2, bg: C_FONDO, fg: C_LEG, negrita: true, tam: 10, borde: BLOQUE_BORDE, alto: 16 }),
      celda(monCode(t.moneda), { bg: C_FONDO2, fg: C_MONEDA, negrita: true, tam: 10, alinear: "center", borde: BLOQUE_BORDE }),
      celda(fmtFecha(t.fecha), { bg: C_FONDO, fg: C_FECHA, negrita: true, tam: 10, alinear: "right", borde: BLOQUE_BORDE }),
    ])
  );

  // Badge ⚠ SIN APUESTAS (mismo disparador que la tarjeta impresa).
  if (jugadoTotal === 0) {
    filas.push(
      fila([
        celda("\u26A0 SIN APUESTAS", {
          span: COLS_PT.length,
          bg: C_BADGE_BG,
          fg: C_BADGE_TEXTO,
          negrita: true,
          tam: 9,
          alinear: "center",
          borde: BLOQUE_BORDE,
          alto: 16,
        }),
      ])
    );
  }

  if (sinEjemplares) {
    filas.push(
      fila([
        celda("SIN APUESTAS", {
          span: COLS_PT.length,
          fg: C_RETIRADO,
          negrita: true,
          tam: 11,
          alinear: "center",
          borde: BLOQUE_BORDE,
          alto: 18,
        }),
      ])
    );
  }

  // Filas de ejemplares (zebra en las impares, gualdrapa, monto).
  t.ejemplares.forEach((e, i) => {
    const c = col(e.numero);
    const nac = e.nacionalidad && String(e.nacionalidad).trim() ? normalizarNacionalidad(e.nacionalidad) : casa;
    const pais = nac && nac !== casa && nac !== "OTRA" ? ` (${esc(nac)})` : "";
    const val = e.valor_ejemplar;
    const zebra = i % 2 === 0 ? C_ZEBRA : "";
    filas.push(
      fila([
        celda(esc(e.numero), {
          bg: c.bg,
          fg: c.fg,
          negrita: true,
          tam: 10,
          alinear: "center",
          borde: BLOQUE_BORDE,
          alto: 16,
        }),
        celda(esc(e.nombre) + pais, {
          bg: zebra,
          fg: e.retirado ? C_RETIRADO : C_NOMBRE,
          negrita: 700,
          tam: 10,
          tachado: e.retirado,
          borde: BLOQUE_BORDE,
        }),
        celda(val === 0 ? "\u2013" : esc(fmtPts(val)), {
          span: 2,
          bg: zebra,
          fg: val === 0 ? C_MONTO_CERO : C_MONTO,
          negrita: 800,
          tam: 10,
          alinear: "right",
          borde: BLOQUE_BORDE,
        }),
      ])
    );
  });

  // Pie: PREMIO/TABLA
  filas.push(
    fila([
      celda("PREMIO/TABLA", { bg: C_PIE_BG, fg: C_PIE_TEXTO, negrita: true, tam: 9, borde: BLOQUE_BORDE, alto: 22 }),
      celda(monSinSimb(t.premio), {
        span: 3,
        bg: C_PIE_BG,
        fg: C_PREMIO,
        negrita: true,
        tam: 13,
        alinear: "right",
        borde: BLOQUE_BORDE,
      }),
    ])
  );
}

/** Devuelve el HTML completo listo para guardarse como `.xls`. */
export function htmlExcelTablas(carreras: TablaImpresion[]): string {
  const filas: string[] = [];

  // Título de la hoja (equivale a la cabecera de página de la vista impresa).
  filas.push(
    fila([
      celda(`TABLAS FIJAS PUBLICADAS \u00B7 ${hoy()}`, {
        span: COLS_PT.length,
        bg: C_FONDO,
        fg: "#ffffff",
        negrita: true,
        tam: 15,
        alto: 30,
      }),
    ])
  );
  filas.push(filaVacia(6));

  carreras.forEach((t, idx) => {
    bloqueCarrera(t, filas);
    if (idx < carreras.length - 1) filas.push(filaVacia(8));
  });

  filas.push(filaVacia(6));
  filas.push(
    fila([
      celda(NORMAS, {
        span: COLS_PT.length,
        fg: C_NORMAS,
        negrita: 600,
        tam: 8,
        alinear: "center",
        envolver: true,
        alto: 46,
      }),
    ])
  );

  const cols = COLS_PT.map((w) => `<col style="width:${w}pt">`).join("");

  return `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
<meta name="ProgId" content="Excel.Sheet">
<meta name="Generator" content="Sistema Hípico">
<title>Tablas Fijas Publicadas</title>
<!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>Tablas Fijas</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
<style>
body{margin:0;}
table{border-collapse:collapse;font-family:system-ui,Arial,sans-serif;}
td{font-family:system-ui,Arial,sans-serif;}
</style>
</head>
<body>
<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:${COLS_PT.reduce((a, b) => a + b, 0)}pt">
<colgroup>${cols}</colgroup>
<tbody>
${filas.join("\n")}
</tbody>
</table>
</body>
</html>`;
}

/**
 * Genera y descarga el archivo Excel de la matriz.
 * Devuelve `false` si no hay carreras que exportar.
 */
export function exportarExcelTablas(carreras: TablaImpresion[], nombreBase?: string): boolean {
  if (!carreras || carreras.length === 0) return false;
  if (typeof document === "undefined" || typeof URL === "undefined" || !URL.createObjectURL) return false;

  const html = htmlExcelTablas(carreras);
  const blob = new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const base = (nombreBase || `TABLAS-FIJAS-${hoy()}`).replace(/[\\/:*?"<>|]+/g, "-");
  a.href = url;
  a.download = `${base}.xls`;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return true;
}
