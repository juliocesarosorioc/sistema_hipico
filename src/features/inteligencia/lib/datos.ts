/**
 * CAPA DE DATOS DE LA INTELIGENCIA HÍPICA (Proyecciones + Pizarra).
 *
 * Reúne lo que hace falta para proyectar una carrera:
 *   1. LAS CARRERAS del día, leídas de la matriz `carreras` (la fuente única
 *      del catálogo: si no está ahí, no existe para nadie).
 *   2. LA MEMORIA HISTÓRICA de cada ejemplar, vía la RPC
 *      `rpc_obtener_memoria_historica_caballos` (con respaldo local al padrón).
 *   3. LA PROGRAMACIÓN DEL DÍA (`programa_dia`): jinete y peso declarados para
 *      HOY. Es el único origen real de los "pesos en vivo" de la pizarra: sin
 *      este dato el ajuste por peso se neutraliza y la UI lo dice.
 *   4. EL RANKING de probabilidad, calculado por el módulo puro
 *      `proyecciones.ts`.
 *   5. LOS INSUMOS de la pizarra prospectiva (`pizarra.ts`), con activos y
 *      retirados, para que el tablero pueda redistribuir el 100% al retirar.
 *
 * El cruce es por NOMBRE de ejemplar: la gaceta y el padrón identifican al
 * caballo por su nombre, y la carrera lo identifica por su número de
 * gualdrapa. El nombre se normaliza a MAYÚSCULAS antes de cruzar porque la
 * gaceta lo escribe como aparece impreso ("El Tremendo") y el padrón lo guarda
 * en mayúsculas.
 */
import { aCarreraCentral, leerCarrerasMaestro } from "@/features/carreras/lib/maestro";
import type { CarreraCatalogo } from "@/features/carreras/lib/maestro-nucleo";
import { claveHipodromo } from "@/features/carreras/lib/claves";
import { leerMemoriaHistorica, type MemoriaEjemplar } from "@/features/gaceta/lib/padron";
import { leerProgramaPorFecha } from "@/features/gaceta/lib/programa";
import { fechaJornadaCaracas } from "@/core/utils/fechas";
import {
  calcularRankingActuarial,
  diasDesdeUltima,
  type ContextoCarrera,
  type EjemplarProyectable,
  type FilaProyeccion,
} from "@/features/inteligencia/lib/proyecciones";
import type { InsumoPizarra } from "@/features/inteligencia/lib/pizarra";

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

/** Jinete y peso declarados para un ejemplar en la carrera de hoy. */
export type ProgramacionEjemplar = {
  pesoHoyKg: number | null;
  jockey: string;
};

/**
 * Peso declarado en kilos.
 *
 * El programa lo guarda como número o como texto ("54", "54,5", "54 Kg"). Se
 * acepta cualquiera, pero SOLO en el rango de hándicap (30–80 kg): si el OCR
 * devolvió el peso corporal del caballo (400+) o un valor basura, se descarta
 * en vez de envenenar el ajuste de la pizarra.
 */
export function pesoDeclaradoKg(valor: unknown): number | null {
  if (valor == null || valor === "") return null;
  const limpio = String(valor).replace(",", ".").replace(/[^\d.]/g, "");
  const n = Number(limpio);
  if (!Number.isFinite(n) || n < 30 || n > 80) return null;
  return Number(n.toFixed(1));
}

/** Lee la programación (peso + jinete) de UNA carrera del programa del día. */
export async function leerProgramacionDeCarrera(
  fecha: string,
  hipodromo: string,
  carrera: number | string
): Promise<Record<number, ProgramacionEjemplar>> {
  const res = await leerProgramaPorFecha(fecha);
  if (!res.ok || !res.data) return {};

  const clave = claveHipodromo(hipodromo);
  const n = Number(carrera) || 0;
  const fila = res.data.carreras.find(
    (c) => claveHipodromo(c.hipodromo) === clave && Number(c.carrera) === n
  );
  if (!fila) return {};

  const salida: Record<number, ProgramacionEjemplar> = {};
  for (const cb of fila.caballos ?? []) {
    const num = Number(cb.numero);
    if (!Number.isFinite(num) || num <= 0) continue;
    salida[num] = {
      pesoHoyKg: pesoDeclaradoKg(cb.peso),
      jockey: String(cb.jockey ?? "").trim(),
    };
  }
  return salida;
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
  /** Peso y jinete declarados hoy, por número de gualdrapa. */
  programacion: Record<number, ProgramacionEjemplar>;
  /** Insumos de la pizarra: TODOS los ejemplares, activos y retirados. */
  insumosPizarra: InsumoPizarra[];
  /** Distancia de la carrera en metros (0 = no declarada). */
  distancia: number;
};

export type ResProyeccion = {
  ok: boolean;
  datos?: ProyeccionCarrera;
  error?: string;
};

/** Distancia usable de la carrera (tolera "1100 m" o 1100). */
export function distanciaDeCarrera(carrera: Pick<CarreraCatalogo, "distancia">): number {
  const limpio = String(carrera.distancia ?? "").replace(",", ".").replace(/[^\d.]/g, "");
  const n = Number(limpio);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Arma la proyección de UNA carrera: cruza sus ejemplares con la memoria
 * histórica y la programación del día, calcula el ranking de probabilidad y
 * prepara los insumos de la pizarra.
 */
export async function proyectarCarrera(
  carrera: CarreraCatalogo,
  fechaCorte?: string
): Promise<ResProyeccion> {
  const caballos = (carrera.caballos ?? []).filter((c) => c.nombre);
  const activos = caballos.filter((c) => !c.retirado);
  const nombres = activos.map((c) => String(c.nombre).trim().toUpperCase());
  if (!nombres.length) {
    return { ok: false, error: "La carrera no tiene ejemplares activos con nombre registrado." };
  }

  const [mem, programacion] = await Promise.all([
    leerMemoriaHistorica(nombres, fechaCorte ?? carrera.fecha),
    leerProgramacionDeCarrera(carrera.fecha, carrera.hipodromo, carrera.carrera),
  ]);
  if (!mem.ok) return { ok: false, error: mem.error };

  const porNombre = indexarMemoria(mem.data);
  const proyectables: EjemplarProyectable[] = activos.map((c) => ({
    numero: Number(c.numero) || 0,
    nombre: String(c.nombre).trim().toUpperCase(),
    nacionalidad: c.nacionalidad ?? "VE",
    memoria: porNombre.get(String(c.nombre).trim().toUpperCase()) ?? null,
  }));

  const contexto: ContextoCarrera = {
    hipodromo: carrera.hipodromo,
    carrera: Number(carrera.carrera) || 0,
    fecha: String(carrera.fecha || "").slice(0, 10),
    distancia: distanciaDeCarrera(carrera),
    superficie: String(carrera.superficie || "ARENA").toUpperCase(),
    premio: Number(carrera.premio) || 0,
  };

  const ranking = calcularRankingActuarial(proyectables, contexto);

  const insumosPizarra: InsumoPizarra[] = caballos.map((c) => {
    const num = Number(c.numero) || 0;
    const nombre = String(c.nombre).trim().toUpperCase();
    const m = porNombre.get(nombre) ?? null;
    const prog = programacion[num];
    const ultima = m?.historial?.[0]?.fecha ?? null;
    return {
      numero: num,
      nombre,
      nacionalidad: c.nacionalidad ?? m?.nacionalidad ?? "VE",
      speedRating: m?.speedRating ?? 0,
      consistencia: m?.indiceConsistenciaGodet ?? 0,
      actuaciones: m?.actuaciones ?? 0,
      placements: m?.placements ?? 0,
      winRate: m?.winRate ?? 0,
      diasDescanso: diasDesdeUltima(ultima, contexto.fecha),
      efectividadYunta: Number(((m?.winRate ?? 0) / 100).toFixed(3)) || 0.5,
      pesoHoyKg: prog?.pesoHoyKg ?? null,
      jockey: prog?.jockey || m?.jineteHabitual || "",
      entrenador: m?.entrenadorHabitual ?? "",
      distancias: (m?.historial ?? []).map((h) => Number(h.distancia) || 0),
      retirado: c.retirado === true,
    };
  });

  return {
    ok: true,
    datos: {
      carrera,
      ranking,
      memoria: mem.data,
      aviso: mem.aviso,
      programacion,
      insumosPizarra,
      distancia: contexto.distancia,
    },
  };
}
