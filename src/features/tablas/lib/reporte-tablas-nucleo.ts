/**
 * NÚCLEO PURO del Reporte de Tablas Fijas vendidas.
 *
 * Convierte las filas de `tickets_apuestas` (una por ejemplar jugado) en un
 * modelo de reporte y calcula los agregados (totales y por dimensión). No hay
 * React ni Supabase acá: es lógica pura, así que se puede testear en node
 * (pruebas/reporte-tablas.test.ts) igual que el resto de los "-nucleo".
 *
 * MODELO (tomado de sql/tablas_venta.sql):
 *   · Cada venta escribe un ticket con `nombre_jugada = 'TABLA FIJA (HIPO Cn)'`,
 *     el `ejemplar_numero` jugado, `monto_jugado`, y congela `premio_por_tabla`,
 *     `pts_ejemplar` y `comision_porcentaje` (la tasa del GRUPO).
 *   · Al liquidar: estado 'Ganador' | 'Perdedor'; `premio_pagar` = lo que recibe
 *     el jugador; `comision_pagada` = lo que se lleva el grupo (solo sobre la
 *     ganancia). Los retirados pasan a 'Retirado' y se reembolsa el monto.
 *   · "En riesgo" = todo lo vendido; el balance del grupo a favor es
 *     vendido − reembolsado − pagado.
 */

/** Una venta (1 ticket = 1 ejemplar jugado) ya normalizada para el reporte. */
export type VentaTablaReporte = {
  id: string;
  hipodromo: string;
  carrera: number;
  numero: string;
  caballo: string;
  jugadorId: string;
  jugador: string;
  grupoId: string;
  grupo: string;
  monto: number;
  cantidad: number;
  pts: number;
  premioPorTabla: number;
  comisionPct: number;
  estado: string;
  pagado: number;
  comision: number;
  moneda: string;
  /** Día de la carrera (nota `fecha_carrera`) o, si falta, el de la venta. */
  fecha: string;
  /** Día LOCAL de la venta (`fecha_registro`); patrón de consulta adicional. */
  fechaVenta: string;
};

/** Dimensiones por las que se puede estructurar (pivotar) el reporte. */
export type DimensionReporte = "grupo" | "hipodromo" | "carrera" | "jugador";

export type TotalesReporte = {
  tickets: number;
  jugadores: number;
  enRiesgo: number;
  ganadores: number;
  perdidos: number;
  pendientes: number;
  retirados: number;
  pagado: number;
  reembolsado: number;
  comision: number;
  /** A favor del grupo: enRiesgo − reembolsado − pagado. */
  balance: number;
};

export type FilaReporte = TotalesReporte & { clave: string; etiqueta: string };

export type OpcionReporte = { value: string; label: string };

export type FiltrosVenta = {
  grupo?: string;
  hipodromo?: string;
  carrera?: string;
  jugador?: string;
};

export type EstadoReporte = "Ganador" | "Perdedor" | "Pendiente" | "Retirado" | "Otro";

const texto = (v: unknown): string => (v == null ? "" : String(v).trim());

/** Número tolerante: acepta coma decimal y valores nulos/strings. */
export const cifra = (v: unknown): number => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const s = String(v ?? "").replace(",", ".").trim();
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
};

/** Estado normalizado (las etiquetas reales vienen en mixed case). */
export function estadoNormalizado(e: unknown): EstadoReporte {
  const s = texto(e).toLowerCase();
  if (s.startsWith("gan")) return "Ganador";
  if (s.startsWith("perd")) return "Perdedor";
  if (s.startsWith("retir")) return "Retirado";
  if (s.startsWith("pend")) return "Pendiente";
  return "Otro";
}

/**
 * Día de la carrera guardado en `nota_auditoria` (JSONB serializado a texto).
 * PostgREST puede entregar la columna como string JSON o como objeto ya
 * parseado; se toleran las dos formas y cualquier nota que no sea JSON.
 */
function fechaDeNota(raw: unknown): string {
  let obj: unknown = raw;
  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s.startsWith("{")) return "";
    try {
      obj = JSON.parse(s);
    } catch {
      return "";
    }
  }
  if (obj && typeof obj === "object") {
    return texto((obj as Record<string, unknown>).fecha_carrera).slice(0, 10);
  }
  return "";
}

/**
 * Día LOCAL (navegador/operador) de la venta a partir de `fecha_registro`
 * (timestamptz). Se alinea con `ventanaDiaLocal`: medianoche del operador, no el
 * prefijo UTC (que en Venezuela pasa al día siguiente después de las 20:00).
 */
function diaLocalDeVenta(raw: unknown): string {
  const s = texto(raw);
  if (!s) return "";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s.slice(0, 10);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dia}`;
}

/** Mapea una fila cruda de `tickets_apuestas` al modelo del reporte. */
export function normalizarVenta(row: Record<string, unknown>): VentaTablaReporte {
  const grupo = texto(row.grupo_cobro_nombre) || texto(row.grupo_comision_nombre) || texto(row.grupo);
  const jugador = texto(row.cliente_juega_nombre) || texto(row.cliente_juega_id);
  return {
    id: texto(row.id),
    hipodromo: texto(row.hipodromo).toUpperCase(),
    carrera: cifra(row.carrera),
    numero: texto(row.ejemplar_numero),
    caballo: texto(row.caballo),
    jugadorId: texto(row.cliente_juega_id) || jugador,
    jugador,
    grupoId: texto(row.grupo_cobro_id) || texto(row.grupo_comision_id) || grupo,
    grupo,
    monto: cifra(row.monto_jugado),
    cantidad: Math.max(1, Math.round(cifra(row.cantidad_tablas)) || 1),
    pts: cifra(row.pts_ejemplar),
    premioPorTabla: cifra(row.premio_por_tabla),
    comisionPct: cifra(row.comision_porcentaje),
    estado: texto(row.estado),
    pagado: cifra(row.premio_pagar),
    comision: cifra(row.comision_pagada),
    moneda: texto(row.moneda).toUpperCase() || "USD",
    fecha: fechaDeNota(row.nota_auditoria) || texto(row.fecha_registro).slice(0, 10),
    fechaVenta: diaLocalDeVenta(row.fecha_registro),
  };
}

/** Totales de un conjunto de ventas (sin agrupar). */
export function totalesDe(ventas: VentaTablaReporte[]): TotalesReporte {
  const t: TotalesReporte = {
    tickets: 0,
    jugadores: 0,
    enRiesgo: 0,
    ganadores: 0,
    perdidos: 0,
    pendientes: 0,
    retirados: 0,
    pagado: 0,
    reembolsado: 0,
    comision: 0,
    balance: 0,
  };
  const jugadores = new Set<string>();
  for (const v of ventas) {
    t.tickets += 1;
    jugadores.add(v.jugadorId || v.jugador || "?");
    t.enRiesgo += v.monto;
    t.comision += v.comision;
    switch (estadoNormalizado(v.estado)) {
      case "Ganador":
        t.ganadores += 1;
        t.pagado += v.pagado;
        break;
      case "Perdedor":
        t.perdidos += 1;
        break;
      case "Retirado":
        t.retirados += 1;
        t.reembolsado += v.monto;
        break;
      case "Pendiente":
        t.pendientes += 1;
        break;
      default:
        break;
    }
  }
  t.jugadores = jugadores.size;
  t.balance = t.enRiesgo - t.reembolsado - t.pagado;
  return t;
}

type Formateador = (h: string) => string;
const IDENTIDAD: Formateador = (h) => h;

/** Clave de agrupación/filtrado de una venta para una dimensión. */
export function claveDe(v: VentaTablaReporte, dim: DimensionReporte): string {
  switch (dim) {
    case "grupo":
      return v.grupoId || v.grupo || "(sin grupo)";
    case "jugador":
      return v.jugadorId || v.jugador || "(sin jugador)";
    case "hipodromo":
      return v.hipodromo || "(sin hipódromo)";
    case "carrera":
      // La carrera sola se repite entre hipódromos (C5 de uno y de otro), así
      // que la clave la incluye para no mezclar jornadas distintas.
      return `${v.hipodromo || "?"}|${v.carrera}`;
  }
}

/** Etiqueta legible de una venta para una dimensión. */
export function etiquetaDe(v: VentaTablaReporte, dim: DimensionReporte, f: Formateador = IDENTIDAD): string {
  switch (dim) {
    case "grupo":
      return v.grupo || "(sin grupo)";
    case "jugador":
      return v.jugador || "(sin jugador)";
    case "hipodromo":
      return f(v.hipodromo) || "(sin hipódromo)";
    case "carrera":
      return `${f(v.hipodromo)} C${v.carrera}`;
  }
}

/** Agrupa las ventas por dimensión y devuelve una fila con sus totales. */
export function agruparPor(
  ventas: VentaTablaReporte[],
  dim: DimensionReporte,
  f: Formateador = IDENTIDAD
): FilaReporte[] {
  const mapa = new Map<string, { etiqueta: string; ventas: VentaTablaReporte[] }>();
  for (const v of ventas) {
    const clave = claveDe(v, dim);
    let g = mapa.get(clave);
    if (!g) {
      g = { etiqueta: etiquetaDe(v, dim, f), ventas: [] };
      mapa.set(clave, g);
    }
    g.ventas.push(v);
  }
  return [...mapa.entries()].map(([clave, g]) => ({
    clave,
    etiqueta: g.etiqueta,
    ...totalesDe(g.ventas),
  }));
}

/** Opciones únicas (clave + etiqueta) de una dimensión, ordenadas. */
export function opcionesDe(
  ventas: VentaTablaReporte[],
  campo: DimensionReporte,
  f: Formateador = IDENTIDAD
): OpcionReporte[] {
  const mapa = new Map<string, string>();
  for (const v of ventas) {
    const clave = claveDe(v, campo);
    if (!mapa.has(clave)) mapa.set(clave, etiquetaDe(v, campo, f));
  }
  return [...mapa.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, "es", { numeric: true }));
}

/** Aplica los filtros de dimensión (cada uno es la clave de `claveDe`). */
export function filtrarVentas(ventas: VentaTablaReporte[], filtros: FiltrosVenta): VentaTablaReporte[] {
  return ventas.filter((v) => {
    if (filtros.grupo && claveDe(v, "grupo") !== filtros.grupo) return false;
    if (filtros.hipodromo && claveDe(v, "hipodromo") !== filtros.hipodromo) return false;
    if (filtros.carrera && claveDe(v, "carrera") !== filtros.carrera) return false;
    if (filtros.jugador && claveDe(v, "jugador") !== filtros.jugador) return false;
    return true;
  });
}

/** Ordena filas por una métrica; desempata por etiqueta. */
export function ordenarFilas(
  filas: FilaReporte[],
  key: keyof TotalesReporte,
  dir: "asc" | "desc"
): FilaReporte[] {
  const signo = dir === "asc" ? 1 : -1;
  return [...filas].sort((a, b) => {
    const d = (a[key] - b[key]) * signo;
    if (d !== 0) return d;
    return a.etiqueta.localeCompare(b.etiqueta, "es", { numeric: true });
  });
}
