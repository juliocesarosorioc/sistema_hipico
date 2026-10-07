/**
 * Carreras del Día — servicio CENTRAL de la jornada.
 * Fuente de verdad: la MATRIZ `carreras` (sql/carreras.sql; unique
 * fecha+hipódromo+carrera) — el ÚNICO lugar del que se listan las carreras que
 * se van a jugar. Desde este editor se registran incluso SIN ejemplares con
 * nombre (basta el Nº de caballos) para poder apostar por número y resolver al
 * cargar la pizarra.
 *
 * `resultados_carreras` queda como libro de resultados y `programa_dia` como
 * documento crudo de la IA: ninguno de los dos se usa para listar carreras.
 */
import { supabase } from "@/lib/supabase";
import { exigirCapacidad } from "@/lib/seguridad/vigente";
import { hoyLocal } from "@/lib/gaceta/programa";
import { leerRetirosCarrera, textoRetirados } from "@/lib/carreras/retiros";
import {
  aCarreraCentral,
  leerCarrerasMaestro,
  escribirCarrerasMaestro,
  eliminarCarreraMaestro,
} from "@/lib/carreras/maestro";

export {
  alternarRetiroCarrera,
  aplicarRetirosCarrera,
  leerRetirosCarrera,
  parsearRetirados,
  textoRetirados,
} from "@/lib/carreras/retiros";
export type { ResultadoRetiros } from "@/lib/carreras/retiros";
// La matriz maestra es el camino normal; estos reexports deja el módulo usable
// igual desde los módulos que ya importaban de acá.
export {
  leerCarrerasMaestro,
  escribirCarrerasMaestro,
  eliminarCarreraMaestro,
  registrarCarreraMaestro,
  marcarMaestroAusente,
  reintentarMaestro,
  maestroActivo,
} from "@/lib/carreras/maestro";
export type { EntradaCarrera, FilaCarreraMaestro } from "@/lib/carreras/maestro";

export type EjemplarCarreraCentral = {
  numero: string;
  nombre?: string | null;
  nacionalidad?: string | null;
  /** Retirado según la lista CENTRAL de la carrera (resultados_carreras.retirados). */
  retirado?: boolean;
};

export type CarreraCentral = {
  id?: string | number;
  fecha: string;
  hipodromo: string;
  carrera: number;
  /** Ejemplares inscritos — pueden tener solo número (sin nombre). */
  caballos?: EjemplarCarreraCentral[];
  /** Números retirados de la carrera (lista central, aplica a todos los módulos). */
  retirados?: string[];
  /**
   * Números INVALIDADOS solo para Remates.
   *
   * NO es lo mismo que `retirados`: invalidar impide pujar y deja la
   * participación intacta, mientras que retirar saca el ejemplar de todos los
   * módulos. Se guardan separados para que un INV de Remates no desaparezca de
   * Tablas, Marcas ni Taquilla.
   */
  invalidados?: string[];
  distancia?: string | null;
  superficie?: string | null;
  premio?: number | null;
  hora?: string | null;
  estado?: string;
  /** De dónde salió la fila: ia | manual | tablas | central. */
  origen?: string | null;
  registrado_por?: string | null;
  actualizado_por?: string | null;
  /** Verificación administrativa: quién revisó la carrera y cuándo. */
  verificado?: boolean;
  verificado_por?: string | null;
  verificado_at?: string | null;
  updated_at?: string | null;
  /**
   * Pizarra oficial: numeros ganadores, en orden de llegada. Es el resultado
   * de la carrera y lo leen Taquilla, Tablas y Reportes.
   *
   * Antes estos datos SE PEDIAN en el select y se tiraban al mapear, asi que
   * cada modulo iba a buscarlos por su cuenta con una consulta extra. Se
   * exponen aqui para que la carrera CENTRAL sea de verdad la unica fuente.
   */
  ganadores?: string[];
  /** El resultado ya se aplico a las tablas fijas de la jornada. */
  aplicado_a_tablas?: boolean;
};

export type ResCarreras = { ok: boolean; datos?: CarreraCentral[]; error?: string };

/** Números 1..n para generar ejemplares "solo número" (sin nombres). */
export function numerosEjemplares(n: number): EjemplarCarreraCentral[] {
  return Array.from({ length: n }, (_, i) => ({ numero: String(i + 1) }));
}

/**
 * Lista las carreras del día para [fecha + hipódromo] desde la MATRIZ MAESTRA
 * `carreras` (sql/carreras.sql) — el ÚNICO lugar del que los módulos toman las
 * carreras que se cargan. Devuelve también carreras "Programada" (sin
 * resultados): la carrera existe desde que se guarda el programa, sin depender
 * de que alguien corra resultados o pulse Publicar.
 *
 * Sin fallback a `resultados_carreras` ni a `programa_dia`: si la matriz no
 * responde, se devuelve el error en vez de mostrar una lista armada con otra
 * fuente. Así no pueden coexistir dos verdades sobre qué carreras hay.
 */
export async function listarCarrerasCentrales(
  fecha?: string,
  hipodromo?: string
): Promise<ResCarreras> {
  const f = fecha || hoyLocal();
  const hip = String(hipodromo ?? "").trim().toUpperCase();
  if (!supabase) return { ok: false, error: "Sin credenciales Supabase (.env.local)." };

  const maestro = await leerCarrerasMaestro(f, hip);
  if (!maestro.ok) {
    return {
      ok: false,
      error:
        maestro.error ??
        "La matriz de carreras no está disponible. Aplicá sql/carreras.sql en Supabase.",
    };
  }
  return { ok: true, datos: maestro.filas.map(aCarreraCentral) };
}

/**
 * UPSERT de la carrera en la MATRIZ MAESTRA `carreras` (unique
 * fecha+hipódromo+carrera): oferta de la carrera + ejemplares (que pueden ser
 * solo números). Deja de escribir la oferta en `resultados_carreras`, que queda
 * como libro de resultados.
 *
 * Escribe SOLO la matriz: si no está aplicada, se devuelve el error en vez de
 * duplicar la oferta en `resultados_carreras`.
 */
export async function guardarCarreraCentral(c: CarreraCentral): Promise<{ ok: boolean; error?: string }> {
    if (!supabase) return { ok: false, error: "Sin credenciales Supabase (.env.local)." };
    try {
      exigirCapacidad("carreras:fn_registrar_carrera");
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
    const hip = String(c.hipodromo ?? "").trim().toUpperCase();
  const num = Number(c.carrera) || 0;
  const fecha = c.fecha || hoyLocal();
  if (!hip || !num) return { ok: false, error: "Hipódromo y Nº de carrera requeridos." };
  // La lista CENTRAL de retiros manda: se reaplica sobre los ejemplares que se
  // guardan, para que editar la carrera no borre los retiros ya registrados.
  const retirados = new Set(await leerRetirosCarrera(fecha, hip, num));
  const filas = Array.isArray(c.caballos) ? c.caballos : [];
  const caballos = filas.map((x) => {
    const numero = String(x.numero).trim();
    return {
      numero,
      nombre: x.nombre ?? null,
      nacionalidad: x.nacionalidad ?? null,
      retirado: x.retirado === true || retirados.has(numero),
    };
  });

  const maestro = await escribirCarrerasMaestro([
    {
      fecha,
      hipodromo: hip,
      carrera: num,
      estado: c.estado,
      caballos,
      // Ojo: si el llamador NO manda la lista, se omite el campo en vez de
      // mandar null. Editar la carrera para cambiar la distancia no puede
      // borrar los retiros ni los invalidados que ya tenía: `undefined` le dice
      // al maestro "no tocar esto", `null` le diría "vaciarlo".
      retirados: Array.isArray(c.retirados)
        ? textoRetirados(c.retirados)
        : c.retirados === undefined
          ? undefined
          : c.retirados,
      invalidado_remate: Array.isArray(c.invalidados)
        ? textoRetirados(c.invalidados)
        : c.invalidados === undefined
          ? undefined
          : null,
      distancia: c.distancia ?? null,
      superficie: c.superficie ?? null,
      premio: c.premio ?? null,
      hora: c.hora ?? null,
      origen: "manual",
    },
  ]);
  if (maestro.ok) return { ok: true };
  return {
    ok: false,
    error:
      maestro.error ??
      "La matriz de carreras no está disponible. Aplicá sql/carreras.sql en Supabase.",
  };
}

/**
 * Elimina la carrera del catálogo (solo la OFERTA — NO borra tablas fijas
 * publicadas, resultados ni jugadas ya registradas). Borra SOLO en la matriz; si
 * no está aplicada, devuelve el error.
 */
export async function eliminarCarreraCentral(fecha: string, hipodromo: string, carrera: number | string): Promise<{ ok: boolean; error?: string }> {
    if (!supabase) return { ok: false, error: "Sin credenciales Supabase (.env.local)." };
    try {
      exigirCapacidad("carreras:fn_eliminar_carrera");
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
    const maestro = await eliminarCarreraMaestro(fecha, hipodromo, carrera);
    if (maestro.ok) return { ok: true };
    return {
      ok: false,
      error:
        maestro.error ??
        "La matriz de carreras no está disponible. Aplicá sql/carreras.sql en Supabase.",
    };
}