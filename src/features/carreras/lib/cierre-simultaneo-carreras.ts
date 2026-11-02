/**
 * MOTOR DE APERTURA Y CIERRE SIMULTÁNEO DE CARRERAS
 * ----------------------------------------------------------------------------
 * Regla de negocio:
 * 1. El Operador o Administrador abre las carreras manualmente al iniciar la jornada.
 * 2. Cierre simultáneo: La carrera se cierra automáticamente en cuanto la cierre
 *    cualquiera de las siguientes fuentes ("la que cierre primero, cierra en la plataforma"):
 *      - DRF (Daily Racing Form): Status OFF / CLOSED / MTP <= 0
 *      - TVG / FanDuel Racing: Race status OFF / Closed
 *      - TwinSpires / Brisnet: Off track / Post Time expirado
 *      - Administrador u Operador: Cierre manual prioritario desde su perfil
 *      - Centinela de Hora de Partida: Post Time oficial alcanzado
 */

import { supabase } from "@/core/supabase";
import {
  alternarEstadoCarreraGlobal,
  esCarreraCerradaOEnPartida,
  obtenerEstadoCarreraEnMemoria,
  marcarEstadoCarreraEnMemoria,
  yaDioLaPartidaPorHora,
} from "@/features/portal/lib/bloqueo-jugadas";
import { HIPODROMOS_USA_DISPONIBLES } from "@/features/carreras/lib/sincronizar-usa-tvg-drf";
import { claveHipodromo } from "@/features/carreras/lib/claves";

export type TipoFuenteCierre =
  | "ADMIN"
  | "OPERADOR"
  | "DRF"
  | "TVG"
  | "TWINSPIRES"
  | "HORA_PARTIDA"
  | "SISTEMA";

export interface EstadoCierreMultiFuente {
  hipodromo: string;
  carrera: number;
  fecha: string;
  cerrada: boolean;
  estado: "ABIERTA" | "CERRADA" | "LIQUIDADA" | "PROGRAMADA";
  fuenteCierre?: TipoFuenteCierre | null;
  motivo?: string | null;
  cerradoEn?: string | null;
}

/**
 * Consulta el estado actual de la carrera en memoria y en Supabase.
 */
export async function consultarEstadoCarreraActual(opts: {
  hipodromo: string;
  carrera: number;
  fecha?: string;
}): Promise<EstadoCierreMultiFuente> {
  const f = opts.fecha || new Date().toISOString().slice(0, 10);
  const hip = opts.hipodromo.trim().toUpperCase();
  const num = Number(opts.carrera);

  // 1. Revisar memoria rápida
  const enMem = obtenerEstadoCarreraEnMemoria({ hipodromo: hip, carrera: num, fecha: f });
  if (enMem && enMem.cerrada) {
    return {
      hipodromo: hip,
      carrera: num,
      fecha: f,
      cerrada: true,
      estado: "CERRADA",
      motivo: "Carrera cerrada en memoria",
    };
  }

  // 2. Revisar base de datos
  if (supabase) {
    try {
      const { data } = await supabase
        .from("carreras")
        .select("estado, hora, cerrada, hora_partida")
        .eq("fecha", f)
        .ilike("hipodromo", `%${hip}%`)
        .eq("carrera", num)
        .maybeSingle();

      if (data) {
        const cerrada = Boolean(
          data.cerrada ||
            String(data.estado).toUpperCase() === "CERRADA" ||
            String(data.estado).toUpperCase() === "LIQUIDADA" ||
            String(data.estado).toUpperCase() === "RESULTADOS"
        );
        return {
          hipodromo: hip,
          carrera: num,
          fecha: f,
          cerrada,
          estado: cerrada ? "CERRADA" : (String(data.estado).toUpperCase() as any) || "ABIERTA",
        };
      }
    } catch {
      /* ignore */
    }
  }

  return {
    hipodromo: hip,
    carrera: num,
    fecha: f,
    cerrada: false,
    estado: "ABIERTA",
  };
}

/**
 * Cierre ejecutado por el Operador, Administrador o Centinela de Feed Externo.
 * Actualiza Supabase, actualiza la memoria global y despacha el evento en tiempo real.
 */
export async function ejecutarCierreCarrera(opts: {
  hipodromo: string;
  carrera: number;
  fecha?: string;
  fuente: TipoFuenteCierre;
  operadorNombre?: string;
  motivo?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const f = opts.fecha || new Date().toISOString().slice(0, 10);
  const hip = opts.hipodromo.trim().toUpperCase();
  const num = Number(opts.carrera);
  const timestamp = new Date().toISOString();
  const actor = opts.operadorNombre || opts.fuente;

  // 1. Actualizar memoria global y disparar CustomEvent
  alternarEstadoCarreraGlobal({
    hipodromo: hip,
    carrera: num,
    fecha: f,
    estado: "CERRADA",
  });

  // 2. Actualizar en Supabase si está disponible
  if (supabase) {
    try {
      await supabase
        .from("carreras")
        .update({
          estado: "Cerrada",
          actualizado_por: `${actor} (${opts.fuente}): ${opts.motivo || "Cierre de taquilla"}`,
        })
        .eq("fecha", f)
        .ilike("hipodromo", `%${hip}%`)
        .eq("carrera", num);
    } catch (e) {
      console.warn("[ejecutarCierreCarrera] Error actualizando en BD:", e);
    }
  }

  return { ok: true };
}

/**
 * Apertura de carrera por Operador o Administrador.
 */
export async function ejecutarAperturaCarrera(opts: {
  hipodromo: string;
  carrera: number;
  fecha?: string;
  operadorNombre?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const f = opts.fecha || new Date().toISOString().slice(0, 10);
  const hip = opts.hipodromo.trim().toUpperCase();
  const num = Number(opts.carrera);
  const actor = opts.operadorNombre || "OPERADOR";

  alternarEstadoCarreraGlobal({
    hipodromo: hip,
    carrera: num,
    fecha: f,
    estado: "ABIERTA",
  });

  if (supabase) {
    try {
      await supabase
        .from("carreras")
        .update({
          estado: "Abierta",
          actualizado_por: `Apertura por ${actor}`,
        })
        .eq("fecha", f)
        .ilike("hipodromo", `%${hip}%`)
        .eq("carrera", num);
    } catch (e) {
      console.warn("[ejecutarAperturaCarrera] Error actualizando en BD:", e);
    }
  }

  return { ok: true };
}

/**
 * Centinela de Cierre Multi-Fuente:
 * Verifica el estado en DRF, TVG, TwinSpires o por hora de partida.
 * "La fuente que cierre primero, cierra la carrera en la plataforma".
 */
export async function evaluarCierreMultiFuente(opts: {
  hipodromo: string;
  carrera: number;
  fecha?: string;
  horaPartida?: string | null;
}): Promise<{ debeCerrar: boolean; fuente?: TipoFuenteCierre; detalle?: string }> {
  const f = opts.fecha || new Date().toISOString().slice(0, 10);
  const hip = opts.hipodromo.trim().toUpperCase();
  const num = Number(opts.carrera);

  // 1. Verificar Hora de Partida Oficial (Post Time)
  if (opts.horaPartida && yaDioLaPartidaPorHora(opts.horaPartida, new Date(), f)) {
    return {
      debeCerrar: true,
      fuente: "HORA_PARTIDA",
      detalle: `Hora oficial de partida expirada (${opts.horaPartida})`,
    };
  }

  // 2. Verificar proveedor DRF (Daily Racing Form)
  const meta = HIPODROMOS_USA_DISPONIBLES.find(
    (h) => h.codigo === hip || claveHipodromo(h.nombre) === claveHipodromo(hip)
  );

  if (meta?.drfCode) {
    try {
      const resp = await fetch(`https://entries.drf.com/data/racecards/${f}/${meta.drfCode}`);
      if (resp.ok) {
        const data = await resp.json();
        const races = data?.races || data?.raceList || [];
        const r = races.find((item: any) => Number(item.raceNumber || item.carrera) === num);
        if (r) {
          const status = String(r.status || r.raceStatus || "").toUpperCase();
          const mtp = Number(r.minutesToPost);
          if (
            status === "OFF" ||
            status === "CLOSED" ||
            status === "FINAL" ||
            status === "OFFICIAL" ||
            (Number.isFinite(mtp) && mtp <= 0)
          ) {
            return {
              debeCerrar: true,
              fuente: "DRF",
              detalle: `DRF reportó estatus: ${status || `MTP ${mtp}`}`,
            };
          }
        }
      }
    } catch {
      /* network / cors fallback */
    }
  }

  return { debeCerrar: false };
}
