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
 *   · "Cobrado neto" = lo que deja una jugada PERDIDA después de pagarle al
 *     grupo que la publicó su % de convenio (`pctConvenio`):
 *     monto perdido × (1 − %/100). El ganador va a "Pagado" y el retirado se
 *     reembolsa, así que ninguno de los dos suma acá.
 */
import { cobradoNeto } from "@/features/grupos/lib/comisiones-convenio";
import { esAdelantadaDe } from "@/features/jugadas/lib/modalidad-tiempo";

/** Una venta (1 ticket = 1 ejemplar jugado) ya normalizada para el reporte. */
export type VentaTablaReporte = {
  id: string;
  hipodromo: string;
  carrera: number;
  nombreJugada?: string;
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
  /**
   * % de convenio del grupo que publicó la jugada, para descontar "Cobrado
   * neto". Lo completa el reporte al cruzar el ticket con `grupos_venta`
   * (0 = sin grupo / sin convenio pactado).
   */
  pctConvenio?: number;
  estado: string;
  pagado: number;
  comision: number;
  moneda: string;
  /** true si la jugada fue ANULADA (auditoría del Monitor de Jugadas). */
  anulada: boolean;
  /**
   * Modalidad de tiempo de la jugada (ver `modalidad-tiempo.ts`): `true` si se
   * cargó ANTES de la carrera (⏳ adelantada) y `false` si fue DURANTE (⚡ en
   * vivo). Sale de `tickets_apuestas.es_adelantada` (con respaldo en la nota).
   */
  adelantada: boolean;
  /** Día de la carrera (nota `fecha_carrera`) o, si falta, el de la venta. */
  fecha: string;
  /** Día LOCAL de la venta (`fecha_registro`); patrón de consulta adicional. */
  fechaVenta: string;
  /**
   * Id de la tabla fija de la que salió la venta (va en `nota_auditoria`).
   * Se usa para cruzarla con los ejemplares INVALIDADOS de esa tabla.
   */
  tablaId?: string;
  /**
   * El ejemplar de esta venta quedó INVALIDADO (descalificado) en la tabla
   * fija. No es lo mismo que RETIRADO: la jugada no se reembolsa, PIERDE.
   *
   * Con la bandera en true la venta NO cuenta como ganadora ni entra en el
   * "Pagado": un ejemplar descalificado no cobra premio.
   */
  invalidado?: boolean;
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
  /**
   * Ventas cuyo ejemplar quedó INVALIDADO (descalificado). Se cuentan APARTE
   * para que el operador vea cuántos tickets dejaron de cobrar por una
   * descalificación (y no por una derrota normal).
   */
  invalidados: number;
  pagado: number;
  reembolsado: number;
  comision: number;
  cobrado: number;
  /** A favor del grupo: enRiesgo − reembolsado − pagado. */
  balance: number;
  /**
   * Comisión que se lleva el GRUPO (misma cifra que `comision`, expuesta con el
   * nombre contable del recálculo íntegro: monto_cobrado / monto_pagado /
   * comision_grupo / balance).
   */
  comisionGrupo: number;
};

/** Las 4 cifras contables que se recalculan de punta a punta en los reportes. */
export type RecalculoIntegral = {
  montoCobrado: number;
  montoPagado: number;
  comisionGrupo: number;
  balance: number;
  reembolsado: number;
};

export type FilaReporte = TotalesReporte & { clave: string; etiqueta: string };

export type OpcionReporte = { value: string; label: string };

export type FiltrosVenta = {
  grupo?: string;
  hipodromo?: string;
  carrera?: string;
  jugador?: string;
};

export type EstadoReporte = "Ganador" | "Perdedor" | "Pendiente" | "Retirado" | "Invalidado" | "Sin Decisión" | "Otro";

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
  // Un ejemplar INVALIDADO no es un retirado: no se reembolsa, pierde.
  if (s.startsWith("inval")) return "Invalidado";
  if (s.includes("sin decisi") || s.startsWith("empat") || s.startsWith("reinteg")) return "Sin Decisión";
  if (s.startsWith("pend")) return "Pendiente";
  return "Otro";
}

/**
 * Cobrado NETO de una venta: solo las PERDIDAS dejan dinero en la casa. El
 * ganador cobra premio (columna Pagado), el retirado se reembolsa y el
 * pendiente todavía no se decidió.
 *
 * `monto` es lo jugado y `pctConvenio` el % que se le paga al grupo donde se
 * publicó: `monto × (1 − %/100)`.
 */
export function cobradoDeVenta(v: VentaTablaReporte): number {
  if (ventaAnulada(v)) return 0;
  // Un ejemplar INVALIDADO también pierde la jugada (no se reembolsa, a
  // diferencia del retirado): el monto queda en la casa, igual que un
  // perdedor. Lo que NO puede es ganar, y eso lo decide la liquidación.
  if (v.invalidado) return cobradoNeto(v.monto, v.pctConvenio);
  if (estadoNormalizado(v.estado) !== "Perdedor") return 0;
  return cobradoNeto(v.monto, v.pctConvenio);
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
 * Id de la TABLA FIJA de la que salio la venta (`nota_auditoria.tabla_id`).
 *
 * Es lo que permite cruzar la venta con los ejemplares INVALIDADOS de esa
 * tabla: el ticket no sabe que su ejemplar quedo descalificado, la tabla si.
 */
function tablaIdDeNota(raw: unknown): string {
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
    return texto((obj as Record<string, unknown>).tabla_id);
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
export function normalizarVenta(
  row: Record<string, unknown>,
  mapaSeudonimos?: Map<string, string>
): VentaTablaReporte {
  const grupo = texto(row.grupo_cobro_nombre) || texto(row.grupo_comision_nombre) || texto(row.grupo);
  const cid = texto(row.cliente_juega_id);
  const cnom = texto(row.cliente_juega_nombre);
  // En los reportes SIEMPRE toma el seudónimo del usuario
  const aliasResuelto =
    (cid && mapaSeudonimos?.get(cid)) ||
    (cnom && mapaSeudonimos?.get(cnom.toUpperCase())) ||
    cnom ||
    cid;
  const jugador = aliasResuelto || "(sin jugador)";
  return {
    id: texto(row.id),
    hipodromo: texto(row.hipodromo).toUpperCase(),
    carrera: cifra(row.carrera),
    nombreJugada: texto(row.nombre_jugada),
    numero: texto(row.ejemplar_numero),
    caballo: texto(row.caballo),
    jugadorId: cid || jugador,
    jugador,
    grupoId: texto(row.grupo_cobro_id) || texto(row.grupo_comision_id) || grupo,
    grupo,
    monto: cifra(row.monto_jugado),
    cantidad: Math.max(1, Math.round(cifra(row.cantidad_tablas)) || 1),
    pts: cifra(row.pts_ejemplar),
    premioPorTabla: cifra(row.premio_por_tabla),
    comisionPct: cifra(row.comision_porcentaje),
    pctConvenio: 0,
    estado: texto(row.estado),
    pagado: cifra(row.premio_pagar),
    comision: cifra(row.comision_pagada),
    moneda: texto(row.moneda).toUpperCase() || "USD",
    anulada: row.anulada === true,
    adelantada: esAdelantadaDe(row),
    fecha: fechaDeNota(row.nota_auditoria) || texto(row.fecha_carrera).slice(0, 10) || texto(row.fecha_registro).slice(0, 10),
    fechaVenta: diaLocalDeVenta(row.fecha_registro),
    tablaId: tablaIdDeNota(row.nota_auditoria),
    // Lo marca el cargador de tablas fijas, que cruza la venta con los
    // ejemplares INVALIDADOS de su tabla (el ticket no lo sabe).
    invalidado: false,
  };
}

/**
 * ¿La venta queda FUERA de las cuentas por estar anulada? Una jugada anulada se
 * devolvió: no suma ni resta en ninguna cifra. Se mira la BANDERA `anulada`
 * (que es la que pone el Monitor al anular: NO reescribe `estado`, que sigue en
 * Ganador/Perdedor/Retirado) y, como respaldo, el propio `estado`.
 */
export function ventaAnulada(v: VentaTablaReporte): boolean {
  if (v.anulada) return true;
  const e = texto(v.estado).toLowerCase();
  return e.startsWith("anul") || e.startsWith("rechaz");
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
    invalidados: 0,
    pagado: 0,
    reembolsado: 0,
    comision: 0,
    cobrado: 0,
    balance: 0,
    comisionGrupo: 0,
  };
  const jugadores = new Set<string>();
  for (const v of ventas) {
    // INVARIANTE FINANCIERA: una jugada ANULADA no entra en NINGUNA cifra (ni
    // suma ni resta). Antes se clasificaba solo por `estado`, así que una anulada
    // cuyo estado quedó en 'Ganador'/'Perdedor'/'Retirado' seguía sumando a
    // enRiesgo/pagado/cobrado/comisión/balance.
    if (ventaAnulada(v)) continue;
    t.tickets += 1;
    jugadores.add(v.jugadorId || v.jugador || "?");
    t.enRiesgo += v.monto;
    t.comision += v.comision;
    // El estado REAL de la venta: si su ejemplar quedó INVALIDADO en la tabla
    // fija, la venta se cuenta aparte (un descalificado no gana ni cobra).
    const bruto = estadoNormalizado(v.estado);
    const estado = v.invalidado ? "Invalidado" : bruto;
    switch (estado) {
      case "Ganador":
        t.ganadores += 1;
        t.pagado += v.pagado;
        break;
      case "Perdedor":
        t.perdidos += 1;
        t.cobrado += cobradoDeVenta(v);
        break;
      case "Retirado":
        t.retirados += 1;
        t.reembolsado += v.monto;
        break;
      case "Invalidado":
        // El ejemplar fue DESCALIFICADO: no puede ganar y no se le paga. La
        // jugada PIERDE (no se reembolsa, a diferencia del retirado), asi que
        // el monto queda en la casa. Se cuenta APARTE para que el operador
        // vea cuantos tickets dejaron de cobrar por una descalificacion.
        t.invalidados += 1;
        t.perdidos += 1;
        if (bruto === "Ganador") {
          // Caso anomalo: se liquido ANTES del invalidamiento y el premio ya
          // salio. Se refleja el dinero pagado (ocultarlo haria creer que la
          // casa conserva ese monto) pero la jugada NO cuenta como ganadora.
          t.pagado += v.pagado;
        } else {
          t.cobrado += cobradoDeVenta(v);
        }
        break;
      case "Sin Decisión":
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
  t.comisionGrupo = t.comision;
  return t;
}

/**
 * RECÁLCULO ÍNTEGRO de las 4 cifras contables de un conjunto de ventas. Es la
 * MISMA matemática de `totalesDe`, expuesta con los nombres del recálculo total
 * para poder recomputar de punta a punta ante una liquidación, una edición o un
 * cambio de resultado: `monto_cobrado`, `monto_pagado`, `comision_grupo` y
 * `balance` neto.
 *
 * Las jugadas ANULADAS no entran (su capital se devolvió): `totalesDe` ya las
 * trata como "Otro" (no suman a ninguna columna).
 */
export function recalcularIntegral(ventas: VentaTablaReporte[]): RecalculoIntegral {
  const t = totalesDe(ventas);
  return {
    montoCobrado: t.cobrado,
    montoPagado: t.pagado,
    comisionGrupo: t.comisionGrupo,
    balance: t.balance,
    reembolsado: t.reembolsado,
  };
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
  key: keyof TotalesReporte | "etiqueta",
  dir: "asc" | "desc"
): FilaReporte[] {
  const signo = dir === "asc" ? 1 : -1;
  return [...filas].sort((a, b) => {
    if (key === "etiqueta") {
      return a.etiqueta.localeCompare(b.etiqueta, "es", { numeric: true }) * signo;
    }
    const d = (a[key] - b[key]) * signo;
    if (d !== 0) return d;
    return a.etiqueta.localeCompare(b.etiqueta, "es", { numeric: true });
  });
}
