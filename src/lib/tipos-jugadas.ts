/**
 * ============================================================================
 * REGLAS DE JUGADAS — servicio de la tabla `tipos_jugadas`
 * ============================================================================
 *
 * Migración del legacy `js/tipos_jugadas.js` + `html/tipos_jugadas.html`, con la
 * MISMA tabla (`public.tipos_jugadas`): no hay script de datos, el CRUD apunta al
 * backend que ya usaba el legacy.
 *
 * Una fila describe una jugada del sistema y cómo se cobra/paga:
 *
 *   nombre              → "GANADOR", "EXACTA", …
 *   comision_porcentaje → el % que se lleva la casa
 *   comision_base       → "PREMIO" (sobre lo que gana) | "MONTO" (sobre lo jugado)
 *   tipo_calculo        → "POR_UNIDAD" (juega X $) | "POR_TABLA" (fija/pizarra)
 *   premio_a_pagar      → multiplicador del pago si gana
 *   permite_cruces      → habilita combinaciones 2x3
 *   activo              → se ofrece en los módulos operativos
 *
 * REGLAS:
 *  1. Sin credenciales la UI sigue operativa con un catálogo de respaldo en
 *     memoria (nunca se ven "vacío" ni errores rojos): ver `sembrarReserva()`.
 *  2. Las escrituras pasan por `exigirCapacidad`: con la llave anon suelta, sin
 *     la guarda, cualquiera podría editar las comisiones desde la consola.
 *  3. En el alta se conserva `base_comision` (texto legado "5%") para no romper
 *     a quien todavía lea esa columna.
 */
import { supabase } from "@/lib/supabase";
import { exigirCapacidad } from "@/lib/seguridad/vigente";

export type TipoCalculo = "POR_UNIDAD" | "POR_TABLA";
export type ComisionBase = "PREMIO" | "MONTO";

export type TipoJugada = {
  id: string;
  nombre: string;
  comision_porcentaje: number;
  comision_base: ComisionBase;
  tipo_calculo: TipoCalculo;
  premio_a_pagar: number;
  permite_cruces: boolean;
  activo: boolean;
};

export type ResListarTipos = { ok: boolean; data: TipoJugada[]; error?: string; local?: boolean };
export type ResTipoJugada = { ok: boolean; error?: string };

export type DatosTipoJugada = {
  nombre: string;
  comision_porcentaje: number;
  comision_base: ComisionBase;
  tipo_calculo: TipoCalculo;
  premio_a_pagar: number;
  permite_cruces: boolean;
  activo: boolean;
};

const COMISION_BASES: ComisionBase[] = ["PREMIO", "MONTO"];
const TIPOS_CALCULO: TipoCalculo[] = ["POR_UNIDAD", "POR_TABLA"];

/** Catálogo de respaldo (sin conexión), paridad con las jugadas del legacy. */
const RESERVA: DatosTipoJugada[] = [
  { nombre: "GANADOR", comision_porcentaje: 5, comision_base: "PREMIO", tipo_calculo: "POR_UNIDAD", premio_a_pagar: 1, permite_cruces: true, activo: true },
  { nombre: "PLACE", comision_porcentaje: 5, comision_base: "PREMIO", tipo_calculo: "POR_UNIDAD", premio_a_pagar: 1, permite_cruces: true, activo: true },
  { nombre: "SHOW", comision_porcentaje: 5, comision_base: "PREMIO", tipo_calculo: "POR_UNIDAD", premio_a_pagar: 1, permite_cruces: true, activo: true },
  { nombre: "EXACTA", comision_porcentaje: 5, comision_base: "PREMIO", tipo_calculo: "POR_UNIDAD", premio_a_pagar: 1, permite_cruces: true, activo: true },
  { nombre: "TRIFECTA", comision_porcentaje: 5, comision_base: "PREMIO", tipo_calculo: "POR_UNIDAD", premio_a_pagar: 1, permite_cruces: true, activo: true },
  { nombre: "CUATRIFECTA", comision_porcentaje: 5, comision_base: "PREMIO", tipo_calculo: "POR_UNIDAD", premio_a_pagar: 1, permite_cruces: true, activo: true },
  { nombre: "DOBLE", comision_porcentaje: 5, comision_base: "PREMIO", tipo_calculo: "POR_UNIDAD", premio_a_pagar: 1, permite_cruces: true, activo: true },
];

let cacheLocal: TipoJugada[] = [];
let sembrada = false;

function sembrarReserva(): TipoJugada[] {
  if (sembrada) return cacheLocal;
  cacheLocal = RESERVA.map((j, i) => ({ id: `local-${i + 1}`, ...j }));
  sembrada = true;
  return cacheLocal;
}

const numero = (v: unknown, porDefecto: number): number => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : porDefecto;
};

const normalizar = (r: Record<string, unknown>): TipoJugada => {
  const base = String(r.comision_base ?? "PREMIO").toUpperCase();
  const calc = String(r.tipo_calculo ?? "POR_UNIDAD").toUpperCase();
  return {
    id: String(r.id ?? ""),
    nombre: String(r.nombre ?? "").toUpperCase(),
    comision_porcentaje: numero(r.comision_porcentaje, numero(r.base_comision, 5)),
    comision_base: (COMISION_BASES as string[]).includes(base) ? (base as ComisionBase) : "PREMIO",
    tipo_calculo: (TIPOS_CALCULO as string[]).includes(calc) ? (calc as TipoCalculo) : "POR_UNIDAD",
    premio_a_pagar: numero(r.premio_a_pagar, 1),
    permite_cruces: r.permite_cruces !== false,
    activo: r.activo !== false,
  };
};

/** SELECT * de tipos_jugadas, ordenado alfabéticamente (como el legacy). */
export async function listarTiposJugada(): Promise<ResListarTipos> {
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from("tipos_jugadas")
        .select("*")
        .order("nombre", { ascending: true });
      if (!error && Array.isArray(data)) {
        cacheLocal = (data as unknown[]).map((r) => normalizar(r as Record<string, unknown>));
        sembrada = true;
        return { ok: true, data: cacheLocal };
      }
    } catch {
      /* sin conexión → respaldo */
    }
  }
  return { ok: true, data: sembrarReserva(), local: true };
}

/** Normaliza y valida el payload del formulario antes de tocar la base. */
function preparar(datos: DatosTipoJugada): DatosTipoJugada {
  const nombre = String(datos.nombre ?? "").trim().toUpperCase();
  if (!nombre) throw new Error("El nombre de la jugada es obligatorio.");
  if (!(COMISION_BASES as string[]).includes(datos.comision_base)) throw new Error("Base de comisión inválida.");
  if (!(TIPOS_CALCULO as string[]).includes(datos.tipo_calculo)) throw new Error("Tipo de cálculo inválido.");
  const pct = Number(datos.comision_porcentaje);
  if (!Number.isFinite(pct) || pct < 0) throw new Error("La comisión debe ser un número ≥ 0.");
  const pago = Number(datos.premio_a_pagar);
  if (!Number.isFinite(pago) || pago < 0) throw new Error("El pago si gana debe ser un número ≥ 0.");
  return {
    nombre,
    comision_porcentaje: pct,
    comision_base: datos.comision_base,
    tipo_calculo: datos.tipo_calculo,
    premio_a_pagar: pago,
    permite_cruces: datos.permite_cruces !== false,
    activo: datos.activo !== false,
  };
}

/**
 * Crea (id null) o edita una regla de jugada. En el alta se escribe además
 * `base_comision` (texto "5%") por compatibilidad con la columna legada.
 */
export async function guardarTipoJugada(id: string | null, datos: DatosTipoJugada): Promise<ResTipoJugada> {
  try {
    exigirCapacidad("reglas_jugadas:fn_guardar_jugada");
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  let limpio: DatosTipoJugada;
  try {
    limpio = preparar(datos);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  if (!supabase) {
    if (id) {
      const i = cacheLocal.findIndex((j) => j.id === id);
      if (i < 0) return { ok: false, error: "La jugada ya no existe." };
      cacheLocal[i] = { id, ...limpio };
    } else {
      if (cacheLocal.some((j) => j.nombre === limpio.nombre)) return { ok: false, error: "Esta jugada ya existe." };
      cacheLocal.push({ id: `local-${Date.now()}`, ...limpio });
    }
    sembrada = true;
    return { ok: true };
  }

  try {
    const payload: Record<string, unknown> = { ...limpio };
    if (!id) payload.base_comision = `${limpio.comision_porcentaje}%`;
    const { error } = id
      ? await supabase.from("tipos_jugadas").update(payload).eq("id", id)
      : await supabase.from("tipos_jugadas").insert([payload]);
    if (error) {
      return {
        ok: false,
        error:
          error.code === "23505"
            ? "Esta jugada ya existe."
            : error.code === "42501"
              ? "Sin permiso para editar las reglas de jugadas."
              : error.message,
      };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "No se pudo guardar la regla de jugada." };
  }
}

/** Activa o desactiva una jugada (mismo permiso de escritura que el guardado). */
export async function alternarTipoJugada(id: string, activo: boolean): Promise<ResTipoJugada> {
  try {
    exigirCapacidad("reglas_jugadas:fn_guardar_jugada");
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  if (!supabase) {
    const j = cacheLocal.find((x) => x.id === id);
    if (!j) return { ok: false, error: "La jugada ya no existe." };
    j.activo = activo;
    return { ok: true };
  }

  try {
    const { error } = await supabase.from("tipos_jugadas").update({ activo }).eq("id", id);
    return error ? { ok: false, error: error.message } : { ok: true };
  } catch {
    return { ok: false, error: "No se pudo cambiar el estado de la jugada." };
  }
}

/** Elimina una jugada. Puede fallar por FK si ya hay tickets usándola. */
export async function eliminarTipoJugada(id: string): Promise<ResTipoJugada> {
  try {
    exigirCapacidad("reglas_jugadas:fn_eliminar_jugada");
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  if (!supabase) {
    cacheLocal = cacheLocal.filter((j) => j.id !== id);
    return { ok: true };
  }

  try {
    const { error } = await supabase.from("tipos_jugadas").delete().eq("id", id);
    if (error) {
      return {
        ok: false,
        error: error.code === "23503" ? "No se pudo eliminar: la jugada está en uso." : error.message,
      };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "No se pudo eliminar la regla de jugada." };
  }
}

/** Etiqueta legible de la comisión, como en la tabla del legacy. */
export function etiquetaComision(j: TipoJugada): string {
  return j.comision_porcentaje != null ? `${j.comision_porcentaje}%` : "—";
}

/** Etiqueta legible del tipo de cálculo. */
export function etiquetaCalculo(j: TipoJugada): string {
  return j.tipo_calculo === "POR_TABLA" ? "Por Tabla" : "Por Unidad";
}
