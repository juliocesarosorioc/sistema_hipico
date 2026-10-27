/**
 * NÚCLEO PURO del Reporte de MARCAS JUGADAS.
 *
 * Una marca es un ticket en `tickets_apuestas` (ver sql/marcas_venta.sql) con
 * `nota_auditoria.origen = 'MARCAS'`. La fila es la MISMA que la de una tabla
 * fija, así que reutiliza `normalizarVenta` del núcleo de tablas; acá solo se
 * agregan los dos datos que hacen a la marca distinta:
 *
 *   · el TICKET guarda `caballo = '<n>'` (solo el número de la marca elegida) y
 *     el rival/oponente en `nota_auditoria.rivales_snapshot`. Para que el detalle
 *     no muestre el número dos veces, la columna `caballo` se compone como
 *     "MARCA <n> vs <rivales>";
 *   · el día que importa es el de la CARRERA (columna `fecha_carrera`, que llena
 *     el trigger `trg_tickets_fecha_carrera`), no el de la venta.
 *
 * No hay React ni Supabase acá: es lógica pura, testeable en node
 * (pruebas/reporte-marcas.test.ts) igual que el resto de los "-nucleo".
 */
import {
  normalizarVenta,
  type VentaTablaReporte,
} from "@/features/tablas/lib/reporte-tablas-nucleo";

const texto = (v: unknown): string => (v == null ? "" : String(v).trim());

/** Lee `nota_auditoria` (JSON string u objeto ya parseado) sin reventar. */
export function leerNota(raw: unknown): Record<string, unknown> {
  let obj: unknown = raw;
  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s.startsWith("{")) return {};
    try {
      obj = JSON.parse(s);
    } catch {
      return {};
    }
  }
  return obj && typeof obj === "object" ? (obj as Record<string, unknown>) : {};
}

/**
 * Números de los rivales del match (los "vs") guardados al vender la marca.
 * Soporta solo / con espacios / con strings.
 */
export function rivalesDeNota(raw: unknown): string[] {
  const nota = leerNota(raw);
  const lista = nota.rivales_snapshot;
  if (!Array.isArray(lista)) return [];
  return lista.map((r) => texto(r)).filter(Boolean);
}

/**
 * Etiqueta del ejemplar para el reporte: la marca elegida y su rival del match.
 * El ticket trae `caballo = '<n>'`, así que sin componer el matchup el detalle
 * mostraría el número dos veces.
 */
export function etiquetaMarca(row: Record<string, unknown>): string {
  const numsCab = (texto(row.caballo).match(/\d+/g) ?? []).map((x) => x.trim());
  const numero = texto(row.ejemplar_numero) || numsCab[0] || texto(row.caballo);
  const base = numero ? `MARCA ${numero}` : "MARCA";
  let rivales = rivalesDeNota(row.nota_auditoria);
  if (!rivales.length && numsCab.length >= 2) {
    rivales = numsCab.filter((n, idx) => idx > 0 && n !== numero);
  }
  if (!rivales.length) {
    const numsJug = (texto(row.nombre_jugada).match(/\d+/g) ?? []).map((x) => x.trim());
    rivales = numsJug.filter((n) => n !== numero);
  }
  return rivales.length ? `${base} x ${rivales.join(" x ")}` : base;
}

/** Mapea una fila cruda de `tickets_apuestas` (marca) al modelo del reporte. */
export function normalizarMarca(row: Record<string, unknown>): VentaTablaReporte {
  const v = normalizarVenta(row);
  return {
    ...v,
    // El matchup es la esencia de la jugada: se muestra en la columna Ejemplar.
    caballo: etiquetaMarca(row),
    // El día del reporte es el de la CARRERA (`nota_auditoria.fecha_carrera` o `fecha_carrera`).
    fecha: v.fecha || texto(row.fecha_carrera).slice(0, 10),
  };
}

/** Normaliza un lote de filas crudas. */
export function normalizarMarcas(rows: Record<string, unknown>[]): VentaTablaReporte[] {
  return rows.map(normalizarMarca);
}