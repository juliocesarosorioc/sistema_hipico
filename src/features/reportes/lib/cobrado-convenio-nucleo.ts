/**
 * ============================================================================
 * COBRADO NETO POR CONVENIO · núcleo puro de los reportes
 * ============================================================================
 * Regla contable del dueño, por jugada:
 *
 *   · si el CLIENTE GANÓ  → el monto va a la columna PAGADO (premio);
 *   · si el CLIENTE PERDIÓ → el monto perdido va a la columna COBRADO,
 *     descontando el % de convenio que el grupo principal le paga al grupo
 *     donde se publicó la jugada:
 *
 *         Cobrado neto = Monto perdido × (1 − % Comisión Convenio / 100)
 *
 * El % sale de las columnas de `grupos_venta` (`comision_tablas`,
 * `comision_marcas`, `comision_polla`, `comision_remates`, `comision_dupletas`),
 * con herencia a `comision_default` cuando el producto no tiene tasa propia
 * (ver `comisiones-convenio.ts`).
 *
 * Este archivo no toca React ni Supabase: recibe los grupos ya cargados y
 * devuelve las filas enriquecidas. Así el cálculo se puede probar en node y la
 * pantalla solo se ocupa de pintar.
 */
import {
  comisionPctDeGrupo,
  type GrupoComisiones,
  type ProductoConvenio,
} from "@/features/grupos/lib/comisiones-convenio";
import type { VentaTablaReporte } from "@/features/tablas/lib/reporte-tablas-nucleo";

export type { GrupoComisiones, ProductoConvenio };

/** Índice `id (texto) → grupo` para resolver el % de cada ticket. */
export function indiceConvenio(grupos: GrupoComisiones[]): Map<string, GrupoComisiones> {
  const mapa = new Map<string, GrupoComisiones>();
  for (const g of grupos) mapa.set(String(g.id), g);
  return mapa;
}

/**
 * % de convenio del grupo que publicó una jugada. Si el producto no tiene tasa
 * propia se hereda `comision_default`; si no hay grupo o no hay ninguna tasa,
 * devuelve 0 (se cobra el monto completo).
 */
export function pctConvenioDe(
  indice: Map<string, GrupoComisiones>,
  grupoId: string | number | null | undefined,
  producto: ProductoConvenio
): number {
  const grupo = indice.get(String(grupoId ?? ""));
  const pct = comisionPctDeGrupo(grupo ?? null, producto);
  if (pct == null || !Number.isFinite(pct)) return 0;
  return Math.min(100, Math.max(0, pct));
}

/**
 * Enriquece las ventas con el % de convenio de su grupo. Es una copia: no muta
 * las filas que vienen de la carga (la data cruda se reutiliza en cada filtro).
 */
export function conConvenio(
  ventas: VentaTablaReporte[],
  indice: Map<string, GrupoComisiones>,
  producto: ProductoConvenio
): VentaTablaReporte[] {
  return ventas.map((v) => ({
    ...v,
    pctConvenio: pctConvenioDe(indice, v.grupoId, producto),
  }));
}
