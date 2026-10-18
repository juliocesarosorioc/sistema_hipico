/**
 * Utilidades compartidas del motor de IMPRESIÓN de Tablas Fijas.
 * Replica 1:1 las funciones del legacy `imprimir tablas` / `reporte_tablas`
 * (auto-ajuste de fuente fsAuto, formateo es-VE, fechas dd/mm/aaaa).
 * Las gualdrapas NO se replican: salen de `shared/lib/horseColors`.
 */
import { getHorseColor } from "@/shared/lib/horseColors";

export const MAX_N = 20;
export const FS_BASE = 8.6;
export const FS_MIN = 7.4;
export const FS_MAX = 13.5;

/** Orientación de hoja A4: vertical (retrato) u horizontal (paisaje). */
export type Orientacion = "vertical" | "horizontal";

/** Dimensiones de página A4 @150dpi: vertical 1240×1754, horizontal 1754×1240. */
export const DIM_PAGINA: Record<Orientacion, { w: number; h: number }> = {
  vertical: { w: 1240, h: 1754 },
  horizontal: { w: 1754, h: 1240 },
};

/**
 * Gualdrapas (1..14) de la impresión — derivadas de la fuente única
 * `shared/lib/horseColors`, no de una lista propia: así el papel pinta el MISMO
 * color que la pantalla. Se conserva el nombre por compatibilidad con el motor
 * de Tablas/Reporte/Excel.
 */
export const PALETA14: Array<[string, string]> = Array.from({ length: 14 }, (_, i) => {
  const c = getHorseColor(i + 1);
  return [c.hex, c.hexText] as [string, string];
});

/**
 * Color del número para estilos inline del HTML impreso / Excel.
 * Delega en `getHorseColor`: codificación 1..20 y fuera de rango cae al gris de
 * respaldo (mismo color en todas partes).
 */
export function col(n: number | string): { bg: string; fg: string } {
  const c = getHorseColor(n);
  return { bg: c.hex, fg: c.hexText };
}

/**
 * Auto-ajuste de fuente por tarjeta (mismo motor del legacy):
 * px = BASE * MAX_N / N, acotado a [FS_MIN, FS_MAX] con 1 decimal.
 */
export function fsAuto(n: number): number {
  const num = Math.min(Math.max(parseInt(String(n || 1), 10) || 1, 1), MAX_N);
  const p = (FS_BASE * MAX_N) / num;
  return Math.floor(Math.min(FS_MAX, Math.max(FS_MIN, p)) * 10) / 10;
}

/** Escapa texto para HTML. */
export function esc(s: unknown): string {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Número con formato es-VE (2 decimales). */
export function fmt(n: number | string): string {
  try {
    return new Intl.NumberFormat("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(parseFloat(String(n)) || 0);
  } catch {
    return (parseFloat(String(n)) || 0).toFixed(2);
  }
}

/** Prefijo de moneda + valor: "Bs 1,23" o "$ 1,23". */
export function mon(v: number | string, m?: string | null): string {
  const s = String(m || "USD").toUpperCase();
  return s.indexOf("VES") >= 0 || s === "BS" ? `Bs ${fmt(v)}` : `$ ${fmt(v)}`;
}

/**
 * Valor SIN símbolo de moneda ("1,23"). La moneda se estipula según el grupo
 * que juega el usuario (t.moneda): los montos se imprimen limpios y el dígito
 * de moneda se muestra en la leyenda del encabezado de cada tarjeta.
 */
export function monSinSimb(v: number | string): string {
  return fmt(v);
}

/**
 * PUNTOS de un ejemplar para imprimir: SIEMPRE sin decimales.
 *
 * Replica el legacy, que imprimia el valor de la grilla con `fmt(v, 0)`
 * (js/components/impresion_tablas.js:118) mientras el premio usaba `fmt(premio)`
 * con 2 (linea 130). La distincion es a proposito: los puntos son un divisor
 * (premio * valor / suma_base_tabla), y el separador de miles ayuda a leerlos
 * de un vistazo; el premio es dinero y se mantiene con centimos.
 *
 * Solo afecta la CAPA DE VISTA. El valor sigue entero y con decimales en el
 * dato (`valor_ejemplar`, `suma_base_tabla`), que es de donde salen la suma y
 * el prorrateo del premio ante un retiro. Acá se redondea, nunca se trunca:
 * truncar 24.7 a 24 bajaria la base y moveria el premio del resto.
 */
export function fmtPts(v: number | string): string {
  const n = parseFloat(String(v));
  if (!Number.isFinite(n)) return "0";
  return new Intl.NumberFormat("es-VE", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
}

/** Código corto de la moneda (USD / BS) para la leyenda del grupo. */
export function monCode(m?: string | null): string {
  const s = String(m || "USD").toUpperCase();
  return s.indexOf("VES") >= 0 || s === "BS" ? "BS" : "USD";
}

/** dd/mm/aaaa desde ISO (o — si falta). */
export function fmtFecha(d?: string | null): string {
  if (!d) return "—";
  const p = String(d).slice(0, 10).split("-");
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : String(d);
}

/** Fecha de HOY en dd/mm/aaaa (para encabezados). */
export function hoy(): string {
  const d = new Date();
  return `${("0" + d.getDate()).slice(-2)}/${("0" + (d.getMonth() + 1)).slice(-2)}/${d.getFullYear()}`;
}

/** Clave normalizada de hipódromo (mayúsculas, sin espacios). */
export function hipoKey(h?: string | null): string {
  return String(h ?? "")
    .toUpperCase()
    .replace(/\s+/g, "");
}

/** Día ISO (YYYY-MM-DD) de una fecha o fecha_creacion. */
export function diaDe(fecha?: string | null, fechaCreacion?: string | null): string {
  const raw = String(fecha || fechaCreacion || "").trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  return raw.slice(0, 10);
}