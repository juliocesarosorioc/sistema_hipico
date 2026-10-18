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
import {
  consolidarReporte,
  montoDecidido,
  productoDeNota,
  type FilaReporte,
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
  grupo_cobro_id?: string | null;
  grupo_cobro_nombre?: string | null;
  moneda?: string | null;
  monto_decidido?: number | string | null;
  monto_jugado?: number | string | null;
  nota_auditoria?: unknown;
};

export type ResultadoConvenio = {
  ok: boolean;
  error?: string;
  filas: FilaReporte[];
  /** Avisos NO fatales (p. ej. si la tabla de pollas no está aplicada). */
  avisos: string[];
};

/** Monto decidido del ticket (con el jugado de respaldo). */
export function montoDeTicket(t: FilaTicket): number {
  return montoDecidido(t.monto_decidido, t.monto_jugado);
}

/** Agrega un ticket al acumulador si se puede clasificar por producto. */
function acumularTicket(t: FilaTicket, out: VentaConvenio[]): void {
  const producto = productoDeNota(t.nota_auditoria);
  if (!producto) return;
  const grupoId = t.grupo_cobro_id ? String(t.grupo_cobro_id) : "";
  if (!grupoId) return;
  const monto = montoDeTicket(t);
  if (!monto) return;
  out.push({ grupoId, producto, moneda: String(t.moneda || "USD"), monto });
}

const finDeDia = (hasta: string): string => `${hasta}T23:59:59.999`;

/**
 * Genera el reporte de comisiones por convenio del rango [desde, hasta] (fechas
 * `YYYY-MM-DD`). `grupos` es la lista de grupos (con sus % por producto).
 */
export async function cargarReporteComisiones(
  desde: string,
  hasta: string,
  grupos: GrupoComisiones[]
): Promise<ResultadoConvenio> {
  if (!supabase) {
    return { ok: false, error: "Sin conexión a Supabase", filas: [], avisos: [] };
  }
  const avisos: string[] = [];
  const ventas: VentaConvenio[] = [];

  // ---- 1) Tickets (marcas, tablas, remates, wps, dupletas, entre tercios) ----
  for (let p = 0; p < MAX_PAGINAS; p++) {
    const { data, error } = await supabase
      .from("tickets_apuestas")
      .select("grupo_cobro_id, grupo_cobro_nombre, moneda, monto_decidido, monto_jugado, nota_auditoria")
      .gte("fecha_registro", desde)
      .lte("fecha_registro", finDeDia(hasta))
      .order("fecha_registro", { ascending: true })
      .range(p * PAGINA, p * PAGINA + PAGINA - 1);
    if (error) {
      return { ok: false, error: error.message, filas: [], avisos };
    }
    const filas = (data ?? []) as FilaTicket[];
    for (const t of filas) acumularTicket(t, ventas);
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
    for (const p of (pollas ?? []) as Array<{ id: string; grupo_id?: string | null }>) {
      if (p.grupo_id) grupoPorPolla.set(String(p.id), String(p.grupo_id));
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
        }
      }
    }
  } catch (e) {
    avisos.push(
      "No se pudieron sumar las pollas del rango: " + (e instanceof Error ? e.message : String(e))
    );
  }

  return { ok: true, filas: consolidarReporte(ventas, grupos), avisos };
}
