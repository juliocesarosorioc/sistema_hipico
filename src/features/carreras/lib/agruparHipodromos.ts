/**
 * Agrupación de carreras por hipódromo para el Monitor de Hipódromos del Día.
 *
 * Vive fuera de los componentes para que Tablas Fijas y Carreras del Día
 * calculen exactamente los mismos grupos a partir de fuentes distintas: la
 * clave es la unificacion (hipodromo en mayusculas + dia del evento).
 */
import type { CarreraMonitor, GrupoHipodromo } from "@/shared/components/ui/MonitorHipodromos";
import { claveHipodromo, numeroCarrera } from "@/features/carreras/lib/claves";

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
 * Eje de fecha para agrupar y filtrar: son DOS fechas distintas y no siempre
 * coinciden.
 *   · "carrera" → cuándo CORRE la carrera (columna `fecha`).
 *   · "venta"   → cuándo se VENDIÓ/publicó la tabla (columna `fecha_creacion`).
 * Una carrera del domingo puede publicarse el viernes; son ejes distintos.
 */
export type EjeFecha = "carrera" | "venta";

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

/**
 * Día (ISO, LOCAL) de una fecha de VENTA/alta.
 *
 * `fecha_creacion` se guarda con `new Date().toISOString()`, o sea en UTC:
 * cortarle los 10 primeros caracteres devolvería el día de Greenwich y, en
 * Venezuela (UTC-4), una venta de las 21:00 aparecería fechada al día
 * siguiente. Por eso los timestamps se convierten a fecha LOCAL. Las fechas sin
 * hora —la de carrera es un `date`— se cortan tal cual, sin conversión, para no
 * desplazarlas.
 */
export function diaDeAlta(raw?: string | null): string {
  const v = String(raw ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}T/.test(v)) {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) {
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      return `${d.getFullYear()}-${mm}-${dd}`;
    }
  }
  return normalizarDia(v);
}

/**
 * Día (ISO) de una fila según el eje pedido.
 *
 *   · "carrera" (default): la fecha del EVENTO (`fecha`), con respaldo en
 *     `fecha_creacion` para las filas legacy que no la traen.
 *   · "venta": la fecha de VENTA/publicación (`fecha_creacion`, en hora local),
 *     con respaldo en la del evento.
 *
 * `fallback` se usa solo cuando la fila no trae NINGUNA de las dos.
 */
export function diaDeCarrera(
  t: CarreraAgrupable,
  fallback: string,
  eje: EjeFecha = "carrera"
): string {
  const evento = normalizarDia(t.fecha);
  const alta = diaDeAlta(t.fecha_creacion);
  const dia = eje === "venta" ? alta || evento : evento || alta;
  return dia || fallback;
}

/**
 * Agrupa por hipódromo las carreras de un día y las ordena por hipódromo y
 * número de carrera. Descarta las que no tienen hipódromo o carrera.
 *
 * `eje` decide contra CUÁL fecha se compara `dia`: cuándo corre (default) o
 * cuándo se vendió. Permite que el mismo panel sirva a los dos ejes del Monitor.
 */
export function agruparPorHipodromo(
  filas: CarreraAgrupable[],
  dia: string,
  eje: EjeFecha = "carrera"
): GrupoHipodromo[] {
  const porHip = new Map<string, CarreraMonitor[]>();
  for (const t of filas) {
    // `dia` vacío = TODOS LOS DÍAS (sin filtro). El Monitor de Tablas Fijas
    // arranca sin día elegido para mostrar todo lo publicado, y su panel de
    // hipódromos tiene que reflejar esa misma vista.
    if (dia && diaDeCarrera(t, dia, eje) !== dia) continue;
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
