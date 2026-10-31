import { supabase } from "@/core/supabase";
import { exigirCapacidad } from "@/features/seguridad/lib/vigente";
import type { EjemplarTabla, TablaGrupo } from "@/features/tablas/lib/tipos";

/** Fila de tablas_fijas (mínima para cierre + completa para el Monitor). */
export type TablaFijaRow = {
  id: string | number;
  hipodromo?: string | null;
  hipodromo_id?: string | number | null;
  carrera?: number | null;
  fecha?: string | null;
  /** Día del evento cuando la columna "fecha" está NULL (fix legacy 2026-09-19). */
  fecha_creacion?: string | null;
  estado?: string | null;
  premio_original?: number | null;
  premio_recalculado?: number | null;
  suma_base_tabla?: number | null;
  limite_ventas?: number | null;
  cantidad_vendida?: number | null;
  moneda?: string | null;
  tasa_cambio?: number | null;
  distancia_carrera?: string | null;
  superficie?: string | null;
  retirados_oficiales?: string | null;
  comision_grupo?: number | null;
  grupo_venta?: string | null;
  monto_tabla?: number | null;
  caballos?: EjemplarTabla[] | null;
  tabla_grupos?: TablaGrupo[] | null;
};

export type ResultadoCerrar = {
  ok: boolean;
  error?: string;
  conteo?: number;
};

/* ============================================================================
   MOTOR DEL EJEMPLAR DE LA TABLA FIJA — válido / retirado / INVALIDADO
   ============================================================================
   Estas reglas son la fuente de verdad del módulo y viven acá (puras, sin
   Supabase) para que el Monitor, el reporte y la liquidación no puedan
   discrepar: si un ejemplar está invalidado, NINGÚN camino lo paga como
   ganador.

   "INVALIDADO" NO es "RETIRADO":
     · RETIRADO   → sale de la oferta, se reembolsa lo jugado y su valor no
                    reparte (además el premio se recalcula a la baja).
     · INVALIDADO → sigue en la oferta (la apuesta se PIERDE, no se devuelve)
                    pero tampoco reparte y no puede ganar.
   ============================================================================ */

/** Un ejemplar INVALIDADO no puede ganar ni ser pagado como ganador. */
export function esInvalidado(c: EjemplarTabla | null | undefined): boolean {
  return Boolean(c?.invalidado);
}

/**
 * Números (texto) de los ejemplares INVALIDADOS de una tabla.
 *
 * Es la lista que la liquidación usa para sacarlos de los ganadores y la que
 * el reporte usa para contarlos aparte.
 */
export function numerosInvalidados(caballos: EjemplarTabla[] | null | undefined): string[] {
  return (caballos ?? [])
    .filter((c) => esInvalidado(c))
    .map((c) => String(c.numero ?? "").trim())
    .filter((n) => n !== "");
}

/**
 * GANADORES QUE SÍ PUEDEN COBRAR.
 *
 * De la lista declarada por el operador (pizarra) se descartan los ejemplares
 * invalidados: un descalificado no puede ganar, así que su ticket no puede
 * quedar como 'Ganador' ni generar un pago.
 *
 * Si la lista de ejemplares de la tabla no se pudo leer (vacía), se devuelven
 * los ganadores tal como vinieron: no se puede decidir con información que no
 * hay, y bloquear la liquidación por una lectura fallida dejaría la tabla sin
 * pagar.
 */
export function ganadoresEfectivos(
  caballos: EjemplarTabla[] | null | undefined,
  ganadores: string | string[] | null | undefined
): string[] {
  const declarados = (Array.isArray(ganadores) ? ganadores : String(ganadores ?? "").split(","))
    .map((g) => String(g ?? "").trim())
    .filter((g) => g !== "");
  if (!declarados.length) return [];
  const lista = caballos ?? [];
  if (!lista.length) return declarados;
  const invalidados = new Set(numerosInvalidados(lista));
  return declarados.filter((g) => !invalidados.has(g));
}

/**
 * PAGO POTENCIAL de una apuesta sobre un ejemplar: la parte del premio de la
 * tabla que le toca según su peso en la base (`premio × valor / base`).
 *
 * Un ejemplar INVALIDADO vale CERO: no puede ganar, así que no puede tener
 * premio potencial (no se le ofrece al jugador una apuesta que la casa no
 * podría cobrar).
 */
export function pagoPotencialEjemplar(opts: {
  premio: number;
  base?: number;
  cantidad?: number;
  monto: number;
  invalidado?: boolean;
}): number {
  if (opts.invalidado) return 0;
  if (!opts.monto) return 0;
  if (opts.cantidad && opts.cantidad > 0) return opts.premio * opts.cantidad;
  const cant = opts.base && opts.base > 0 ? Math.max(1, Math.round(opts.monto / opts.base)) : 1;
  return opts.premio * cant;
}

/**
 * Auto-cierre de la Tabla Fija publicada de una carrera.
 * Cambia estado → 'Cerrada' para que deje de aparecer como Abierta en el
 * módulo de Tablas Fijas (evita carreras abiertas sin cerrar).
 * RLS está desactivado sobre tablas_fijas → UPDATE directo válido.
 */
export async function cerrarTablaFija(
  hipodromo: string,
  carrera: number | string
  ): Promise<ResultadoCerrar> {
    if (!supabase) {
      return { ok: false, error: "Sin credenciales Supabase (.env.local)." };
    }
    try {
      exigirCapacidad("tablas:fn_cerrar_tabla");
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
    try {
    let query = supabase
      .from("tablas_fijas")
      .update({ estado: "Cerrada" })
      .eq("carrera", carrera);
    if (hipodromo) query = query.eq("hipodromo", hipodromo);

    const { error, data } = await query.select("id");

    if (error) return { ok: false, error: error.message };
    return { ok: true, conteo: (data ?? []).length };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}