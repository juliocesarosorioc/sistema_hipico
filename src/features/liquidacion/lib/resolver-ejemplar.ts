/**
 * ============================================================================
 * SINCRONIZACIÓN NÚMERO DE EJEMPLAR ➔ NOMBRE OFICIAL (puerta a Supabase)
 * ============================================================================
 *
 * La parte PURA (indexar el padrón y resolver el nombre) vive en
 * `resolver-ejemplar-nucleo.ts`; acá está solo la lectura de la MATRIZ
 * `carreras` (padrón `carreras.caballos` = JSON `{numero, nombre}`) para la
 * combinación (fecha, hipódromo, nº de carrera).
 *
 * Best-effort: sin conexión, sin matriz o sin fila, devuelve `null` (el editor
 * NO rompe: la jugada se guarda igual, solo no se puede sincronizar el nombre).
 */
import { supabase } from "@/core/supabase";
import { claveHipodromo } from "@/features/carreras/lib/claves";
import { COLUMNAS_MAESTRO } from "@/features/carreras/lib/maestro-nucleo";
import { nombreDeNumero, type EjemplarPadron } from "@/features/liquidacion/lib/resolver-ejemplar-nucleo";

export * from "@/features/liquidacion/lib/resolver-ejemplar-nucleo";

const TXT = (v: unknown): string => (v == null ? "" : String(v).trim());

/**
 * Nombre oficial del ejemplar en la MATRIZ para (fecha, hipódromo, carrera).
 *
 * Lee `carreras` por la clave canónica del día (mismo filtro que el resto de la
 * app: fecha + hipódromo sin espacios + número) y devuelve el nombre del
 * ejemplar con ese número, o `null` si no lo encuentra.
 */
export async function nombreDeEjemplarEnMatriz(opts: {
  fecha: string;
  hipodromo: string;
  carrera: number | string;
  numero: string | number;
}): Promise<string | null> {
  if (!supabase) return null;
  const num = Number(opts.carrera) || 0;
  if (!claveHipodromo(opts.hipodromo) || !num) return null;
  const dia = String(opts.fecha ?? "").slice(0, 10);
  if (!dia) return null;
  try {
    const { data, error } = await supabase
      .from("carreras")
      .select(COLUMNAS_MAESTRO)
      .eq("fecha", dia)
      .eq("carrera", num)
      .limit(20);
    if (error) return null;
    const clave = claveHipodromo(opts.hipodromo);
    const fila = ((data ?? []) as Array<Record<string, unknown>>).find(
      (r) => claveHipodromo(String(r.hipodromo ?? "")) === clave
    );
    if (!fila) return null;
    return nombreDeNumero(opts.numero, (fila.caballos as EjemplarPadron[]) ?? []);
  } catch {
    return null;
  }
}

/**
 * Resuelve el nombre oficial de un ejemplar a partir del `caballo` que el editor
 * tenga a mano (puede venir "5" o un pareo "5x3"): solo se sincroniza cuando el
 * campo es un número SUELTO (un pareo/tabla no tiene un único nombre que poner).
 * Devuelve `null` si no aplica.
 */
export async function nombreOficialDeCaballoSuelto(opts: {
  fecha: string;
  hipodromo: string;
  carrera: number | string;
  caballo: string | number | null | undefined;
}): Promise<string | null> {
  const t = TXT(opts.caballo);
  if (!/^[0-9]+$/.test(t)) return null;
  return nombreDeEjemplarEnMatriz({ ...opts, numero: t });
}
