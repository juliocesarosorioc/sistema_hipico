/**
 * Utilidades compartidas del motor de IMPRESIÓN de Tablas Fijas.
 * Replica 1:1 las funciones del legacy `imprimir tablas` / `reporte_tablas`
 * (PALETA14, auto-ajuste de fuente fsAuto, formateo es-VE, fechas dd/mm/aaaa).
 */

export const MAX_N = 20;
export const FS_BASE = 8.6;
export const FS_MIN = 7.4;
export const FS_MAX = 13.5;

/** Gualdrapas exactas del legacy (14 colores: [fondo, texto]). */
export const PALETA14: Array<[string, string]> = [
  ["#e11d48", "#ffffff"],
  ["#ffffff", "#111827"],
  ["#1d4ed8", "#ffffff"],
  ["#facc15", "#111827"],
  ["#16a34a", "#ffffff"],
  ["#111827", "#facc15"],
  ["#f97316", "#111827"],
  ["#fbcfe8", "#111827"],
  ["#22d3ee", "#111827"],
  ["#7c3aed", "#ffffff"],
  ["#9caeff", "#111827"],
  ["#84cc16", "#111827"],
  ["#92400e", "#ffffff"],
  ["#7f1d1d", "#ffffff"],
];

/** Color del número (índice sobre PALETA14, cíclico, mismo legacy). */
export function col(n: number | string): { bg: string; fg: string } {
  const i = ((parseInt(String(n), 10) || 1) - 1) % 14;
  const v = PALETA14[i < 0 ? 0 : i];
  return { bg: v[0], fg: v[1] };
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