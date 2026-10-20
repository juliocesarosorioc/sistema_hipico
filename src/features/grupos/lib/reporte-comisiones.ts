/**
 * ============================================================================
 * REPORTE DE COMISIONES POR CONVENIO — lectura desde Supabase
 * ============================================================================
 * Junta las ventas del rango pedido y las consolida con el núcleo PURO
 * (`comisiones-convenio.ts`), que es el que decide el producto de cada ticket y
 * aplica el % pactado por grupo.
 *
 * DE DÓNDE SALE CADA PRODUCTO:
 *   · Marcas, Tablas Fijas, Remates, WPS, Dupletas y "Entre Tercios" viven
 *     TODOS en `tickets_apuestas`, discriminados por `nota_auditoria->>'origen'`
 *     (y `modalidad` para WPS). Se clasifican con `productoDeNota`.
 *   · La Polla vive aparte: `pollas` (grupo_id) + `polla_ventas` (pagado).
 *
 * El monto del convenio es el MONTO DECIDIDO del ticket. Las monedas no se
 * mezclan: USD y VES se reportan en columnas separadas.
 *
 * Lo que NO hace falta para LEER es corriente; pero SÍ hay que aplicar
 * `sql/grupos_comisiones_convenio.sql` para poder GUARDAR el % por producto
 * (las columnas nuevas de `grupos_venta`).
 */
import { supabase } from "@/core/supabase";
import { desgloseJugada } from "@/features/liquidacion/lib/etiquetas-reporte";
import { grupoDeCuenta } from "./atribucion-grupo";
import {
  comisionEnDinero,
  comisionPctDeGrupo,
  consolidarReporte,
  filtrarDetalle,
  montoDecidido,
  productoDeNota,
  type DetalleJugada,
  type EstadoJugada,
  type FilaReporte,
  type FiltrosReporte,
  type GrupoComisiones,
  type VentaConvenio,
} from "./comisiones-convenio";

/** Tamaño de página de PostgREST (su tope por respuesta). */
const PAGINA = 1000;
/** Tope de páginas: evita un bucle infinito si la base devuelve siempre lo mismo. */
const MAX_PAGINAS = 40;
/** Lote de ids para el `in (...)` de pollas (evita URLs kilométricas). */
const LOTE_IDS = 200;

type FilaTicket = {
  id?: string | number | null;
  grupo_cobro_id?: string | null;
  grupo_cobro_nombre?: string | null;
  /**
   * Atribución entre grupos (PROMPT #5): `grupo_cuenta_id` es a QUIÉN le da
   * cuenta el jugador (su grupo) y `grupo_publicador_id` quién PUBLICÓ la jugada.
   * Pueden faltar (migración sin aplicar) → se cae a `grupo_cobro_id`.
   */
  grupo_cuenta_id?: string | null;
  grupo_publicador_id?: string | null;
  moneda?: string | null;
  monto_decidido?: number | string | null;
  monto_jugado?: number | string | null;
  nota_auditoria?: unknown;
  /** Fecha de la carrera (o de la venta si falta) para el detalle. */
  fecha_carrera?: string | null;
  fecha_registro?: string | null;
  hipodromo?: string | null;
  carrera?: string | number | null;
  cliente?: string | null;
  nombre_jugada?: string | null;
  estado?: string | null;
};

export type ResultadoConvenio = {
  ok: boolean;
  error?: string;
  filas: FilaReporte[];
  /** Detalle por jugada (tabla del reporte). */
  detalle: DetalleJugada[];
  /** Avisos NO fatales (p. ej. si la tabla de pollas no está aplicada). */
  avisos: string[];
};

/** Monto decidido del ticket (con el jugado de respaldo). */
export function montoDeTicket(t: FilaTicket): number {
  return montoDecidido(t.monto_decidido, t.monto_jugado);
}

/** Fecha del detalle: la de la carrera; si es heredada/nula, la de la venta. */
export function fechaDeTicket(t: FilaTicket): string {
  const fc = String(t.fecha_carrera ?? "").slice(0, 10);
  if (fc) return fc;
  return String(t.fecha_registro ?? "").slice(0, 10);
}

/**
 * Estado del ticket → estado del detalle. El convenio se paga sobre el monto
 * DECIDIDO, así que un ticket resuelto (o ganador/perdedor) es "PAGADO"; una
 * jugada retirada/anulada no genera comisión y un pendiente no está decidido.
 */
export function estadoDeTicket(estado: string | null | undefined): EstadoJugada {
  const e = String(estado ?? "").trim().toUpperCase();
  if (/ANULAD|RETIRAD|RECHAZAD/.test(e)) return "ANULADA";
  if (!e || /PENDIENTE/.test(e)) return "PENDIENTE";
  return "PAGADO";
}

/** Fila de detalle de un ticket ya clasificado (o null si no suma al reporte). */
function detalleDeTicket(
  t: FilaTicket,
  producto: VentaConvenio["producto"],
  grupo: GrupoComisiones | undefined,
  moneda: string,
  monto: number,
  grupoId: string
): DetalleJugada {
  const d = desgloseJugada(t as unknown as Record<string, unknown>);
  const pct = comisionPctDeGrupo(grupo, producto) ?? 0;
  // El ejemplar desglosado ("4 × 1", "7"); si no hay, cae al rótulo de la jugada.
  const detalle = String(d.ejemplar || d.caballo || d.jugada || "").trim();
  return {
    fecha: fechaDeTicket(t),
    hipodromo: String(t.hipodromo ?? "").trim(),
    carrera: t.carrera != null ? String(t.carrera) : "",
    cliente: String(t.cliente ?? "").trim(),
    grupoId,
    grupo: String(grupo?.nombre ?? grupoId),
    esPrincipal: grupo?.es_principal === true,
    producto,
    detalle,
    estado: estadoDeTicket(t.estado),
    moneda,
    monto,
    pct,
    comision: comisionEnDinero(monto, pct),
  };
}

/** Agrega un ticket al acumulador si se puede clasificar por producto. */
function acumularTicket(t: FilaTicket, out: VentaConvenio[]): void {
  const producto = productoDeNota(t.nota_auditoria);
  if (!producto) return;
  // REGLA DE ORO CONTABLE: la comisión por convenio se le debe al grupo al que
  // el jugador le DA CUENTA (grupo_cuenta_id = su grupo). Si la migración no está
  // aplicada, cae al `grupo_cobro_id` histórico (mismo comportamiento previo).
  const grupoId = grupoDeCuenta(t.grupo_cuenta_id, t.grupo_publicador_id, t.grupo_cobro_id);
  if (!grupoId) return;
  const monto = montoDeTicket(t);
  if (!monto) return;
  out.push({ grupoId, producto, moneda: String(t.moneda || "USD"), monto });
}

const finDeDia = (hasta: string): string => `${hasta}T23:59:59.999`;

/** Índice de grupos por id, para resolver nombre/principal en el detalle. */
function indiceGrupos(grupos: GrupoComisiones[]): Map<string, GrupoComisiones> {
  const m = new Map<string, GrupoComisiones>();
  for (const g of grupos) m.set(String(g.id), g);
  return m;
}

/** Detalle de una fila de polla (las pollas no traen cliente/hipódromo propios). */
function detalleDePolla(
  grupoId: string,
  fecha: string,
  monto: number,
  grupos: Map<string, GrupoComisiones>
): DetalleJugada {
  const grupo = grupos.get(grupoId);
  const pct = comisionPctDeGrupo(grupo, "polla") ?? 0;
  return {
    fecha: String(fecha ?? "").slice(0, 10),
    hipodromo: "",
    carrera: "",
    cliente: "",
    grupoId,
    grupo: String(grupo?.nombre ?? grupoId),
    esPrincipal: grupo?.es_principal === true,
    producto: "polla",
    detalle: "POLLA",
    estado: "PAGADO",
    moneda: "USD",
    monto,
    pct,
    comision: comisionEnDinero(monto, pct),
  };
}

/**
 * Genera el reporte de comisiones por convenio del rango [desde, hasta] (fechas
 * `YYYY-MM-DD`). `grupos` es la lista de grupos (con sus % por producto).
 *
 * Devuelve el CONSOLIDADO por grupo+producto (`filas`) y el DETALLE por jugada
 * (`detalle`). El 4.º argumento `filtros` acota el detalle (grupo, fechas,
 * hipódromo, carrera y tipo de jugada); el consolidado sigue saliendo del rango
 * completo para que el total a pagar no cambie por un filtro de vista.
 */
export async function cargarReporteComisiones(
  desde: string,
  hasta: string,
  grupos: GrupoComisiones[],
  filtros?: FiltrosReporte
): Promise<ResultadoConvenio> {
  if (!supabase) {
    return { ok: false, error: "Sin conexión a Supabase", filas: [], detalle: [], avisos: [] };
  }
  const avisos: string[] = [];
  const ventas: VentaConvenio[] = [];
  const detalle: DetalleJugada[] = [];
  const idx = indiceGrupos(grupos);

  // ---- 1) Tickets (marcas, tablas, remates, wps, dupletas, entre tercios) ----
  // Se pide `*` (y no columnas nombradas) para tolerar migraciones incompletas:
  // el detalle necesita fecha_carrera/hipodromo/carrera/cliente/estado, y una
  // columna que falte no debe tumbar el reporte entero.
  for (let p = 0; p < MAX_PAGINAS; p++) {
    const { data, error } = await supabase
      .from("tickets_apuestas")
      .select("*")
      .gte("fecha_registro", desde)
      .lte("fecha_registro", finDeDia(hasta))
      .order("fecha_registro", { ascending: true })
      .range(p * PAGINA, p * PAGINA + PAGINA - 1);
    if (error) {
      return { ok: false, error: error.message, filas: [], detalle: [], avisos };
    }
    const filas = (data ?? []) as FilaTicket[];
    for (const t of filas) {
      acumularTicket(t, ventas);
      // Detalle: solo las jugadas clasificables y con grupo de cobro.
      const producto = productoDeNota(t.nota_auditoria);
      const grupoId = grupoDeCuenta(t.grupo_cuenta_id, t.grupo_publicador_id, t.grupo_cobro_id);
      if (!producto || !grupoId) continue;
      const monto = montoDeTicket(t);
      if (!monto) continue;
      const moneda = String(t.moneda || "USD");
      detalle.push(detalleDeTicket(t, producto, idx.get(grupoId), moneda, monto, grupoId));
    }
    if (filas.length < PAGINA) break;
    if (p === MAX_PAGINAS - 1) avisos.push("El rango es muy amplio: se leyó hasta el tope de páginas.");
  }

  // ---- 2) Pollas (tablas propias) ----
  try {
    const { data: pollas, error: e1 } = await supabase
      .from("pollas")
      .select("id, grupo_id, fecha")
      .gte("fecha", desde)
      .lte("fecha", hasta);
    if (e1) throw e1;
    const grupoPorPolla = new Map<string, string>();
    const fechaPorPolla = new Map<string, string>();
    for (const p of (pollas ?? []) as Array<{ id: string; grupo_id?: string | null; fecha?: string | null }>) {
      if (p.grupo_id) grupoPorPolla.set(String(p.id), String(p.grupo_id));
      fechaPorPolla.set(String(p.id), String(p.fecha ?? "").slice(0, 10));
    }
    const ids = [...grupoPorPolla.keys()];
    for (let i = 0; i < ids.length; i += LOTE_IDS) {
      const lote = ids.slice(i, i + LOTE_IDS);
      const { data: pv, error: e2 } = await supabase
        .from("polla_ventas")
        .select("polla_id, pagado")
        .in("polla_id", lote);
      if (e2) throw e2;
      for (const v of (pv ?? []) as Array<{ polla_id: string; pagado?: number | string | null }>) {
        const grupoId = grupoPorPolla.get(String(v.polla_id));
        const monto = Number(v.pagado ?? 0);
        if (grupoId && Number.isFinite(monto) && monto > 0) {
          ventas.push({ grupoId, producto: "polla", moneda: "USD", monto });
          detalle.push(detalleDePolla(grupoId, fechaPorPolla.get(String(v.polla_id)) ?? "", monto, idx));
        }
      }
    }
  } catch (e) {
    avisos.push(
      "No se pudieron sumar las pollas del rango: " + (e instanceof Error ? e.message : String(e))
    );
  }

  const detalleFiltrado = filtros ? filtrarDetalle(detalle, filtros) : detalle;
  return { ok: true, filas: consolidarReporte(ventas, grupos), detalle: detalleFiltrado, avisos };
}
