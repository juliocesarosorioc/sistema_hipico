/**
 * Agrupación de carreras por hipódromo para el Monitor de Hipódromos del Día.
 *
 * Vive fuera de los componentes para que Tablas Fijas y Carreras del Día
 * calculen exactamente los mismos grupos a partir de fuentes distintas: la
 * clave es la unificacion (hipodromo en mayusculas + dia del evento).
 */
import type { CarreraMonitor, GrupoHipodromo } from "@/components/ui/MonitorHipodromos";
import { claveHipodromo, numeroCarrera } from "@/lib/carreras/claves";

export type CarreraAgrupable = {
  hipodromo?: string | null;
  carrera?: number | string | null;
  estado?: string | null;
  id?: string | number;
  /** Ventas asociadas, si el módulo las tiene. */
  ventas?: number;
  /** Días alternativos: `fecha` es la fecha del evento. */
  fecha?: string | null;
  fecha_creacion?: string | null;
};

/**
 * Normaliza un valor de fecha a ISO (YYYY-MM-DD). Acepta el formato regional
 * DD-MM-YYYY que todavía llega en filas legacy, y cae a `fecha_creacion` cuando
 * la fila no tiene `fecha` (la fecha del evento es la que manda).
 */
export function normalizarDia(raw?: string | null): string {
  const v = String(raw ?? "").trim();
  if (!v) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const partes = v.split(/[-/]/);
  if (partes.length === 3 && partes[0].length <= 2) {
    return `${partes[2]}-${partes[1].padStart(2, "0")}-${partes[0].padStart(2, "0")}`;
  }
  return v.slice(0, 10);
}

/** Día del evento en ISO, tolerante al legacy sin `fecha`. */
export function diaDeCarrera(t: CarreraAgrupable, fallback: string): string {
  return normalizarDia(t.fecha) || normalizarDia(t.fecha_creacion) || fallback;
}

/**
 * Agrupa por hipódromo las carreras de un día y las ordena por hipódromo y
 * número de carrera. Descarta las que no tienen hipódromo o carrera.
 */
export function agruparPorHipodromo(
  filas: CarreraAgrupable[],
  dia: string
): GrupoHipodromo[] {
  const porHip = new Map<string, CarreraMonitor[]>();
  for (const t of filas) {
    if (diaDeCarrera(t, dia) !== dia) continue;
    // `claveHipodromo` y no un `.trim().toUpperCase()` propio: el Monitor y el
    // registro central tienen que producir EXACTAMENTE la misma clave, o un
    // "LA urel" agruparía en un módulo y en otro sería otro hipódromo.
    const hipo = claveHipodromo(t.hipodromo);
    const numero = numeroCarrera(t.carrera);
    if (!hipo || !numero) continue;
    const arr = porHip.get(hipo) ?? [];
    arr.push({ id: t.id, carrera: numero, estado: t.estado, ventas: t.ventas });
    porHip.set(hipo, arr);
  }
  return Array.from(porHip.entries())
    .map(([hipodromo, carreras]) => ({
      hipodromo,
      carreras: carreras.sort((a, b) => Number(a.carrera) - Number(b.carrera)),
    }))
    .sort((a, b) => a.hipodromo.localeCompare(b.hipodromo));
}
