/**
 * CAPA DE DATOS DE LA INTELIGENCIA HÍPICA (Proyecciones).
 *
 * Reúne lo que hace falta para proyectar una carrera:
 *   1. LAS CARRERAS del día, leídas de la matriz `carreras` (la fuente única
 *      del catálogo: si no está ahí, no existe para nadie).
 *   2. LA MEMORIA HISTÓRICA de cada ejemplar, vía la RPC
 *      `rpc_obtener_memoria_historica_caballos` (con respaldo local al padrón).
 *   3. EL RANKING de probabilidad, calculado por el módulo puro
 *      `proyecciones.ts`.
 *
 * El cruce es por NOMBRE de ejemplar: la gaceta y el padrón identifican al
 * caballo por su nombre, y la carrera lo identifica por su número de
 * gualdrapa. El nombre se normaliza a MAYÚSCULAS antes de cruzar porque la
 * gaceta lo escribe como aparece impreso ("El Tremendo") y el padrón lo guarda
 * en mayúsculas.
 */
import { aCarreraCentral, leerCarrerasMaestro } from "@/features/carreras/lib/maestro";
import type { CarreraCatalogo } from "@/features/carreras/lib/maestro-nucleo";
import { leerMemoriaHistorica, type MemoriaEjemplar } from "@/features/gaceta/lib/padron";
import { fechaJornadaCaracas } from "@/core/utils/fechas";
import {
  calcularRankingActuarial,
  type ContextoCarrera,
  type EjemplarProyectable,
  type FilaProyeccion,
} from "@/features/inteligencia/lib/proyecciones";

export type ResCarrerasDia = {
  ok: boolean;
  carreras: CarreraCatalogo[];
  error?: string;
};

/** Carreras del día (matriz `carreras`), opcionalmente de un hipódromo. */
export async function leerCarrerasDeInteligencia(
  fecha?: string,
  hipodromo?: string
): Promise<ResCarrerasDia> {
  const f = fecha || fechaJornadaCaracas();
  const res = await leerCarrerasMaestro(f, hipodromo);
  if (!res.ok) return { ok: false, carreras: [], error: res.error };
  // `aCarreraCentral` es la MISMA normalización que usa el resto de la
  // plataforma (retirados, invalidados, estado): así la proyección ve la
  // carrera exactamente como la ven Taquilla y Liquidación.
  return { ok: true, carreras: res.filas.map((fila) => aCarreraCentral(fila)) };
}

/** Cruza la memoria histórica por nombre de ejemplar (normalizado). */
export function indexarMemoria(
  memoria: MemoriaEjemplar[]
): Map<string, MemoriaEjemplar> {
  const m = new Map<string, MemoriaEjemplar>();
  for (const e of memoria) {
    const k = String(e.nombre || "").trim().toUpperCase();
    if (k) m.set(k, e);
  }
  return m;
}

export type ProyeccionCarrera = {
  /** Carrera analizada. */
  carrera: CarreraCatalogo;
  /** Ranking con la probabilidad de cada ejemplar. */
  ranking: FilaProyeccion[];
  /** Memoria histórica que se pudo leer (vacía si la RPC no está aplicada). */
  memoria: MemoriaEjemplar[];
  /** Aviso de la fuente de la memoria (p. ej. "modo local"). */
  aviso?: string;
};

export type ResProyeccion = {
  ok: boolean;
  datos?: ProyeccionCarrera;
  error?: string;
};

/**
 * Arma la proyección de UNA carrera: cruza sus ejemplares con la memoria
 * histórica y calcula el ranking de probabilidad.
 */
export async function proyectarCarrera(
  carrera: CarreraCatalogo,
  fechaCorte?: string
): Promise<ResProyeccion> {
  const caballos = (carrera.caballos ?? []).filter((c) => c.nombre && !c.retirado);
  const nombres = caballos.map((c) => String(c.nombre).trim().toUpperCase());
  if (!nombres.length) {
    return { ok: false, error: "La carrera no tiene ejemplares con nombre registrado." };
  }

  const mem = await leerMemoriaHistorica(nombres, fechaCorte ?? carrera.fecha);
  if (!mem.ok) return { ok: false, error: mem.error };

  const porNombre = indexarMemoria(mem.data);
  const proyectables: EjemplarProyectable[] = caballos.map((c) => ({
    numero: Number(c.numero) || 0,
    nombre: String(c.nombre).trim().toUpperCase(),
    nacionalidad: c.nacionalidad ?? "VE",
    memoria: porNombre.get(String(c.nombre).trim().toUpperCase()) ?? null,
  }));

  const contexto: ContextoCarrera = {
    hipodromo: carrera.hipodromo,
    carrera: Number(carrera.carrera) || 0,
    fecha: String(carrera.fecha || "").slice(0, 10),
    distancia: Number(carrera.distancia) || 0,
    superficie: String(carrera.superficie || "ARENA").toUpperCase(),
    premio: Number(carrera.premio) || 0,
  };

  return {
    ok: true,
    datos: {
      carrera,
      ranking: calcularRankingActuarial(proyectables, contexto),
      memoria: mem.data,
      aviso: mem.aviso,
    },
  };
}
