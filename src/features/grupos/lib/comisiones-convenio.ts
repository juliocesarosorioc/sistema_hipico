/**
 * ============================================================================
 * COMISIÓN POR CONVENIO DE PRODUCTO · núcleo puro
 * ============================================================================
 * Qué es: cada grupo pacta CON EL GRUPO PRINCIPAL la comisión que cobra por
 * producto, expresada en % del MONTO DECIDIDO de la jugada.
 *
 *   entre tercios · marcas · tablas fijas · remates · polla · wps · dupletas
 *
 * Cómo funciona el negocio (regla del dueño):
 *   - el GRUPO PRINCIPAL coloca la jugada y la habilita para los jugadores de
 *     TODOS los grupos;
 *   - cuando un cliente de un grupo compra, el grupo principal le PAGA a ese
 *     grupo su % sobre el monto decidido.
 *   - `entre_tercios` es la comisión general histórica (`comision_default`);
 *     los demás campos son NUEVOS (los agrega sql/grupos_comisiones_convenio.sql)
 *     y, si están en NULL, heredan de `comision_default`.
 *
 * Este archivo es PURO (no toca Supabase) para poder blindarlo con pruebas sin
 * navegador, igual que los `*-nucleo.ts` de reportes. La lectura/escritura real
 * vive en `reporte-comisiones.ts`.
 * ============================================================================
 */

/** Los conceptos de comisión por convenio que negocia cada grupo. */
export type ProductoConvenio =
  | "entre_tercios"
  | "marcas"
  | "tablas"
  | "remates"
  | "polla"
  | "wps"
  | "dupletas";

/** Nombre de la columna en `grupos_venta` que guarda el % de cada concepto. */
export type CampoComision =
  | "comision_default"
  | "comision_marcas"
  | "comision_tablas"
  | "comision_remates"
  | "comision_polla"
  | "comision_wps"
  | "comision_dupletas";

export type ConceptoConvenio = {
  /** Clave estable del producto (la que viaja en la config del grupo). */
  clave: ProductoConvenio;
  /** Rótulo humano. */
  etiqueta: string;
  /** Nombre de la columna en `grupos_venta`. */
  campo: string;
  emoji: string;
  /**
   * `true` cuando el campo es un producto PROPIO del convenio; `false` para
   * `entre_tercios`, que reutiliza el `comision_default` histórico.
   */
  propio: boolean;
};

/**
 * Catálogo de conceptos, en el orden en que se muestran. `entre_tercios`
 * primero porque es la comisión general y el respaldo de los demás.
 */
export const CONCEPTOS_CONVENIO: readonly ConceptoConvenio[] = [
  { clave: "entre_tercios", etiqueta: "Jugadas entre tercios", campo: "comision_default", emoji: "🎯", propio: false },
  { clave: "marcas", etiqueta: "Marcas", campo: "comision_marcas", emoji: "🏷️", propio: true },
  { clave: "tablas", etiqueta: "Tablas fijas", campo: "comision_tablas", emoji: "📋", propio: true },
  { clave: "remates", etiqueta: "Remates", campo: "comision_remates", emoji: "🔨", propio: true },
  { clave: "polla", etiqueta: "Polla", campo: "comision_polla", emoji: "🎟️", propio: true },
  { clave: "wps", etiqueta: "W.P.S.", campo: "comision_wps", emoji: "🐎", propio: true },
  { clave: "dupletas", etiqueta: "Dupletas", campo: "comision_dupletas", emoji: "🎫", propio: true },
] as const;

const POR_CLAVE: Record<string, ConceptoConvenio> = Object.fromEntries(
  CONCEPTOS_CONVENIO.map((c) => [c.clave, c])
);

/** ¿Es una clave de concepto válida? */
export function esConcepto(v: unknown): v is ProductoConvenio {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(POR_CLAVE, v);
}

/** El concepto (rótulo/campo/emoji) de una clave, o `null`. */
export function conceptoDe(clave: string): ConceptoConvenio | null {
  return POR_CLAVE[clave] ?? null;
}

/**
 * PRODUCTO de un ticket a partir de su `origen` y (para taquilla) su
 * `modalidad`. Los valores son los que escribe cada RPC en
 * `tickets_apuestas.nota_auditoria`; ver sql/banqueros.sql::club_modalidad_ticket.
 *
 * Devuelve `null` cuando no se puede clasificar (no suma al reporte) en vez de
 * adivinar un producto.
 */
export function productoDeTicket(
  origen: string | null | undefined,
  modalidad?: string | null
): ProductoConvenio | null {
  const o = String(origen ?? "").trim().toUpperCase();
  const m = String(modalidad ?? "").trim().toUpperCase();
  // WPS viaja por Taquilla con `modalidad='WPS'`, o migrado como `WPS_LEGACY`.
  if (m === "WPS" || o === "WPS" || o === "WPS_LEGACY") return "wps";
  switch (o) {
    case "MARCAS":
      return "marcas";
    case "TABLAS_FIJAS":
    case "TABLAS":
      return "tablas";
    case "REMATE":
    case "REMATES":
      return "remates";
    case "DUPLETA":
    case "DUPLETAS":
      return "dupletas";
    case "POLLA":
    case "POLLAS":
      return "polla";
    case "TAQUILLA":
      return "entre_tercios";
    default:
      return null;
  }
}

/** Lee `origen` y `modalidad` de una `nota_auditoria` (texto o jsonb), sin romper. */
export function leerNota(nota: unknown): { origen: string; modalidad: string } {
  let base: unknown = nota;
  if (typeof nota === "string") {
    const s = nota.trim();
    if (!s.startsWith("{") && !s.startsWith("[")) return { origen: "", modalidad: "" };
    try {
      base = JSON.parse(s);
    } catch {
      return { origen: "", modalidad: "" };
    }
  }
  if (!base || typeof base !== "object") return { origen: "", modalidad: "" };
  const o = base as Record<string, unknown>;
  return { origen: String(o.origen ?? ""), modalidad: String(o.modalidad ?? o.origen ?? "") };
}

/** Producto de un ticket a partir de su `nota_auditoria` cruda. */
export function productoDeNota(nota: unknown): ProductoConvenio | null {
  const { origen, modalidad } = leerNota(nota);
  return productoDeTicket(origen, modalidad);
}

/**
 * Monto sobre el que se paga el convenio: el MONTO DECIDIDO (lo efectivamente
 * comprometido tras el reparto), con el monto jugado como respaldo del legacy.
 */
export function montoDecidido(monto_decidido: unknown, monto_jugado?: unknown): number {
  for (const v of [monto_decidido, monto_jugado]) {
    const n = Number(v);
    if (Number.isFinite(n) && n !== 0) return n;
  }
  return 0;
}

/** Grupo con (algunas) columnas de convenio. Estructural: encaja con GrupoRow. */
export type GrupoComisiones = {
  id: string | number;
  nombre?: string | null;
  es_principal?: boolean | null;
  comision_default?: number | null;
  comision_marcas?: number | null;
  comision_tablas?: number | null;
  comision_remates?: number | null;
  comision_polla?: number | null;
  comision_wps?: number | null;
  comision_dupletas?: number | null;
};

const leer = (grupo: GrupoComisiones | null | undefined, campo: string): number | null => {
  if (!grupo) return null;
  const v = (grupo as unknown as Record<string, unknown>)[campo];
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * % que cobra el grupo por un concepto. Si el concepto es propio y su campo
 * está vacío, HEREDA el `comision_default` (entre tercios) para no inventar una
 * tasa. Devuelve `null` cuando no hay de dónde sacarla.
 */
export function comisionPctDeGrupo(
  grupo: GrupoComisiones | null | undefined,
  clave: ProductoConvenio
): number | null {
  const c = POR_CLAVE[clave];
  if (!c) return null;
  const propio = leer(grupo, c.clave === "entre_tercios" ? "comision_default" : c.campo);
  if (propio != null) return propio;
  if (c.clave !== "entre_tercios") {
    const base = leer(grupo, "comision_default");
    if (base != null) return base;
  }
  return null;
}

/** Redondeo a 2 decimales, estable para reportes. */
export const redondear2 = (n: number): number => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/** Comisión en dinero de un monto al `pct` pactado. `pct` null/0 → 0. */
export function comisionEnDinero(monto: number, pct: number | null | undefined): number {
  const m = Number(monto);
  if (!Number.isFinite(m) || m <= 0) return 0;
  const p = Number(pct);
  if (!Number.isFinite(p) || p <= 0) return 0;
  return redondear2((m * p) / 100);
}

/**
 * COBRADO NETO de una jugada PERDIDA: lo que le queda a la casa después de
 * pagarle al grupo donde se publicó la jugada su % de convenio.
 *
 *   cobrado neto = monto perdido × (1 − pct / 100)
 *
 * `pct` nulo o fuera de rango se acota a [0, 100]; sin grupo (pct 0) se cobra el
 * monto completo, que es el comportamiento previo a este cálculo.
 */
export function cobradoNeto(montoPerdido: number, pct: number | null | undefined): number {
  const m = Number(montoPerdido);
  if (!Number.isFinite(m) || m <= 0) return 0;
  const p = Number(pct);
  const limpio = Number.isFinite(p) ? Math.min(100, Math.max(0, p)) : 0;
  return redondear2(m * (1 - limpio / 100));
}

// ---------------------------------------------------------------------------
// Consolidación del reporte
// ---------------------------------------------------------------------------

/** Una línea de venta ya normalizada (monto decidido por grupo y producto). */
export type VentaConvenio = {
  grupoId: string;
  producto: ProductoConvenio;
  moneda: string;
  monto: number;
};

// ===========================================================================
// DETALLE POR JUGADA (tabla del reporte y exportaciones)
// ===========================================================================

/**
 * Estado de una jugada del reporte. El convenio se paga sobre el MONTO DECIDIDO,
 * que por definición ya está resuelto; "PAGADO" es el estado normal. "PENDIENTE"
 * queda para completitud (una jugada sin decidir) y "ANULADA" para una jugada
 * retirada, que no genera comisión.
 */
export type EstadoJugada = "PAGADO" | "PENDIENTE" | "ANULADA";

/**
 * Una JUGADA del reporte: el detalle por ticket que pide la tabla. El rótulo del
 * producto (`etiqueta`/`emoji`) lo completa el llamador con el catálogo para no
 * duplicar la tabla de conceptos acá.
 */
export type DetalleJugada = {
  /** Fecha de registro del ticket (YYYY-MM-DD) o "" si no vino. */
  fecha: string;
  hipodromo: string;
  carrera: string;
  /** Nombre del jugador dueño de la jugada. */
  cliente: string;
  grupoId: string;
  grupo: string;
  esPrincipal: boolean;
  producto: ProductoConvenio;
  /** Ejemplares involucrados ("4 × 1", "7", "TAQUILLA 3X8"). Texto ya legible. */
  detalle: string;
  estado: EstadoJugada;
  moneda: string;
  /** Monto decidido sobre el que se calcula la comisión. */
  monto: number;
  /** % pactado del grupo para ese producto. */
  pct: number;
  /** Comisión generada a favor del grupo (monto × pct / 100). */
  comision: number;
};

/** Comisión de un detalle con su propio % (0 si el % o el monto no sirven). */
export function comisionDeDetalle(d: Pick<DetalleJugada, "monto" | "pct">): number {
  return comisionEnDinero(d.monto, d.pct);
}

/**
 * Firma de filtros del reporte. Todos opcionales: un filtro vacío ("") no
 * discrimina. El filtro de `producto` es el tipo de jugada del catálogo del
 * convenio.
 */
export type FiltrosReporte = {
  grupoId?: string;
  /** Rango por fecha del detalle (YYYY-MM-DD). Comparación inclusiva. */
  desde?: string;
  hasta?: string;
  hipodromo?: string;
  carrera?: string;
  producto?: ProductoConvenio | "";
};

/** ¿La fecha (YYYY-MM-DD) cae dentro de [desde, hasta]? Compara texto ISO. */
export function fechaEnRango(fecha: string, desde?: string, hasta?: string): boolean {
  const f = String(fecha ?? "").slice(0, 10);
  if (!f) return !desde && !hasta;
  if (desde && f < desde) return false;
  if (hasta && f > hasta) return false;
  return true;
}

/** Igualdad laxa de texto para filtros (trim + sin mayúsculas). "" no filtra. */
function coincide(valor: string, filtro?: string): boolean {
  const f = String(filtro ?? "").trim().toUpperCase();
  if (!f) return true;
  return String(valor ?? "").trim().toUpperCase().includes(f) || f === "TODAS" || f === "TODOS";
}

/** Aplica los filtros del reporte a las jugadas del detalle. Puro. */
export function filtrarDetalle(filas: DetalleJugada[], filtros: FiltrosReporte): DetalleJugada[] {
  const gid = String(filtros.grupoId ?? "").trim();
  return filas.filter((f) => {
    if (gid && String(f.grupoId) !== gid) return false;
    if (!fechaEnRango(f.fecha, filtros.desde, filtros.hasta)) return false;
    if (!coincide(f.hipodromo, filtros.hipodromo)) return false;
    if (!coincide(f.carrera, filtros.carrera)) return false;
    if (filtros.producto && f.producto !== filtros.producto) return false;
    return true;
  });
}

/** KPIs del reporte (resumen de cabecera). */
export type KpisReporte = {
  /** Volumen total jugado (suma de montos decididos), por moneda. */
  volumen: number;
  /** Total de jugadas DECIDIDAS (estado PAGADO). */
  decididas: number;
  /** Total de comisión generada a favor del grupo. */
  comision: number;
  /** Moneda dominante del conjunto (la de mayor volumen); "" si no hay filas. */
  moneda: string;
  /** % de convenio APLICADO sobre lo jugado (comisión / volumen × 100). */
  pctAplicado: number;
  /** Total de jugadas en el conjunto filtrado (incluye no decididas). */
  jugadas: number;
};

/**
 * KPIs de un conjunto de jugadas. `moneda` permite acotar a una sola moneda
 * (la del grupo); si se omite, se usa la moneda de MAYOR volumen para no mezclar
 * USD y VES en un mismo total (nunca se convierten).
 */
export function kpisDeDetalle(filas: DetalleJugada[], moneda?: string): KpisReporte {
  const mon = String(moneda ?? "").trim().toUpperCase();
  // Moneda dominante: la de mayor volumen entre las filas.
  let dominante = "";
  if (!mon) {
    const porMoneda = new Map<string, number>();
    for (const f of filas) {
      const m = String(f.moneda || "USD").toUpperCase();
      porMoneda.set(m, (porMoneda.get(m) ?? 0) + Number(f.monto || 0));
    }
    let mejor = -1;
    for (const [m, v] of porMoneda) {
      if (v > mejor) {
        mejor = v;
        dominante = m;
      }
    }
  }
  const usar = mon || dominante;

  let volumen = 0;
  let comision = 0;
  let decididas = 0;
  let jugadas = 0;
  for (const f of filas) {
    const m = String(f.moneda || "USD").toUpperCase();
    if (usar && m !== usar) continue;
    jugadas += 1;
    if (f.estado === "PAGADO") decididas += 1;
    volumen += Number(f.monto || 0);
    comision += Number(f.comision || 0);
  }
  volumen = redondear2(volumen);
  comision = redondear2(comision);
  return {
    volumen,
    decididas,
    comision,
    moneda: usar,
    pctAplicado: volumen > 0 ? redondear2((comision / volumen) * 100) : 0,
    jugadas,
  };
}

/** Fecha de hoy local en formato YYYY-MM-DD (sin desfase por zona horaria). */
export function hoyLocalISO(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

// ===========================================================================
// EXPORTACIONES (texto WhatsApp y CSV) — builders PUROS
// ===========================================================================

/** Importe con separador de miles y 2 decimales, con su símbolo de moneda. */
export function formatearDinero(n: number, moneda: string): string {
  const m = String(moneda || "USD").toUpperCase();
  const sym = m === "VES" ? "Bs " : "$";
  return `${sym}${Number(n || 0).toLocaleString("es-VE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Fecha YYYY-MM-DD → DD/MM/AAAA (para el texto de WhatsApp). */
export function fechaLegible(iso: string): string {
  const s = String(iso ?? "").slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
}

/** Encabezado del reporte (lo comparten el texto de WhatsApp y el PNG). */
export type EncabezadoReporte = {
  grupo: string;
  desde: string;
  hasta: string;
  /** Monoedas del reporte (normalmente ["USD"], o USD y VES). */
  moneda?: string;
};

/**
 * Texto del reporte listo para enviar/copiar por WhatsApp. Resume los KPIs y
 * lista las jugadas del detalle (máximo `topeFilas` para no hacer un mensaje
 * eterno). Puro: no toca el DOM.
 */
export function textoReporteWhatsApp(
  kpis: KpisReporte,
  detalle: DetalleJugada[],
  encabezado: EncabezadoReporte,
  topeFilas = 40
): string {
  const L: string[] = [];
  L.push("📈 *REPORTE DE COMISIONES POR CONVENIO*");
  L.push(`🏢 Grupo: *${encabezado.grupo || "—"}*`);
  L.push(`📅 Rango: ${fechaLegible(encabezado.desde)} al ${fechaLegible(encabezado.hasta)}`);
  L.push("");
  L.push("━━━━━━━━━━━━━━━━━━━━");
  L.push(`💵 Volumen jugado: *${formatearDinero(kpis.volumen, kpis.moneda)}*`);
  L.push(`✅ Jugadas decididas: *${kpis.decididas}* de ${kpis.jugadas}`);
  L.push(`📊 % de convenio aplicado: *${kpis.pctAplicado}%*`);
  L.push(`🤝 *Comisión a favor del grupo: ${formatearDinero(kpis.comision, kpis.moneda)}*`);
  L.push("━━━━━━━━━━━━━━━━━━━━");

  const visibles = detalle.slice(0, topeFilas);
  if (visibles.length) {
    L.push("");
    L.push("*Detalle de jugadas*");
    for (const d of visibles) {
      const donde = [d.hipodromo, d.carrera ? `C${d.carrera}` : ""].filter(Boolean).join(" ");
      const partes = [
        fechaLegible(d.fecha),
        donde,
        d.cliente || "—",
        d.detalle || "—",
      ].filter(Boolean);
      L.push(`• ${partes.join(" · ")} → ${formatearDinero(d.monto, d.moneda)} (${d.pct}% = ${formatearDinero(d.comision, d.moneda)})`);
    }
    if (detalle.length > visibles.length) {
      L.push(`… y ${detalle.length - visibles.length} jugada(s) más.`);
    }
  } else {
    L.push("");
    L.push("_Sin jugadas en el rango._");
  }
  L.push("");
  L.push("_Generado por el Sistema Hípico._");
  return L.join("\n");
}

/** Columnas del CSV/Excel del detalle, en orden. */
export const COLUMNAS_DETALLE = [
  "Fecha",
  "Hipódromo",
  "Carrera",
  "Cliente",
  "Tipo de Jugada",
  "Detalle de Ejemplares",
  "Estado",
  "Monto Base",
  "% Convenio",
  "Comisión",
] as const;

/** Celda segura para CSV/Excel (comillas y comas). */
function celda(v: unknown): string {
  const s = String(v ?? "");
  return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Matriz de celdas del detalle (encabezado + filas) para exportar a CSV/Excel.
 * Pura: el llamador decide el formato (CSV directo o HTML de Excel).
 */
export function matrizDetalle(detalle: DetalleJugada[]): string[][] {
  const out: string[][] = [[...COLUMNAS_DETALLE]];
  for (const d of detalle) {
    out.push([
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
    ]);
  }
  return out;
}

/** CSV del detalle (con BOM para que Excel respete los acentos). */
export function csvDetalle(detalle: DetalleJugada[]): string {
  return matrizDetalle(detalle)
    .map((fila) => fila.map(celda).join(","))
    .join("\r\n");
}

/** Fila del reporte: un grupo + un producto + una moneda. */
export type FilaReporte = {
  grupoId: string;
  grupo: string;
  esPrincipal: boolean;
  producto: ProductoConvenio;
  etiqueta: string;
  emoji: string;
  moneda: string;
  tickets: number;
  monto: number;
  pct: number;
  comision: number;
};

const claveFila = (grupoId: string, producto: string, moneda: string) =>
  `${grupoId}::${producto}::${moneda.toUpperCase()}`;

/**
 * Convierte las ventas crudas en filas del reporte (por grupo, producto y
 * moneda). Pura y determinista: misma entrada → misma salida. Las monedas NO se
 * mezclan (USD y VES son colas distintas).
 */
export function consolidarReporte(
  ventas: VentaConvenio[],
  grupos: GrupoComisiones[]
): FilaReporte[] {
  const porId = new Map<string, GrupoComisiones>();
  for (const g of grupos) porId.set(String(g.id), g);

  const acc = new Map<string, FilaReporte>();
  for (const v of ventas) {
    const monto = Number(v.monto);
    if (!Number.isFinite(monto) || monto === 0) continue;
    const gid = String(v.grupoId);
    if (!gid) continue;
    const moneda = String(v.moneda || "USD").toUpperCase();
    const k = claveFila(gid, v.producto, moneda);
    let fila = acc.get(k);
    if (!fila) {
      const c = POR_CLAVE[v.producto];
      const grupo = porId.get(gid);
      const pct = comisionPctDeGrupo(grupo, v.producto);
      fila = {
        grupoId: gid,
        grupo: String(grupo?.nombre ?? gid),
        esPrincipal: grupo?.es_principal === true,
        producto: v.producto,
        etiqueta: c?.etiqueta ?? v.producto,
        emoji: c?.emoji ?? "",
        moneda,
        tickets: 0,
        monto: 0,
        pct: pct ?? 0,
        comision: 0,
      };
      acc.set(k, fila);
    }
    fila.tickets += 1;
    fila.monto += monto;
  }

  const filas = [...acc.values()];
  for (const f of filas) {
    f.monto = redondear2(f.monto);
    f.comision = comisionEnDinero(f.monto, f.pct);
  }
  // Grupo (alfabético), producto en el orden del catálogo y moneda.
  const ordenProducto = new Map(CONCEPTOS_CONVENIO.map((c, i) => [c.clave, i]));
  filas.sort((a, b) => {
    if (a.grupo !== b.grupo) return a.grupo.localeCompare(b.grupo);
    const oa = ordenProducto.get(a.producto) ?? 99;
    const ob = ordenProducto.get(b.producto) ?? 99;
    if (oa !== ob) return oa - ob;
    return a.moneda.localeCompare(b.moneda);
  });
  return filas;
}

/** Totales por moneda (para el pie del reporte). */
export type TotalMoneda = { moneda: string; monto: number; comision: number };

export function totalesPorMoneda(filas: FilaReporte[]): TotalMoneda[] {
  const acc = new Map<string, TotalMoneda>();
  for (const f of filas) {
    const t = acc.get(f.moneda) ?? { moneda: f.moneda, monto: 0, comision: 0 };
    t.monto = redondear2(t.monto + f.monto);
    t.comision = redondear2(t.comision + f.comision);
    acc.set(f.moneda, t);
  }
  return [...acc.values()].sort((a, b) => a.moneda.localeCompare(b.moneda));
}

/** Agrupa las filas por grupo conservando el orden alfabético del núcleo. */
export function agruparPorGrupo(filas: FilaReporte[]): Array<{
  grupoId: string;
  grupo: string;
  esPrincipal: boolean;
  filas: FilaReporte[];
  comision: number;
}> {
  const orden: string[] = [];
  const mapa = new Map<string, { grupoId: string; grupo: string; esPrincipal: boolean; filas: FilaReporte[]; comision: number }>();
  for (const f of filas) {
    let g = mapa.get(f.grupoId);
    if (!g) {
      g = { grupoId: f.grupoId, grupo: f.grupo, esPrincipal: f.esPrincipal, filas: [], comision: 0 };
      mapa.set(f.grupoId, g);
      orden.push(f.grupoId);
    }
    g.filas.push(f);
    g.comision = redondear2(g.comision + f.comision);
  }
  return orden.map((id) => mapa.get(id)!).filter(Boolean);
}

// ===========================================================================
// CONVERSIÓN FORMULARIO ⇄ COLUMNAS (pura, la comparten el alta y la edición)
// ===========================================================================

/** Valores del bloque de comisiones tal como los maneja el formulario (texto). */
export type ValoresConvenio = Partial<Record<ProductoConvenio, string>>;

/** Estado inicial del formulario: Entre Tercios pactado y el resto heredando. */
export function valoresConvenioInicial(entreTercios = "2.5"): ValoresConvenio {
  return { entre_tercios: entreTercios };
}

/** Lee los valores de un grupo (o fila cruda) a texto de formulario. */
export function valoresConvenioDeGrupo(
  g: Record<string, unknown> | null | undefined
): ValoresConvenio {
  const out: ValoresConvenio = {};
  for (const c of CONCEPTOS_CONVENIO) {
    const v = g ? g[c.campo] : null;
    out[c.clave] = v === null || v === undefined ? "" : String(v);
  }
  return out;
}

/**
 * Convierte el formulario en columnas de `grupos_venta`. Vacío → `null` (hereda),
 * salvo "Entre Tercios", que siempre lleva un número (`comision_default`).
 */
export function columnasConvenioDesde(
  valores: ValoresConvenio,
  porDefecto = 2.5
): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const c of CONCEPTOS_CONVENIO) {
    const t = String(valores[c.clave] ?? "").trim().replace(",", ".");
    const n = Number(t);
    const base = c.clave === "entre_tercios";
    if (!t || !Number.isFinite(n) || n < 0) {
      out[c.campo] = base ? porDefecto : null;
      continue;
    }
    out[c.campo] = n;
  }
  return out;
}

/**
 * Payload COMPLETO de comisiones a partir de la FILA del grupo en edición (o
 * de cualquier objeto con las columnas de `grupos_venta`).
 *
 * Devuelve SIEMPRE las 7 claves (`comision_default` … `comision_dupletas`) para
 * que el UPDATE nunca vaya a medias: si un campo vino vacío/no numérico queda
 * en `null` (= hereda), salvo `entre_tercios`, que cae a `porDefecto` porque es
 * la comisión general y no puede quedar sin tasa. Recorre el catálogo entero,
 * así que una columna nueva del convenio viaja sola en el payload.
 */
export function columnasConvenioCompletas(
  g: Record<string, unknown> | null | undefined,
  porDefecto = 5
): Record<CampoComision, number | null> {
  const base = columnasConvenioDesde(valoresConvenioDeGrupo(g), porDefecto);
  const out = {} as Record<CampoComision, number | null>;
  for (const c of CONCEPTOS_CONVENIO) {
    out[c.campo as CampoComision] = base[c.campo] ?? null;
  }
  return out;
}
